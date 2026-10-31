// Renders fake camera frames of a chessboard (perspective, noise, exposure,
// a "hand") so the tracker can be tested without a camera.

import { Chess } from '../vendor/chess.js';
import { applyH, boardToImage, invertH } from '../js/homography.js';

export const W = 480;
export const H = 360;

// Where the board's a1, h1, h8, a8 corners land in the image (tilted, off-centre).
export const TRUE_CORNERS = [[92, 318], [398, 330], [352, 52], [130, 44]];

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  return Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
}

const LIGHT_SQ = [226, 202, 166];
const DARK_SQ = [140, 100, 64];
const TABLE = [88, 80, 72];
const WHITE_PC = [238, 236, 226];
const BLACK_PC = [38, 36, 40];
const SKIN = [214, 164, 134];
const MARGIN = [232, 228, 214];

// pieces: Map squareName -> { type, color } (a chess.js board snapshot works).
// opts: { hand: {x, y, r} | null, gain, noise, rand, corners, tall, margin }
//   tall: draw pieces standing up (they lean over the squares behind them) instead of flat discs
//   margin: a vinyl-style light margin around the playing area
export function renderFrame(pieces, opts = {}) {
  const { hand = null, gain = 1, noise = 4, rand = rng(1), corners = TRUE_CORNERS, tall = false, margin = false } = opts;
  const Hm = boardToImage(corners);
  const inv = invertH(Hm);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [u, v] = applyH(inv, x + 0.5, y + 0.5);
      let rgb = TABLE;
      const rim = margin ? 0.6 : 0.15;
      if (u >= -rim && u < 8 + rim && v >= -rim && v < 8 + rim) {
        rgb = margin ? MARGIN : [60, 40, 28];               // frame around the board
        if (u >= 0 && u < 8 && v >= 0 && v < 8) {
          const f = Math.floor(u), r = Math.floor(v);
          rgb = (f + r) % 2 === 0 ? DARK_SQ : LIGHT_SQ;
          const piece = !tall && pieces.get('abcdefgh'[f] + (r + 1));
          if (piece) {
            const du = u - f - 0.5, dv = v - r - 0.5;
            const dist = Math.hypot(du, dv);
            if (dist < 0.3) rgb = piece.color === 'w' ? WHITE_PC : BLACK_PC;
            if (dist < 0.12) rgb = piece.color === 'w' ? [200, 198, 190] : [70, 66, 72];   // piece top
          }
        }
      }
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = rgb[c];
      data[o + 3] = 255;
    }
  }
  if (tall) drawStandingPieces(data, pieces, Hm);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const handHere = hand && Math.hypot(x - hand.x, y - hand.y) < hand.r;
      for (let c = 0; c < 3; c++) data[o + c] = (handHere ? SKIN[c] : data[o + c]) * gain + gauss(rand) * noise;
    }
  }
  return { width: W, height: H, data };
}

const HEIGHT = { p: 0.8, n: 1.0, b: 1.1, r: 0.9, q: 1.3, k: 1.45 };

// Pieces as upright capsules: base on the square, body rising up the image (towards the
// far side), drawn far-to-near so nearer pieces cover the ones behind them.
function drawStandingPieces(data, pieces, Hm) {
  const list = [...pieces].map(([name, p]) => {
    const f = name.charCodeAt(0) - 97, r = name.charCodeAt(1) - 49;
    const base = applyH(Hm, f + 0.5, r + 0.5);
    const a = applyH(Hm, f, r + 0.5), b = applyH(Hm, f + 1, r + 0.5);
    const cell = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { p, base, cell };
  }).sort((s, t) => s.base[1] - t.base[1]);
  for (const { p, base, cell } of list) {
    const rad = 0.3 * cell, h = HEIGHT[p.type] * cell;
    const [bx, by] = base, ty = by - h;
    const body = p.color === 'w' ? WHITE_PC : BLACK_PC;
    for (let y = Math.max(0, Math.floor(ty - rad)); y < Math.min(H, Math.ceil(by + rad)); y++) {
      for (let x = Math.max(0, Math.floor(bx - rad)); x < Math.min(W, Math.ceil(bx + rad)); x++) {
        const cy = Math.min(by, Math.max(ty, y));
        if (Math.hypot(x - bx, y - cy) > rad) continue;
        const shade = 0.75 + 0.25 * (1 - Math.abs(x - bx) / rad);   // rounder look
        const o = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) data[o + c] = body[c] * shade;
      }
    }
  }
}

export function piecesOf(chess) {
  const map = new Map();
  for (const row of chess.board()) for (const p of row) if (p) map.set(p.square, p);
  return map;
}

export function squareCentre(name, corners = TRUE_CORNERS) {
  const f = name.charCodeAt(0) - 97, r = name.charCodeAt(1) - 49;
  return applyH(boardToImage(corners), f + 0.5, r + 0.5);
}
