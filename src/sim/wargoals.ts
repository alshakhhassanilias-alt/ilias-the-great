/**
 * War goals and weapons programmes.
 *
 * War goals: when your country goes to war you declare what it is for. A limited war (take the border regions)
 * keeps the public patient; a total war (break them completely) fires up the nationalists and the army but wears
 * the country out faster and alarms the world; a defensive war (hold the line, restore the border) keeps support
 * high as long as you are defending. When the war ends the goal is judged: achieve it and you gain stability,
 * political capital and the factions' respect; fail and you pay for it at home.
 *
 * Weapons programmes: long projects (drones, air defence, missile brigades, an armoured corps, a navy squadron,
 * cyber command, special forces, a national reserve) that permanently change how your forces fight. Missile
 * brigades also unlock strikes on the enemy's economy.
 */
import { clamp } from './util';
import { logEvent } from './log';
import { fund } from './actions';
import { sway } from './domestic';
import { areAtWar } from './relations';
import type { Eff } from './doctrines';
import type { Country, GameState, War, WarRecord } from './types';

import { GOALS_META, type WarGoal } from './goalmeta';
import { legacyWarAim } from './legacy';
export { GOALS_META, type WarGoal };
export const goalOf = (s: GameState, w: War): WarGoal | 0 => (s.stats[`wgoal:${w.id}`] ?? 0) as WarGoal | 0;

export function setWarGoal(s: GameState, w: War, g: WarGoal) {
  const c = s.countries[s.player];
  s.stats[`wgoal:${w.id}`] = g;
  if (g === 2) {
    c.mil.warSupport = clamp((c.mil.warSupport ?? 0.6) + 0.08, 0, 1);
    sway(c, 'nationalists', 10); sway(c, 'military', 8); sway(c, 'liberals', -12);
    c.reputation = clamp(c.reputation - 4, 0, 100);
  } else if (g === 1) sway(c, 'liberals', 2);
  else { sway(c, 'liberals', 5); sway(c, 'military', 3); }
}

/** War-support multipliers for the player's war goals (fatigue and casualties). */
export function goalFatigue(s: GameState, c: Country, wars: War[]): number {
  if (!c.isPlayer) return 1;
  let k = 1;
  for (const w of wars) {
    const g = goalOf(s, w);
    if (g === 1) k = Math.min(k, 0.6);
    if (g === 2) k = Math.max(k, 1.35);
    if (g === 3 && w.defenders.includes(c.id)) k = Math.min(k, 0.5);
  }
  return k;
}

/** Judge the war goal when a war of the player's ends. */
export function settleGoal(s: GameState, rec: WarRecord) {
  if (rec.a !== s.player && rec.b !== s.player) return;
  const g = (s.stats[`wgoal:${rec.id}`] ?? 0) as WarGoal | 0;
  if (!g) return;
  delete s.stats[`wgoal:${rec.id}`];
  const c = s.countries[s.player];
  const me = rec.a === s.player;
  const gained = me ? rec.provsA : rec.provsB;
  const won = rec.winner === (me ? 'a' : 'b');
  const ok = g === 1 ? gained >= 1 : g === 2 ? gained >= 3 || (won && rec.terms === 'surrender') : gained >= 0;
  const P = c.politics;
  if (ok) {
    c.eco.stability = clamp(c.eco.stability + (g === 2 ? 6 : 4), 0, 100);
    if (P) P.pc = Math.min(100, P.pc + (g === 2 ? 18 : 12));
    sway(c, 'military', 10); sway(c, 'nationalists', g === 3 ? 6 : 10);
    legacyWarAim(s, GOALS_META[g].title, true, g === 2 ? 30 : 18);
    logEvent(s, `🏆 WAR AIMS ACHIEVED: ${GOALS_META[g].title} in the ${rec.name}. The nation celebrates; your authority grows.`, 'info', [c.id], true, { big: true, prov: c.capital });
  } else {
    c.eco.stability = clamp(c.eco.stability - (g === 2 ? 8 : 4), 0, 100);
    if (P) P.pc = Math.max(0, P.pc - 8);
    sway(c, 'nationalists', -12); sway(c, 'military', -8);
    legacyWarAim(s, GOALS_META[g].title, false, g === 2 ? -30 : -15);
    logEvent(s, `📉 WAR AIMS FAILED: you promised the country ${GOALS_META[g].title.toLowerCase()} in the ${rec.name} (${GOALS_META[g].success}) and did not deliver.`, 'danger', [c.id], true, { big: true, prov: c.capital });
  }
}

// ------------------------------------------------------------------ weapons programmes
export interface Programme { id: string; icon: string; title: string; desc: string; weeks: number; cost: number; eff: Eff; plain: string }
export const PROGRAMMES: Programme[] = [
  { id: 'drones', icon: '🛩', title: 'Drone Corps', desc: 'Thousands of reconnaissance and strike drones in every brigade.', weeks: 20, cost: 0.004, eff: { off: 1.06 }, plain: 'Attack +6%' },
  { id: 'airdef', icon: '🛡', title: 'Integrated Air Defence', desc: 'Layered missile and gun defences over cities and the front.', weeks: 24, cost: 0.006, eff: { def: 1.05, deter: 0.95 }, plain: 'Defence +5% · enemies 5% less keen to attack' },
  { id: 'missiles', icon: '🚀', title: 'Missile Brigades', desc: 'Long-range precision missiles. Unlocks strikes on the enemy economy.', weeks: 26, cost: 0.006, eff: { off: 1.03 }, plain: 'Attack +3% · unlocks missile strikes' },
  { id: 'armour', icon: '🪖', title: 'Armoured Corps', desc: 'Modern tanks and infantry fighting vehicles.', weeks: 28, cost: 0.008, eff: { off: 1.05, def: 1.02 }, plain: 'Attack +5% · defence +2%' },
  { id: 'navy', icon: '⚓', title: 'Navy Squadron', desc: 'Frigates, submarines and a landing force.', weeks: 36, cost: 0.01, eff: { def: 1.02 }, plain: 'Naval power ↑ · defence +2%' },
  { id: 'cyber', icon: '💻', title: 'Cyber Command', desc: 'Offensive and defensive cyber units.', weeks: 16, cost: 0.003, eff: { ops: 0.1 }, plain: 'Covert operations +10%' },
  { id: 'sof', icon: '🎯', title: 'Special Forces', desc: 'Elite raiders and paratroopers.', weeks: 16, cost: 0.003, eff: { off: 1.02, ops: 0.05 }, plain: 'Attack +2% · covert ops +5%' },
  { id: 'reserve', icon: '🎖', title: 'National Reserve', desc: 'A trained reserve of every able adult.', weeks: 18, cost: 0.003, eff: { manpower: 1.15 }, plain: 'Manpower +15%' },
];
export const progById = (id: string) => PROGRAMMES.find((p) => p.id === id);
export const hasProg = (c: Country, id: string) => !!c.progs?.some((p) => p.id === id && p.done);

export function progEff(c: Country): Eff {
  const out = { off: 1, def: 1, deter: 1, manpower: 1, ops: 0 };
  for (const p of c.progs ?? []) {
    if (!p.done) continue;
    const e = progById(p.id)?.eff ?? {};
    out.off *= e.off ?? 1; out.def *= e.def ?? 1; out.deter *= e.deter ?? 1; out.manpower *= e.manpower ?? 1; out.ops += e.ops ?? 0;
  }
  return out;
}
export const progKey = (c: Country) => (c.progs ?? []).filter((p) => p.done).map((p) => p.id).join('.');

export function actStartProgramme(s: GameState, id: string) {
  const c = s.countries[s.player];
  const p = progById(id);
  if (!p) return { ok: false, message: 'No such programme' };
  if (c.progs?.some((x) => x.id === id)) return { ok: false, message: 'Already started' };
  if ((c.progs ?? []).filter((x) => !x.done).length >= 2) return { ok: false, message: 'Two programmes at a time at most' };
  const f = fund(s, c.id, p.cost * c.eco.gdp, `Programme: ${p.title}`);
  if (!f.ok) return f;
  (c.progs ??= []).push({ id, until: s.tick + p.weeks, done: false });
  return { ok: true, message: `${p.title}: the programme begins (${p.weeks} weeks).` };
}

export function stepProgrammes(s: GameState) {
  const c = s.countries[s.player];
  if (!c?.progs) return;
  for (const p of c.progs) {
    if (p.done || s.tick < p.until) continue;
    p.done = true;
    const P = progById(p.id)!;
    if (p.id === 'navy') c.mil.equipNavy += 0.006 * c.eco.gdp;
    logEvent(s, `${P.icon} ${P.title} is operational. ${P.plain}.`, 'info', [c.id], true);
    sway(c, 'military', 5);
  }
}

/** A missile strike on the enemy's economy and morale (needs Missile Brigades). */
export function actMissileStrike(s: GameState, target: number) {
  const c = s.countries[s.player], T = s.countries[target];
  if (!hasProg(c, 'missiles')) return { ok: false, message: 'You need Missile Brigades first' };
  if (!T?.alive || !areAtWar(s, c.id, target)) return { ok: false, message: 'You are not at war with them' };
  const key = `msl:${target}`;
  if (s.tick - (s.stats[key] ?? -999) < 4) return { ok: false, message: `Missiles are being reloaded (${4 - (s.tick - (s.stats[key] ?? 0))} weeks)` };
  const f = fund(s, c.id, 0.001 * c.eco.gdp, 'Missile strike');
  if (!f.ok) return f;
  s.stats[key] = s.tick;
  const intercept = T.mil.equipAir / Math.max(1, T.mil.equipAir + c.mil.equipAir * 1.5);
  const hit = 1 - 0.6 * intercept;
  T.eco.capital *= 1 - 0.004 * hit;
  T.eco.damage = clamp(T.eco.damage + 0.01 * hit, 0, 1);
  T.mil.warSupport = clamp((T.mil.warSupport ?? 0.6) - 0.03 * hit, 0.02, 1);
  c.reputation = clamp(c.reputation - 1, 0, 100);
  logEvent(s, `🚀 Missile strike: ${c.name} hits power plants and rail depots across ${T.name}${hit < 0.6 ? ', though many missiles were shot down' : ''}.`, 'war', [c.id, T.id], true, { prov: T.capital });
  return { ok: true, message: `Strike delivered (${Math.round(hit * 100)}% got through).` };
}
