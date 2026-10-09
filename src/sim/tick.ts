import type { Geo } from './geo';
import { stepEconomies } from './economy';
import { stepWars, forcePeaceAll, logEvent } from './war';
import { stepAI } from './ai';
import { nextRand } from './rng';
import { rollPlayerEvent, stepWorldEvents } from './events';
import { stepGoals } from './goals';
import { alliesOf } from './relations';
import { START_YEAR, TICKS_PER_YEAR, type GameState } from './types';

export function dateOf(tick: number): Date {
  return new Date(Date.UTC(START_YEAR, 0, 1) + tick * 7 * 86400000);
}
export function dateLabel(tick: number): string {
  const d = dateOf(tick);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function checkInstability(s: GameState, geo: Geo) {
  for (const c of s.countries) {
    if (!c.alive || c.eco.stability >= 8) continue;
    if (nextRand(s) < 0.02) {
      c.eco.stability = 40;
      c.mil.exhaustion = Math.min(c.mil.exhaustion, 0.3);
      c.eco.inflation = Math.min(c.eco.inflation, 0.1);
      logEvent(s, `Political upheaval in ${c.name}: the government fell and a transitional regime sued for peace in all wars.`, 'danger', [c.id], c.id === s.player);
      forcePeaceAll(s, geo, c.id);
    }
  }
}

function checkVictory(s: GameState, geo: Geo) {
  const P = s.countries[s.player];
  if (!P.alive) {
    if (!s.victory) s.victory = { achieved: false, text: `${P.name} has been annexed. Game over.` };
    return;
  }
  if (s.victory || s.settings.victory === 'none' || s.tick % 13 !== 0) return;
  let worldGdp = 0, worldW = 0, myW = 0;
  for (const c of s.countries) if (c.alive) worldGdp += c.eco.gdp;
  for (const p of geo.provinces) worldW += p.area;
  for (const p of P.provinces) myW += geo.provinces[p].area;
  if (s.settings.victory === 'economic' && P.eco.gdp / worldGdp >= 0.3)
    s.victory = { achieved: true, text: `Economic victory! ${P.name} produces ${(100 * P.eco.gdp / worldGdp).toFixed(0)}% of world GDP.` };
  else if (s.settings.victory === 'conquest' && myW / worldW >= 0.4)
    s.victory = { achieved: true, text: `Conquest victory! ${P.name} controls ${(100 * myW / worldW).toFixed(0)}% of the world's land.` };
  else if (s.settings.victory === 'hegemon') {
    const bloc = [P.id, ...alliesOf(s, P.id)];
    const g = bloc.reduce((t, id) => t + s.countries[id].eco.gdp, 0);
    if (g / worldGdp >= 0.6) s.victory = { achieved: true, text: `Hegemony! Your bloc commands ${(100 * g / worldGdp).toFixed(0)}% of world GDP.` };
  }
  if (s.victory) logEvent(s, s.victory.text, 'info', [s.player], true);
}

/** Advance the world by one week. Deterministic given (state, rng). */
export function tick(s: GameState, geo: Geo) {
  s.tick++;
  stepEconomies(s, geo);
  stepWars(s, geo);
  stepAI(s, geo);
  checkInstability(s, geo);
  stepWorldEvents(s, geo);
  rollPlayerEvent(s, geo);
  stepGoals(s);
  checkVictory(s, geo);
}

export const yearOf = (tick: number) => START_YEAR + tick / TICKS_PER_YEAR;
