// Follows a real-life game by watching which squares change between *stable*
// camera frames and picking the legal move that explains the change.

import { squareDiffs, maxOf } from './vision.js';

export const DEFAULTS = {
  noise: 0.03,          // per-square change below this is camera noise
  minChange: 0.07,      // every square a move touches must change at least this much
  still: 0.035,         // max per-square change between consecutive samples to count as "still"
  stableSamples: 4,     // consecutive still samples before we trust a frame
  maxPenalty: 0.2,      // total (noise-adjusted) change allowed on squares the move does not touch
  rebase: 0.05,         // below this the board is unchanged; re-baseline to follow slow lighting drift
};

const sq = (name) => (name.charCodeAt(0) - 97) + (name.charCodeAt(1) - 49) * 8;

// Squares whose appearance changes when `m` (a verbose chess.js move) is played.
export function changedSquares(m) {
  const squares = [m.from, m.to];
  if (m.flags.includes('e')) squares.push(m.to[0] + m.from[1]);   // en passant victim
  if (m.flags.includes('k')) squares.push('h' + m.from[1], 'f' + m.from[1]);
  if (m.flags.includes('q')) squares.push('a' + m.from[1], 'd' + m.from[1]);
  return squares.map(sq);
}

// Picks the legal move that best explains the per-square changes `d`, or null.
// Promotions share their squares, so they collapse to the queen promotion.
export function matchMove(chess, d, params = DEFAULTS) {
  const candidates = new Map();
  for (const m of chess.moves({ verbose: true })) {
    const key = m.from + m.to;
    if (!candidates.has(key) || m.promotion === 'q') candidates.set(key, m);
  }

  const adjusted = Array.from(d, (v) => Math.max(0, v - params.noise));
  const total = adjusted.reduce((a, b) => a + b, 0);

  let best = null;
  for (const m of candidates.values()) {
    const squares = changedSquares(m);
    if (squares.some((s) => d[s] < params.minChange)) continue;
    const gain = squares.reduce((sum, s) => sum + adjusted[s], 0);
    const penalty = total - gain;
    const score = gain - 2 * penalty;
    if (penalty > params.maxPenalty || score <= 0) continue;
    if (!best || score > best.score) best = { move: m, score };
  }
  return best && best.move;
}

export class Tracker {
  constructor(chess, params = {}) {
    this.chess = chess;
    this.params = { ...DEFAULTS, ...params };
    this.resync();
  }

  // Forget what the board looked like; the next stable frame becomes the baseline.
  // Call after anything that changes the game without the camera seeing it.
  resync() {
    this.committed = null;
    this.prev = null;
    this.stable = 0;
    this.result = { state: 'init' };
  }

  // Feed one signature per camera sample. Returns { state, move?, d? } where state is
  // init | moving | settling | steady | unmatched, or - exactly once each time it
  // happens - baseline | move. Callers can therefore act on 'move' without de-duplicating.
  feed(sig) {
    const p = this.params;
    const prev = this.prev;
    this.prev = sig;
    if (!prev) return (this.result = { state: 'init' });

    if (maxOf(squareDiffs(prev, sig)) > p.still) {
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

    const d = squareDiffs(this.committed, sig);
    if (maxOf(d) < p.rebase) {
      this.committed = sig;
      return (this.result = { state: 'steady', d });
    }

    const m = matchMove(this.chess, d, p);
    if (!m) return (this.result = { state: 'unmatched', d });

    this.chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    this.committed = sig;
    this.result = { state: 'steady', d };
    return { state: 'move', move: m, d };
  }
}
