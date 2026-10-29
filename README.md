# ilias-the-great

A camera chess coach for **over-the-board games with friends**. Point a webcam or phone at a real board and the app follows the game, then draws the engine's best move as an arrow on the live video, plus a plain-English "move your knight g1 → f3".

It's meant for open, everyone-knows-it's-on games: testing what it can do, analysing a casual game, or teaching. Don't use it on a live online game (chess.com, lichess, etc.) or to get a hidden edge on someone who doesn't know about it. That's cheating, and fair-play systems are built to catch it.

No server, no API key, no build step. Everything (vision, move tracking, Stockfish) runs in the browser.

## Run it

```sh
npm start            # python3 -m http.server 8000
# open http://localhost:8000
```

Cameras only work on `https://` pages or `localhost`. To use a phone as the camera, serve the folder over https (any static host works, e.g. GitHub Pages) and open that URL on the phone.

## Use it

1. **Start camera.** Look down at the board from above or from a side. Keep the camera still (a phone propped on some books is fine).
2. **Click the 4 corners** of the 8×8 playing area in the order **a1** (White's left-hand corner), **h1**, **h8**, **a8**. Drag the dots to fine-tune. If the labels land on the wrong corners, press *Rotate 90°*. Your corners are remembered for next time.
3. **Set up the pieces and play.** Each time a move is made and hands leave the board, the app works out the move and shows the best move for whoever's turn it is.

Side panel: a digital copy of the position, move list, *Undo*, *New game*, a box to type a correction (`Nf3` or `e2e4`), a FEN box to start mid-game, *Advise for* (turn / White only / Black only), engine strength (Skill Level 0–20), think time, and detection sensitivity. *Show detection* paints the squares the camera thinks changed.

## How it works

- **Where's the board?** The four clicked corners give a projective transform (`js/homography.js`) from board coordinates to camera pixels, so any angle works.
- **What moved?** (`js/vision.js`, `js/tracker.js`) It does not recognise pieces. It samples the centre of each square, waits until the picture has been still for about 0.6 s (hands gone), and compares it with the last accepted picture, after cancelling out global brightness changes. Then it picks the legal move (chess.js) whose squares best explain the change. Castling, en passant, captures and promotion (queen by default; a picker appears to change it) fall out of this. If nothing legal fits (a hand resting on the board, a knocked piece), it ignores the frame and says so.
- **What's best?** Stockfish 17.1 (lite, single-threaded WebAssembly) runs in a Web Worker.

Because it only tracks *changes*, it needs to start from a known position (the standard one, or a FEN you enter) and see every move. If it ever drifts, fix it with *Undo* or by typing the move, which also re-syncs the camera baseline.

## Tips and limits

- Good, even light and no shadow across the board help most. Pieces that contrast with the squares help too; if moves are missed, raise the sensitivity slider, and if phantom moves appear, lower it.
- Tracking assumes a standard board and standard castling. Chess960 isn't supported.
- Typed corrections assume the real board already shows that move.
- The camera is never recorded or uploaded; frames are only read in the page.

## Tests

```sh
npm test
```

`test/` renders fake camera frames (perspective, noise, exposure shifts, a moving hand, sloppy calibration) and checks that whole games, including castling both ways, en passant, a capturing promotion and a checkmate, are followed exactly. The browser pipeline was also exercised end to end with a stubbed camera.

## Credits

[chess.js](https://github.com/jhlywa/chess.js) (BSD-2) and [Stockfish.js](https://github.com/nmrugg/stockfish.js) (GPLv3, built from [Stockfish](https://stockfishchess.org/)) are vendored in `vendor/`, with their licences alongside. Stockfish is GPLv3, so if you redistribute this app, its terms apply to that part.
