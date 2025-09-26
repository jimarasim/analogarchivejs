//get cert with: google "self signed certificate"
//openssl req -nodes -new -x509 -keyout server.key -out server.cert
import 'dotenv/config';
import { parseFile } from 'music-metadata';
import {createServer} from 'https';
import {promises, readFileSync} from 'fs';
import {join, extname} from 'path';
import * as url from 'url';
import express from 'express';
import B2 from 'backblaze-b2';

const app = express();
const port = 50001;
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
//use self-signed certificate for localhost development
const options = {key: readFileSync('./ssl/server.key'),
    cert: readFileSync('./ssl/server.cert')}
const directoryPathMusic = "./music";
const directoryPathVideo = "./video";

// Backblaze B2 configuration
const b2 = new B2({
    applicationKeyId: process.env.B2_APPLICATION_KEY_ID, // Set these in your environment
    applicationKey: process.env.B2_APPLICATION_KEY
});
const bucketName = 'analogarchive';

//make files available in music subdirectory
app.use('/music', express.static(join(__dirname, directoryPathMusic.substring(2))));
app.use('/video', express.static(join(__dirname, directoryPathVideo.substring(2))));
app.get('/Archive.zip', function(req,res){
    res.sendFile(__dirname + '/Archive.zip');
});
app.get('/favicon.ico', function(req,res){
    res.sendFile(__dirname + '/favicon.ico');
});
app.get('/styles.css', function(req, res) {
    res.set('Content-Type', 'text/css');
    res.sendFile(__dirname + '/styles.css');
});

// Local metadata endpoint for root endpoint files
app.get('/localmetadata/:filename(*)', async (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const filePath = join(directoryPathMusic, filename);

        console.log(`Getting local metadata for: ${filePath}`);

        // Parse metadata from local file
        const metadata = await parseFile(filePath);
        const artwork = await extractArtwork(filePath);

        console.log('Local metadata parsed successfully');
        console.log('Artist:', metadata.common.artist);
        console.log('Title:', metadata.common.title);
        console.log('Album:', metadata.common.album);

        // Return metadata as JSON
        res.json({
            artist: metadata.common.artist || 'Unknown Artist',
            album: metadata.common.album || 'Unknown Album',
            title: metadata.common.title || filename,
            artwork: artwork,
            duration: metadata.format.duration || 0
        });
    } catch (err) {
        console.error('Error getting local metadata:', err);
        res.status(500).json({ error: 'Local metadata extraction failed', message: err.message });
    }
});

// Metadata endpoint to get song info from B2 files
app.get('/b2metadata/:folder/:filename(*)', async (req, res) => {
    try {
        await b2.authorize();
        const folder = req.params.folder;
        const filename = decodeURIComponent(req.params.filename);
        const fullPath = `${folder}/${filename}`;

        console.log(`Getting metadata for: ${fullPath}`);

        // Download the file from B2
        const fileData = await b2.downloadFileByName({
            bucketName: bucketName,
            fileName: fullPath,
            responseType: 'arraybuffer'
        });

        if (fileData.data) {
            // Convert to buffer for metadata parsing
            let buffer;
            if (fileData.data instanceof ArrayBuffer) {
                buffer = Buffer.from(fileData.data);
            } else if (Buffer.isBuffer(fileData.data)) {
                buffer = fileData.data;
            } else {
                buffer = Buffer.from(fileData.data);
            }

            console.log(`Buffer size: ${buffer.length} bytes`);

            // Parse metadata from the buffer using parseBuffer instead of parseFile
            const { parseBuffer } = await import('music-metadata');
            const metadata = await parseBuffer(buffer, { duration: true });

            console.log('Metadata parsed successfully');
            console.log('Artist:', metadata.common.artist);
            console.log('Title:', metadata.common.title);
            console.log('Album:', metadata.common.album);

            // Extract artwork
            let artwork = "";
            if (metadata.common.picture && metadata.common.picture[0]) {
                const picture = metadata.common.picture[0];
                artwork = picture.data.toString('base64');
                console.log('Artwork extracted, size:', artwork.length);
            }

            // Return metadata as JSON
            res.json({
                artist: metadata.common.artist || 'Unknown Artist',
                album: metadata.common.album || 'Unknown Album',
                title: metadata.common.title || filename,
                artwork: artwork,
                duration: metadata.format.duration || 0
            });
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (err) {
        console.error('Error getting metadata:', err);
        res.status(500).json({ error: 'Metadata extraction failed', message: err.message });
    }
});

// Proxy endpoint to serve B2 files and avoid CORS issues
app.get('/b2proxy/:folder/:filename(*)', async (req, res) => {
    try {
        console.log('=== B2 Proxy Request Start ===');
        console.log(`Folder: ${req.params.folder}`);
        console.log(`Filename param: ${req.params.filename}`);

        await b2.authorize();
        const folder = req.params.folder;
        const filename = decodeURIComponent(req.params.filename);
        const fullPath = `${folder}/${filename}`;

        console.log(`Decoded filename: ${filename}`);
        console.log(`Full path: ${fullPath}`);

        // Download the file from B2
        console.log('Starting B2 download...');
        const fileData = await b2.downloadFileByName({
            bucketName: bucketName,
            fileName: fullPath,
            responseType: 'arraybuffer'
        });

        console.log(`Download successful`);
        console.log(`Data exists: ${fileData.data ? 'yes' : 'no'}`);

        if (fileData.data) {
            console.log(`Data type: ${typeof fileData.data}`);
            console.log(`Data length: ${fileData.data.byteLength || fileData.data.length || 'unknown'}`);
        }

        // Set appropriate headers
        res.set('Content-Type', 'audio/mpeg');
        res.set('Accept-Ranges', 'bytes');
        res.set('Cache-Control', 'public, max-age=3600');
        res.set('Access-Control-Allow-Origin', '*');

        // Handle the data
        if (fileData.data) {
            let buffer;
            if (fileData.data instanceof ArrayBuffer) {
                buffer = Buffer.from(fileData.data);
                console.log('Converted ArrayBuffer to Buffer');
            } else if (Buffer.isBuffer(fileData.data)) {
                buffer = fileData.data;
                console.log('Data is already a Buffer');
            } else {
                buffer = Buffer.from(fileData.data);
                console.log('Converted data to Buffer');
            }

            console.log(`Sending buffer of size: ${buffer.length}`);
            res.send(buffer);
            console.log('=== B2 Proxy Request Success ===');
        } else {
            console.error('No file data in response');
            res.status(404).send('File data not found');
        }
    } catch (err) {
        console.error('=== B2 Proxy Request Error ===');
        console.error('Error type:', err.constructor.name);
        console.error('Error message:', err.message);
        console.error('Error status:', err.status);
        console.error('Error response:', err.response?.data);
        console.error('Full error stack:', err.stack);

        // Don't crash the server, send error response
        try {
            if (!res.headersSent) {
                res.status(500).json({
                    error: 'Proxy error',
                    message: err.message,
                    file: req.params.filename
                });
            }
        } catch (sendError) {
            console.error('Error sending error response:', sendError);
        }
        console.error('=== B2 Proxy Request Error End ===');
    }
});

// Original local music endpoint
app.get('/', async (req,res) =>{
    try {
        const files = await promises.readdir(directoryPathMusic);
        let fileNames = '<html><head><title>ananlogarchivejs</title><link rel="stylesheet" href="styles.css"></head><body><div class="container">';
        for (const file of files) {
            const filePath = join(directoryPathMusic, file);
            const stats = await promises.stat(filePath);
            if (stats.isFile() && extname(filePath).toLowerCase() === '.mp3') {
                const metadata = await parseFile(filePath);
                const artwork = await extractArtwork(filePath);
                fileNames += `
                <a class="link" 
                style="background-image:url('data:image/png;base64,${artwork}')" 
                onclick="playAudio('music/${file}', this)">
                ${metadata.common.artist}
                ${metadata.common.album}
                ${metadata.common.title}
                </a>`;
            }
        }
        fileNames += '</div>'
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write(fileNames);
        res.end(`        <script>
              let currentAudio = null;
              let currentLink = null;
              let currentMetadataDiv = null;
              
              async function playAudio(audioSrc, link) {
                console.log('Playing:', audioSrc);
                
                // If there's already a playing audio, stop it and convert back to link
                if (currentAudio && currentLink) {
                  currentAudio.pause();
                  currentAudio.parentNode.replaceChild(currentLink, currentAudio);
                  if (currentMetadataDiv) {
                    currentMetadataDiv.remove();
                  }
                  currentAudio = null;
                  currentLink = null;
                  currentMetadataDiv = null;
                }
                
                // Create a new audio element
                const audio = new Audio();
                audio.controls = true;
                
                // Create metadata display container
                const metadataDiv = document.createElement('div');
                metadataDiv.className = 'now-playing-metadata';
                metadataDiv.style.cssText = \`
                  display: flex;
                  align-items: center;
                  background: linear-gradient(135deg, #1e3c72, #2a5298);
                  color: white;
                  padding: 15px;
                  border-radius: 8px;
                  margin: 10px 0;
                  box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                \`;
                
                // Add loading state
                metadataDiv.innerHTML = \`
                  <div style="width: 80px; height: 80px; background: #444; border-radius: 4px; display: flex; align-items: center; justify-content: center; margin-right: 15px;">
                    <span style="color: #888;">♪</span>
                  </div>
                  <div>
                    <div style="font-size: 18px; font-weight: bold; margin-bottom: 5px;">Loading...</div>
                    <div style="opacity: 0.8;">Fetching metadata...</div>
                  </div>
                \`;
                
                audio.addEventListener('loadstart', () => console.log('Loading started:', audioSrc));
                audio.addEventListener('canplay', () => console.log('Can start playing'));
                audio.addEventListener('error', (e) => {
                    console.error('Audio error:', e);
                    console.error('Audio error details:', audio.error);
                });
                
                audio.src = audioSrc;
                
                // Replace the link with audio and metadata
                const container = document.createElement('div');
                container.appendChild(metadataDiv);
                container.appendChild(audio);
                link.parentNode.replaceChild(container, link);
                
                // Store references
                currentAudio = audio;
                currentLink = link;
                currentMetadataDiv = container;
                
                // Fetch and display metadata (use local metadata endpoint for root)
                try {
                  const filename = audioSrc.replace('music/', '');
                  const metadataUrl = \`/localmetadata/\${encodeURIComponent(filename)}\`;
                  console.log('Fetching local metadata from:', metadataUrl);
                  const response = await fetch(metadataUrl);
                  const metadata = await response.json();
                  
                  console.log('Metadata received:', metadata);
                  
                  const artworkSrc = metadata.artwork ? 
                    \`data:image/png;base64,\${metadata.artwork}\` : 
                    'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg width="80" height="80" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg"><rect width="80" height="80" fill="#444"/><text x="40" y="45" text-anchor="middle" fill="#888" font-size="20">♪</text></svg>');
                  
                  metadataDiv.innerHTML = \`
                    <img src="\${artworkSrc}" 
                         style="width: 80px; height: 80px; border-radius: 4px; margin-right: 15px; object-fit: cover;" 
                         onerror="this.style.display='none';">
                    <div>
                      <div style="font-size: 18px; font-weight: bold; margin-bottom: 5px;">\${metadata.title}</div>
                      <div style="opacity: 0.9; margin-bottom: 3px;">\${metadata.artist}</div>
                      <div style="opacity: 0.7; font-size: 14px;">\${metadata.album}</div>
                    </div>
                  \`;
                } catch (metadataError) {
                  console.error('Failed to load local metadata:', metadataError);
                  // Keep loading state or show error
                }
                
                // Try to play after a short delay
                setTimeout(() => {
                    audio.play().catch(e => {
                        console.error('Play failed:', e);
                    });
                }, 200);
                
                // When the audio ends, replace everything with the original link
                audio.addEventListener('ended', () => {
                  container.parentNode.replaceChild(link, container);
                  currentAudio = null;
                  currentLink = null;
                  currentMetadataDiv = null;
                  
                  let nextLink = link.nextElementSibling;
                  if(nextLink != null){
                    nextLink.click();
                  }
                });
              }
        </script></body></html>`);
    } catch (err) {
        console.error(err);
        res.writeHead(500);
        res.end('Internal Server Error');
    }
});

// New endpoint for analog folder from Backblaze B2
app.get('/analog', async (req, res) => {
    try {
        await b2.authorize();

        // Get bucket information first
        const bucket = await b2.getBucket({ bucketName });
        const bucketId = bucket.data.buckets[0].bucketId;
        console.log(`Using bucket ID: ${bucketId}`);

        // List files in the analog folder
        const response = await b2.listFileNames({
            bucketId: bucketId,
            startFileName: 'analog/',
            prefix: 'analog/',
            maxFileCount: 10000
        });

        console.log(`Found ${response.data.files.length} files in analog folder`);

        let fileNames = '<html><head><title>ananlogarchivejs - Analog</title><link rel="stylesheet" href="styles.css"></head><body><div class="container">';

        for (const file of response.data.files) {
            if (file.fileName.toLowerCase().endsWith('.mp3') && file.fileName !== 'analog/') {
                const fileName = file.fileName.split('/').pop(); // Get just the filename
                // Use our proxy endpoint to avoid CORS issues
                const proxyUrl = `/b2proxy/analog/${encodeURIComponent(fileName)}`;

                console.log(`File: ${file.fileName} -> Proxy URL: ${proxyUrl}`);

                fileNames += `
                <a class="link" 
                onclick="playAudio('${proxyUrl}', this)">
                ${fileName}
                </a>`;
            }
        }

        fileNames += '</div>';
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write(fileNames);
        res.end(`        <script>
              let currentAudio = null;
              let currentLink = null;
              let currentMetadataDiv = null;
              
              async function playAudio(audioSrc, link) {
                console.log('Playing:', audioSrc);
                
                // If there's already a playing audio, stop it and convert back to link
                if (currentAudio && currentLink) {
                  currentAudio.pause();
                  currentAudio.parentNode.replaceChild(currentLink, currentAudio);
                  if (currentMetadataDiv) {
                    currentMetadataDiv.remove();
                  }
                  currentAudio = null;
                  currentLink = null;
                  currentMetadataDiv = null;
                }
                
                // Create a new audio element
                const audio = new Audio();
                audio.controls = true;
                
                // Create metadata display container
                const metadataDiv = document.createElement('div');
                metadataDiv.className = 'now-playing-metadata';
                metadataDiv.style.cssText = \`
                  display: flex;
                  align-items: center;
                  background: linear-gradient(135deg, #1e3c72, #2a5298);
                  color: white;
                  padding: 15px;
                  border-radius: 8px;
                  margin: 10px 0;
                  box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                \`;
                
                // Add loading state
                metadataDiv.innerHTML = \`
                  <div style="width: 80px; height: 80px; background: #444; border-radius: 4px; display: flex; align-items: center; justify-content: center; margin-right: 15px;">
                    <span style="color: #888;">♪</span>
                  </div>
                  <div>
                    <div style="font-size: 18px; font-weight: bold; margin-bottom: 5px;">Loading...</div>
                    <div style="opacity: 0.8;">Fetching metadata...</div>
                  </div>
                \`;
                
                audio.addEventListener('loadstart', () => console.log('Loading started:', audioSrc));
                audio.addEventListener('canplay', () => console.log('Can start playing'));
                audio.addEventListener('error', (e) => {
                    console.error('Audio error:', e);
                    console.error('Audio error details:', audio.error);
                });
                
                audio.src = audioSrc;
                
                // Replace the link with audio and metadata
                const container = document.createElement('div');
                container.appendChild(metadataDiv);
                container.appendChild(audio);
                link.parentNode.replaceChild(container, link);
                
                // Store references
                currentAudio = audio;
                currentLink = link;
                currentMetadataDiv = container;
                
                // Fetch and display metadata
                try {
                  const metadataUrl = audioSrc.replace('/b2proxy/', '/b2metadata/');
                  console.log('Fetching metadata from:', metadataUrl);
                  const response = await fetch(metadataUrl);
                  const metadata = await response.json();
                  
                  console.log('Metadata received:', metadata);
                  
                  const artworkSrc = metadata.artwork ? 
                    \`data:image/jpeg;base64,\${metadata.artwork}\` : 
                    'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg width="80" height="80" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg"><rect width="80" height="80" fill="#444"/><text x="40" y="45" text-anchor="middle" fill="#888" font-size="20">♪</text></svg>');
                  
                  metadataDiv.innerHTML = \`
                    <img src="\${artworkSrc}" 
                         style="width: 80px; height: 80px; border-radius: 4px; margin-right: 15px; object-fit: cover;" 
                         onerror="this.style.display='none';">
                    <div>
                      <div style="font-size: 18px; font-weight: bold; margin-bottom: 5px;">\${metadata.title}</div>
                      <div style="opacity: 0.9; margin-bottom: 3px;">\${metadata.artist}</div>
                      <div style="opacity: 0.7; font-size: 14px;">\${metadata.album}</div>
                    </div>
                  \`;
                } catch (metadataError) {
                  console.error('Failed to load metadata:', metadataError);
                  // Keep loading state or show error
                }
                
                // Try to play after a short delay
                setTimeout(() => {
                    audio.play().catch(e => {
                        console.error('Play failed:', e);
                    });
                }, 200);
                
                // When the audio ends, replace everything with the original link
                audio.addEventListener('ended', () => {
                  container.parentNode.replaceChild(link, container);
                  currentAudio = null;
                  currentLink = null;
                  currentMetadataDiv = null;
                  
                  let nextLink = link.nextElementSibling;
                  if(nextLink != null){
                    nextLink.click();
                  }
                });
              }
        </script></body></html>`);
    } catch (err) {
        console.error('Error fetching analog folder:', err);
        res.writeHead(500);
        res.end('Internal Server Error');
    }
});

// New endpoint for live folder from Backblaze B2
app.get('/live', async (req, res) => {
    try {
        await b2.authorize();

        // Get bucket information first
        const bucket = await b2.getBucket({ bucketName });
        const bucketId = bucket.data.buckets[0].bucketId;
        console.log(`Using bucket ID: ${bucketId}`);

        // List files in the live folder
        const response = await b2.listFileNames({
            bucketId: bucketId,
            startFileName: 'live/',
            prefix: 'live/',
            maxFileCount: 10000
        });

        console.log(`Found ${response.data.files.length} files in live folder`);

        let fileNames = '<html><head><title>ananlogarchivejs - Live</title><link rel="stylesheet" href="styles.css"></head><body><div class="container">';

        for (const file of response.data.files) {
            if (file.fileName.toLowerCase().endsWith('.mp3') && file.fileName !== 'live/') {
                const fileName = file.fileName.split('/').pop(); // Get just the filename
                // Use our proxy endpoint to avoid CORS issues
                const proxyUrl = `/b2proxy/live/${encodeURIComponent(fileName)}`;

                console.log(`File: ${file.fileName} -> Proxy URL: ${proxyUrl}`);

                fileNames += `
                <a class="link" 
                onclick="playAudio('${proxyUrl}', this)">
                ${fileName}
                </a>`;
            }
        }

        fileNames += '</div>';
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write(fileNames);
        res.end(`        <script>
              let currentAudio = null;
              let currentLink = null;
              let currentMetadataDiv = null;
              
              async function playAudio(audioSrc, link) {
                console.log('Playing:', audioSrc);
                
                // If there's already a playing audio, stop it and convert back to link
                if (currentAudio && currentLink) {
                  currentAudio.pause();
                  currentAudio.parentNode.replaceChild(currentLink, currentAudio);
                  if (currentMetadataDiv) {
                    currentMetadataDiv.remove();
                  }
                  currentAudio = null;
                  currentLink = null;
                  currentMetadataDiv = null;
                }
                
                // Create a new audio element
                const audio = new Audio();
                audio.controls = true;
                
                // Create metadata display container
                const metadataDiv = document.createElement('div');
                metadataDiv.className = 'now-playing-metadata';
                metadataDiv.style.cssText = \`
                  display: flex;
                  align-items: center;
                  background: linear-gradient(135deg, #1e3c72, #2a5298);
                  color: white;
                  padding: 15px;
                  border-radius: 8px;
                  margin: 10px 0;
                  box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                \`;
                
                // Add loading state
                metadataDiv.innerHTML = \`
                  <div style="width: 80px; height: 80px; background: #444; border-radius: 4px; display: flex; align-items: center; justify-content: center; margin-right: 15px;">
                    <span style="color: #888;">♪</span>
                  </div>
                  <div>
                    <div style="font-size: 18px; font-weight: bold; margin-bottom: 5px;">Loading...</div>
                    <div style="opacity: 0.8;">Fetching metadata...</div>
                  </div>
                \`;
                
                audio.addEventListener('loadstart', () => console.log('Loading started:', audioSrc));
                audio.addEventListener('canplay', () => console.log('Can start playing'));
                audio.addEventListener('error', (e) => {
                    console.error('Audio error:', e);
                    console.error('Audio error details:', audio.error);
                });
                
                audio.src = audioSrc;
                
                // Replace the link with audio and metadata
                const container = document.createElement('div');
                container.appendChild(metadataDiv);
                container.appendChild(audio);
                link.parentNode.replaceChild(container, link);
                
                // Store references
                currentAudio = audio;
                currentLink = link;
                currentMetadataDiv = container;
                
                // Fetch and display metadata
                try {
                  const metadataUrl = audioSrc.replace('/b2proxy/', '/b2metadata/');
                  console.log('Fetching metadata from:', metadataUrl);
                  const response = await fetch(metadataUrl);
                  const metadata = await response.json();
                  
                  console.log('Metadata received:', metadata);
                  
                  const artworkSrc = metadata.artwork ? 
                    \`data:image/jpeg;base64,\${metadata.artwork}\` : 
                    'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg width="80" height="80" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg"><rect width="80" height="80" fill="#444"/><text x="40" y="45" text-anchor="middle" fill="#888" font-size="20">♪</text></svg>');
                  
                  metadataDiv.innerHTML = \`
                    <img src="\${artworkSrc}" 
                         style="width: 80px; height: 80px; border-radius: 4px; margin-right: 15px; object-fit: cover;" 
                         onerror="this.style.display='none';">
                    <div>
                      <div style="font-size: 18px; font-weight: bold; margin-bottom: 5px;">\${metadata.title}</div>
                      <div style="opacity: 0.9; margin-bottom: 3px;">\${metadata.artist}</div>
                      <div style="opacity: 0.7; font-size: 14px;">\${metadata.album}</div>
                    </div>
                  \`;
                } catch (metadataError) {
                  console.error('Failed to load metadata:', metadataError);
                  // Keep loading state or show error
                }
                
                // Try to play after a short delay
                setTimeout(() => {
                    audio.play().catch(e => {
                        console.error('Play failed:', e);
                    });
                }, 200);
                
                // When the audio ends, replace everything with the original link
                audio.addEventListener('ended', () => {
                  container.parentNode.replaceChild(link, container);
                  currentAudio = null;
                  currentLink = null;
                  currentMetadataDiv = null;
                  
                  let nextLink = link.nextElementSibling;
                  if(nextLink != null){
                    nextLink.click();
                  }
                });
              }
        </script></body></html>`);
    } catch (err) {
        console.error('Error fetching live folder:', err);
        res.writeHead(500);
        res.end('Internal Server Error');
    }
});

// Original movie endpoint
app.get('/movie', async (req,res) =>{
    try {
        let fileNames = '' +
            '<html>' +
            '<head>' +
            '<title>ananlogarchivejs</title>' +
            '<link rel="stylesheet" href="styles.css">' +
            '</head>' +
            '<body>' +
            '<div class="videocontainer">';
        const files = await promises.readdir(directoryPathVideo);
        for (const file of files) {
            const filePath = join(directoryPathVideo, file);
            const stats = await promises.stat(filePath);
            if (stats.isFile() && extname(filePath).toLowerCase() === '.mp4') {
                fileNames += `
                <div class="video">
                    <video width="320 "controls>
                      <source src="${filePath}" type="video/mp4">
                      Your browser does not support the video tag.
                    </video>
                    <b>${file}</b>
                </div>
                `;
            }
        }
        fileNames += '</div>'
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write(fileNames);
        res.end(`</body></html>`);
    } catch (err) {
        console.error(err);
        res.writeHead(500);
        res.end('Internal Server Error');
    }
});

createServer(options, app).listen(port, () => {
    console.log(`Server listening on https://localhost:${port}`);
    console.log(`Server listening on https://localhost:${port}/movie`);
    console.log(`Server listening on https://localhost:${port}/analog`);
    console.log(`Server listening on https://localhost:${port}/live`);
});

async function extractArtwork(filePath) {
    const metadata = await parseFile(filePath);
    if(metadata.common.picture===undefined){
        return "";
    }else {
        const picture = metadata.common.picture[0];
        return picture.data.toString('base64');
    }
}