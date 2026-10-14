import { clamp } from './util';
import type { Country, GameState } from './types';

/** The public's approval of the government (0-100): stability, growth, prices, jobs and war weariness. */
export function approval(_s: GameState, c: Country): number {
  const e = c.eco;
  return clamp(50 + 0.45 * (e.stability - 50) + 500 * (e.growth - 0.02) - 250 * Math.max(0, e.inflation - 0.04) - 100 * Math.max(0, e.unemployment - e.uNat - 0.02) - 20 * c.mil.exhaustion, 5, 95);
}
