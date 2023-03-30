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
const options = {key: readFileSync('./ssl/server.key'),
    cert: readFileSync('./ssl/server.cert')}
const directoryPath = "./music";

//make files available in music subdirectory
app.use('/music', express.static(join(__dirname, directoryPath.substring(2))));
app.get('/', async (req,res) =>{
    try {
        const files = await promises.readdir(directoryPath);
        let fileNames = '';
        for (const file of files) {
            const filePath = join(directoryPath, file);
            const stats = await promises.stat(filePath);
            if (stats.isFile() && extname(filePath).toLowerCase() === '.mp3') {
                const metadata = await parseFile(filePath);
                fileNames += `<a href="music/${file}" target="_blank" style="color: limegreen">${file}</a> 
                    Artist: ${metadata.common.artist}, 
                    Album: ${metadata.common.album}, 
                    Song: ${metadata.common.title}<br />`;
            }
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
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

console.log("Server running at https://localhost:8080/");

