# Reveal trailer

The production files for *THE WORLD ORDER* reveal trailer (75.6 s, 1080p30). Credits and sources: [CREDITS.md](CREDITS.md).
The footage and rendered video are not in the repository (about 1 GB); these scripts rebuild them.

Run everything from one working folder that holds `src/` (footage), `g/` (gameplay frames), `vo/`, `audio/`, `title/`, `fonts/`, `edit/`.

1. `python3 dvids.py <ids…>` — fetch the public-domain DVIDS clips (checks each page says PUBLIC DOMAIN). The NASA clip comes from images.nasa.gov.
2. `npm run build`, then `node trailer/capture-gameplay.mjs <workdir>/g` — frame-exact 30 fps gameplay capture (frozen clock).
3. `node trailer/render-title.mjs <workdir>/title 170` — the title card (`title.html`) rendered frame by frame.
4. `python3 music.py` — the original score as stems in `audio/`.
5. `python3 edit.py` — cuts, grades and joins the 34 shots into `edit/picture.mp4` (the edit decision list is at the top).
6. `python3 mix.py`, write `mix_raw.npy` to raw f32, then `./master.sh` — narration, ducking, master to −14 LUFS.
7. Mux: `ffmpeg -i edit/picture.mp4 -i audio/mix_master.wav -c:v libx264 -b:v 14M -c:a aac -b:a 320k -movflags +faststart …`
