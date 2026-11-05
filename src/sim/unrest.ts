/**
 * Independence movements: a country in turmoil that holds conquered land can lose it again. Provinces
 * whose historical owner still exists (or can be reborn) break away and rejoin, so the map keeps changing
 * and conquest is never "free".
 */
import type { Geo } from './geo';
import { nextRand } from './rng';
import { logEvent } from './log';
import { addRelation, touchTreaties } from './relations';
import { transferProvince } from './war';
import { recount } from './buildings';
import type { GameState } from './types';
import { BENCH_EQUIP_PER_TROOP } from './military';

export function stepUnrest(s: GameState, geo: Geo) {
  if (s.tick % 4 !== 1 || s.tick < 30) return;
  for (const c of s.countries) {
    if (!c.alive || c.provinces.length < 2 || c.eco.stability >= 38) continue;
    // warn the player before it happens
    const hot = c.provinces.filter((p) => s.core[p] !== c.id && s.core[p] >= 0 && s.integ[p] < 0.7 && p !== c.capital);
    if (!hot.length) continue;
    if (c.id === s.player && s.tick - (s.stats.unrestWarn ?? -999) > 40) {
      s.stats.unrestWarn = s.tick;
      logEvent(s, `✊ Unrest in the lands you conquered: with stability at ${c.eco.stability.toFixed(0)}, independence movements are growing.`, 'danger', [c.id], true);
    }
    const p = hot.reduce((a, b) => (s.integ[a] < s.integ[b] ? a : b));
    if (nextRand(s) > 0.07 * (38 - c.eco.stability) / 38 * (1.2 - s.integ[p])) continue;
    const R = s.countries[s.core[p]];
    if (R.id === c.id) continue;
    const reborn = !R.alive;
    if (reborn) {
      R.alive = true;
      R.provinces = [];
      R.capital = p;
      R.mil.troops = Math.max(R.mil.troops, 6000);
      R.mil.equipArmy = Math.max(R.mil.equipArmy, R.mil.troops * BENCH_EQUIP_PER_TROOP * 0.5);
      R.mil.readiness = 0.7; R.mil.exhaustion = 0; R.mil.nuclear = false;
      R.eco.stability = 55; R.eco.cash = 0; R.eco.debt = 0;
      R.reputation = Math.max(R.reputation, 60);
    }
    const name = geo.provinces[p].name || R.name;
    transferProvince(s, geo, p, R.id);
    recount(s, [c.id, R.id]);
    touchTreaties(s);
    addRelation(s, R.id, c.id, -25);
    c.eco.stability = Math.max(0, c.eco.stability - 4);
    logEvent(s, reborn
      ? `✊ INDEPENDENCE: ${name} rises up against ${c.name} and ${R.name} is reborn as a country!`
      : `✊ UPRISING: ${name} breaks away from ${c.name} and returns to ${R.name}.`, 'territory', [R.id, c.id], true, { big: true, prov: p });
  }
}
