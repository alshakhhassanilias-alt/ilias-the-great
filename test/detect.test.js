import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import { boardToImage } from '../js/homography.js';
import { detectBoard, occupancyOf, trackBoard } from '../js/detect.js';
import { TRUE_CORNERS, W, H, piecesOf, renderFrame, rng } from './synth.js';

const [A, B, C, D] = TRUE_CORNERS;   // image points; listed as a1, h1, h8, a8 below
const POSES = {
  'white nearest the camera': [A, B, C, D],
  'black nearest the camera': [C, D, A, B],
  'camera at the side': [B, C, D, A],
  'mirrored (selfie camera)': [B, A, D, C],
  'top-down, turned 30°': [0, 1, 2, 3].map((k) => {
    const a = Math.PI / 6 + (k * Math.PI) / 2 + Math.PI / 4;
    return [240 + 150 * Math.cos(a), 180 + 150 * Math.sin(a)];
  }),
};

const maxError = (found, truth) => Math.max(...found.map(([x, y], k) => Math.hypot(x - truth[k][0], y - truth[k][1])));
// Pieces stand up (and hide what is behind them) in the angled views; seen from straight
// above they are just discs.
const frame = (chess, corners, seed = 1) =>
  renderFrame(piecesOf(chess), { corners, tall: corners !== POSES['top-down, turned 30°'], margin: true, noise: 5, rand: rng(seed) });

for (const [name, corners] of Object.entries(POSES)) {
  test(`finds and orients the starting position: ${name}`, () => {
    const chess = new Chess();
    const found = detectBoard(frame(chess, corners), { expected: occupancyOf(chess.board()) });
    assert.ok(found, 'board found');
    assert.ok(maxError(found.corners, corners) < 4, `corners off by ${maxError(found.corners, corners).toFixed(1)}px`);
  });
}

test('orients a middlegame position from the known game state', () => {
  const chess = new Chess();
  for (const m of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6']) chess.move(m);
  for (const corners of [POSES['black nearest the camera'], POSES['camera at the side']]) {
    const found = detectBoard(frame(chess, corners, 3), { expected: occupancyOf(chess.board()) });
    assert.ok(found && maxError(found.corners, corners) < 4);
  }
});

test('finds nothing when there is no board', () => {
  const rand = rng(9);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = Math.floor(i / W);
    const v = 90 + 60 * Math.sin(x / 37) * Math.cos(y / 23) + 20 * rand();
    data.set([v, v * 0.9, v * 0.8, 255], i * 4);
  }
  assert.equal(detectBoard({ width: W, height: H, data }), null);
});

test('tracks the board when the camera moves', () => {
  const chess = new Chess();
  const before = POSES['white nearest the camera'];
  const turn = 0.03, cx = 240, cy = 180;
  const after = before.map(([x, y]) => [
    cx + (x - cx) * Math.cos(turn) - (y - cy) * Math.sin(turn) + 9,
    cy + (x - cx) * Math.sin(turn) + (y - cy) * Math.cos(turn) - 6,
  ]);
  const tracked = trackBoard(frame(chess, after, 5), boardToImage(before));
  assert.ok(tracked, 'tracked');
  assert.ok(maxError(tracked.corners, after) < 2, `off by ${maxError(tracked.corners, after).toFixed(2)}px`);
});
