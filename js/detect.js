// Finds a chessboard in a camera frame with no help from the user.
//
// 1. X-corners: the points where four squares meet look like a saddle (light,
//    dark, light, dark around a circle). The ChESS detector (Bennett & Lasenby)
//    scores every pixel for that.
// 2. Lattice: from a few neighbouring X-corners, guess a perspective grid and grow
//    it outward, snapping to X-corners, until it explains as many as it can.
//    A board has 7x7 inner corners, so the lattice may span at most 7 lines.
// 3. Window: decide which 8x8 block of that lattice is the board (inside, squares
//    alternate light/dark; just outside, they don't).
// 4. Orientation: pick which corner is a1, using the light/dark colouring (a1 is
//    dark) and, when the position is known, where the white and black pieces sit.

import { applyH, homography, invertH } from './homography.js';

const RING = 16;

export function toGray(img, maxSide = 480) {
  const scale = Math.max(1, Math.max(img.width, img.height) / maxSide);
  const w = Math.round(img.width / scale);
  const h = Math.round(img.height / scale);
  const g = new Float32Array(w * h);
  const { data, width } = img;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * scale), y1 = Math.max(y0 + 1, Math.floor((y + 1) * scale));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * scale), x1 = Math.max(x0 + 1, Math.floor((x + 1) * scale));
      let sum = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * width + xx) * 4;
          sum += 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
          n++;
        }
      }
      g[y * w + x] = sum / n;
    }
  }
  return { w, h, g: blur(g, w, h), scale };
}

function blur(g, w, h) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      tmp[i] = (g[i - (x > 0)] + g[i] + g[i + (x < w - 1)]) / 3;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = (tmp[i - (y > 0) * w] + tmp[i] + tmp[i + (y < h - 1) * w]) / 3;
    }
  }
  return out;
}

// ChESS response: high at X-corners, low on edges, blobs and flat areas.
// roi: optional [x0, y0, x1, y1] to limit the scan.
export function xCornerResponse({ w, h, g }, r = 5, roi = null) {
  const R = new Float32Array(w * h);
  const offs = Array.from({ length: RING }, (_, n) => {
    const a = (2 * Math.PI * n) / RING;
    return Math.round(r * Math.sin(a)) * w + Math.round(r * Math.cos(a));
  });
  const I = new Float32Array(RING);
  const [x0, y0, x1, y1] = roi ? roi.map(Math.round) : [0, 0, w, h];
  for (let y = Math.max(r, y0); y < Math.min(h - r, y1); y++) {
    for (let x = Math.max(r, x0); x < Math.min(w - r, x1); x++) {
      const i = y * w + x;
      let mean = 0;
      for (let n = 0; n < RING; n++) { I[n] = g[i + offs[n]]; mean += I[n]; }
      mean /= RING;
      let sr = 0, dr = 0;
      for (let n = 0; n < 4; n++) sr += Math.abs(I[n] + I[n + 8] - I[n + 4] - I[n + 12]);
      for (let n = 0; n < 8; n++) dr += Math.abs(I[n] - I[n + 8]);
      const local = (g[i] + g[i - 1] + g[i + 1] + g[i - w] + g[i + w]) / 5;
      R[i] = sr - dr - RING * Math.abs(mean - local);
    }
  }
  return R;
}

// Local maxima of R, refined to sub-pixel, strongest first.
export function findXCorners(R, w, h, { radius = 4, rel = 0.05, max = 300 } = {}) {
  let top = 0;
  for (const v of R) if (v > top) top = v;
  if (top <= 0) return { points: [], top };
  const thr = top * rel;
  const points = [];
  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      const v = R[y * w + x];
      if (v <= thr) continue;
      let isMax = true;
      for (let dy = -radius; dy <= radius && isMax; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const u = R[(y + dy) * w + x + dx];
          if (u > v || (u === v && (dy < 0 || (dy === 0 && dx < 0)))) { isMax = false; break; }
        }
      }
      if (!isMax) continue;
      const l = R[y * w + x - 1], rr = R[y * w + x + 1], u = R[(y - 1) * w + x], d = R[(y + 1) * w + x];
      const ox = l - 2 * v + rr < 0 ? (l - rr) / (2 * (l - 2 * v + rr)) : 0;
      const oy = u - 2 * v + d < 0 ? (u - d) / (2 * (u - 2 * v + d)) : 0;
      points.push({ x: x + Math.max(-0.5, Math.min(0.5, ox)), y: y + Math.max(-0.5, Math.min(0.5, oy)), s: v });
    }
  }
  points.sort((a, b) => b.s - a.s);
  return { points: points.slice(0, max), top };
}

// ------------------------------------------------------------------ geometry

const mul = (A, B) => {
  const C = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
  return C;
};

function normaliser(pts) {
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= pts.length; my /= pts.length;
  let d = 0;
  for (const [x, y] of pts) d += Math.hypot(x - mx, y - my);
  const s = Math.SQRT2 / (d / pts.length || 1);
  return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
}

// Least-squares homography src -> dst (Hartley-normalised DLT with h33 = 1).
export function fitHomography(src, dst) {
  if (src.length < 4) return null;
  if (src.length === 4) return homography(src, dst);
  const Ts = normaliser(src), Td = normaliser(dst);
  const ns = src.map(([x, y]) => applyH(Ts, x, y));
  const nd = dst.map(([x, y]) => applyH(Td, x, y));
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb = new Array(8).fill(0);
  const addRow = (row, b) => {
    for (let i = 0; i < 8; i++) {
      Atb[i] += row[i] * b;
      for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j];
    }
  };
  for (let k = 0; k < ns.length; k++) {
    const [x, y] = ns[k], [u, v] = nd[k];
    addRow([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    addRow([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solve(AtA, Atb);
  if (!h) return null;
  const Td_inv = invertH(Td);
  return Td_inv && mul(Td_inv, mul([...h, 1], Ts));
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k];
    x[i] = s / M[i][i];
  }
  return x;
}

function project(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  if (w <= 1e-9) return null;
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

class PointGrid {
  constructor(points, cell = 16) {
    this.points = points;
    this.cell = cell;
    this.map = new Map();
    points.forEach((p, i) => {
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      if (!this.map.has(key)) this.map.set(key, []);
      this.map.get(key).push(i);
    });
  }

  nearest(x, y, maxDist, skip) {
    const c = this.cell, reach = Math.ceil(maxDist / c);
    const cx = Math.floor(x / c), cy = Math.floor(y / c);
    let best = -1, bestD = maxDist;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        for (const i of this.map.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (skip && skip.has(i)) continue;
          const d = Math.hypot(this.points[i].x - x, this.points[i].y - y);
          if (d < bestD) { best = i; bestD = d; }
        }
      }
    }
    return best;
  }
}

// A board has 7 inner corner lines each way. The board's outer edge (where squares meet
// the margin) gives weak, X-like responses too, so the lattice may grow to 9 lines and is
// then trimmed to the 7 strongest consecutive ones.
const SPAN = 6;
const GROW_SPAN = 8;
const SNAP = 0.3;        // snap radius as a fraction of the local cell size

// Grows a lattice (integer grid coords -> image) from a 4-point seed.
function growLattice(seed, points, grid) {
  const assigned = new Map();           // "i,j" -> point index
  const used = new Set();
  const coords = [[0, 0], [1, 0], [0, 1], [1, 1]];
  seed.forEach((k, n) => { assigned.set(coords[n].join(), k); used.add(k); });
  let H = homography(coords, seed.map((k) => [points[k].x, points[k].y]));
  if (!H) return null;
  let imin = 0, imax = 1, jmin = 0, jmax = 1;

  for (let round = 0; round < 12; round++) {
    let added = 0;
    for (let i = imin - 1; i <= imax + 1; i++) {
      for (let j = jmin - 1; j <= jmax + 1; j++) {
        if (assigned.has(`${i},${j}`)) continue;
        if (Math.max(imax, i) - Math.min(imin, i) > GROW_SPAN || Math.max(jmax, j) - Math.min(jmin, j) > GROW_SPAN) continue;
        const q = project(H, i, j), qx = project(H, i + 1, j), qy = project(H, i, j + 1);
        if (!q || !qx || !qy) continue;
        const cell = Math.min(Math.hypot(qx[0] - q[0], qx[1] - q[1]), Math.hypot(qy[0] - q[0], qy[1] - q[1]));
        if (cell < 5) continue;
        const k = grid.nearest(q[0], q[1], SNAP * cell, used);
        if (k < 0) continue;
        assigned.set(`${i},${j}`, k);
        used.add(k);
        imin = Math.min(imin, i); imax = Math.max(imax, i);
        jmin = Math.min(jmin, j); jmax = Math.max(jmax, j);
        added++;
      }
    }
    if (!added) break;
    H = refit(assigned, points) ?? H;
  }
  return { H, assigned, bounds: [imin, imax, jmin, jmax] };
}

function refit(assigned, points) {
  const src = [], dst = [];
  for (const [key, k] of assigned) { src.push(key.split(',').map(Number)); dst.push([points[k].x, points[k].y]); }
  return fitHomography(src, dst);
}

// Least squares, then repeatedly drop the points that sit far from the fitted grid
// (false corners where pieces meet squares) and fit again.
function robustFit(src, dst) {
  let H = fitHomography(src, dst);
  for (let round = 0; round < 3 && H; round++) {
    const err = src.map(([x, y], k) => {
      const p = project(H, x, y);
      return p ? Math.hypot(p[0] - dst[k][0], p[1] - dst[k][1]) : Infinity;
    });
    const median = [...err].sort((a, b) => a - b)[err.length >> 1];
    const limit = Math.max(1, 3 * median);
    const keep = err.map((e) => e <= limit);
    if (keep.every(Boolean)) break;
    const s = src.filter((_, k) => keep[k]), d = dst.filter((_, k) => keep[k]);
    if (s.length < 6) break;
    src = s; dst = d;
    H = fitHomography(src, dst) ?? H;
  }
  return H && { H, src, dst };
}

// Keeps the 7 consecutive lines (each way) with the strongest X-corners.
function trimLattice(lat, points) {
  const entries = [...lat.assigned].map(([key, k]) => [...key.split(',').map(Number), k]);
  const bestStart = (axis) => {
    const strength = new Map();
    for (const e of entries) strength.set(e[axis], (strength.get(e[axis]) ?? 0) + points[e[2]].s);
    const lines = [...strength.keys()];
    const lo = Math.min(...lines), hi = Math.max(...lines);
    if (hi - lo <= SPAN) return [lo, hi];
    let best = lo, bestSum = -1;
    for (let start = lo; start + SPAN <= hi; start++) {
      let sum = 0;
      for (let l = start; l <= start + SPAN; l++) sum += strength.get(l) ?? 0;
      if (sum > bestSum) { bestSum = sum; best = start; }
    }
    return [best, best + SPAN];
  };
  const [i0, i1] = bestStart(0), [j0, j1] = bestStart(1);
  const kept = entries.filter(([i, j]) => i >= i0 && i <= i1 && j >= j0 && j <= j1);
  const fit = robustFit(kept.map(([i, j]) => [i, j]), kept.map(([, , k]) => [points[k].x, points[k].y]));
  if (!fit) return null;
  const inliers = new Set(fit.src.map(([i, j]) => `${i},${j}`));
  const assigned = new Map(kept.filter(([i, j]) => inliers.has(`${i},${j}`)).map(([i, j, k]) => [`${i},${j}`, k]));
  return { H: fit.H, assigned, bounds: [i0, i1, j0, j1], count: assigned.size };
}

export function fitLattice(points, { seeds = 50, minInliers = 10 } = {}) {
  if (points.length < minInliers) return null;
  const grid = new PointGrid(points);
  let best = null;
  const covered = new Set();
  for (let p = 0; p < Math.min(seeds, points.length); p++) {
    if (covered.has(p)) continue;
    const P = points[p];
    const near = points
      .map((q, k) => ({ k, d: Math.hypot(q.x - P.x, q.y - P.y) }))
      .filter((o) => o.k !== p && o.d > 4)
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
    for (let a = 0; a < near.length; a++) {
      for (let b = a + 1; b < near.length; b++) {
        const A = points[near[a].k], B = points[near[b].k];
        const ux = A.x - P.x, uy = A.y - P.y, vx = B.x - P.x, vy = B.y - P.y;
        const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
        if (Math.abs(ux * vy - uy * vx) / (lu * lv) < 0.6) continue;     // nearly parallel
        if (Math.max(lu, lv) / Math.min(lu, lv) > 1.8) continue;
        const c = grid.nearest(P.x + ux + vx, P.y + uy + vy, 0.3 * Math.min(lu, lv));
        if (c < 0 || c === p) continue;
        const lat = growLattice([p, near[a].k, near[b].k, c], points, grid);
        if (!lat) continue;
        lat.count = lat.assigned.size;
        // Prefer more inliers; on ties, the finer lattice (a diagonal or 2x lattice also fits a subset).
        if (!best || lat.count > best.count) best = lat;
      }
    }
    if (best && best.count >= 20) for (const k of best.assigned.values()) covered.add(k);
  }
  if (!best) return null;
  const trimmed = trimLattice(best, points);
  return trimmed && trimmed.count >= minInliers ? trimmed : null;
}

// --------------------------------------------------------------- board window

// The 8 symmetries of the square: board plane point (X, Y) -> window-local point.
const D4 = [
  (X, Y) => [X, Y], (X, Y) => [8 - Y, X], (X, Y) => [8 - X, 8 - Y], (X, Y) => [Y, 8 - X],
  (X, Y) => [8 - X, Y], (X, Y) => [X, 8 - Y], (X, Y) => [Y, X], (X, Y) => [8 - Y, 8 - X],
];
const squareIn = (g, f, r) => {
  const [x, y] = g(f + 0.5, r + 0.5);
  return Math.floor(y) * 8 + Math.floor(x);
};

function sampleMean(gray, H, x0, y0, size, n = 3) {
  const { w, h, g } = gray;
  let sum = 0, sum2 = 0, cnt = 0;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const p = project(H, x0 + (size * (a + 0.5)) / n, y0 + (size * (b + 0.5)) / n);
      if (!p) continue;
      const x = Math.round(p[0]), y = Math.round(p[1]);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const v = g[y * w + x];
      sum += v; sum2 += v * v; cnt++;
    }
  }
  if (!cnt) return null;
  const mean = sum / cnt;
  return { mean, std: Math.sqrt(Math.max(0, sum2 / cnt - mean * mean)) };
}

// Square colour (from its corners, which pieces rarely cover) and centre stats.
function squareFeatures(gray, Hw, x, y) {
  let corner = 0, n = 0;
  for (const [cx, cy] of [[0.06, 0.06], [0.74, 0.06], [0.06, 0.74], [0.74, 0.74]]) {
    const s = sampleMean(gray, Hw, x + cx, y + cy, 0.2, 2);
    if (s) { corner += s.mean; n++; }
  }
  const centre = sampleMean(gray, Hw, x + 0.3, y + 0.3, 0.4, 4);
  if (!n || !centre) return null;
  return { corner: corner / n, centre: centre.mean, std: centre.std };
}

// How strongly a line of squares alternates light/dark (board) vs not (margin, table).
function alternation(values) {
  let s = 0, n = 0;
  values.forEach((v, k) => { if (v != null) { s += k % 2 ? -v : v; n++; } });
  return n >= 4 ? Math.abs(s) / n : 0;
}

function corr(xs, ys) {
  const n = xs.length;
  if (n < 4) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    sxy += a * b; sxx += a * a; syy += b * b;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

// expected: optional array of 64 (index rank*8 + file) of null | 'w' | 'b'.
function orientationScores(F, expected) {
  return D4.map((g) => {
    const light = [], cornerV = [], occ = [], piece = [], colourSign = [], centreV = [];
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = F[squareIn(g, f, r)];
        if (!sq) continue;
        const e = expected?.[r * 8 + f];
        if (!e) { light.push((f + r) % 2 ? 1 : -1); cornerV.push(sq.corner); }
        if (expected) {
          occ.push(e ? 1 : 0);
          piece.push(Math.abs(sq.centre - sq.corner) + 0.5 * sq.std);
          if (e) { colourSign.push(e === 'w' ? 1 : -1); centreV.push(sq.centre); }
        }
      }
    }
    const parity = corr(cornerV, light);
    const occupancy = expected ? corr(piece, occ) : 0;
    const colour = expected ? corr(centreV, colourSign) : 0;
    return { parity, occupancy, colour, total: parity + occupancy + colour };
  });
}

// Picks the 8x8 window and orientation. Returns board corners a1, h1, h8, a8 in gray coords.
function chooseBoard(lattice, gray, R, top, expected) {
  const [imin, imax, jmin, jmax] = lattice.bounds;
  const candidates = [];
  for (let oi = imax - 7; oi <= imin - 1; oi++) {
    for (let oj = jmax - 7; oj <= jmin - 1; oj++) {
      const Hw = mul(lattice.H, [1, 0, oi, 0, 1, oj, 0, 0, 1]);
      const quad = [[0, 0], [8, 0], [8, 8], [0, 8]].map(([x, y]) => project(Hw, x, y));
      if (quad.some((p) => !p)) continue;
      const margin = 0.2 * Math.max(gray.w, gray.h);
      if (quad.some(([x, y]) => x < -margin || y < -margin || x > gray.w + margin || y > gray.h + margin)) continue;

      let xs = 0;
      for (let y = 1; y <= 7; y++) {
        for (let x = 1; x <= 7; x++) {
          const p = project(Hw, x, y);
          const px = Math.round(p[0]), py = Math.round(p[1]);
          let m = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const xx = px + dx, yy = py + dy;
            if (xx >= 0 && yy >= 0 && xx < gray.w && yy < gray.h) m = Math.max(m, R[yy * gray.w + xx]);
          }
          xs += m / top;
        }
      }

      // Squares -1..8 in both directions, so we can compare inside lines with the ones just outside.
      const cornerAt = (x, y) => {
        const f = squareFeatures(gray, Hw, x, y);
        return f && f.corner;
      };
      const F = [];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) F.push(squareFeatures(gray, Hw, x, y));
      let inside = 0;
      for (let k = 0; k < 8; k++) {
        inside += alternation(F.slice(k * 8, k * 8 + 8).map((s) => s && s.corner));
        inside += alternation([0, 1, 2, 3, 4, 5, 6, 7].map((x) => F[x * 8 + k] && F[x * 8 + k].corner));
      }
      const lines = [];
      for (const fixed of [-1, 8]) {
        lines.push([0, 1, 2, 3, 4, 5, 6, 7].map((k) => cornerAt(k, fixed)));
        lines.push([0, 1, 2, 3, 4, 5, 6, 7].map((k) => cornerAt(fixed, k)));
      }
      const outside = lines.reduce((s, l) => s + alternation(l), 0) / 4;
      candidates.push({ Hw, xs: xs / 49, checker: inside / 16 - outside, F });
    }
  }
  if (!candidates.length) return null;

  const xsMax = Math.max(...candidates.map((c) => c.xs), 1e-9);
  const chMax = Math.max(...candidates.map((c) => c.checker), 1e-9);
  let best = null;
  for (const c of candidates) {
    const orient = orientationScores(c.F, expected);
    orient.forEach((o, k) => {
      const total = c.xs / xsMax + c.checker / chMax + o.total;
      if (!best || total > best.total) best = { total, c, k, o, orient };
    });
  }
  const g = D4[best.k];
  const corners = [[0, 0], [8, 0], [8, 8], [0, 8]].map(([X, Y]) => project(best.c.Hw, ...g(X, Y)));
  const others = best.orient.filter((_, k) => k !== best.k).map((o) => o.total);
  return {
    corners,
    orientationMargin: best.o.total - Math.max(...others),
    windows: candidates.length,
    scores: best.o,
  };
}

// chess.js board() rows -> 64 entries indexed rank*8 + file: null | 'w' | 'b'.
export function occupancyOf(rows) {
  const out = new Array(64).fill(null);
  for (const row of rows) {
    for (const p of row) if (p) out[(p.square.charCodeAt(1) - 49) * 8 + p.square.charCodeAt(0) - 97] = p.color;
  }
  return out;
}

// Full detection. img: { width, height, data } RGBA. Returns null or
// { corners: [a1, h1, h8, a8] in img pixels, inliers, orientationMargin, ... }.
export function detectBoard(img, { expected = null, maxSide = 480 } = {}) {
  const gray = toGray(img, maxSide);
  const R = xCornerResponse(gray);
  const { points, top } = findXCorners(R, gray.w, gray.h);
  const lattice = fitLattice(points);
  if (!lattice) return null;
  const board = chooseBoard(lattice, gray, R, top, expected);
  if (!board) return null;
  return {
    ...board,
    corners: board.corners.map(([x, y]) => [x * gray.scale, y * gray.scale]),
    inliers: lattice.count,
  };
}

// Follows a board that was already found as the camera moves: snaps the predicted
// inner corners to fresh X-corners (wide first, then tight) and refits. Only the area
// around the board is scanned. H: board plane -> img pixels.
// Returns { corners, inliers, shift } or null if too few corners were found.
export function trackBoard(img, H, { maxSide = 480, minInliers = 10 } = {}) {
  const gray = toGray(img, maxSide);
  const s = 1 / gray.scale;
  let Hg = [H[0] * s, H[1] * s, H[2] * s, H[3] * s, H[4] * s, H[5] * s, H[6], H[7], H[8]];
  const quad = [[0, 0], [8, 0], [8, 8], [0, 8]].map(([x, y]) => project(Hg, x, y));
  if (quad.some((p) => !p)) return null;
  const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
  const pad = 0.2 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const roi = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  const R = xCornerResponse(gray, 5, roi);
  const { points } = findXCorners(R, gray.w, gray.h);
  if (points.length < minInliers) return null;
  const grid = new PointGrid(points);

  let fit = null, firstShift = null;
  for (const snap of [0.5, SNAP, SNAP]) {
    const src = [], dst = [];
    const used = new Set();
    let shift = 0;
    for (let y = 1; y <= 7; y++) {
      for (let x = 1; x <= 7; x++) {
        const q = project(Hg, x, y), qx = project(Hg, x + 1, y), qy = project(Hg, x, y + 1);
        if (!q || !qx || !qy) continue;
        const cell = Math.min(Math.hypot(qx[0] - q[0], qx[1] - q[1]), Math.hypot(qy[0] - q[0], qy[1] - q[1]));
        const k = grid.nearest(q[0], q[1], snap * cell, used);
        if (k < 0) continue;
        used.add(k);
        src.push([x, y]);
        dst.push([points[k].x, points[k].y]);
        shift += Math.hypot(points[k].x - q[0], points[k].y - q[1]);
      }
    }
    if (src.length < minInliers) return null;
    fit = robustFit(src, dst);
    if (!fit || fit.src.length < minInliers) return null;
    if (firstShift === null) firstShift = shift / src.length;
    Hg = fit.H;
  }
  const corners = [[0, 0], [8, 0], [8, 8], [0, 8]].map(([x, y]) => {
    const p = project(Hg, x, y);
    return p && [p[0] * gray.scale, p[1] * gray.scale];
  });
  if (corners.some((p) => !p)) return null;
  return { corners, inliers: fit.src.length, shift: firstShift * gray.scale };
}
