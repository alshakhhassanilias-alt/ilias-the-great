// What's drawn over the live camera picture: the board outline and grid, the last move,
// and the best move as a big arrow with a pulsing target square and a label. It is an SVG
// whose coordinates are the video's pixels, so it lines up with the picture exactly.
//
// The elements are created once and only their shapes change, so CSS animations (the
// pulse) keep running smoothly while the board pose updates several times a second.

import { applyH } from './homography.js?v=4';

const fmt = (n) => Math.round(n * 10) / 10;
const path = (pts, close = true) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${fmt(x)} ${fmt(y)}`).join('') + (close ? 'Z' : '');
const squareCorners = (H, f, r) => [[f, r], [f + 1, r], [f + 1, r + 1], [f, r + 1]].map(([x, y]) => applyH(H, x, y));
const fr = (name) => [name.charCodeAt(0) - 97, name.charCodeAt(1) - 49];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Board-plane points an arrow goes through: straight, or an L for a knight (long leg first).
export function arrowRoute(from, to, knight) {
  const [ff, fr0] = fr(from), [tf, tr] = fr(to);
  const a = [ff + 0.5, fr0 + 0.5], b = [tf + 0.5, tr + 0.5];
  if (!knight) return [a, b];
  const corner = Math.abs(tf - ff) === 2 ? [b[0], a[1]] : [a[0], b[1]];
  return [a, corner, b];
}

export class Overlay {
  constructor(svg) {
    this.svg = svg;
    svg.innerHTML = `
      <g class="ov-diff"></g>
      <path class="ov-grid"/>
      <path class="ov-edge"/>
      <path class="ov-last"/>
      <g class="ov-best">
        <path class="ov-from"/>
        <path class="ov-to"/>
        <path class="ov-arrow-shade"/>
        <path class="ov-arrow"/>
        <path class="ov-head"/>
        <g class="ov-label"><rect rx="999"/><text text-anchor="middle" dominant-baseline="central"/></g>
      </g>
      <g class="ov-handles"></g>`;
    this.q = (sel) => svg.querySelector(sel);
    this.unit = 1;
  }

  // w, h: video size in pixels; unit: video pixels per CSS pixel on screen.
  setSize(w, h, unit) {
    this.w = w;
    this.h = h;
    this.unit = unit;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }

  // H: board plane -> video pixels (or null). corners: tapped/locked corners in video pixels.
  // last / best: chess.js-style moves ({ from, to }; best also { san, knight }).
  render({ H, corners = [], last = null, best = null, diffs = null, handles = false }) {
    const u = this.unit;
    const show = (el, on) => el.setAttribute('display', on ? 'inline' : 'none');

    this.q('.ov-handles').innerHTML = handles
      ? corners.map(([x, y], i) => `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(9 * u)}" stroke-width="${fmt(2.5 * u)}"/>` +
        `<text x="${fmt(x + 14 * u)}" y="${fmt(y - 12 * u)}" font-size="${fmt(14 * u)}" stroke-width="${fmt(4 * u)}">${['a1', 'h1', 'h8', 'a8'][i]}</text>`).join('')
      : '';

    for (const sel of ['.ov-grid', '.ov-edge', '.ov-last', '.ov-best', '.ov-diff']) show(this.q(sel), !!H);
    if (!H) return;

    // grid and outline
    let grid = '';
    for (let i = 1; i < 8; i++) {
      grid += path([applyH(H, i, 0), applyH(H, i, 8)], false) + path([applyH(H, 0, i), applyH(H, 8, i)], false);
    }
    this.q('.ov-grid').setAttribute('d', grid);
    this.q('.ov-grid').setAttribute('stroke-width', fmt(1.2 * u));
    this.q('.ov-edge').setAttribute('d', path([[0, 0], [8, 0], [8, 8], [0, 8]].map(([x, y]) => applyH(H, x, y))));
    this.q('.ov-edge').setAttribute('stroke-width', fmt(2.5 * u));

    this.q('.ov-diff').innerHTML = diffs
      ? [...diffs].map((d, s) => (d < 0.03 ? '' : `<path d="${path(squareCorners(H, s % 8, s >> 3))}" fill-opacity="${Math.min(0.6, d * 1.5).toFixed(2)}"/>`)).join('')
      : '';

    this.q('.ov-last').setAttribute('d', last ? path(squareCorners(H, ...fr(last.from))) + path(squareCorners(H, ...fr(last.to))) : '');

    show(this.q('.ov-best'), !!best);
    if (!best) return;
    const toSq = squareCorners(H, ...fr(best.to));
    const cell = (dist(toSq[0], toSq[1]) + dist(toSq[1], toSq[2]) + dist(toSq[2], toSq[3]) + dist(toSq[3], toSq[0])) / 4;
    this.q('.ov-from').setAttribute('d', path(squareCorners(H, ...fr(best.from))));
    this.q('.ov-from').setAttribute('stroke-width', fmt(2.5 * u));
    this.q('.ov-to').setAttribute('d', path(toSq));
    this.q('.ov-to').setAttribute('stroke-width', fmt(3 * u));

    // The arrow: a thick round-ended line with a separate head, sized to the target square
    // but never thinner than ~6 screen pixels.
    const pts = arrowRoute(best.from, best.to, best.knight).map(([x, y]) => applyH(H, x, y));
    const width = Math.max(0.2 * cell, 6 * u);
    const headLen = Math.max(0.55 * cell, 16 * u), headHalf = Math.max(0.36 * cell, 11 * u);
    const tip = pts.at(-1), prev = pts.at(-2);
    const len = dist(prev, tip) || 1;
    const ux = (tip[0] - prev[0]) / len, uy = (tip[1] - prev[1]) / len;
    const base = [tip[0] - ux * headLen, tip[1] - uy * headLen];
    const shaft = path([...pts.slice(0, -1), base], false);
    for (const sel of ['.ov-arrow', '.ov-arrow-shade']) this.q(sel).setAttribute('d', shaft);
    this.q('.ov-arrow').setAttribute('stroke-width', fmt(width));
    this.q('.ov-arrow-shade').setAttribute('stroke-width', fmt(width + 6 * u));
    this.q('.ov-head').setAttribute('d', path([tip, [base[0] - uy * headHalf, base[1] + ux * headHalf], [base[0] + uy * headHalf, base[1] - ux * headHalf]]));
    this.q('.ov-head').setAttribute('stroke-width', fmt(3 * u));

    // The move's name in a pill just above the target square (kept inside the picture).
    const font = 16 * u;
    const label = this.q('.ov-label');
    const boxW = (best.san.length * 0.66 + 1.4) * font, boxH = 1.75 * font;
    const top = Math.min(...toSq.map((p) => p[1]));
    const cx = Math.min(Math.max(tip[0], boxW / 2 + 4 * u), this.w - boxW / 2 - 4 * u);
    const cy = Math.max(top - boxH / 2 - 6 * u, boxH / 2 + 4 * u);
    const rect = label.querySelector('rect');
    rect.setAttribute('x', fmt(cx - boxW / 2));
    rect.setAttribute('y', fmt(cy - boxH / 2));
    rect.setAttribute('width', fmt(boxW));
    rect.setAttribute('height', fmt(boxH));
    const text = label.querySelector('text');
    text.setAttribute('x', fmt(cx));
    text.setAttribute('y', fmt(cy));
    text.setAttribute('font-size', fmt(font));
    text.textContent = best.san;
  }
}
