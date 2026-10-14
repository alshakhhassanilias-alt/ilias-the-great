import { stepCoalitions } from './coalitions';
import { stepProgrammes } from './wargoals';
import { stepWarEvents } from './events6';
import { stepNations } from './nations';
import { stepPolitics as stepDomestic } from './domestic';
import { stepArcs } from './arcs';
import { approval } from './approval';
import { stepCables } from './cables';
import { setInTick } from './relations';
import type { Geo } from './geo';
import { stepEconomiesGen } from './economy';
import { stepWars, forcePeaceAll, logEvent } from './war';
import { stepPartisans } from './specops';
import { stepAutopilot } from './modes';
import { stepLegacy } from './legacy';
import { stepCabinet } from './cabinet';
import { stepArmies } from './armies';
import { stepAIGen } from './ai';
import { nextRand } from './rng';
import { stepProjects } from './projects';
import { stepCrisis } from './crises';
import { stepRival } from './rival';
import { stepDoctrines } from './doctrines';
import { stepLeaders } from './leaders';
import { stepCalendar } from './events3';
import { stepReview, stepTrophies } from './trophies';
import { stepUnrest } from './unrest';
import { rollPlayerEvent, stepAssembly, stepWorldEvents } from './events';
import { stepPolitics } from './politics';
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
  if (!s.victory && s.settings.endYear && START_YEAR + s.tick / TICKS_PER_YEAR >= s.settings.endYear) {
    s.victory = { achieved: true, text: `The year ${s.settings.endYear} has come. ${P.name} ends the era with a GDP of $${(P.eco.gdp / 1e12).toFixed(2)} trillion and ${P.provinces.length} regions.` };
    logEvent(s, s.victory.text, 'info', [s.player], true);
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
  setInTick(true);
  try { for (const _ of tickSlices(s, geo)) { /* run the whole week at once */ } } finally { setInTick(false); }
}
/**
 * One week, in slices. The game loop runs as many slices as fit in a few milliseconds per frame, so even a slow
 * phone keeps drawing smoothly (the world just advances a little slower). The order of work, and therefore the
 * result, is exactly the same as running the week in one go.
 */
export function* tickSlices(s: GameState, geo: Geo): Generator<void> {
  s.tick++;
  yield* stepEconomiesGen(s, geo);
  yield;
  stepWars(s, geo);
  stepArmies(s, geo);
  stepPartisans(s);
  yield;
  yield* stepAIGen(s, geo);
  stepAutopilot(s, geo);
  stepCabinet(s);
  stepDomestic(s, approval(s, s.countries[s.player]));
  stepArcs(s, geo);
  stepNations(s, geo);
  stepCoalitions(s, geo);
  stepProgrammes(s);
  stepWarEvents(s);
  stepCables(s);
  checkInstability(s, geo);
  stepWorldEvents(s, geo);
  yield;
  stepPolitics(s, geo);
  stepProjects(s, geo);
  stepCrisis(s, geo);
  stepRival(s, geo);
  stepDoctrines(s);
  yield;
  stepLeaders(s, geo);
  stepTrophies(s, geo);
  stepReview(s, geo);
  stepUnrest(s, geo);
  yield;
  stepAssembly(s, geo);
  stepCalendar(s);
  rollPlayerEvent(s, geo);
  stepGoals(s);
  stepLegacy(s, geo);
  checkVictory(s, geo);
}

export const yearOf = (tick: number) => START_YEAR + tick / TICKS_PER_YEAR;
