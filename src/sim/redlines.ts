/**
 * For every action, a reaction. When a country is attacked, or a war turns against it, the countries that care about
 * it climb a ladder, one rung at a time, as the danger grows:
 *
 *   1 · arms and sanctions   weapons flow to it and the enemy is sanctioned (from the first weeks)
 *   2 · a red line           a public warning: one step further and we fight. The enemy slows its advance and becomes
 *                            more willing to make peace; cross the line anyway and rung 3 follows.
 *   3 · intervention         they enter the war on its side.
 *
 * Who climbs, and how fast, depends on how much they care (an alliance, how close they are, whether it is in their
 * sphere, how much they dislike the attacker), what they can do (strength, other wars, stability at home) and how much
 * danger it is in (homeland lost, the capital, who has joined against it, the balance of strength). A country that
 * started the war is protected too, but only once the war has come to its own soil.
 *
 * And the last resort: a nuclear power whose existence is threatened says so. Nobody wipes it off the map: the
 * enemy's advance on its homeland all but stops and peace becomes very likely.
 *
 * The player is never moved by this: as the attacker you are warned and choose (halt, call the bluff, seek a
 * ceasefire); as the protector you are asked (the "ally_attacked" decision); as the one in danger you are told who has
 * your back, and a nuclear player chooses whether to make the warning.
 */
import type { Geo } from './geo';
import type { Country, CountryId, GameState, War } from './types';
import { clamp } from './util';
import { nextRand } from './rng';
import { logEvent } from './log';
import { addRelation, getRelation, hasAlliance, sanctionLevel, warSideOf, warsOf } from './relations';
import { imposeSanction } from './diplomacy';
import { strength } from './military';
import { isMajor } from './drama';
import { cable } from './cables';
import { onEnterWar } from './warsupport';
import { addRec } from './minds';
import { patronOf } from './influence';

export type Rung = 0 | 1 | 2 | 3;
export interface ReactX {
  war: number;
  /** the country in danger */
  x: CountryId;
  /** the protector */
  f: CountryId;
  rung: Rung;
  /** the threat when the red line was drawn: cross it by a clear margin and they act */
  line?: number;
  tick: number;
  /** the player answered the red line: 'halt' | 'bluff' | 'talks' */
  answer?: string;
  /** it has already fought once in this war */
  again?: boolean;
}
export const RUNG_LABEL = ['watching', 'arming', 'red line', 'at war'] as const;

const key = (w: number, x: number, f: number) => `${w}:${x}:${f}`;

/** When a war starts: how much of its homeland each side holds, so losses are measured from here. */
export function noteWarStart(s: GameState, w: War) {
  const home = homeland(s);
  for (const x of [...w.attackers, ...w.defenders]) threatOf(s, w, x, home, true);
}

/** How much of its homeland a country holds (its core regions), and how many it has. */
function homeland(s: GameState): Map<CountryId, [number, number]> {
  const m = new Map<CountryId, [number, number]>();
  for (let p = 0; p < s.core.length; p++) {
    const k = s.core[p];
    if (k < 0) continue;
    let e = m.get(k);
    if (!e) { e = [0, 0]; m.set(k, e); }
    e[1]++;
    if (s.owner[p] === k) e[0]++;
  }
  return m;
}

export interface Threat { v: number; held: number; lost: number; capital: boolean; why: string[] }
/** How much danger `x` is in, in war `w` (0 none, 1 existential). */
export function threatOf(s: GameState, w: War, x: CountryId, home?: Map<CountryId, [number, number]>, record = false): Threat {
  const X = s.countries[x];
  const h = (home ?? homeland(s)).get(x) ?? [X.provinces.length, Math.max(1, X.provinces.length)];
  const held = h[1] > 0 ? h[0] / h[1] : 1;
  const base = s.stats[`hl0:${w.id}:${x}`] ?? held;
  if (record && s.stats[`hl0:${w.id}:${x}`] === undefined) s.stats[`hl0:${w.id}:${x}`] = held;
  const lost = Math.max(0, base - held);
  const capital = (s.stats[`capfall:${x}`] ?? -1e9) >= w.start || !X.provinces.includes(X.capital);
  const mine = warSideOf(w, x);
  const foes = mine === 0 ? w.defenders : w.attackers;
  const friends = mine === 0 ? w.attackers : w.defenders;
  const fs = foes.reduce((t, k) => t + (s.countries[k]?.alive ? strength(s.countries[k]) : 0), 0);
  const ms = friends.reduce((t, k) => t + (s.countries[k]?.alive ? strength(s.countries[k]) : 0), 0);
  const gp = !isMajor(s, x) && foes.some((k) => isMajor(s, k));
  const why: string[] = [];
  let v = 2.2 * lost;
  if (lost > 0.04) why.push(`${Math.round(lost * 100)}% of its homeland lost`);
  if (capital) { v += 0.45; why.push('its capital has fallen'); }
  if (held < 0.5) { v += 0.3; why.push('its survival is at stake'); }
  if (gp) { v += 0.15; why.push('a great power fights against it'); }
  if (fs > 2 * ms) { v += 0.1; why.push('the enemy is far stronger'); }
  if (X.mil.exhaustion > 0.8) v += 0.1;
  return { v: clamp(v, 0, 1), held, lost, capital, why };
}

/** How much `f` cares about `x` (0..1), facing enemy `lead`. */
export function commitment(s: GameState, f: CountryId, x: CountryId, lead: CountryId, aggressor: boolean): number {
  const F = s.countries[f];
  if (!F?.alive || hasAlliance(s, f, lead)) return 0;
  const rel = getRelation(s, f, x);
  // strategic interest: a great power does not let its rival swallow a country of its own camp
  const oF = F.orient ?? 0, oX = s.countries[x]?.orient ?? 0;
  const strategic = isMajor(s, f) && oF * oX > 0 && getRelation(s, f, lead) < -30 ? 0.4 * Math.min(Math.abs(oF), Math.abs(oX)) : 0;
  if (rel < 20 && !hasAlliance(s, f, x) && strategic < 0.1) return 0;
  if (rel < -20) return 0;
  let v = (hasAlliance(s, f, x) ? 0.55 : 0) + strategic;
  v += 0.35 * clamp((rel - 30) / 70, 0, 1);
  if (patronOf(s, x)?.patron === f) v += 0.25;
  if (getRelation(s, f, lead) < -30) v += 0.1;
  v *= 1 - 0.35 * F.ai.caution;
  if (aggressor) v *= 0.7;
  if (F.eco.stability < 30) v *= 0.5;
  if (warsOf(s, f).length) v *= 0.6;
  return clamp(v, 0, 1);
}

/** The protectors of `x` in war `w`, most committed first (also for the interface). */
export function protectorsOf(s: GameState, w: War, x: CountryId): { f: CountryId; commit: number; rung: Rung }[] {
  const side = warSideOf(w, x);
  if (side < 0) return [];
  const foes = side === 0 ? w.defenders : w.attackers;
  const lead = foes[0];
  if (lead === undefined) return [];
  const L = s.countries[lead];
  const aggressor = side === 0;
  const out: { f: CountryId; commit: number; rung: Rung }[] = [];
  for (const F of s.countries) {
    if (!F.alive || F.id === x || warSideOf(w, F.id) >= 0) continue;
    if (!isMajor(s, F.id) && strength(F) < 0.2 * strength(L)) continue;
    const commit = commitment(s, F.id, x, lead, aggressor);
    if (commit < 0.3) continue;
    out.push({ f: F.id, commit, rung: s.react?.[key(w.id, x, F.id)]?.rung ?? 0 });
  }
  // friends already fighting alongside count too (for the interface)
  for (const k of side === 0 ? w.attackers : w.defenders) {
    const r = s.react?.[key(w.id, x, k)];
    if (r?.rung === 3) out.push({ f: k, commit: 1, rung: 3 });
  }
  // the most committed and the most able first: an ally is never crowded out by a great power that merely cares
  return out.sort((a, b) => b.commit * Math.sqrt(strength(s.countries[b.f])) - a.commit * Math.sqrt(strength(s.countries[a.f]))).slice(0, 6);
}

/** How strongly the advance on `x` is held back by red lines and nuclear warnings in war `w` (1 = not at all). */
export const advanceBrake = (s: GameState, w: War, x: CountryId) => s.stats[`rlb:${w.id}:${x}`] ?? 1;
/** Extra willingness for peace on `b` in war `w`: the red lines drawn against it. */
export const peacePressure = (s: GameState, w: War, b: CountryId) => s.stats[`rlp:${w.id}:${b}`] ?? 0;

function setBrake(s: GameState, w: War, x: CountryId, v: number) { s.stats[`rlb:${w.id}:${x}`] = Math.min(advanceBrake(s, w, x), v); }
function pressure(s: GameState, w: War, x: CountryId, v: number) {
  const side = warSideOf(w, x);
  for (const e of side === 0 ? w.defenders : w.attackers) s.stats[`rlp:${w.id}:${e}`] = Math.max(peacePressure(s, w, e), v);
}

/** Monthly: every country in every war, and the countries that care about it. */
export function stepRedLines(s: GameState) {
  // forget the wars that are over (once a year)
  if (s.tick % 52 === 1) {
    const live = new Set(s.wars.map((w) => w.id));
    for (const k of Object.keys(s.stats)) { const m = /^(hl0|rlb|rlp|nuke|nukeq|aa|blf):(\d+)/.exec(k); if (m && !live.has(Number(m[2]))) delete s.stats[k]; }
    if (s.react) for (const k of Object.keys(s.react)) if (!live.has(s.react[k].war)) delete s.react[k];
  }
  if (!s.wars.length) return;
  s.react ??= {};
  const home = homeland(s);
  for (const w of [...s.wars]) {
    for (const side of [w.attackers, w.defenders]) {
      for (const x of [...side]) {
        const X = s.countries[x];
        if (!X?.alive) continue;
        const t = threatOf(s, w, x, home, true);
        const aggressor = side === w.attackers;
        // an aggressor is protected only once the war is on its own soil
        if (aggressor && t.lost < 0.05 && !t.capital) continue;
        nuclearLastResort(s, w, x, t);
        if (t.v < 0.05 && !(side === w.defenders && x === side[0])) continue;
        for (const p of protectorsOf(s, w, x)) climb(s, w, x, p.f, p.commit, t, aggressor);
      }
    }
  }
}

function climb(s: GameState, w: War, x: CountryId, f: CountryId, commit: number, t: Threat, aggressor: boolean) {
  const k = key(w.id, x, f);
  const r: ReactX = s.react![k] ?? (s.react![k] = { war: w.id, x, f, rung: 0, tick: s.tick });
  // a protector that dropped out (a peace signed by someone else, a change of government) while its friend is still
  // in danger comes back, after a pause
  if (r.rung === 3 && warSideOf(w, f) < 0 && s.tick - r.tick > 8 && t.v >= 0.15) { r.rung = 2; r.line = 0; r.tick = s.tick - 4; r.again = true; }
  if (r.rung === 3) return;
  // one rung a month at most, so every step is seen (and can be answered) before the next
  if (r.rung > 0 && s.tick - r.tick < 4) { if (r.rung >= 1 && f !== s.player) arm(s, f, x, r, w); return; }
  const rung0 = r.rung;
  const X = s.countries[x], F = s.countries[f];
  const foes = warSideOf(w, x) === 0 ? w.defenders : w.attackers;
  const lead = foes[0];
  const E = s.countries[lead];
  const mineX = x === s.player, mineE = foes.includes(s.player), mineF = f === s.player;
  const big = mineX || mineE || mineF || isMajor(s, f) && isMajor(s, lead);
  // rung 1: weapons and sanctions, renewed every month
  if (r.rung === 0 && (t.v >= 0.05 || (!aggressor && commit >= 0.45))) {
    r.rung = 1; r.tick = s.tick;
    if (!mineF) {
      logEvent(s, `📦 ${F.name} is arming ${hasAlliance(s, f, x) ? 'its ally ' : ''}${X.name} against ${E.name}.`, 'war', [f, x, lead], big);
      if (mineX) cable(s, f, 'warm');
    }
  }
  if (r.rung >= 1 && !mineF) arm(s, f, x, r, w);
  if (r.rung !== rung0) return;
  // rung 2: the red line
  const gpAgainst = isMajor(s, f) && foes.some((e) => isMajor(s, e));
  if (r.rung === 1 && (t.v >= 0.22 || (gpAgainst && t.v >= 0.1)) && !mineF) {
    r.rung = 2; r.line = t.v; r.tick = s.tick;
    const fs = strength(F), es = strength(E);
    setBrake(s, w, x, fs > 2 * es ? 0.45 : fs > es ? 0.65 : 0.85);
    pressure(s, w, x, 0.15 + 0.25 * commit);
    addRelation(s, f, lead, -10);
    const where = X.provinces.includes(X.capital) ? `${X.name}'s heartland` : `what is left of ${X.name}`;
    logEvent(s, `⚠ RED LINE: ${F.name} warns ${E.name}: one step further into ${where} and it will enter the war.`, 'danger', [f, x, lead], true, { big: big || isMajor(s, f), prov: X.capital });
    if (mineX) cable(s, f, 'warm');
    // one decision per war, naming everyone who has drawn a line (answered for all of them)
    if (mineE && !s.inbox.some((i) => i.id === 'war_redline' && i.data.war === w.id) && !s.scheduled.some((i) => i.id === 'war_redline' && i.data.war === w.id)) s.scheduled.push({ tick: s.tick, id: 'war_redline', data: { war: w.id, x, f, lead } });
    return;
  }
  // rung 3: the line is crossed (or the danger is existential): they fight
  const crossed = r.rung === 2 && (t.v >= (r.line ?? 0) + 0.12 || (t.capital && s.tick - r.tick > 4)) && r.answer !== 'halt';
  const existential = t.v >= 0.5 && r.rung >= 1;
  const halted = r.answer === 'halt' && t.v < (r.line ?? 0) + 0.2;
  if ((crossed || existential) && !halted) {
    if (mineF) {
      if (!s.stats[`aa:${w.id}:${x}`]) { s.stats[`aa:${w.id}:${x}`] = s.tick; s.scheduled.push({ tick: s.tick, id: 'ally_attacked', data: { ally: x, aggressor: lead, war: w.id } }); }
      return;
    }
    const bluffed = r.answer === 'bluff';
    const p = clamp(0.35 + 0.6 * commit - (bluffed ? 0.15 : 0) - (E.mil.nuclear && !F.mil.nuclear ? 0.3 : 0), 0.05, 0.97);
    if (nextRand(s) > p) {
      if (bluffed && !s.stats[`blf:${k}`]) {
        s.stats[`blf:${k}`] = 1;
        F.reputation = clamp(F.reputation - 6, 0, 100);
        logEvent(s, `🎲 ${F.name} does not act on its red line. ${E.name} called the bluff, and the world noticed.`, 'diplo', [f, x, lead], true);
      }
      return;
    }
    r.rung = 3; r.tick = s.tick;
    const side = warSideOf(w, x) === 0 ? w.attackers : w.defenders;
    side.push(f);
    w.startProvs[f] = F.provinces.length;
    onEnterWar(s, F, 'ally');
    addRelation(s, f, lead, -25);
    addRec(s, f, 'loyal', 0.5);
    setBrake(s, w, x, 0.6);
    logEvent(s, `⚔ INTERVENTION: ${F.name} ${r.again ? 're-enters' : 'enters'} the ${w.name} to save ${X.name}${t.capital ? ', whose capital has fallen' : crossed && !r.again ? ': its red line was crossed' : ''}.`, 'war', [f, x, lead], true, { big: true, prov: X.capital });
    if (mineX) cable(s, f, 'warm');
    if (mineE) cable(s, f, 'sanctions_you');
  }
}

/** Weapons and money for the one in danger, every month; a great power also sanctions the enemy. */
function arm(s: GameState, f: CountryId, x: CountryId, r: ReactX, w: War) {
  const F = s.countries[f], X = s.countries[x];
  const foes = warSideOf(w, x) === 0 ? w.defenders : w.attackers;
  const lead = foes[0];
  if (lead === undefined || !X?.alive) return;
  const c = commitment(s, f, x, lead, warSideOf(w, x) === 0) || 0.4;
  const aid = Math.min(0.0009 * F.eco.gdp * c, 0.015 * X.eco.gdp);
  X.mil.equipArmy += aid * 0.7; X.mil.equipAir += aid * 0.3;
  if (isMajor(s, f) && sanctionLevel(s, f, lead) === 0 && nextRand(s) < 0.15) imposeSanction(s, f, lead, 1);
  void r;
}

/** A nuclear power facing destruction says so, and is not wiped off the map. */
function nuclearLastResort(s: GameState, w: War, x: CountryId, t: Threat) {
  const X = s.countries[x];
  if (!X.mil.nuclear || s.stats[`nuke:${w.id}:${x}`]) return;
  if (!(t.held < 0.6 || t.capital || t.lost > 0.3)) return;
  if (x === s.player) {
    if (!s.stats[`nukeq:${w.id}`]) { s.stats[`nukeq:${w.id}`] = s.tick; s.scheduled.push({ tick: s.tick, id: 'war_existential', data: { war: w.id } }); }
    return;
  }
  nuclearWarning(s, w, x);
}
export function nuclearWarning(s: GameState, w: War, x: CountryId) {
  const X = s.countries[x];
  s.stats[`nuke:${w.id}:${x}`] = s.tick;
  s.stats[`rlb:${w.id}:${x}`] = 0.12;
  pressure(s, w, x, 0.7);
  X.reputation = clamp(X.reputation - 4, 0, 100);
  const foes = warSideOf(w, x) === 0 ? w.defenders : w.attackers;
  logEvent(s, `☢ ${X.name} warns that it will use every weapon it has if its existence is threatened. The world holds its breath; ${foes.map((e) => s.countries[e].name).slice(0, 3).join(', ')} halt at the lines.`, 'danger', [x, ...foes], true, { big: true, prov: X.capital });
}

/** `f` entered war `w` to save someone who is still fighting and still in danger: no separate peace. */
export function boundTo(s: GameState, w: War, f: CountryId): boolean {
  for (const r of Object.values(s.react ?? {})) {
    if (r.war !== w.id || r.f !== f || r.rung !== 3) continue;
    if (warSideOf(w, r.x) < 0 || !s.countries[r.x]?.alive) continue;
    if (threatOf(s, w, r.x).v >= 0.1) return true;
  }
  return false;
}

/** The red lines drawn against the player in war `w` that are still unanswered. */
export function linesAgainst(s: GameState, w: number): ReactX[] {
  return Object.values(s.react ?? {}).filter((r) => r.war === w && r.rung === 2 && !r.answer);
}

/** The countries that will step in for each side of the war, for the war panel. */
export function warReactions(s: GameState, w: War) {
  const out: { side: 0 | 1; x: CountryId; f: CountryId; rung: Rung }[] = [];
  for (const [i, side] of [w.attackers, w.defenders].entries()) {
    const x = side[0];
    if (x === undefined) continue;
    const ps = protectorsOf(s, w, x);
    // those already fighting at its side (they joined on the first day, or stepped in later)
    for (const k of side) if (k !== x && s.countries[k]?.alive && !ps.some((p) => p.f === k) && (isMajor(s, k) || strength(s.countries[k]) > 0.2 * strength(s.countries[x]))) out.push({ side: i as 0 | 1, x, f: k, rung: 3 });
    for (const p of ps) out.push({ side: i as 0 | 1, x, f: p.f, rung: p.rung });
  }
  return out.slice(0, 12);
}
export type { Country };
