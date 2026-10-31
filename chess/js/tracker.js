// Follows a real-life game by watching which squares change between *stable*
// camera frames and picking the legal move that explains the change.

import { squareDiffs, maxOf } from './vision.js?v=4';

export const DEFAULTS = {
  noise: 0.03,          // per-square change below this is camera noise
  minChange: 0.07,      // every square a move touches must change at least this much
  still: 0.06,          // max per-square change between consecutive samples to count as "still"
  stableSamples: 4,     // consecutive still samples before we trust a frame
  maxPenalty: 0.2,      // total (noise-adjusted) change allowed on squares the move does not touch
  rebase: 0.05,         // below this the board is unchanged; re-baseline to follow slow lighting drift
  minScore: 0.06,       // a move scoring at least this is taken even if the board looks nearly unchanged
  provisionalSamples: 20, // for this long after a move, a further change may revise it instead
};

import { applyH } from './homography.js?v=4';

const sq = (name) => (name.charCodeAt(0) - 97) + (name.charCodeAt(1) - 49) * 8;

// Squares a move touches, each with the height class of the piece standing there
// before or after (tall pieces hide more of the board behind them).
export function touchedSquares(m) {
  const tall = (type) => (type === 'p' ? 1 : 2);
  const out = [
    { s: sq(m.from), h: tall(m.piece) },
    { s: sq(m.to), h: Math.max(tall(m.promotion ?? m.piece), m.captured ? tall(m.captured) : 0) },
  ];
  if (m.flags.includes('e')) out.push({ s: sq(m.to[0] + m.from[1]), h: 1 });   // en passant victim
  if (m.flags.includes('k')) out.push({ s: sq('h' + m.from[1]), h: 2 }, { s: sq('f' + m.from[1]), h: 2 });
  if (m.flags.includes('q')) out.push({ s: sq('a' + m.from[1]), h: 2 }, { s: sq('d' + m.from[1]), h: 2 });
  return out;
}

export function changedSquares(m) {
  return touchedSquares(m).map((t) => t.s);
}

// Seen at an angle, a standing piece covers part of the square behind it (further up the
// picture) and can hide the square in front of it from view. For each square: the
// neighbour that lies "up" in the image (behind) and "down" (front), or -1.
// H: board plane -> image pixels.
export function viewGeometry(H) {
  const centre = (f, r) => applyH(H, f + 0.5, r + 0.5);
  const behind = new Array(64).fill(-1);
  const front = new Array(64).fill(-1);
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const [x, y] = centre(f, r);
      let up = 0.6, down = 0.6;
      for (let dr = -1; dr <= 1; dr++) {
        for (let df = -1; df <= 1; df++) {
          const nf = f + df, nr = r + dr;
          if ((!df && !dr) || nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
          const [nx, ny] = centre(nf, nr);
          const dot = (y - ny) / (Math.hypot(nx - x, ny - y) || 1);   // +1 = straight up the image
          if (dot > up) { up = dot; behind[r * 8 + f] = nr * 8 + nf; }
          if (-dot > down) { down = -dot; front[r * 8 + f] = nr * 8 + nf; }
        }
      }
    }
  }
  return { behind, front };
}

const nameOf = (s) => 'abcdefgh'[s % 8] + (1 + (s >> 3));

// Legal moves that could explain the per-square changes `d`, best first, as { move, score }.
// Promotions share their squares, so they collapse to the queen promotion.
// view (optional, from viewGeometry) accounts for standing pieces: a touched square's
// change may show up on the squares behind it, and a square hidden behind a piece in
// front of it may show no change at all.
// loose: the same changes measured with slack (see squareDiffs); it is used for the squares a
// move should NOT touch, so small camera movements don't count against a move.
export function rankMoves(chess, d, params = DEFAULTS, view = null, loose = d) {
  const candidates = new Map();
  for (const m of chess.moves({ verbose: true })) {
    const key = m.from + m.to;
    if (!candidates.has(key) || m.promotion === 'q') candidates.set(key, m);
  }

  const adjusted = Array.from(d, (v) => Math.max(0, v - params.noise));
  const looseAdjusted = Array.from(loose, (v) => Math.max(0, v - params.noise));
  const looseTotal = looseAdjusted.reduce((a, b) => a + b, 0);

  const ranked = [];
  for (const m of candidates.values()) {
    const touched = touchedSquares(m);
    const arrivals = new Set([sq(m.to), ...(m.flags.includes('k') ? [sq('f' + m.from[1])] : []), ...(m.flags.includes('q') ? [sq('d' + m.from[1])] : [])]);
    const may = new Set();          // squares this move can change
    const must = [];                // squares in plain view that should change
    for (const { s, h } of touched) {
      may.add(s);
      for (let b = s, k = 0; view && k < h && view.behind[b] >= 0; k++) may.add((b = view.behind[b]));
      // Hidden if a piece stands in front of it before or after the move (the mover included).
      const f = view ? view.front[s] : -1;
      const hidden = f >= 0 && (chess.get(nameOf(f)) || arrivals.has(f));
      if (!hidden) must.push(s);
    }
    let gain = 0, looseGain = 0;
    for (const s of may) { gain += adjusted[s]; looseGain += looseAdjusted[s]; }
    const penalty = looseTotal - looseGain;
    if (gain < params.minChange - params.noise || penalty > params.maxPenalty) continue;
    const missing = must.reduce((sum, s) => sum + Math.max(0, params.minChange - d[s]), 0);
    // Between moves that explain the change equally well, prefer the one predicting fewer squares.
    const score = gain - 2 * penalty - 2 * missing - 0.005 * may.size;
    // bad: how much the move leaves unexplained or fails to show, used to compare explanations.
    if (score > 0) ranked.push({ move: m, score, bad: 2 * penalty + 2 * missing });
  }
  return ranked.sort((a, b) => b.score - a.score);
}

export function matchMove(chess, d, params = DEFAULTS, view = null, loose = d) {
  return rankMoves(chess, d, params, view, loose)[0]?.move ?? null;
}

export class Tracker {
  constructor(chess, params = {}) {
    this.chess = chess;
    this.params = { ...DEFAULTS, ...params };
    this.view = null;
    this.resync();
  }

  // Tell the tracker how the board sits in the picture (board plane -> image pixels),
  // so it knows which squares standing pieces hide.
  setView(H) {
    this.view = H ? viewGeometry(H) : null;
  }

  // Forget what the board looked like; the next stable frame becomes the baseline.
  // Call after anything that changes the game without the camera seeing it.
  resync() {
    this.committed = null;
    this.prev = null;
    this.stable = 0;
    this.t = 0;
    this.provisional = null;
    this.result = { state: 'init' };
  }

  // Feed one signature per camera sample. Returns { state, move?, replaced?, alternatives?, d? }
  // where state is init | moving | settling | steady | unmatched, or - exactly once each
  // time it happens - baseline | move. Callers can therefore act on 'move' without
  // de-duplicating. A 'move' with `replaced` swaps out the previous move (see reconsider).
  // prevSameView: the previous frame sampled with the *current* board pose, if the pose
  // moved since, so a pose update doesn't count as movement.
  feed(sig, prevSameView = null) {
    const p = this.params;
    this.t++;
    const prev = this.prev && (prevSameView ?? this.prev);
    this.prev = sig;
    if (!prev) return (this.result = { state: 'init' });

    if (maxOf(squareDiffs(prev, sig, 1)) > p.still) {
      this.stable = 0;
      return (this.result = { state: 'moving' });
    }
    this.stable++;
    if (this.stable < p.stableSamples) return (this.result = { state: 'settling' });
    // Already judged this stable frame; an idle board is re-judged now and then so the
    // baseline follows slow lighting drift.
    const recheck = this.result.state === 'steady' && this.stable % 20 === 0;
    if (this.stable > p.stableSamples && !recheck) return this.result;

    if (!this.committed) {
      this.committed = sig;
      this.result = { state: 'steady' };
      return { state: 'baseline' };
    }

    // A legal move that clearly explains the change wins; failing that, a board that looks
    // the same (allowing for a little camera movement) is just re-baselined.
    const { ranked, d, loose } = this.#rank(this.committed, sig);
    const fixed = this.#reconsider(sig, ranked[0]);
    if (fixed) return fixed;
    if (!ranked.length || ranked[0].score < p.minScore) {
      if (maxOf(loose) < p.rebase) {
        this.committed = sig;
        return (this.result = { state: 'steady', d: loose });
      }
      if (!ranked.length) return (this.result = { state: 'unmatched', d });
    }

    const m = ranked[0].move;
    this.chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    this.provisional = { base: this.committed, at: this.t };
    this.committed = sig;
    this.result = { state: 'steady', d };
    // The runners-up, so a wrong guess can be fixed with one tap.
    return { state: 'move', move: m, alternatives: ranked.slice(1, 4).map((r) => r.move), d };
  }

  #rank(from, sig) {
    const d = squareDiffs(from, sig, 0);
    const loose = squareDiffs(from, sig, 1);
    return { d, loose, ranked: rankMoves(this.chess, d, this.params, this.view, loose) };
  }

  // The board changed again soon after a move. If a single move from the position before
  // that one explains everything clearly better than a second move would, the first guess
  // was made while a hand was still over the board: swap it (or keep it, if it's the same).
  #reconsider(sig, next) {
    const pv = this.provisional;
    if (!pv || this.t - pv.at > this.params.provisionalSamples || !this.chess.history().length) return null;
    const last = this.chess.undo();
    const { ranked, d } = this.#rank(pv.base, sig);
    const single = ranked[0];
    if (!single || (next && single.bad + 0.05 >= next.bad)) {
      this.chess.move({ from: last.from, to: last.to, promotion: last.promotion });
      return null;
    }
    const m = single.move;
    this.chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    this.committed = sig;
    this.provisional = { base: pv.base, at: this.t };
    this.result = { state: 'steady', d };
    if (m.san === last.san) return this.result;
    return { state: 'move', move: m, replaced: last, alternatives: ranked.slice(1, 4).map((r) => r.move), d };
  }
}
