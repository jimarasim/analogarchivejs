# analogarchivejs
Analogarchivejs displays a directory of mp3 files using their meta-data (artist, album, song) in a standalone webserver app, with the ability to play them in a streaming audio player.      
Just put a "music" sub-directory in the working directory of analogarchivejs (where index.js is located), and put all of your mp3s in that directory.  
When you start the app and call it from a requesting browser, it reads all of the mp3 files in the music directory and displays them in a list of audio playable links... just click a link to play and/or download
the mp3 file.  

SETUP:
1. install node.js: `https://nodejs.org/en/download`. 
2. clone this repository: `git clone https://github.com/jimarasim/analogarchivejs.git`. 
3. install the node modules in the working directory (same directory as index.js): `npm install`. 
4. Create a `music` directory in the working directory (same directory as index.js): `mkdir music`  
5. Put all of your mp3 files in that directory.
6. Run the app from the working directory (same directory as index.js): `node .`. 
7. Load the webpage on your local host: open a browser and navigate to `https://localhost:50001`. 
