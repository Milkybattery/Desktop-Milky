# Milky

A browser-based 3D character chat. Static files only, so it runs on GitHub Pages as is.

## Run it

- Locally: `python3 -m http.server` in this folder, then open http://localhost:8000
- GitHub Pages: push the folder to a repo, then Settings > Pages > Deploy from branch > `main` / root.

## Where things live

- `js/config.js`: default API key and model (also editable in the cog menu, stored per browser)
- `personality.txt`: her character description
- `js/brain.js`: the prompt rules and tag parsing ([EMOTION], [FEET], [NEXT], [SHAKY], [REMEMBER])
- `js/stage.js`: the 3D scene, poses, emotions, desk and camera
- `assets/milky.glb`, `animations/pose1.glb`: the model and the feet-up pose
- `assets/faces/`: optional head textures per emotion (add the name to `CUSTOM_FACES` in `stage.js`)

Her memory (recent chat and anything she chose to remember) is kept in the browser's localStorage.
