# ilias-the-great

A camera chess coach for **over-the-board games with friends**. Open it on your phone, point the camera at a real board, and it finds the board, asks which side you're playing, follows the game, and shows (and says) the engine's best move on the live video.

It's meant for open, everyone-knows-it's-on games: testing what it can do, analysing a casual game, or teaching. Don't use it on a live online game (chess.com, lichess, etc.) or to get a hidden edge on someone who doesn't know about it. That's cheating, and fair-play systems are built to catch it.

No server, no API key, no build step. Everything (vision, move tracking, Stockfish) runs in the browser.

## Open it on your phone

Browsers only allow the camera on `https://` pages (or `localhost`), so the app has to be served over https. Any static host works, since it's just files (GitHub Pages, Netlify, etc.). On a computer, `npm start` (runs `python3 -m http.server 8000`), then open `http://localhost:8000`.

## What it looks like

A full-screen camera app. A status pill at the top says what it's doing (finding the board, your move, their move, watching). On the camera picture, the best move is a thick glowing arrow (an L for knights) with a pulsing target square and the move's name. A bottom sheet, which you can swipe up, holds the move card (piece, move, evaluation bar) and three tabs:

- **Coach:** undo, fix a misread move, new game, and the move list.
- **Board:** a digital board with tap-to-move and legal-move dots.
- **Settings:** your side, engine strength, camera tools and comfort options.

The pieces are the app's own SVG drawings, so they look the same on every phone; text chess symbols turned white pawns into black emoji on some phones. It keeps the screen on during a game, buzzes on your turn (Android), and can be added to the home screen as a full-screen app.

## Use it

1. **Open the page and allow the camera.** It opens the back camera by itself. Get all 64 squares in view. Propping the phone up (on a stack of books, a cup) works best, but holding it is OK.
2. **It finds the board on its own.** A grid appears over the squares, with a1/h1/h8/a8 labels in the corners.
3. **Tell it your side.** Tap *White* or *Black*, or just say "white" or "black". It guesses the side nearest the camera and highlights that button.
4. **Play.** On your turn a green arrow on the camera shows the best move, the text says e.g. "Move your knight g1 → f3", and it says the move out loud (turn this off with *Say moves out loud*). On your opponent's turn it waits. Each move is picked up when hands leave the board.

If it misreads a move, the message under the best move offers the next most likely moves ("Saw a3. Not right? **Na3**"). Tap the right one. *Undo*, typing a move (`Nf3` or `e2e4`), and *Set corners by hand* (tap a1, h1, h8, a8) are there as fallbacks. To start mid-game, paste a FEN.

Other settings: engine strength (Skill Level 0–20), think time, detection sensitivity, and *Show detection*, which paints the squares the camera thinks changed.

## How it works

- **Finding the board** (`js/detect.js`). Every inner corner of a chessboard, where four squares meet, looks like a saddle: light, dark, light, dark around a circle. The ChESS detector scores each pixel for that. From a few neighbouring corners it guesses a perspective grid and grows it, keeps the 7×7 inner corner lines with the strongest response, and refits while dropping outliers (false corners where pieces meet squares). Then it chooses the orientation, meaning which corner is a1, from the square colours (a1 is dark) and from where the white and black pieces stand in the known game position. That works from any side, at any rotation, and even with a mirrored selfie camera.
- **Following the board** (`js/pose.js`). While locked on, it re-snaps the grid to fresh corners every frame, so a hand-held phone is fine. It also finds the board from scratch every second or so, and as soon as snapping struggles. That corrects a grid that drifted or slipped a square when the camera moved fast.
- **Staying smooth.** All the image work runs in a Web Worker (`js/vision-worker.js`) that only ever processes the newest frame. The camera picture is the plain `<video>` element, with the grid and arrow drawn on a transparent layer above it. A slow phone just reads fewer frames and never freezes.
- **What moved?** (`js/vision.js`, `js/tracker.js`). It doesn't recognise pieces. It samples each square, waits until the picture has been still for about 0.6 s (no hands), compares with the last accepted picture, and picks the legal move (chess.js) that best explains the change. It knows that, seen at an angle, a standing piece hides part of the square behind it and can be hidden by the piece in front. Castling, en passant, captures and promotion (queen by default; a picker offers the others) are handled. If a hand was still over the board when it guessed, the guess is revised once the hand leaves.
- **What's best?** Stockfish 17.1 (lite, single-threaded WebAssembly) in a Web Worker.

## How well it works

- **Following a moving camera:** on real footage from a head-mounted camera with hands constantly in view, the board was found in under 2 seconds and followed to within a square almost all the time, recovering on its own within a frame or two after fast movements. With the CPU slowed 4× to mimic a phone, the page stayed smooth.
- **Finding the board:** tested on 53 real phone photos from a public dataset (top-down and tilted shots, boards rotated 45°, mid-game positions, hands and clutter in view). The board was found in all 53, with at least 97% overlap with the hand-labelled outline. On the starting-position photos it picked the right a1 corner every time.
- **Reading moves:** on synthetic video with standing pieces seen at an angle from three sides, about 97% of moves in random games are read right first time. In every miss the right move was among the one-tap fixes. Real cameras, lighting and pieces will differ, so expect the odd fix.
- **Limits:** it needs to see every move and to start from a known position (the normal setup or a FEN). It has trouble with very low camera angles where pieces hide most of the board, strong glare, or pieces close to the colour of the squares. Chess960 isn't supported.

## Tests

```sh
npm test
```

`npm test` also runs on every pull request (`.github/workflows/tests.yml`). `test/` renders fake camera frames: perspective, noise, exposure shifts, standing pieces that hide what's behind them, a moving hand, a drifting hand-held camera and sloppy calibration. The tests check that the board is found and oriented from every side, and that whole games (castling both ways, en passant, a capturing promotion, a checkmate) are followed exactly. The full browser pipeline was also exercised end to end with a stubbed camera.

## Credits

[chess.js](https://github.com/jhlywa/chess.js) (BSD-2) and [Stockfish.js](https://github.com/nmrugg/stockfish.js) (GPLv3, built from [Stockfish](https://stockfishchess.org/)) are vendored in `vendor/`, with their licences alongside. Stockfish is GPLv3, so if you redistribute this app, its terms apply to that part. Board detection was evaluated on photos from the [chess-board-segmentation](https://huggingface.co/datasets/dopaul/chess-board-segmentation) dataset (CC BY 4.0); the photos aren't included here.
