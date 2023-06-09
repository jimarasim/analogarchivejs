//get cert with: google "self signed certificate"
//openssl req -nodes -new -x509 -keyout server.key -out server.cert
import { parseFile } from 'music-metadata';
import {createServer} from 'https';
import {promises, readFileSync} from 'fs';
import {join, extname} from 'path';
import * as url from 'url';
import express from 'express';

const app = express();
const port = 50001;
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
//use self-signed certificate for localhost development
const options = {key: readFileSync('./ssl/server.key'),
    cert: readFileSync('./ssl/server.cert')}
const directoryPathMusic = "./music";
const directoryPathVideo = "./video";

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
