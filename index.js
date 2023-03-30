//get cert with: google "self signed certificate"
//openssl req -nodes -new -x509 -keyout server.key -out server.cert
import { parseFile } from 'music-metadata';
import {createServer} from 'https';
import {promises, readFileSync} from 'fs';
import {join, extname} from 'path';

let options = {key: readFileSync('./ssl/server.key'),
    cert: readFileSync('./ssl/server.cert')}

let directoryPath = "/Users/jameskennetharasim/Downloads/installed/static_volatile/STATIC_MUSIC/STATIC_MUSIC/_VINYL";
createServer(options, async (req, res) => {
    if (req.url === '/') {
        try {
            const files = await promises.readdir(directoryPath);
            let fileNames = '';
            for (const file of files) {
                const filePath = join(directoryPath, file);
                const stats = await promises.stat(filePath);
                if (stats.isFile() && extname(filePath).toLowerCase() === '.mp3') {
                    const metadata = await parseFile(filePath);
                    fileNames += `<em style="color: limegreen">${file}</em> 
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
    } else {
        res.writeHead(404);
        res.end();
    }
}).listen(8080);
console.log("Server running at https://localhost:8080/");