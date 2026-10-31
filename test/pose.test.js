import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import { occupancyOf } from '../js/detect.js';
import { BoardFollower } from '../js/pose.js';
import { TRUE_CORNERS, piecesOf, renderFrame, rng } from './synth.js';

const chess = new Chess();
const expected = occupancyOf(chess.board());
const rand = rng(31);
const shifted = (dx, dy) => TRUE_CORNERS.map(([x, y]) => [x + dx, y + dy]);
const frame = (corners) => renderFrame(piecesOf(chess), { corners, tall: true, margin: true, noise: 4, rand });
const maxError = (a, b) => Math.max(...a.map(([x, y], k) => Math.hypot(x - b[k][0], y - b[k][1])));

function lockOn(follower, corners) {
  for (let i = 0; i < 4 && follower.mode !== 'locked'; i++) follower.update(frame(corners), expected);
  assert.equal(follower.mode, 'locked');
}

test('keeps up with a camera that pans and jumps', () => {
  const follower = new BoardFollower();
  lockOn(follower, TRUE_CORNERS);
  // a steady pan...
  for (let t = 1; t <= 12; t++) {
    const truth = shifted(2 * t, -t);
    follower.update(frame(truth), expected);
    assert.ok(maxError(follower.corners, truth) < 4, `pan frame ${t}: off by ${maxError(follower.corners, truth).toFixed(1)}px`);
  }
  // ...then a sudden jump of more than a square: it is found again, same way round.
  const truth = shifted(24 + 45, -12 + 10);
  for (let t = 0; t < 3; t++) follower.update(frame(truth), expected);
  assert.ok(maxError(follower.corners, truth) < 4, `after jump: off by ${maxError(follower.corners, truth).toFixed(1)}px`);
});

test('corrects a pose that slipped one square', () => {
  const follower = new BoardFollower();
  lockOn(follower, TRUE_CORNERS);
  // Pretend tracking slipped one file over.
  const [a1, h1, h8, a8] = TRUE_CORNERS;
  const step = (p, q) => [(q[0] - p[0]) / 8, (q[1] - p[1]) / 8];
  const [bx, by] = step(a1, h1), [tx, ty] = step(a8, h8);
  follower.setCorners([[a1[0] + bx, a1[1] + by], [h1[0] + bx, h1[1] + by], [h8[0] + tx, h8[1] + ty], [a8[0] + tx, a8[1] + ty]]);
  for (let t = 0; t < 6; t++) follower.update(frame(TRUE_CORNERS), expected);
  assert.ok(maxError(follower.corners, TRUE_CORNERS) < 4, `off by ${maxError(follower.corners, TRUE_CORNERS).toFixed(1)}px`);
});

test('does not lock onto a picture with no board', () => {
  const follower = new BoardFollower();
  const blank = { width: 480, height: 360, data: new Uint8ClampedArray(480 * 360 * 4).fill(128) };
  for (let i = 0; i < 4; i++) follower.update(blank, expected);
  assert.equal(follower.mode, 'search');
  assert.equal(follower.corners, null);
});
