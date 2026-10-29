// Turns a camera frame into a compact per-square "signature" and compares
// signatures. No piece recognition happens here; we only need to know which
// squares *changed* between two stable frames.

import { applyH } from './homography.js';

export const GRID = 6;      // GRID x GRID sample points per square
export const INNER = 0.6;   // fraction of the square sampled (the centre; avoids leaning neighbours)
const PER_SQUARE = GRID * GRID * 3;

// img: { width, height, data } as from ImageData (RGBA).
// H: board plane -> pixel coordinates of img.
export function sampleSignature(img, H) {
  const out = new Float32Array(64 * PER_SQUARE);
  const lo = (1 - INNER) / 2;
  let o = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      for (let gy = 0; gy < GRID; gy++) {
        for (let gx = 0; gx < GRID; gx++) {
          const [x, y] = applyH(
            H,
            f + lo + (INNER * (gx + 0.5)) / GRID,
            r + lo + (INNER * (gy + 0.5)) / GRID,
          );
          o = bilinear(img, x, y, out, o);
        }
      }
    }
  }
  return out;
}

function bilinear(img, x, y, out, o) {
  const { width, height, data } = img;
  x = Math.min(Math.max(x - 0.5, 0), width - 1.001);
  y = Math.min(Math.max(y - 0.5, 0), height - 1.001);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const i00 = (y0 * width + x0) * 4;
  const i10 = i00 + 4;
  const i01 = i00 + width * 4;
  const i11 = i01 + 4;
  for (let c = 0; c < 3; c++) {
    out[o++] =
      data[i00 + c] * (1 - fx) * (1 - fy) + data[i10 + c] * fx * (1 - fy) +
      data[i01 + c] * (1 - fx) * fy + data[i11 + c] * fx * fy;
  }
  return o;
}

export function squareBrightness(sig) {
  const lum = new Float32Array(64);
  for (let s = 0; s < 64; s++) {
    let sum = 0;
    for (let i = s * PER_SQUARE; i < (s + 1) * PER_SQUARE; i++) sum += sig[i];
    lum[s] = sum / PER_SQUARE;
  }
  return lum;
}

// Per-square change (0 = identical, ~1 = black vs white) from signature a to b,
// after cancelling any global exposure change. At most a handful of squares
// change in a move, so the median brightness ratio across all 64 is a robust
// estimate of the exposure shift.
export function squareDiffs(a, b) {
  const la = squareBrightness(a);
  const lb = squareBrightness(b);
  const ratios = Array.from(la, (v, s) => (lb[s] + 1) / (v + 1)).sort((x, y) => x - y);
  const gain = (ratios[31] + ratios[32]) / 2;
  const d = new Float32Array(64);
  for (let s = 0; s < 64; s++) {
    let sum = 0;
    for (let i = s * PER_SQUARE; i < (s + 1) * PER_SQUARE; i++) sum += Math.abs(a[i] - b[i] / gain);
    d[s] = sum / PER_SQUARE / 255;
  }
  return d;
}

export function maxOf(arr) {
  let m = 0;
  for (const v of arr) if (v > m) m = v;
  return m;
}
