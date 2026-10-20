/**
 * World crises: every couple of years something shakes the whole planet (a recession, a pandemic wave,
 * an energy shock, a famine, a new Cold War, or a tech boom). They last many months, show up as a
 * banner, hit every economy, and put real decisions in front of the player.
 */
import type { Geo } from './geo';
import { nextRand } from './rng';
import { clamp } from './util';
import { logEvent } from './log';
import { addRelation } from './relations';
import type { Country, GameState } from './types';
import { recessionDue, recessionRisk } from './trade';

export interface CrisisDef {
  id: string; icon: string; title: string; weeks: number; start: string; end: string; blurb: string;
  /** weekly effect on one country; `k` is 1, or 0.5 if the player has cushioned it */
  hit: (s: GameState, c: Country, k: number) => void;
  /** only some years/conditions allow it */
  ok?: (s: GameState) => boolean;
}

const shield = (s: GameState, c: Country) => (c.id === s.player && s.stats.shield ? 0.5 : 1);

export const CRISES: CrisisDef[] = [
  {
    id: 'recession', icon: '📉', title: 'Global Recession', weeks: 44, blurb: 'Credit freezes and trade shrinks everywhere. Debt-heavy economies suffer most.',
    start: 'Markets crash around the world: a global recession has begun.', end: 'The recession has bottomed out and growth is returning.',
    hit: (_s, c, k) => { c.eco.tfp *= 1 - 0.0007 * k * (0.7 + 0.6 * Math.min(1.5, c.eco.debt / c.eco.gdp)); if (c.eco.debt > c.eco.gdp * 1.2) c.eco.stability = Math.max(0, c.eco.stability - 0.04 * k); },
  },
  {
    id: 'pandemic', icon: '🦠', title: 'Pandemic Wave', weeks: 40, blurb: 'A new virus spreads along the trade routes. Rich, high-tech countries cope better.',
    start: 'A dangerous new virus is spreading across borders: the world is in a pandemic.', end: 'Vaccines are rolled out and the pandemic fades.',
    hit: (_s, c, k) => { const resil = 0.6 + c.eco.tech / 100; c.eco.laborForce *= 1 - 0.0006 * k / resil; c.eco.pop *= 1 - 0.0002 * k / resil; c.eco.stability = Math.max(0, c.eco.stability - 0.05 * k / resil); },
  },
  {
    id: 'energy', icon: '⛽', title: 'Energy Shock', weeks: 36, blurb: 'Supplies are disrupted and energy prices soar. Energy exporters win, importers lose.',
    start: 'Energy supplies collapse and prices skyrocket worldwide.', end: 'Energy markets have calmed down.',
    hit: (_s, c, k) => { c.eco.energyCap *= 1 - 0.0012 * k; },
  },
  {
    id: 'famine', icon: '🌾', title: 'Global Harvest Failure', weeks: 48, blurb: 'Droughts and floods wreck harvests. Poor food importers face unrest.',
    start: 'Crop failures on several continents: food prices are spiking.', end: 'New harvests ease the global food shortage.',
    hit: (_s, c, k) => { c.eco.foodCap *= 1 - 0.0011 * k; if (c.eco.foodUnmet > 0.05) c.eco.stability = Math.max(0, c.eco.stability - 0.08 * k); },
  },
  {
    id: 'coldwar', icon: '🧊', title: 'New Cold War', weeks: 70, blurb: 'The great powers harden into rival camps. AI nations are far more willing to fight.',
    start: 'Rival blocs square off in a new cold war. Diplomacy freezes.', end: 'The cold war thaws: tensions ease.',
    hit: (s, c, _k) => {
      if (s.tick % 6 !== 0) return;
      // relations between countries of different ideology sink
      const o = s.countries[Math.floor(nextRand(s) * s.countries.length)];
      if (o.alive && o.id !== c.id && o.id !== s.player && c.id !== s.player && (o.gov === 'D') !== (c.gov === 'D') && o.eco.gdp > 2e11 && c.eco.gdp > 2e11) addRelation(s, c.id, o.id, -1.5);
    },
  },
  {
    id: 'boom', icon: '🚀', title: 'Global Tech Boom', weeks: 52, blurb: 'A wave of innovation lifts the whole world, rewarding countries with strong technology.',
    start: 'A tech boom is sweeping the world: new industries are born.', end: 'The tech boom matures into steady growth.',
    hit: (_s, c, _k) => { c.eco.tfp *= 1 + 0.0004 * (0.4 + c.eco.tech / 60); },
  },
];

export const crisisById = (id: string) => CRISES.find((c) => c.id === id)!;

export function stepCrisis(s: GameState, _geo: Geo) {
  const cr = s.crisis;
  if (cr) {
    const d = crisisById(cr.id);
    for (const c of s.countries) if (c.alive) d.hit(s, c, shield(s, c));
    if (s.tick >= cr.end) {
      logEvent(s, `${d.icon} ${d.end}`, 'econ', [], true, { big: true });
      s.crisis = null;
      delete s.stats.shield;
      s.nextCrisis = s.tick + 80 + Math.floor(nextRand(s) * 80);
    }
    return;
  }
  const early = recessionDue(s);
  if (s.tick < s.nextCrisis && !early) return;
  const last = s.stats.lastCrisis ?? -1;
  const pool = CRISES.filter((d, i) => i !== last && (!d.ok || d.ok(s)));
  // the warning signs decide how likely the next crisis is to be a recession
  const risk = recessionRisk(s).risk;
  const d = early ? crisisById('recession') : nextRand(s) < risk * 0.8 && last !== CRISES.findIndex((x) => x.id === 'recession') ? crisisById('recession') : pool[Math.floor(nextRand(s) * pool.length)];
  if (d.id === 'recession') s.stats.lastRecession = s.tick;
  s.stats.lastCrisis = CRISES.indexOf(d);
  s.crisis = { id: d.id, start: s.tick, end: s.tick + d.weeks };
  s.scheduled.push({ tick: s.tick + 2, id: d.id === 'boom' ? 'boom_response' : 'crisis_response', data: {} });
  logEvent(s, `${d.icon} ${d.id === 'boom' ? 'WORLD BOOM' : 'WORLD CRISIS'}: ${d.title}. ${d.start}`, 'danger', [], true, { big: true, prov: s.countries[s.player].capital });
}

/** Weeks left (for the UI chip). */
export const crisisLeft = (s: GameState) => (s.crisis ? Math.max(0, s.crisis.end - s.tick) : 0);
export const cushion = (s: GameState) => { s.stats.shield = 1; };
void clamp;
