import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import { boardToImage } from '../js/homography.js';
import { sampleSignature } from '../js/vision.js';
import { Tracker } from '../js/tracker.js';
import { TRUE_CORNERS, piecesOf, renderFrame, rng, squareCentre } from './synth.js';

// Drives a Tracker with synthetic frames of `sans` being played: idle board, a hand
// that walks in, carries the piece across, lets go and leaves.
function playGame(sans, { calibrationError = 0, noise = 4, gainAt = {}, seed = 7, hold = null } = {}) {
  const rand = rng(seed);
  const jitter = () => (rand() - 0.5) * 2 * calibrationError;
  const estimated = TRUE_CORNERS.map(([x, y]) => [x + jitter(), y + jitter()]);
  const Hest = boardToImage(estimated);

  const truth = new Chess();
  const tracked = new Chess();
  const tracker = new Tracker(tracked);
  let gain = 1;
  const states = [];

  const show = (chess, hand = null) => {
    const sig = sampleSignature(renderFrame(piecesOf(chess), { hand, gain, noise, rand }), Hest);
    const out = tracker.feed(sig);
    states.push(out.state);
    return out;
  };
  const idle = (chess, n) => { for (let i = 0; i < n; i++) show(chess); };

  idle(truth, 8);
  sans.forEach((san, ply) => {
    if (gainAt[ply] !== undefined) gain = gainAt[ply];
    const before = new Chess(truth.fen());
    const m = truth.move(san);
    const [fx, fy] = squareCentre(m.from);
    const [tx, ty] = squareCentre(m.to);
    const lifted = new Chess(before.fen());
    lifted.remove(m.from);

    for (let i = 0; i < 3; i++) show(before, { x: -60 + ((fx + 60) * (i + 1)) / 3, y: fy, r: 34 });
    for (let i = 0; i < 4; i++) show(lifted, { x: fx + ((tx - fx) * (i + 1)) / 4, y: fy + ((ty - fy) * (i + 1)) / 4, r: 34 });
    show(truth, { x: tx, y: ty, r: 34 });
    show(truth, { x: tx, y: ty, r: 34 });
    for (let i = 0; i < 3; i++) show(truth, { x: tx + ((560 - tx) * (i + 1)) / 3, y: ty, r: 34 });
    idle(truth, 8);
    if (hold && hold.afterPly === ply) {
      for (let i = 0; i < hold.frames; i++) show(truth, hold.hand);
      idle(truth, 8);
    }
  });
  return { tracker, tracked, truth, states };
}

const san = (chess) => chess.history();

test('follows an opening, captures and a checkmate', () => {
  const game = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'];
  const { tracked } = playGame(game);
  assert.deepEqual(san(tracked), game);
  assert.ok(tracked.isCheckmate());
});

test('follows castling on both sides', () => {
  const game = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'Nf6', 'd3', 'O-O'];
  assert.deepEqual(san(playGame(game).tracked), game);
});

test('follows queenside castling', () => {
  const game = ['d4', 'd5', 'Nc3', 'Nc6', 'Bf4', 'Bf5', 'Qd2', 'Qd7', 'O-O-O', 'O-O-O'];
  assert.deepEqual(san(playGame(game).tracked), game);
});

test('follows en passant', () => {
  const game = ['e4', 'a6', 'e5', 'd5', 'exd6'];
  assert.deepEqual(san(playGame(game).tracked), game);
});

test('follows a capturing promotion (queen by default)', () => {
  const game = ['h4', 'g5', 'hxg5', 'h6', 'gxh6', 'Nf6', 'h7', 'Ng8', 'hxg8=Q'];
  assert.deepEqual(san(playGame(game).tracked), game);
});

test('survives exposure changes, heavy noise and a sloppy calibration', () => {
  const game = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'];
  const { tracked } = playGame(game, { calibrationError: 4, noise: 9, gainAt: { 3: 1.12, 6: 0.88 }, seed: 11 });
  assert.deepEqual(san(tracked), game);
});

test('a hand resting on the board does not invent a move', () => {
  const game = ['e4', 'e5', 'Nf3'];
  const [cx, cy] = squareCentre('d4');
  const { tracked } = playGame(game, { hold: { afterPly: 1, frames: 14, hand: { x: cx, y: cy, r: 40 } } });
  assert.deepEqual(san(tracked), game);
});

test('reports unmatched when pieces change in a way no legal move explains', () => {
  const tracked = new Chess();
  const tracker = new Tracker(tracked);
  const Hm = boardToImage(TRUE_CORNERS);
  const feed = (chess) => tracker.feed(sampleSignature(renderFrame(piecesOf(chess), { rand: rng(3) }), Hm));
  for (let i = 0; i < 8; i++) feed(tracked);
  const wrong = new Chess();
  wrong.remove('a1');
  wrong.remove('h8');
  let last;
  for (let i = 0; i < 8; i++) last = feed(wrong);
  assert.equal(last.state, 'unmatched');
  assert.equal(tracked.history().length, 0);
});

test('resync adopts the next stable frame as the new baseline', () => {
  const tracked = new Chess();
  const tracker = new Tracker(tracked);
  const Hm = boardToImage(TRUE_CORNERS);
  const feed = (chess) => tracker.feed(sampleSignature(renderFrame(piecesOf(chess), { rand: rng(5) }), Hm));
  for (let i = 0; i < 8; i++) feed(tracked);
  const moved = new Chess();
  moved.move('Nf3');
  tracker.resync();
  tracked.load(moved.fen());
  const events = [];
  const watch = (chess) => { for (let i = 0; i < 12; i++) events.push(feed(chess)); };
  watch(moved);
  assert.deepEqual(events.map((e) => e.state).filter((s) => s === 'baseline'), ['baseline']);
  moved.move('d5');
  events.length = 0;
  watch(moved);
  const moves = events.filter((e) => e.state === 'move');
  assert.equal(moves.length, 1, 'a move is reported exactly once');
  assert.equal(moves[0].move.san, 'd5');
  assert.equal(events.at(-1).state, 'steady');
});
