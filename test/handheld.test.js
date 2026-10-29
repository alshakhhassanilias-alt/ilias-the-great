import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import { boardToImage } from '../js/homography.js';
import { sampleSignature } from '../js/vision.js';
import { Tracker } from '../js/tracker.js';
import { trackBoard } from '../js/detect.js';
import { TRUE_CORNERS, piecesOf, renderFrame, rng, squareCentre } from './synth.js';

// A phone held in the hand: the board drifts a few pixels and turns slightly over time.
const pose = (t) => {
  const dx = 7 * Math.sin(t / 23), dy = 5 * Math.sin(t / 31), a = 0.015 * Math.sin(t / 41), cx = 240, cy = 180;
  return TRUE_CORNERS.map(([x, y]) => [
    cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a) + dx,
    cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a) + dy,
  ]);
};

// Same loop as the app: follow the board every other frame, then feed the tracker.
test('follows a game filmed with a hand-held, drifting camera', () => {
  const game = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'Nf6', 'd3', 'd6'];
  const rand = rng(21);
  const truth = new Chess();
  const tracked = new Chess();
  const tracker = new Tracker(tracked);
  let corners = pose(0);
  let t = 0, prevImg = null;

  const show = (chess, hand = null) => {
    const img = renderFrame(piecesOf(chess), { hand, rand, tall: true, margin: true, corners: pose(t), noise: 4 });
    if (t++ % 2 === 0) {
      const found = trackBoard(img, boardToImage(corners));
      if (found && found.shift > 0.6) corners = found.corners;
    }
    const H = boardToImage(corners);
    tracker.setView(H);
    tracker.feed(sampleSignature(img, H), prevImg && sampleSignature(prevImg, H));
    prevImg = img;
  };

  for (let i = 0; i < 10; i++) show(truth);
  for (const san of game) {
    const before = new Chess(truth.fen());
    const m = truth.move(san);
    const [fx, fy] = squareCentre(m.from, pose(t)), [tx, ty] = squareCentre(m.to, pose(t));
    const lifted = new Chess(before.fen());
    lifted.remove(m.from);
    for (let i = 0; i < 3; i++) show(before, { x: -60 + ((fx + 60) * (i + 1)) / 3, y: fy, r: 34 });
    for (let i = 0; i < 4; i++) show(lifted, { x: fx + ((tx - fx) * (i + 1)) / 4, y: fy + ((ty - fy) * (i + 1)) / 4, r: 34 });
    for (let i = 0; i < 2; i++) show(truth, { x: tx, y: ty, r: 34 });
    for (let i = 0; i < 3; i++) show(truth, { x: tx + ((560 - tx) * (i + 1)) / 3, y: ty, r: 34 });
    for (let i = 0; i < 10; i++) show(truth);
  }
  assert.deepEqual(tracked.history(), game);
});
