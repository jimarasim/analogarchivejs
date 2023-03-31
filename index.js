//get cert with: google "self signed certificate"
//openssl req -nodes -new -x509 -keyout server.key -out server.cert
import { parseFile } from 'music-metadata';
import {createServer} from 'https';
import {promises, readFileSync} from 'fs';
import {join, extname} from 'path';
import * as url from 'url';
import express from 'express';

const app = express();
const port = 8080;
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
//use self-signed certificate for localhost development
const options = {key: readFileSync('./ssl/server.key'),
    cert: readFileSync('./ssl/server.cert')}
const directoryPath = "./music";

//make files available in music subdirectory
app.use('/music', express.static(join(__dirname, directoryPath.substring(2))));

app.get('/', async (req,res) =>{
    try {
        const files = await promises.readdir(directoryPath);
        let fileNames = '<html><head><title></title></head><body><ul>';
        for (const file of files) {
            const filePath = join(directoryPath, file);
            const stats = await promises.stat(filePath);
            if (stats.isFile() && extname(filePath).toLowerCase() === '.mp3') {
                const metadata = await parseFile(filePath);
                fileNames +=
                `<li>
                    <a href="#" onclick="playAudio('music/${file}', this)">${file}</a> 
                    Artist: ${metadata.common.artist}, 
                    Album: ${metadata.common.album}, 
                    Song: ${metadata.common.title}
                </li>`;
            }
        }
        fileNames += '</ul></body></html>'
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write(`
        <script>
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
                });
              }
        </script>
        `);
        res.end(fileNames);
    } catch (err) {
        console.error(err);
        res.writeHead(500);
        res.end('Internal Server Error');
    }
});

createServer(options, app).listen(port, () => {
    console.log(`Server listening on https://localhost:${port}`);
});
