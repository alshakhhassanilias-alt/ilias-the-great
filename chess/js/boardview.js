// The on-screen board: SVG squares and pieces, coordinates, last move, check, the best move
// as an arrow, and tap-to-move with legal-move dots. The piece that just moved slides in.

import { pieceShape } from './pieces.js?v=4';
import { arrowRoute } from './overlay.js?v=4';

const FILES = 'abcdefgh';
const S = 100;   // one square, in SVG units

export class BoardView {
  // onMove({ from, to, promotion }) is called when the user moves a piece by tapping.
  constructor(el, { chess, onMove }) {
    this.el = el;
    this.chess = chess;
    this.onMove = onMove;
    this.flipped = false;
    this.selected = null;
    this.animatedFor = '';
    el.addEventListener('click', (e) => this.#tap(e));
  }

  #xy(name) {
    const f = FILES.indexOf(name[0]), r = +name[1] - 1;
    return this.flipped ? [(7 - f) * S, r * S] : [f * S, (7 - r) * S];
  }

  #tap(e) {
    const box = this.el.getBoundingClientRect();
    let col = Math.floor(((e.clientX - box.left) / box.width) * 8);
    let row = Math.floor(((e.clientY - box.top) / box.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return;
    if (this.flipped) { col = 7 - col; row = 7 - row; }
    const name = FILES[col] + (8 - row);
    const piece = this.chess.get(name);
    if (this.selected && this.selected !== name) {
      const legal = this.chess.moves({ square: this.selected, verbose: true }).find((m) => m.to === name);
      if (legal) {
        const from = this.selected;
        this.selected = null;
        this.onMove({ from, to: name, promotion: legal.promotion ? 'q' : undefined });
        return;
      }
    }
    this.selected = piece && piece.color === this.chess.turn() && this.selected !== name ? name : null;
    this.render(this.last);
  }

  // best: { from, to, knight } or null.
  render({ best = null } = {}) {
    this.last = { best };
    const chess = this.chess;
    const lastMove = chess.history({ verbose: true }).at(-1);
    const parts = [];

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const name = FILES[f] + (r + 1);
        const [x, y] = this.#xy(name);
        parts.push(`<rect x="${x}" y="${y}" width="${S}" height="${S}" class="${(f + r) % 2 ? 'sq-l' : 'sq-d'}"/>`);
      }
    }
    // coordinates along the bottom and left edges, in the opposite square colour
    for (let i = 0; i < 8; i++) {
      const file = this.flipped ? FILES[7 - i] : FILES[i];
      const rank = this.flipped ? i + 1 : 8 - i;
      parts.push(`<text x="${i * S + 92}" y="${8 * S - 8}" text-anchor="end" class="${i % 2 ? 'co-d' : 'co-l'}">${file}</text>`);
      parts.push(`<text x="8" y="${i * S + 24}" class="${i % 2 ? 'co-l' : 'co-d'}">${rank}</text>`);
    }
    const tint = (name, cls) => { const [x, y] = this.#xy(name); parts.push(`<rect x="${x}" y="${y}" width="${S}" height="${S}" class="${cls}"/>`); };
    if (lastMove) { tint(lastMove.from, 'hl-last'); tint(lastMove.to, 'hl-last'); }
    if (best) { tint(best.from, 'hl-from'); tint(best.to, 'hl-to'); }
    if (this.selected) tint(this.selected, 'hl-sel');
    if (chess.inCheck()) {
      const king = chess.board().flat().find((p) => p && p.type === 'k' && p.color === chess.turn());
      if (king) { const [x, y] = this.#xy(king.square); parts.push(`<circle cx="${x + 50}" cy="${y + 50}" r="50" fill="url(#checkGlow)"/>`); }
    }

    // pieces; the one that just moved slides in from where it came from
    const key = chess.fen();
    const animate = lastMove && this.animatedFor !== key && this.animatedFor !== '';
    for (const p of chess.board().flat()) {
      if (!p) continue;
      const [x, y] = this.#xy(p.square);
      const moving = animate && p.square === lastMove.to;
      const start = moving ? this.#xy(lastMove.from) : [x, y];
      parts.push(`<g class="pc${moving ? ' pc-moving' : ''}" data-to="${x} ${y}" style="transform: translate(${start[0]}px, ${start[1]}px)">${pieceShape(p.type, p.color)}</g>`);
    }
    this.animatedFor = key;

    if (this.selected) {
      for (const m of chess.moves({ square: this.selected, verbose: true })) {
        const [x, y] = this.#xy(m.to);
        parts.push(m.captured
          ? `<circle cx="${x + 50}" cy="${y + 50}" r="44" class="mv-cap"/>`
          : `<circle cx="${x + 50}" cy="${y + 50}" r="15" class="mv-dot"/>`);
      }
    }

    if (best) {
      // board-plane point (files across, ranks up, 0..8) -> SVG units
      const toSvg = ([X, Y]) => (this.flipped ? [(8 - X) * S, Y * S] : [X * S, (8 - Y) * S]);
      const pts = arrowRoute(best.from, best.to, best.knight).map(toSvg);
      const tip = pts.at(-1), prev = pts.at(-2);
      const len = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]);
      const ux = (tip[0] - prev[0]) / len, uy = (tip[1] - prev[1]) / len;
      const base = [tip[0] - ux * 34, tip[1] - uy * 34];
      const shaft = [...pts.slice(0, -1), base].map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('');
      parts.push(`<g class="bd-arrow"><path d="${shaft}"/><path class="head" d="M${tip[0]} ${tip[1]}L${base[0] - uy * 24} ${base[1] + ux * 24}L${base[0] + uy * 24} ${base[1] - ux * 24}Z"/></g>`);
    }

    this.el.innerHTML = `<svg viewBox="0 0 800 800" role="img" aria-label="Board">
      <defs><radialGradient id="checkGlow"><stop offset="0" stop-color="#ff4d4d" stop-opacity=".9"/><stop offset="1" stop-color="#ff4d4d" stop-opacity="0"/></radialGradient></defs>
      ${parts.join('')}</svg>`;

    // second frame: let the moved piece glide to its square
    const moving = this.el.querySelector('.pc-moving');
    if (moving) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const [x, y] = moving.dataset.to.split(' ');
        moving.style.transform = `translate(${x}px, ${y}px)`;
      }));
    }
  }

  flip() {
    this.flipped = !this.flipped;
    this.render(this.last);
  }
}
