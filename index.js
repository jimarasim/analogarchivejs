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

// Proxy endpoint to serve B2 files and avoid CORS issues
app.get('/b2proxy/:folder/:filename(*)', async (req, res) => {
    try {
        await b2.authorize();
        const folder = req.params.folder;
        const filename = decodeURIComponent(req.params.filename); // Decode here
        const fullPath = `${folder}/${filename}`;

        console.log(`Proxying B2 file: ${fullPath}`);

        // Download the file from B2
        const fileData = await b2.downloadFileByName({
            bucketName: bucketName,
            fileName: fullPath,
            responseType: 'arraybuffer' // Ensure we get binary data
        });

        console.log(`File downloaded successfully`);
        console.log(`Response type: ${typeof fileData}`);
        console.log(`Has data property: ${fileData.data ? 'yes' : 'no'}`);
        console.log(`Data type: ${typeof fileData.data}`);
        console.log(`Data length: ${fileData.data ? fileData.data.byteLength || fileData.data.length : 'N/A'}`);

        // Set appropriate headers
        res.set('Content-Type', 'audio/mpeg');
        res.set('Accept-Ranges', 'bytes');
        res.set('Cache-Control', 'public, max-age=3600');
        res.set('Access-Control-Allow-Origin', '*');

        // The data should be in fileData.data as a buffer/arraybuffer
        if (fileData.data) {
            // Convert arraybuffer to buffer if needed
            let buffer;
            if (fileData.data instanceof ArrayBuffer) {
                buffer = Buffer.from(fileData.data);
            } else if (Buffer.isBuffer(fileData.data)) {
                buffer = fileData.data;
            } else {
                buffer = Buffer.from(fileData.data);
            }

            res.send(buffer);
        } else {
            console.error('No file data in response');
            res.status(404).send('File data not found');
        }
    } catch (err) {
        console.error('Error proxying B2 file:', err);
        console.error('Error message:', err.message);
        console.error('Error status:', err.status);
        res.status(404).send('File not found: ' + err.message);
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
              function playAudio(audioSrc, link) {
                // Create a new audio element
                const audio = new Audio(audioSrc);
                audio.controls = true;
                
                // Replace the link with the audio element
                link.parentNode.replaceChild(audio, link);
                
                // Play the audio
                audio.play();
                
                // When the audio ends, replace the audio element with the original link
                audio.addEventListener('ended', () => {
                  audio.parentNode.replaceChild(link, audio);
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
              function playAudio(audioSrc, link) {
                console.log('Playing:', audioSrc);
                
                // Create a new audio element
                const audio = new Audio();
                audio.controls = true;
                
                audio.addEventListener('loadstart', () => console.log('Loading started:', audioSrc));
                audio.addEventListener('canplay', () => console.log('Can start playing'));
                audio.addEventListener('error', (e) => {
                    console.error('Audio error:', e);
                    console.error('Audio error details:', audio.error);
                });
                
                audio.src = audioSrc;
                
                // Replace the link with the audio element
                link.parentNode.replaceChild(audio, link);
                
                // Try to play after a short delay
                setTimeout(() => {
                    audio.play().catch(e => {
                        console.error('Play failed:', e);
                    });
                }, 200);
                
                // When the audio ends, replace the audio element with the original link
                audio.addEventListener('ended', () => {
                  audio.parentNode.replaceChild(link, audio);
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
              function playAudio(audioSrc, link) {
                console.log('Playing:', audioSrc);
                
                // Create a new audio element
                const audio = new Audio();
                audio.controls = true;
                
                audio.addEventListener('loadstart', () => console.log('Loading started:', audioSrc));
                audio.addEventListener('canplay', () => console.log('Can start playing'));
                audio.addEventListener('error', (e) => {
                    console.error('Audio error:', e);
                    console.error('Audio error details:', audio.error);
                });
                
                audio.src = audioSrc;
                
                // Replace the link with the audio element
                link.parentNode.replaceChild(audio, link);
                
                // Try to play after a short delay
                setTimeout(() => {
                    audio.play().catch(e => {
                        console.error('Play failed:', e);
                    });
                }, 200);
                
                // When the audio ends, replace the audio element with the original link
                audio.addEventListener('ended', () => {
                  audio.parentNode.replaceChild(link, audio);
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