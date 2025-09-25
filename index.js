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
        console.log('Bucket response:', JSON.stringify(bucket.data, null, 2));

        const bucketId = bucket.data.buckets[0].bucketId;
        const downloadUrl = bucket.data.buckets[0].downloadUrl;

        console.log(`Using bucket ID: ${bucketId}`);
        console.log(`Using download URL: ${downloadUrl}`);
        console.log(`Expected bucket ID: 6abe393070d7852e929c0815`);

        // List files in the analog folder
        const response = await b2.listFileNames({
            bucketId: bucketId,
            startFileName: 'analog/',
            prefix: 'analog/',
            maxFileCount: 1000
        });

        console.log(`Found ${response.data.files.length} files in analog folder`);

        let fileNames = '<html><head><title>ananlogarchivejs - Analog</title><link rel="stylesheet" href="styles.css"></head><body><div class="container">';

        for (const file of response.data.files) {
            console.log(`Processing file: ${file.fileName}`);
            if (file.fileName.toLowerCase().endsWith('.mp3') && file.fileName !== 'analog/') {
                const fileName = file.fileName.split('/').pop(); // Get just the filename
                // Try different URL formats
                const directUrl = `${downloadUrl}/file/${bucketName}/${file.fileName}`;
                const fallbackUrl = `https://f005.backblazeb2.com/file/${bucketName}/${file.fileName}`;

                console.log(`Direct URL: ${directUrl}`);
                console.log(`Fallback URL: ${fallbackUrl}`);

                fileNames += `
                <a class="link" 
                onclick="playAudio('${directUrl}', '${fallbackUrl}', this)">
                ${fileName}
                </a>`;
            }
        }

        fileNames += '</div>';
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write(fileNames);
        res.end(`        <script>
              function playAudio(audioSrc, fallbackSrc, link) {
                // Create a new audio element
                const audio = new Audio();
                audio.controls = true;
                
                // Try the primary URL first
                audio.src = audioSrc;
                
                // If primary fails, try fallback
                audio.onerror = function() {
                    console.log('Primary URL failed, trying fallback:', fallbackSrc);
                    audio.src = fallbackSrc;
                    audio.onerror = function() {
                        console.log('Both URLs failed');
                        alert('Could not load audio file: ' + audioSrc);
                    };
                };
                
                // Replace the link with the audio element
                link.parentNode.replaceChild(audio, link);
                
                // Play the audio
                audio.play().catch(e => {
                    console.error('Play failed:', e);
                    alert('Could not play audio: ' + e.message);
                });
                
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
        const downloadUrl = bucket.data.buckets[0].downloadUrl;

        // List files in the live folder
        const response = await b2.listFileNames({
            bucketId: bucketId,
            startFileName: 'live/',
            prefix: 'live/',
            maxFileCount: 1000
        });

        let fileNames = '<html><head><title>ananlogarchivejs - Live</title><link rel="stylesheet" href="styles.css"></head><body><div class="container">';

        for (const file of response.data.files) {
            if (file.fileName.toLowerCase().endsWith('.mp3') && file.fileName !== 'live/') {
                const fileName = file.fileName.split('/').pop(); // Get just the filename
                // Use simple direct download URL without authorization for now
                const directUrl = `${downloadUrl}/file/${bucketName}/${file.fileName}`;

                fileNames += `
                <a class="link" 
                onclick="playAudio('${directUrl}', this)">
                ${fileName}
                </a>`;
            }
        }

        fileNames += '</div>';
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

// Helper function to get download URL for B2 files
async function getB2DownloadUrl(fileName, bucketId) {
    try {
        // Get download authorization token
        const downloadAuth = await b2.getDownloadAuthorization({
            bucketId: bucketId,
            fileNamePrefix: fileName,
            validDurationInSeconds: 3600 // 1 hour
        });

        // Get bucket info for download URL
        const bucket = await b2.getBucket({ bucketName });
        const downloadUrl = bucket.data.buckets[0].downloadUrl;

        return `${downloadUrl}/file/${bucketName}/${fileName}?Authorization=${downloadAuth.data.authorizationToken}`;
    } catch (err) {
        console.error('Error getting download URL:', err);
        // Fallback to public URL if bucket is public
        return `https://f002.backblazeb2.com/file/${bucketName}/${fileName}`;
    }
}