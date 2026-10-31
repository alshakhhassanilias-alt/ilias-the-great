// Keeps track of where the board is in a moving camera picture.
//
// Every frame the inner corners are re-snapped (fast). Every few frames, and as soon
// as snapping fails, the board is found from scratch (slower but can't drift): that
// corrects a pose that slid off the board or snapped one square over. A fresh
// detection is matched to the current a1..a8 labelling so the orientation stays put.

import { boardToImage, isConvexQuad } from './homography.js?v=4';
import { detectBoard, trackBoard } from './detect.js?v=4';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cellSize = (q) => (dist(q[0], q[1]) + dist(q[1], q[2]) + dist(q[2], q[3]) + dist(q[3], q[0])) / 32;
const area = (q) => Math.abs(q.reduce((s, p, i) => s + p[0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * p[1], 0)) / 2;

// The same quad listed in the 8 possible corner orders (4 rotations x 2 directions).
function relabellings(q) {
  const out = [];
  for (const base of [q, [...q].reverse()]) for (let k = 0; k < 4; k++) out.push([...base.slice(k), ...base.slice(0, k)]);
  return out;
}

// The labelling of `found` closest to `current`, with its mean corner distance.
export function matchLabels(found, current) {
  let best = null;
  for (const q of relabellings(found)) {
    const d = q.reduce((s, p, k) => s + dist(p, current[k]), 0) / 4;
    if (!best || d < best.d) best = { corners: q, d };
  }
  return best;
}

export class BoardFollower {
  constructor({ redetectEvery = 5, minInliers = 14 } = {}) {
    this.redetectEvery = redetectEvery;
    this.minInliers = minInliers;
    this.reset();
  }

  reset() {
    this.mode = 'search';
    this.corners = null;
    this.pending = null;
    this.frames = 0;
    this.failures = 0;
    this.inliers = 0;
  }

  // Corners tapped by hand: use them as they are, no tracking.
  setManual(corners) {
    this.mode = corners ? 'manual' : 'search';
    this.corners = corners;
  }

  // Corners set from outside while locked (rotated or dragged by the user).
  setCorners(corners) {
    this.corners = corners;
  }

  // img: RGBA frame. expected: occupancy of the current position (see occupancyOf).
  // Returns { mode, corners, locked: true on the frame the board is first found, margin }.
  update(img, expected) {
    this.frames++;
    if (this.mode === 'manual') return { mode: this.mode, corners: this.corners };
    if (this.mode === 'search') return this.#search(img, expected);

    // A sudden drop in matched corners means the snap latched onto the wrong ones
    // (fast camera movement): treat it as a failure so the board is found afresh.
    const tracked = trackBoard(img, boardToImage(this.corners));
    if (tracked && this.#plausible(tracked.corners) && tracked.inliers >= Math.max(12, 0.6 * this.inliers)) {
      this.corners = tracked.corners;
      this.inliers = tracked.inliers;
      this.failures = 0;
    } else {
      this.failures++;
    }

    if (this.failures > 0 || this.frames % this.redetectEvery === 0) {
      const found = detectBoard(img, { expected });
      if (found && found.inliers >= this.minInliers) {
        const match = matchLabels(found.corners, this.corners);
        const cell = cellSize(this.corners);
        // Close to where we think the board is: keep our labelling, take the better fit.
        // A detection that saw every corner line knows exactly which 8x8 block is the board,
        // so it also wins when our pose has slipped a square or two (labelling kept) or the
        // camera moved a lot (labelling from the detector, which uses the game position).
        // With lines hidden a detection can be a square off itself, so it is only taken
        // once tracking has been failing for a while.
        let adopt = null;
        if (match.d < 0.75 * cell) adopt = match.corners;
        else if (found.complete) adopt = match.d < 2.5 * cell ? match.corners : found.corners;
        else if (this.failures >= 3 && found.inliers >= 30) adopt = found.corners;
        if (adopt) {
          this.corners = adopt;
          this.inliers = found.inliers;
          this.failures = 0;
        }
      }
    }
    if (this.failures > 25) this.reset();      // gone for a few seconds: start over
    return { mode: this.mode, corners: this.corners, lost: this.failures > 0 };
  }

  #plausible(next) {
    if (!isConvexQuad(next)) return false;
    const ratio = area(next) / area(this.corners);
    const jump = Math.max(...next.map((p, k) => dist(p, this.corners[k])));
    return ratio > 0.6 && ratio < 1.6 && jump < 3 * cellSize(this.corners);
  }

  // A detection that saw the whole grid is taken at once; a partial one needs a second,
  // agreeing one (allowing for a moving camera), so one lucky frame can't lock onto the
  // wrong thing.
  #search(img, expected) {
    const found = detectBoard(img, { expected });
    if (!found || found.inliers < this.minInliers) {
      this.pending = null;
      return { mode: this.mode, corners: null };
    }
    const sure = found.complete && found.inliers >= 30;
    const agree = this.pending && matchLabels(found.corners, this.pending).d < 1.5 * cellSize(found.corners);
    this.pending = found.corners;
    if (!sure && !agree) return { mode: this.mode, corners: null };
    this.mode = 'locked';
    this.corners = found.corners;
    this.inliers = found.inliers;
    this.failures = 0;
    return { mode: this.mode, corners: this.corners, locked: true, margin: found.orientationMargin };
  }
}
