import { clamp } from './util';
import type { Country, GameState } from './types';

/**
 * The public's approval of the government (0-100): stability, growth, prices, jobs, war weariness, the factions'
 * mood, and the wear of power (every year in office costs a little, like in real politics).
 */
export function approval(s: GameState, c: Country): number {
  const e = c.eco;
  let wear = 0;
  if (c.id === s.player) {
    const L = s.legacy;
    wear = L && L.status === 'office' ? Math.min(14, 3 * (L.term - 1) + 1.2 * ((s.tick - L.termStart) / 52)) : Math.min(10, 1.2 * (s.tick / 52));
  }
  return clamp((c.politics?.appr ?? 0) + 44 + 0.4 * (e.stability - 55) + 350 * (e.growth - 0.025) - 250 * Math.max(0, e.inflation - 0.04) - 100 * Math.max(0, e.unemployment - e.uNat - 0.02) - 20 * c.mil.exhaustion - wear, 5, 95);
}
