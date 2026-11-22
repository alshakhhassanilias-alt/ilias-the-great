/**
 * War mechanics: declaration, alliance calls, front-based combat resolution, blockade / air war,
 * exhaustion, province transfer and peace negotiation.
 *
 * Combat (abstract, per weekly tick, per contested province):
 *   attack power  = committed troops × equipment quality × tech × readiness × supply(distance from
 *                   friendly integrated land) × air-support × intel edge × amphibious penalty
 *   defence power = field troops allocated to the province × quality × tech × readiness × fortification
 *                   × terrain (rugged = harder) × capital bonus
 *   progress per tick = 0.16 · clamp(ln(attack/defence) + 0.25, −1.2, 1.6) scaled by province size.
 * A province changes hands when progress reaches 100%. Casualties are Lanchester-like in the force ratio.
 */
import { opAttackMult, opDefenceMult, opFocus, opTempo } from './operations';
import { chronicle } from './chronicle';
import { addRec } from './minds';
import { addAggression, coalitionAgainst } from './coalitions';
import { settleGoal } from './wargoals';
import { legacyWarEnded } from './legacy';
import { cable } from './cables';
import { voicesOn } from './reactions';
import { advanceBrake, noteWarStart, peacePressure } from './redlines';
import { mods } from './doctrines';
import type { Geo } from './geo';
import { hash01, nextRand } from './rng';
import { clamp } from './util';
import { CLAIMS } from '../data/countryData';
import {
  addRelation, alliesOf, areAtWar, capitalLost as capitalLostOf, getRelation, guarantorsOf, hasAlliance, NAME_TO_ID, touchTreaties, pairKey, warBetween, warSideOf, warsOf,
} from './relations';
import { peopleW } from './economy';
import { airPower, landPower, navalPower, strength } from './military';
import type { ArmyOrder, CountryId, Country, GameState, LogKind, ProvId, War } from './types';

import { logEvent } from './log';
import { fortBonus, transferBuildings } from './buildings';
import { addGrudge } from './leaders';
import { fmtCas, isBigNews, MILESTONES } from './drama';
import { bumpSupply, isPocket, landSupply, neighbours, supplyNet, supplyReach } from './supply';
import { opsOf } from './specops';
import { armiesActive, armyStrikes, holdBonus } from './armies';
import { bumpSupport, morale, onEnterWar, stepWarSupport, warSupport } from './warsupport';
import { campDef, campLoss, campOff } from './campaigns';
import { charDef } from './character';
import { applyExtras, demilitarised, extraCost, PEACE_EXTRAS, type PeaceExtra } from './peaceterms';
import { assignGenerals, attackBonus, defenceBonus, ensureGenerals, generalAfterBattle, generalAt, homeCommander, supplyBonus } from './generals';
export { logEvent };

const CLAIM_SET = new Map<string, number>();
for (const [a, b, v] of CLAIMS) { const ia = NAME_TO_ID[a], ib = NAME_TO_ID[b]; if (ia !== undefined && ib !== undefined) CLAIM_SET.set(`${ia}>${ib}`, v); }
export const claimStrength = (a: CountryId, b: CountryId) => CLAIM_SET.get(`${a}>${b}`) ?? 0;

export const isCoastalProv = (geo: Geo, p: ProvId) => geo.provinces[p].coast > 0.15;
export const isCoastalCountry = (s: GameState, geo: Geo, c: Country) => c.provinces.some((p) => isCoastalProv(geo, p));

// ---------------------------------------------------------------------------------------------
// Territory
// ---------------------------------------------------------------------------------------------
const SHARED_KEYS: (keyof Country['eco'])[] = ['pop', 'realGdp', 'potential', 'capital', 'energyCap', 'foodCap', 'energyDemand', 'foodDemand', 'laborForce'];

/** Move a province between countries, carrying its share of population and productive capacity. */
/** `quiet`: a peaceful change (independence, a union): no refugees, no "capital falls" banner, no annexation notice */
export function transferProvince(s: GameState, geo: Geo, p: ProvId, to: CountryId, quiet = false): number {
  const from = s.owner[p];
  if (from === to) return 0;
  const A = s.countries[from], B = s.countries[to];
  // the region's share of the country, in people: map weights only compare regions inside their original country, so a
  // small neighbour's capital must not carry a big conqueror's population when it changes hands again
  const pw = peopleW(geo);
  const totalW = A.provinces.reduce((t, q) => t + pw[q], 0) || 1;
  const f = Math.min(1, pw[p] / totalW);
  // fighting over a region sends part of its people fleeing
  const fw = quiet ? undefined : warBetween(s, from, to);
  if (fw) fw.displaced = (fw.displaced ?? 0) + A.eco.pop * f * 0.08;
  for (const k of SHARED_KEYS) {
    const amt = (A.eco[k] as number) * f;
    (A.eco[k] as number) -= amt;
    (B.eco[k] as number) += amt * (k === 'capital' ? 0.8 : 1);
  }
  // output moves with the region (above); productivity is a property of the country and stays as it is. (It used to be
  // rescaled so that output matched capacity at once, which turned the army's share of a shrunken labour force, war
  // damage and other passing penalties into permanent productivity, and could explode the loser's later.)
  for (const X of [A, B]) X.eco.gdp = X.eco.realGdp * X.eco.price;
  A.provinces = A.provinces.filter((q) => q !== p);
  B.provinces.push(p);
  s.owner[p] = to;
  s.integ[p] = s.core[p] === to ? 1 : 0;
  s.stats[`flips:${p}`] = (s.stats[`flips:${p}`] ?? 0) + 1;
  s.stats[`held:${p}`] = s.tick;
  bumpSupply();
  transferBuildings(s, p, from, to, quiet);
  for (const w of s.wars) w.fronts = w.fronts.filter((fr) => fr.prov !== p);
  for (const c of [A, B]) c.mil.focus = c.mil.focus.filter((q) => s.owner[q] !== c.id);
  // a nation that retakes its historic capital moves its government back
  if (s.stats[`seat:${B.id}`] === p) {
    delete s.stats[`seat:${B.id}`];
    if (B.capital !== p) {
      B.capital = p;
      if (!quiet) logEvent(s, `🏛 THE CAPITAL IS RETAKEN: ${B.name} is back in ${geo.provinces[p].name || 'its capital'}.`, 'war', [B.id, from], true, { big: true, prov: p });
      B.eco.stability = Math.min(100, B.eco.stability + 6);
      if (warsOf(s, B.id).length) bumpSupport(B, 0.06);
    }
  }
  if (A.provinces.length === 0) eliminateCountry(s, A, to, quiet);
  else if (p === A.capital && quiet) A.capital = A.provinces.reduce((best, q) => (geo.provinces[q].w > geo.provinces[best].w ? q : best), A.provinces[0]);
  else if (p === A.capital) {
    s.stats[`seat:${A.id}`] ??= p; // the historic capital, to return to (relations.ts capitalLost)
    A.capital = newSeat(geo, A.provinces, pw);
    A.eco.stability = Math.max(0, A.eco.stability - 12);
    A.mil.exhaustion = Math.min(1, A.mil.exhaustion + 0.2);
    if (warsOf(s, A.id).length) bumpSupport(A, -0.08);
    const fell = s.stats[`capfall:${A.id}`] === undefined;
    s.stats[`capfall:${A.id}`] = s.tick;
    logEvent(s, `🏛 CAPITAL FALLS: ${s.countries[to].name} has taken ${geo.provinces[p].name || 'the capital region'}; the government of ${A.name} flees.`, 'war', [A.id, to], true, fell ? { big: true, prov: p } : { prov: p });
  }
  return f;
}

/** Where a government goes when its capital falls: the biggest city of the largest connected part of what is left (not a
 *  big city cut off behind the lines, which left the rest of the country without a supply hub). */
function newSeat(geo: Geo, provs: ProvId[], pw: Float64Array): ProvId {
  const left = new Set(provs), seen = new Set<ProvId>();
  let best: ProvId[] = [], bestW = -1;
  for (const p0 of provs) {
    if (seen.has(p0)) continue;
    const comp = [p0]; seen.add(p0);
    for (let i = 0; i < comp.length; i++) for (const q of geo.adj[comp[i]]) if (left.has(q) && !seen.has(q)) { seen.add(q); comp.push(q); }
    const w = comp.reduce((t, q) => t + pw[q], 0);
    if (w > bestW) { bestW = w; best = comp; }
  }
  return best.reduce((a, q) => (pw[q] > pw[a] ? q : a), best[0]);
}

function eliminateCountry(s: GameState, c: Country, by: CountryId, quiet = false) {
  c.alive = false;
  c.eco.pop = 0;
  delete s.stats[`seat:${c.id}`];
  s.stats[`fallen:${c.id}`] = s.tick;
  // a fallen nation keeps its name and colours for the history books, not its charts (saves stay small over centuries)
  c.hist = { gdp: [], gdppc: [], debt: [], mil: [], stab: [], infl: [], unemp: [], pop: [], trade: [] };
  delete c.generals;
  if (!quiet) {
    s.stats[`conq:${by}`] = (s.stats[`conq:${by}`] ?? 0) + 1;
    logEvent(s, `${c.name} has been wiped off the map: annexed by ${s.countries[by].name}.`, 'territory', [c.id, by], true, { big: true, prov: s.countries[by].capital });
    chronicle(s, 'fell', `${c.name} was conquered by ${s.countries[by].name}.`, [c.id, by]);
  }
  for (const w of [...s.wars]) {
    const side = warSideOf(w, c.id);
    w.attackers = w.attackers.filter((x) => x !== c.id);
    w.defenders = w.defenders.filter((x) => x !== c.id);
    if (side >= 0 && (!w.attackers.length || !w.defenders.length)) {
      // the war ends with the nation: it goes into the history books like any other (it used to vanish without a record)
      const wonBy = side === 0 ? w.defenders[0] : w.attackers[0];
      if (wonBy !== undefined) {
        const a = wonBy, b = c.id;
        const hist = s.warHistory ?? (s.warHistory = []);
        hist.push({ id: w.id, name: w.name, a, b, start: w.start, end: s.tick, casA: Math.round(w.casualties[a] ?? 0), casB: Math.round(w.casualties[b] ?? 0), provsA: w.taken?.[a] ?? 0, provsB: w.taken?.[b] ?? 0, winner: 'a', terms: 'surrender', civ: Math.round(Object.values(w.civ ?? {}).reduce((x, y) => x + y, 0)), displaced: Math.round(w.displaced ?? 0), hist: w.hist?.slice(-60), atk: [...w.attackers], def: [...w.defenders] });
        s.stats[`lostWar:${b}`] = s.tick;
        legacyWarEnded(s, hist[hist.length - 1]);
        settleGoal(s, hist[hist.length - 1]);
        if (hist.length > 40) hist.splice(0, hist.length - 40);
      }
    }
    if (!w.attackers.length || !w.defenders.length) endWar(s, w);
  }
  for (const k of Object.keys(s.treaties)) {
    const [a, b] = k.split('-').map(Number);
    if (a === c.id || b === c.id) delete s.treaties[k];
  }
  touchTreaties(s);
}

export function endWar(s: GameState, w: War) {
  s.wars = s.wars.filter((x) => x.id !== w.id);
}

// ---------------------------------------------------------------------------------------------
// Declaring war
// ---------------------------------------------------------------------------------------------
export interface DeclareResult { ok: boolean; reason?: string }

export function canDeclareWar(s: GameState, a: CountryId, d: CountryId): DeclareResult {
  const A = s.countries[a], D = s.countries[d];
  if (!A?.alive || !D?.alive) return { ok: false, reason: 'Country does not exist' };
  if (a === d) return { ok: false, reason: 'Cannot target yourself' };
  if (areAtWar(s, a, d)) return { ok: false, reason: 'Already at war' };
  if (A.mil.troops < 20) return { ok: false, reason: 'You have no army to fight with' };
  if (demilitarised(s, a, d)) return { ok: false, reason: `The peace treaty forbids you to attack ${D.name}` };
  return { ok: true };
}

function aggressionFallout(s: GameState, a: CountryId, d: CountryId, severity: number) {
  const A = s.countries[a];
  A.reputation = clamp(A.reputation - severity * 1.5, 0, 100);
  for (const x of s.countries) {
    if (!x.alive || x.id === a || x.id === d) continue;
    const toVictim = getRelation(s, x.id, d);
    const toAgg = getRelation(s, x.id, a);
    if (toVictim > 15 && toAgg < 40) addRelation(s, x.id, a, -severity * (0.5 + toVictim / 100));
    else if (toVictim < -40) addRelation(s, x.id, a, severity * 0.2);
    else addRelation(s, x.id, a, -severity * 0.25);
  }
}

/** set by warmode.ts (a late binding: warmode imports this module) */
// eslint-disable-next-line no-var
export var registerPlayerWarFn: ((s: GameState, w: War) => void) | null | undefined;
export function setRegisterPlayerWar(f: (s: GameState, w: War) => void) { registerPlayerWarFn = f; }
export function declareWar(s: GameState, geo: Geo, a: CountryId, d: CountryId, why?: string): DeclareResult {
  const chk = canDeclareWar(s, a, d);
  if (!chk.ok) return chk;
  const A = s.countries[a], D = s.countries[d];
  const justified = claimStrength(a, d) > 0.3 || getRelation(s, a, d) < -60 || !!s.stats[`cb:${a}>${d}`];
  let severity = justified ? 2 : 7;
  const treaty = s.treaties[pairKey(a, d)];
  addRec(s, a, 'aggr', justified ? 0.6 : 1);
  if (treaty?.nap) { addRec(s, a, 'betray', 1); addGrudge(s, d, a, 'broke a non-aggression pact with it', 15); severity += 6; A.reputation = Math.max(0, A.reputation - 10); logEvent(s, `${A.name} broke its non-aggression pact with ${D.name}.`, 'diplo', [a, d], true); }
  if (treaty?.alliance) { severity += 4; }
  if (treaty) { treaty.alliance = false; treaty.nap = false; treaty.trade = false; treaty.coop = false; touchTreaties(s); }
  const war: War = {
    id: s.nextWarId++, name: `${A.name}–${D.name} War`, attackers: [a], defenders: [d], start: s.tick, fronts: [], casualties: {}, gained: {}, lost: {},
    startProvs: { [a]: A.provinces.length, [d]: D.provinces.length },
  };
  s.wars.push(war);
  onEnterWar(s, A, 'aggressor', justified);
  onEnterWar(s, D, 'defender');
  A.lastWarDecl = s.tick;
  s.stats[`pair:${a}>${d}`] = s.tick;
  addGrudge(s, d, a, 'attacked it', 30);
  addRelation(s, a, d, -40);
  aggressionFallout(s, a, d, severity);
  addAggression(s, a, justified ? 14 : 24);
  logEvent(s, `${A.name} declared war on ${D.name}!${why ? ` Reason: ${why}.` : justified ? ' It claims the land is rightfully its own.' : ''}`, 'war', [a, d], true, isBigNews(s, a, d) ? { big: true, prov: D.capital } : undefined);

  // alliance calls
  if (s.settings.defensiveAlliances) {
    for (const x of new Set([...alliesOf(s, d), ...guarantorsOf(s, d)])) {
      if (x === a || hasAlliance(s, x, a)) continue;
      const X = s.countries[x];
      if (x === s.player) {
        // the player decides whether to honour the alliance (see the "ally_attacked" event)
        s.scheduled.push({ tick: s.tick, id: 'ally_attacked', data: { ally: d, aggressor: a, war: war.id } });
        continue;
      }
      if (joinsDefense(s, x, d, a)) {
        war.defenders.push(x);
        war.startProvs[x] = X.provinces.length;
        onEnterWar(s, X, 'ally');
        addRec(s, x, 'loyal', 0.6);
        addRelation(s, x, a, -25);
        logEvent(s, `${X.name} honours its alliance and joins the war on ${D.name}'s side.`, 'war', [x, d], x === s.player || d === s.player);
      } else {
        X.reputation = Math.max(0, X.reputation - 4);
        addRec(s, x, 'betray', 0.5);
        logEvent(s, `${X.name} declined to defend its ally ${D.name}.`, 'diplo', [x, d]);
      }
    }
    for (const x of alliesOf(s, a)) {
      if (x === d || war.attackers.includes(x) || war.defenders.includes(x) || x === s.player) continue;
      const X = s.countries[x];
      if (X.ai.aggression > 0.4 && getRelation(s, x, d) < -45 && nextRand(s) < 0.3) {
        war.attackers.push(x);
        war.startProvs[x] = X.provinces.length;
        onEnterWar(s, X, 'ally');
        logEvent(s, `${X.name} joins ${A.name}'s war against ${D.name}.`, 'war', [x, a, d]);
      }
    }
  }
  // a coalition against the aggressor answers an attack on any of its members
  const coal = coalitionAgainst(s, a);
  if (coal?.members.includes(d)) {
    for (const x of coal.members) {
      if (x === d || war.defenders.includes(x) || !s.countries[x]?.alive || hasAlliance(s, x, a)) continue;
      if (x === s.player) { s.scheduled.push({ tick: s.tick, id: 'ally_attacked', data: { ally: d, aggressor: a, war: war.id } }); continue; }
      if (nextRand(s) < 0.7) { war.defenders.push(x); war.startProvs[x] = s.countries[x].provinces.length; onEnterWar(s, s.countries[x], 'ally'); logEvent(s, `${s.countries[x].name} honours the coalition and joins the war against ${A.name}.`, 'war', [x, a, d], true); }
    }
  }
  if (d === s.player) cable(s, a, 'war_on_you'); else if (a === s.player) cable(s, d, 'you_declared');
  if (a === s.player) voicesOn(s, 'declare', d); else if (d === s.player) voicesOn(s, 'attacked', a);
  noteWarStart(s, war);
  if (a === s.player || d === s.player) registerPlayerWarFn?.(s, war);
  if ((a === s.player || d === s.player) && !s.inbox.some((x) => x.id === 'war_goal') && !(s.warx?.[war.id]?.council)) s.inbox.push({ uid: s.nextInbox++, id: 'war_goal', tick: s.tick, expires: s.tick + 6, urgent: true, data: { w: war.id, e: a === s.player ? d : a } });
  return { ok: true };
}

/** Would ally x join the defence of d against aggressor a? */
function joinsDefense(s: GameState, x: CountryId, d: CountryId, a: CountryId): boolean {
  const X = s.countries[x], A = s.countries[a];
  let p = 0.55 + 0.003 * getRelation(s, x, d) + (getRelation(s, x, a) < -20 ? 0.15 : 0) - 0.25 * X.ai.caution;
  if (strength(A) > 3 * strength(X) + strength(s.countries[d])) p -= 0.3;
  if (A.mil.nuclear && !X.mil.nuclear) p -= 0.15;
  if (X.eco.stability < 30) p -= 0.2;
  if (warsOf(s, x).length >= 2) p -= 0.3;
  return nextRand(s) < clamp(p, 0.05, 0.97);
}

// ---------------------------------------------------------------------------------------------
// Peace
// ---------------------------------------------------------------------------------------------
export function warScore(s: GameState, w: War, c: CountryId): number {
  const side = warSideOf(w, c);
  if (side < 0) return 0;
  const enemies = side === 0 ? w.defenders : w.attackers;
  const own = side === 0 ? w.attackers : w.defenders;
  const enemyLoss = enemies.reduce((t, e) => t + (w.lost[e] ?? 0), 0) / Math.max(1, enemies.length);
  const ownLoss = own.reduce((t, e) => t + (w.lost[e] ?? 0), 0) / Math.max(1, own.length);
  const enemyCas = enemies.reduce((t, e) => t + (w.casualties[e] ?? 0), 0);
  const ownCas = own.reduce((t, e) => t + (w.casualties[e] ?? 0), 0);
  const casRatio = (enemyCas - ownCas) / (enemyCas + ownCas + 1);
  return clamp(1.5 * (enemyLoss - ownLoss) + 0.3 * casRatio, -1, 1);
}

export type PeaceKind = 'status_quo' | 'restore' | 'demand' | 'concede' | 'surrender';
export interface PeaceTerms { kind: PeaceKind; share?: number; /** demands beyond borders (see peaceterms.ts) */ extras?: PeaceExtra[] }

/** Provinces transferred under demand (from b to a) / concede (from a to b) terms. */
export function termProvinces(s: GameState, geo: Geo, a: CountryId, b: CountryId, t: PeaceTerms): { from: CountryId; to: CountryId; provs: ProvId[] } | null {
  if (t.kind === 'demand' || t.kind === 'surrender') {
    const donor = s.countries[b];
    const mine = new Set(s.countries[a].provinces);
    // prioritise provinces already held/occupied-adjacent to the demander
    const ranked = [...donor.provinces].sort((p, q) => {
      const near = (x: number) => geo.adj[x].some((n) => mine.has(n)) ? 0 : 1;
      return near(p) - near(q) || geo.provinces[q].w - geo.provinces[p].w;
    });
    if (t.kind === 'surrender') return { from: b, to: a, provs: ranked };
    // a peace treaty redraws the border: it hands over land next to the winner, never the loser's capital (a capital
    // is only lost by being taken), and never land across the sea from anything the winner holds
    const reachable = ranked.filter((p) => p !== donor.capital && geo.adj[p].some((n) => mine.has(n)));
    const n = Math.max(1, Math.round((t.share ?? 0.2) * donor.provinces.length));
    return { from: b, to: a, provs: reachable.slice(0, Math.min(n, donor.provinces.length - 1 || 1)) };
  }
  if (t.kind === 'concede') {
    const donor = s.countries[a];
    const theirs = new Set(s.countries[b].provinces);
    const ranked = [...donor.provinces].filter((p) => p !== donor.capital && geo.adj[p].some((n) => theirs.has(n)))
      .sort((p, q) => geo.provinces[p].w - geo.provinces[q].w);
    const n = Math.max(1, Math.round((t.share ?? 0.15) * donor.provinces.length));
    return { from: a, to: b, provs: ranked.slice(0, Math.min(n, ranked.length)) };
  }
  return null;
}

export interface PeaceEval { accept: boolean; willingness: number; required: number; reasons: string[] }

/** How willing is `b` to accept peace offered by `a` on these terms? */
export function evaluatePeace(s: GameState, geo: Geo, a: CountryId, b: CountryId, t: PeaceTerms): PeaceEval {
  const w = warBetween(s, a, b);
  const B = s.countries[b];
  if (!w) return { accept: false, willingness: 0, required: 1, reasons: ['Not at war'] };
  const score = warScore(s, w, b);
  const years = (s.tick - w.start) / 52;
  const capitalLost = capitalLostOf(s, B);
  const reasons: string[] = [];
  let will = 0.9 * B.mil.exhaustion; reasons.push(`War exhaustion ${(B.mil.exhaustion * 100).toFixed(0)}%`);
  will += 0.5 * -score; if (score < 0) reasons.push('Losing the war'); else if (score > 0.2) reasons.push('Winning the war');
  will += 0.2 * Math.min(1, years / 3);
  if (capitalLost) will += 0.35;
  if (B.eco.stability < 25) { will += 0.3; reasons.push('Domestic unrest'); }
  const ws = warSupport(B);
  will += 0.7 * (0.5 - ws);
  if (ws < 0.35) reasons.push(`War support only ${(ws * 100).toFixed(0)}%`); else if (ws > 0.7) reasons.push(`War support ${(ws * 100).toFixed(0)}%: the public wants victory`);
  will -= 0.25 * B.ai.aggression;
  const rl = peacePressure(s, w, b);
  if (rl > 0) { will += rl; reasons.push('Red lines drawn against them: they fear a wider war'); }
  const gainsB = (w.gained[b] ?? 0);
  let required = 0.4;
  const terms = termProvinces(s, geo, a, b, t);
  const share = terms ? terms.provs.length / Math.max(1, s.countries[terms.from].provinces.length) : 0;
  switch (t.kind) {
    case 'status_quo': required = 0.4; break;
    case 'restore': required = 0.4 + 0.8 * gainsB; break;
    case 'demand': required = 0.45 + 1.7 * share; reasons.push(`Territorial demand: ${(share * 100).toFixed(0)}% of provinces`); break;
    case 'concede': required = 0.4 - 1.2 * share - 0.1; break;
    case 'surrender': required = 1.9; break;
  }
  if (t.kind !== 'concede') for (const x of t.extras ?? []) { required += extraCost(s, x, b); reasons.push(`${PEACE_EXTRAS[x].label}: +${Math.round(extraCost(s, x, b) * 100)} needed`); }
  const res = w.resolve?.[b] ?? 0;
  if (res && t.kind !== 'concede') { required += res; reasons.push('A war for their survival: they hold out'); }
  if (b === s.player) required = Infinity;
  return { accept: will >= required, willingness: will, required, reasons };
}

/** Execute a peace treaty between principals a and b. */
export function makePeace(s: GameState, geo: Geo, a: CountryId, b: CountryId, t: PeaceTerms) {
  const w = warBetween(s, a, b);
  if (!w) return;
  const A = s.countries[a], B = s.countries[b];
  if (a === s.player || b === s.player) cable(s, a === s.player ? b : a, 'peace');
  if (t.kind === 'restore') {
    for (const p of [...A.provinces, ...B.provinces]) {
      const core = s.core[p];
      if (s.owner[p] !== core && s.countries[core].alive && (warSideOf(w, core) >= 0) && (s.owner[p] === a || s.owner[p] === b)) transferProvince(s, geo, p, core);
    }
  }
  const scoreA = warScore(s, w, a);
  const tp = termProvinces(s, geo, a, b, t);
  let moved = 0;
  if (tp) for (const p of tp.provs) if (s.owner[p] === tp.from) { transferProvince(s, geo, p, tp.to); moved++; }
  if (tp && moved && w.attackers.includes(tp.to)) addAggression(s, tp.to, 2 * moved);
  {
    // the record of this war, for the history and the end-of-war summary
    const provsA = (w.taken?.[a] ?? 0) + (tp && tp.to === a ? moved : 0) - (tp && tp.from === a ? moved : 0);
    const provsB = (w.taken?.[b] ?? 0) + (tp && tp.to === b ? moved : 0) - (tp && tp.from === b ? moved : 0);
    const edge = provsA - provsB + 3 * scoreA;
    const winner: 'a' | 'b' | 'draw' = t.kind === 'surrender' || (tp && tp.to === a && moved) || (t.kind !== 'concede' && (t.extras?.length ?? 0) > 0) ? 'a' : t.kind === 'concede' ? 'b' : edge > 1.2 ? 'a' : edge < -1.2 ? 'b' : 'draw';
    const hist = s.warHistory ?? (s.warHistory = []);
    if (winner !== 'draw') s.stats[`lostWar:${winner === 'a' ? b : a}`] = s.tick;
    hist.push({ id: w.id, name: w.name, a, b, start: w.start, end: s.tick, casA: Math.round(w.casualties[a] ?? 0), casB: Math.round(w.casualties[b] ?? 0), provsA, provsB, winner, terms: t.kind, civ: Math.round(Object.values(w.civ ?? {}).reduce((x, y) => x + y, 0)), displaced: Math.round(w.displaced ?? 0), hist: w.hist?.slice(-60), atk: [...w.attackers], def: [...w.defenders] });
    legacyWarEnded(s, hist[hist.length - 1]);
    settleGoal(s, hist[hist.length - 1]);
    if (hist.length > 40) hist.splice(0, hist.length - 40);
  }
  if (t.extras?.length && t.kind !== 'concede') applyExtras(s, a, b, t.extras);
  if (tp && tp.provs.length && tp.to === s.player) s.stats.warWins = (s.stats.warWins ?? 0) + 1;
  const lbl = ({ status_quo: 'ceasefire on current lines', restore: 'a return to pre-war borders', demand: 'territorial concessions', concede: 'concessions by the sender', surrender: 'total surrender' } as const)[t.kind];
  logEvent(s, `${A.name} and ${B.name} signed peace (${lbl}).`, 'peace', [a, b], a === s.player || b === s.player);
  if (a === s.player || b === s.player) voicesOn(s, 'peace', a === s.player ? b : a);
  // who leaves the war: a peace between the two leaders ends it for everyone; otherwise a separate peace takes out only
  // the signers who do not lead their side (it used to take out both, so an ally's separate peace with the main
  // attacker ended the war for the victim too, without its consent)
  const leaders = [w.attackers[0], w.defenders[0]];
  if (leaders.includes(a) && leaders.includes(b)) { w.attackers = []; w.defenders = []; }
  else for (const x of [a, b]) if (!leaders.includes(x)) { w.attackers = w.attackers.filter((y) => y !== x); w.defenders = w.defenders.filter((y) => y !== x); }
  w.fronts = w.fronts.filter((f) => warSideOf(w, f.by) >= 0 && warSideOf(w, s.owner[f.prov]) >= 0);
  if (!w.attackers.length || !w.defenders.length) {
    logEvent(s, `The ${w.name} has ended.`, 'peace', [a, b]);
    endWar(s, w);
  }
  A.mil.exhaustion *= 0.8; B.mil.exhaustion *= 0.8;
  addRelation(s, a, b, 10);
  A.mil.focus = []; B.mil.focus = [];
}

/**
 * A government that falls sues for peace on every front. A war against the player never just stops, though: the new
 * rulers send the player a peace offer (with concessions) and say why, and the player decides.
 */
export function forcePeaceAll(s: GameState, geo: Geo, c: CountryId, why = 'a new government') {
  for (const w of [...warsOf(s, c)]) {
    const side = warSideOf(w, c);
    for (const e of [...(side === 0 ? w.defenders : w.attackers)]) {
      if (!warBetween(s, c, e)) continue;
      if (e === s.player && c !== s.player) {
        if (!s.offers.some((o) => o.from === c && o.kind === 'peace')) s.offers.push({ id: s.nextOfferId++, from: c, kind: 'peace', terms: { kind: 'concede', share: 0.15 }, tick: s.tick });
        logEvent(s, `🏳 ${s.countries[c].name} is in turmoil (${why}) and asks you for peace, offering land. Accept or fight on: the offer is in your notices.`, 'peace', [c, s.player], true, { big: true, prov: s.countries[c].capital });
        cable(s, c, 'peace');
        continue;
      }
      makePeace(s, geo, c, e, { kind: 'status_quo' });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------------------------
/** A country in several wars splits its field army between them (it used to divide by N^0.7, fielding N^0.3 armies). */
const wr = (s: GameState, c: CountryId) => Math.max(1, warsOf(s, c).length);

function competence(s: GameState, c: Country): number {
  if (c.isPlayer) return 1;
  return s.settings.difficulty === 'hard' ? 1.1 : s.settings.difficulty === 'easy' ? 0.92 : 1;
}

interface Candidate { prov: ProvId; amphibious: boolean; supply: number; score: number; from: ProvId }

export { supplyReach };
function seaReach(c: Country): number {
  const np = navalPower(c.mil);
  if (np < 5e8) return 0;
  return 25 + 80 * clamp(Math.sqrt(np / 1e12), 0, 1) + 8 * c.mil.bld.port;
}

export function navalSuperiority(a: Country, b: Country): number {
  return Math.tanh(Math.log((navalPower(a.mil) + 1e7) / (navalPower(b.mil) + 1e7)) / 1.5);
}
export function airSuperiority(a: Country, b: Country): number {
  return Math.tanh(Math.log((airPower(a.mil) + 1e7) / (airPower(b.mil) + 1e7)) / 1.5);
}

export function attackCandidates(s: GameState, geo: Geo, c: Country, w: War): Candidate[] {
  const side = warSideOf(w, c.id);
  const friends = new Set(side === 0 ? w.attackers : w.defenders);
  const enemies = new Set(side === 0 ? w.defenders : w.attackers);
  const mineProvs: ProvId[] = [];
  for (const f of friends) for (const p of s.countries[f].provinces) mineProvs.push(p);
  const out = new Map<ProvId, Candidate>();
  const net = supplyNet(s, geo, c.id);
  const pocketOf = (q: ProvId) => isPocket(s, geo, q);
  // (the same neighbours as supply uses: adj misses a few borders, so land could be cut off by an enemy that could not attack it)
  const nbs = neighbours(geo);
  for (const p of mineProvs) {
    for (const q of nbs[p]) {
      if (!enemies.has(s.owner[q]) || out.has(q)) continue;
      const ls = landSupply(s, geo, net, q);
      const supply = ls.supply;
      const imp = geo.provinces[q].w * (q === s.countries[s.owner[q]].capital ? 3 : 1) + 0.3;
      // pincers: provinces we already touch from several sides are easier to cut off; encircled ones are easy prey
      let sides = 0;
      for (const n2 of nbs[q]) if (friends.has(s.owner[n2])) sides++;
      const prey = pocketOf(q) ? 1.6 : 1;
      out.set(q, { prov: q, amphibious: false, supply, from: ls.from, score: ((imp * supply) / (1 + 0.6 * geo.provinces[q].terrain)) * prey * (1 + 0.18 * Math.max(0, sides - 1)) });
    }
  }
  const sr = seaReach(c);
  if (sr > 0) {
    const myCoast = mineProvs.filter((p) => isCoastalProv(geo, p) && s.owner[p] === c.id);
    for (const e of enemies) {
      const E = s.countries[e];
      if (!E.alive) continue;
      for (const q of E.provinces) {
        if (out.has(q) || !isCoastalProv(geo, q)) continue;
        let dmin = Infinity;
        for (const b of myCoast) { const d = geo.dist(b, q); if (d < dmin) dmin = d; }
        if (dmin > sr) continue;
        const sup = navalSuperiority(c, E);
        const supply = clamp(0.8 - 0.5 * (dmin / sr), 0.3, 0.8) * (0.8 + 0.2 * Math.max(0, sup)) * (0.72 + 0.28 * net.capacity);
        // no hopeless landings: not at the end of a thin sea lane, not against a stronger navy (an ordered landing is below)
        if (supply < 0.45 || sup < -0.15) continue;
        const imp = geo.provinces[q].w * (q === E.capital ? 1.5 : 1) + 0.3;
        out.set(q, { prov: q, amphibious: true, supply, from: -1, score: (imp * supply * 0.7) / (1 + 0.6 * geo.provinces[q].terrain) });
      }
    }
  }
  // special operations: an ordered landing or airdrop becomes a target even far from the lines
  for (const op of opsOf(c)) {
    if (op.until <= s.tick || !enemies.has(s.owner[op.prov])) continue;
    const prev = out.get(op.prov);
    const supply = op.kind === 'naval' ? Math.max(prev?.supply ?? 0, 0.62 * (0.72 + 0.28 * net.capacity)) : Math.max(prev?.supply ?? 0, 0.5);
    out.set(op.prov, { prov: op.prov, amphibious: op.kind === 'naval' && (prev === undefined || prev.from < 0) || (prev?.amphibious ?? false), supply, from: prev?.from ?? -1, score: (prev?.score ?? 1) + 6 });
  }
  return [...out.values()];
}

interface Strike { c: Country; supply: number; amphibious: boolean; share: number; from: ProvId; order?: ArmyOrder }

/** Every 4 weeks, a point on each war's chart: casualties on both sides and the war score. */
export function sampleWars(s: GameState) {
  if (s.tick % 4 !== 0) return;
  for (const w of s.wars) {
    const sum = (ids: CountryId[]) => Math.round(ids.reduce((t, c) => t + (w.casualties[c] ?? 0), 0));
    const h = (w.hist ??= []);
    h.push([s.tick, sum(w.attackers), sum(w.defenders), Math.round(warScore(s, w, w.attackers[0]) * 100)]);
    if (h.length > 120) h.splice(0, h.length - 120);
  }
}

export function stepWars(s: GameState, geo: Geo) {
  stepPockets(s, geo);
  // this week's blockades are built up off to the side and swapped in at the end: zeroing them here let supply networks
  // rebuilt in the middle of the week (after a capture) see no blockade at all
  const blockade = new Map<CountryId, number>();
  const tired = new Set<CountryId>(); // the economic cost of war wears a country once a week, however many wars it is in
  let generalsFreed = false; // the player's unpinned generals are reassigned once a week, not once per war
  for (const w of [...s.wars]) {
    if (!s.wars.includes(w)) continue;
    const sides: CountryId[][] = [w.attackers, w.defenders];
    // --- 1. choose targets
    const strikes = new Map<ProvId, Strike[]>();
    for (let si = 0; si < 2; si++) {
      for (const cid of sides[si]) {
        const c = s.countries[cid];
        if (!c.alive || c.mil.troops < 10) continue;
        const cands = attackCandidates(s, geo, c, w);
        if (!cands.length) continue;
        const off = c.mil.troops * clamp(c.mil.commit, 0.05, 1) * c.mil.readiness / wr(s, cid);
        if (c.isPlayer && armiesActive(s)) {
          // the player's army groups choose their own targets
          const scoreMap = new Map(cands.map((x) => [x.prov, x.score]));
          if (!generalsFreed) { generalsFreed = true; for (const g of c.generals ?? []) if (!g.pinned) g.front = -1; }
          for (const st of armyStrikes(s, geo, c, cands, off, (p) => scoreMap.get(p) ?? 0)) {
            const list = strikes.get(st.prov) ?? [];
            const same = list.find((x) => x.c === c && x.order === st.army.order);
            if (same) same.share += st.share; else list.push({ c, supply: st.supply, amphibious: st.amphibious, share: st.share, from: st.from, order: st.army.order });
            strikes.set(st.prov, list);
            const g = c.generals?.find((x) => x.id === st.army.general && x.status === 'active');
            if (g && !g.pinned && !generalAt(c, st.prov)) g.front = st.prov;
            if (!w.fronts.some((f) => f.prov === st.prov && f.by === cid)) w.fronts.push({ prov: st.prov, by: cid, progress: 0, amphibious: st.amphibious });
          }
          continue;
        }
        // concentrate against an equal; only an army that clearly outnumbers the enemy's field army can push on more sectors
        // at once (from about 90k men on the offensive)
        let foeField = 0;
        for (const e of sides[1 - si]) { const E = s.countries[e]; if (E.alive) foeField = Math.max(foeField, E.mil.troops * E.mil.readiness / wr(s, e)); }
        const nTargets = clamp((off > 1.2 * foeField ? Math.round : Math.floor)(Math.sqrt(off / 40000)), 1, 6);
        let chosen: Candidate[];
        if (c.isPlayer && !c.mil.autoAdvance) {
          const focus = new Set(c.mil.focus);
          chosen = cands.filter((x) => focus.has(x.prov)).slice(0, nTargets);
        } else {
          // keep pushing where it works; give up an offensive that has gone nowhere for six weeks; look for thin sectors
          // (it used to stick to an existing front whatever happened there, 7k men against 78k for a whole war)
          const mine = new Map(w.fronts.filter((f) => f.by === cid).map((f) => [f.prov, f]));
          const gar = w.gar ?? {};
          // hopeless attacks are not made at all: a front that has gone nowhere for eight weeks while outmatched, or an
          // attack at the end of a supply line that barely reaches (the army stays on the defensive instead of bleeding)
          const viable = cands.filter((x) => { const f = mine.get(x.prov); return x.supply >= 0.2 && !(f && (f.stall ?? 0) >= 8 && (f.r ?? 1) < 0.7); }); // (0.7: about where an attack stops gaining ground)
          chosen = viable.map((x) => {
            const f = mine.get(x.prov), stuck = (f?.stall ?? 0) >= 6;
            const thin = 1 / (1 + 2.5 * (gar[`${s.owner[x.prov]}:${x.prov}`] ?? 0));
            // (a stuck front loses even a capital's lure; an attack at the end of a hopeless supply line is a last resort)
            // an offensive under way is finished before a new one is opened: the closer it is to taking the region, the
            // stronger the pull (looking for thin sectors only applies to opening a new front; applied to fronts under
            // way it made a one-target army alternate between two of them, each losing what the other gained)
            return { ...x, score: x.score * (stuck ? 0.12 : 1) * (x.supply < 0.3 ? 0.3 : 1) * (f ? 1 : 0.6 + 0.4 * thin) + (f && !stuck ? 1.2 + 4 * f.progress : 0) + (c.isPlayer && c.mil.focus.includes(x.prov) ? 2 : 0) };
          }).sort((a, b) => b.score - a.score).slice(0, nTargets);
        }
        for (const ch of chosen) {
          const list = strikes.get(ch.prov) ?? [];
          list.push({ c, supply: ch.supply, amphibious: ch.amphibious, share: off / chosen.length, from: ch.from });
          strikes.set(ch.prov, list);
          if (!w.fronts.some((f) => f.prov === ch.prov && f.by === cid)) w.fronts.push({ prov: ch.prov, by: cid, progress: 0, amphibious: ch.amphibious });
        }
      }
    }

    // --- 1b. a player's operation concentrates the offensive on its objective; the rest of the front thins out
    const fo = opFocus(s);
    const PL = s.countries[s.player];
    if (fo && fo.war === w.id && PL.alive && warSideOf(w, PL.id) >= 0) {
      const cand = attackCandidates(s, geo, PL, w).find((x) => x.prov === fo.target);
      if (cand) {
        const off = PL.mil.troops * clamp(PL.mil.commit, 0.05, 1) * PL.mil.readiness / wr(s, PL.id);
        for (const [q, list] of strikes) if (q !== fo.target) for (const st of list) if (st.c === PL) st.share *= 1 - fo.share;
        const list = strikes.get(fo.target) ?? [];
        const ex = list.find((x) => x.c === PL);
        if (ex) ex.share += fo.share * off; else list.push({ c: PL, supply: cand.supply, amphibious: cand.amphibious, share: fo.share * off, from: cand.from });
        strikes.set(fo.target, list);
        if (!w.fronts.some((f) => f.prov === fo.target && f.by === PL.id)) w.fronts.push({ prov: fo.target, by: PL.id, progress: 0, amphibious: cand.amphibious });
      }
    }

    // --- 2. defenders' field troops are reinforced where the pressure is (capital gets a bonus)
    const pressure = new Map<ProvId, number>();
    for (const [p, list] of strikes) pressure.set(p, list.reduce((t, st) => t + landPower(st.c.mil, st.share) * st.supply, 0));
    const threatened = new Map<CountryId, ProvId[]>();
    for (const p of strikes.keys()) {
      const o = s.owner[p];
      const arr = threatened.get(o) ?? [];
      arr.push(p);
      threatened.set(o, arr);
    }
    const imp = (p: ProvId, o: CountryId) => geo.provinces[p].w * (p === s.countries[o].capital ? 3 : 1) + 0.2;
    const defW = (p: ProvId, o: CountryId) => Math.pow(pressure.get(p) ?? 1, 0.9) * (p === s.countries[o].capital ? 1.3 : 1);
    // defenders do not teleport: each week their reserves move part of the way toward where the attacks are. A new or
    // shifted attack meets a thin line at first; an attack that goes on draws the reserves in. (They used to be spread
    // perfectly over this week's attacks, so no attack ever found a weak sector and wars between equals froze.)
    // and they cannot strip the rest of the frontier bare: a third of the field army stays spread along every region that
    // faces the enemy, so a long frontier is thin and a short one is strong
    const frontage = new Map<CountryId, number>();
    for (const o of threatened.keys()) {
      const foes = new Set(warSideOf(w, o) === 0 ? w.defenders : w.attackers);
      let n = 0;
      for (const q of s.countries[o].provinces) if (geo.adj[q].some((x) => foes.has(s.owner[x]))) n++;
      frontage.set(o, Math.max(1, n));
    }
    const gar = (w.gar ??= {});
    const garShare = new Map<ProvId, number>();
    const seen = new Set<string>();
    for (const [o, tp] of threatened) {
      const sumD = tp.reduce((t2, q) => t2 + defW(q, o), 0);
      let tot = 0;
      for (const q of tp) {
        const k = `${o}:${q}`, tgt = defW(q, o) / sumD;
        const prev = gar[k];
        const v = prev === undefined ? 0.45 * tgt : prev + (tgt - prev) * 0.4;
        garShare.set(q, v); tot += v; seen.add(k);
      }
      if (tot > 1) for (const q of tp) garShare.set(q, garShare.get(q)! / tot);
      for (const q of tp) gar[`${o}:${q}`] = Math.round(garShare.get(q)! * 1000) / 1000;
    }
    // reserves drift away from sectors no longer under attack
    for (const k of Object.keys(gar)) if (!seen.has(k)) { const [o, q] = k.split(':').map(Number); const v = gar[k] * 0.6; if (v < 0.01 || s.owner[q] !== o) delete gar[k]; else gar[k] = Math.round(v * 1000) / 1000; }

    // --- 3. resolve each battle
    for (const [p, list0] of strikes) {
      const list = list0.filter((st) => st.c.alive && warSideOf(w, st.c.id) >= 0);
      if (!list.length) continue;
      const e = s.owner[p];
      if (warSideOf(w, e) < 0 || list.every((st) => warSideOf(w, st.c.id) === warSideOf(w, e))) continue;
      const E = s.countries[e];
      if (!E.alive) continue;
      const tp = threatened.get(e)!;
      const sumImp = tp.reduce((t, q) => t + imp(q, e), 0);
      const sumDef = tp.reduce((t, q) => t + defW(q, e), 0);
      const defTroops = (E.mil.troops * (1 - 0.6 * E.mil.commit) * E.mil.readiness / wr(s, e)) * (0.35 / frontage.get(e)! + 0.65 * (garShare.get(p) ?? defW(p, e) / sumDef)) * (1 + 0.25 * E.eco.infra / 100);
      const terrain = geo.provinces[p].terrain;
      const fort = 1.15 + 0.2 * (E.eco.infra / 100) + (p === E.capital ? 0.8 : 0);
      const pocket = isPocket(s, geo, p);
      const Pd = Math.max(1, landPower(E.mil, defTroops) * fort * fortBonus(s, p) * (1 + 0.9 * terrain) * competence(s, E) * mods(E).def * morale(E) * (pocket ? 0.55 : 1) * defenceBonus(homeCommander(E)) * (E.isPlayer ? holdBonus(s, geo, p) * opDefenceMult(s, p) : 1) * campDef(s, E) * charDef(E));
      let Pa = 0;
      const contrib: { st: Strike; pa: number; air: number }[] = [];
      for (const st of list) {
        const C = st.c;
        const air = clamp(airSuperiority(C, E) + 0.03 * C.mil.bld.airbase - 0.015 * E.mil.bld.airbase, -1, 1.3);
        const intel = 1 + 0.2 * (C.mil.intel - E.mil.intel);
        const gen = generalAt(C, p);
        st.supply = Math.min(1, st.supply * supplyBonus(gen));
        const pa = (st.order === 'encircle' && pocket ? 1.25 : 1) * attackBonus(gen, pocket) * landPower(C.mil, st.share) * st.supply * (1 + 0.18 * air) * intel * (st.amphibious ? 0.55 + 0.3 * Math.max(0, navalSuperiority(C, E)) : 1) * competence(s, C) * mods(C).off * morale(C) * campOff(s, C, e);
        contrib.push({ st, pa: pa * (st.c.isPlayer ? opAttackMult(s, p) : 1), air }); // (a planned operation on this sector: operations.ts)
        Pa += contrib[contrib.length - 1].pa;
      }
      if (Pa <= 0) continue;
      const noise = 1 + (nextRand(s) - 0.5) * 0.16;
      const ratio = (Pa * noise) / Pd;
      const sizeScale = Math.pow(140 / Math.max(22, geo.provinces[p].area), 0.35);
      const nuclearBrake = E.mil.nuclear ? contrib.reduce((t, x) => t + (x.st.c.mil.nuclear ? 0.85 : 0.45) * x.pa, 0) / Pa : 1; // fear of escalation limits advances on nuclear powers
      const amph = contrib.every((x) => x.st.amphibious) ? 0.7 : 1;
      const raw = 0.08 * clamp(Math.log(ratio) + 0.4, -1.2, 1.6) * sizeScale; // breaks even at about 0.67: the defenders' bonuses are already in Pd
      // red lines and nuclear warnings hold back an advance into the defender's own homeland (redlines.ts)
      const redLine = s.core[p] === e ? advanceBrake(s, w, e) : 1;
      // a planned operation on this sector moves at an operation's tempo (operations.ts)
      const tempo = contrib.some((x) => x.st.c.isPlayer) ? opTempo(s, p) : 1;
      // an overwhelming edge breaks through faster than a narrow one (the weekly cap rises above 2:1, up to +70%)
      const rush = 1 + 0.6 * clamp(Math.log(ratio / 2), 0, 1.2);
      const delta = (raw > 0 ? Math.min(raw * tempo, (pocket ? 0.1 : 0.065) * tempo * rush) * nuclearBrake * redLine : raw) * (raw > 0 ? amph : 1);
      // casualties
      const defShare = defTroops;
      const gunner = contrib.some((x) => generalAt(x.st.c, p)?.trait === 'artillery');
      const defLossFrac = 0.0065 * Math.pow(clamp(ratio, 0.3, 3), 0.5) * (1 + 0.2 * Math.max(0, contrib[0].air)) * (gunner ? 1.15 : 1);
      const defLoss = Math.min(E.mil.troops * 0.5, defShare * defLossFrac);
      applyLosses(s, E, defLoss, w, 0.7);
      const atkLossBy = new Map<CountryId, number>();
      for (const { st, pa } of contrib) {
        const frac = pa / Pa;
        const atkLossFrac = 0.0075 * Math.pow(clamp(1 / ratio, 0.3, 3), 0.5) * (0.7 + 0.6 * terrain);
        const al = Math.min(st.c.mil.troops * 0.5, st.share * atkLossFrac) * (st.order === 'raid' ? 0.5 : 1) * campLoss(s, st.c, e);
        if (st.order === 'raid') E.eco.damage = Math.min(1, E.eco.damage + 0.0015);
        applyLosses(s, st.c, al, w, 1);
        atkLossBy.set(st.c.id, al);
        void frac;
      }
      for (const f of w.fronts) if (f.prov === p) { f.ld = (f.ld ?? 0) + defLoss; f.la = (f.la ?? 0) + (atkLossBy.get(f.by) ?? 0); }
      E.eco.damage = Math.min(1, E.eco.damage + 0.0025 * (imp(p, e) / sumImp) * Math.min(2, ratio));
      for (const { st } of contrib) {
        let front = w.fronts.find((f) => f.prov === p && f.by === st.c.id);
        if (front) { front.atk = Math.round(st.share); front.def = Math.round(defTroops); front.sup = Math.round(st.supply * 100) / 100; front.from = st.from; front.pocket = pocket; front.r = Math.round(ratio * 100) / 100; }
        if (!front) { front = { prov: p, by: st.c.id, progress: 0, amphibious: st.amphibious }; w.fronts.push(front); }
        const inc = delta * (contrib.length > 1 ? 1.1 : 1) * ((contrib.find((x) => x.st === st)!.pa) / Pa) * contrib.length * (st.order === 'raid' && delta > 0 ? 0.6 : 1);
        front.rate = front.rate === undefined ? inc : front.rate * 0.7 + inc * 0.3;
        front.stall = delta < 0.004 ? (front.stall ?? 0) + 1 : 0; // (the battle's progress: a small ally in a joint push is not stuck)
        front.progress = clamp(front.progress + inc, 0, 1.2);
      }
      const best = w.fronts.filter((f) => f.prov === p).sort((a, b) => b.progress - a.progress)[0];
      {
        // commanders gain experience (and risk their lives) in every week of fighting
        const intensity = Math.min(1, (defTroops + contrib.reduce((t2, x) => t2 + x.st.share, 0)) / 60000 + 0.2);
        const place = geo.provinces[p].name || E.name;
        const taken = !!best && best.progress >= 1;
        for (const { st } of contrib) generalAfterBattle(s, st.c, p, taken && best.by === st.c.id, intensity, place);
      }
      if (best && best.progress >= 1 && E.provinces.length === 1 && !E.isPlayer && !s.countries[best.by].isPlayer && hash01('spare', e, s.tick, s.settings.seed) < 0.8) {
        // the conqueror stops short of swallowing the last region: a rump state survives, and the world sees a ceasefire
        const winner = best.by;
        logEvent(s, `${s.countries[winner].name} halts its offensive and agrees a ceasefire, leaving ${E.name} a rump state.`, 'peace', [winner, e], false);
        makePeace(s, geo, winner, e, { kind: 'status_quo' });
        if (!s.wars.includes(w)) break;
        continue;
      }
      if (best && best.progress >= 1) {
        const winner = best.by;
        const wasCapital = p === E.capital;
        const f = transferProvince(s, geo, p, winner);
        // the world comments on the player's conquests and losses (capitals at once, otherwise now and then)
        if (winner === s.player) voicesOn(s, wasCapital ? 'capital' : 'conquest', e);
        else if (e === s.player && (wasCapital || (w.taken?.[winner] ?? 0) % 5 === 4)) voicesOn(s, 'besieged', winner);
        // a breakthrough: the line behind it is broken, and the next regions are already half-open
        for (const q of geo.adj[p]) {
          if (s.owner[q] !== e) continue;
          const fq = w.fronts.find((x) => x.prov === q && x.by === winner);
          if (fq) { fq.progress = Math.min(0.9, fq.progress + 0.2); fq.born = s.tick; } else w.fronts.push({ prov: q, by: winner, progress: 0.15, amphibious: false, born: s.tick });
        }
        w.gained[winner] = (w.gained[winner] ?? 0) + f;
        (w.taken ??= {})[winner] = (w.taken[winner] ?? 0) + 1;
        w.lost[e] = (w.lost[e] ?? 0) + f;
        const W = s.countries[winner];
        const name = geo.provinces[p].name || `a region of ${s.countries[s.core[p]].name}`;
        E.mil.exhaustion = Math.min(1, E.mil.exhaustion + 0.1 * f * 6);
        bumpSupport(W, 0.006 + 0.08 * Math.min(0.5, f));
        bumpSupport(E, -(0.004 + 0.12 * Math.min(0.5, f)));
        addGrudge(s, e, winner, 'seized its land', 6);
        if (w.attackers.includes(winner)) addRec(s, winner, 'conquest', 0.25);
        const la = best.la ?? 0, ld = best.ld ?? 0;
        const big = p === E.capital || isBigNews(s, winner, e);
        const gw = generalAt(W, p);
        if (w.attackers.includes(winner)) addAggression(s, winner, 2.5);
        logEvent(s, `Battle of ${name}: ${W.name}${gw ? ` (General ${gw.name})` : ''} captured it from ${E.name}${la + ld > 2000 ? ` after fighting that cost ${fmtCas(la)} attackers and ${fmtCas(ld)} defenders` : ''}.`, 'territory', [winner, e], winner === s.player || e === s.player || big, big && p !== E.capital ? { big: true, prov: p } : { prov: p });
        if (!s.wars.includes(w)) break; // the capture ended the war (the last region of the last enemy)
      }
    }
    if (!s.wars.includes(w)) continue;
    // --- 3b. drama: armies at the gates, casualty milestones
    for (const fr of w.fronts) {
      const E = s.countries[s.owner[fr.prov]];
      if (!fr.gates && E && fr.prov === E.capital && fr.progress > 0.55) {
        fr.gates = true;
        if (s.tick - (s.stats[`gates:${E.id}`] ?? -999) < 78) continue;
        s.stats[`gates:${E.id}`] = s.tick;
        logEvent(s, `🔥 ${s.countries[fr.by].name}'s army is at the gates of ${geo.provinces[fr.prov].name || E.name + "'s capital"}!`, 'war', [fr.by, E.id], true, { big: true, prov: fr.prov });
      }
    }
    {
      const total = Object.values(w.casualties).reduce((t, x) => t + x, 0);
      let m = w.mile ?? -1;
      while (m + 1 < MILESTONES.length && total >= MILESTONES[m + 1]) m++;
      if (m !== (w.mile ?? -1)) {
        w.mile = m;
        const involved = [...w.attackers, ...w.defenders];
        const mine = involved.includes(s.player);
        logEvent(s, `☠ The ${w.name} has now cost ${fmtCas(MILESTONES[m])} lives.`, 'danger', involved.slice(0, 3), mine || m >= 3, m >= 3 || (mine && m >= 2) ? { big: true, prov: s.countries[w.defenders[0]]?.capital } : undefined);
      }
    }
    // --- 4. unattended fronts decay
    w.fronts = w.fronts.filter((fr) => {
      // a front decays when its own attacker stops pushing there (it used to be kept alive by anyone attacking the province)
      if (strikes.get(fr.prov)?.some((st) => st.c.id === fr.by)) return true;
      if (fr.born !== undefined && s.tick - fr.born < 3) return true; // a breakthrough's head start lasts a few weeks
      if (warSideOf(w, fr.by) < 0) return false;
      fr.progress -= 0.06; // ground won is lost slowly once the attack moves elsewhere
      return fr.progress > 0;
    });
    // --- 5. strategic air / sea war between belligerents
    for (const a of w.attackers) for (const d of w.defenders) {
      const A = s.countries[a], D = s.countries[d];
      if (!A.alive || !D.alive) continue;
      for (const [X, Y] of [[A, D], [D, A]] as [Country, Country][]) {
        const air = airSuperiority(X, Y);
        if (air > 0.2) {
          Y.eco.infra = Math.max(5, Y.eco.infra - 0.12 * air);
          Y.eco.damage = Math.min(1, Y.eco.damage + 0.0015 * air);
          Y.mil.equipAir *= 1 - 0.0015 * air;
        }
        const nav = navalSuperiority(X, Y);
        if (nav > 0.15 && isCoastalCountry(s, geo, Y) && isCoastalCountry(s, geo, X)) blockade.set(Y.id, Math.min(0.7, (blockade.get(Y.id) ?? 0) + 0.35 * nav));
      }
      A.mil.equipAir *= 0.9995; D.mil.equipAir *= 0.9995;
      A.mil.equipNavy *= 0.9996; D.mil.equipNavy *= 0.9996;
    }
    // --- 6. exhaustion from the economic cost of fighting
    for (const cid of [...w.attackers, ...w.defenders]) {
      const c = s.countries[cid];
      if (!c.alive || tired.has(cid)) continue;
      tired.add(cid);
      const tol = ({ D: 1.5, F: 1.1, A: 0.8, C: 0.7, M: 0.9 } as Record<string, number>)[c.gov] ?? 1;
      c.mil.exhaustion = clamp(c.mil.exhaustion + (0.0007 + 0.04 * c.eco.damage / 52 + 0.002 * c.eco.occupation) * tol, 0, 1);
    }
  }
  for (const c of s.countries) c.eco.blockade = blockade.get(c.id) ?? 0;
  stepWarSupport(s, geo);
  // integration of conquered land: see occupation.ts
}

/** Encirclements: regions cut off from every supply hub bleed troops; new pockets make the news. */
function stepPockets(s: GameState, geo: Geo) {
  const seen = new Set<CountryId>();
  for (const w of s.wars) for (const cid of [...w.attackers, ...w.defenders]) {
    if (seen.has(cid)) continue;
    seen.add(cid);
    const c = s.countries[cid];
    if (!c.alive) continue;
    ensureGenerals(s, c);
    assignGenerals(s, c);
    const net = supplyNet(s, geo, cid);
    const n = net.pocket.length;
    const before = c.mil.pocket ?? 0;
    c.mil.pocket = n;
    if (!n) continue;
    // troops in the pocket run short of food, fuel and ammunition
    const totalW = c.provinces.reduce((t, q) => t + geo.provinces[q].w, 0) || 1;
    const share = net.pocket.reduce((t, q) => t + geo.provinces[q].w, 0) / totalW;
    const loss = c.mil.troops * 0.004 * Math.min(0.5, share);
    // each pocket's losses go to the war whose enemy holds the ring around it (they all used to go to the first war
    // the country was in, whoever had cut it off)
    const nbs = neighbours(geo);
    const ringOf = (q: ProvId) => warsOf(s, cid).find((x) => nbs[q].some((o) => { const own = s.owner[o]; return own !== cid && warSideOf(x, own) >= 0 && warSideOf(x, own) !== warSideOf(x, cid); })) ?? w;
    const byWar = new Map<War, number>();
    for (const q of net.pocket) byWar.set(ringOf(q), (byWar.get(ringOf(q)) ?? 0) + geo.provinces[q].w);
    const pw = [...byWar.values()].reduce((t, x) => t + x, 0) || 1;
    if (loss > 1) {
      c.mil.troops -= loss; c.mil.casualties += loss;
      for (const [x, wt] of byWar) x.casualties[cid] = (x.casualties[cid] ?? 0) + loss * wt / pw;
    }
    if (n > before && (before === 0 || n >= before + 2) && s.tick - (s.stats[`pocket:${cid}`] ?? -999) > 12) {
      s.stats[`pocket:${cid}`] = s.tick;
      const p = net.pocket[0];
      const name = geo.provinces[p].name || c.name;
      const wp = ringOf(p);
      const side = warSideOf(wp, cid);
      const foe = nbs[p].map((q) => s.owner[q]).find((o) => o !== cid && warSideOf(wp, o) >= 0 && warSideOf(wp, o) !== side);
      const enemy = foe ?? cid;
      const involved = cid === s.player || enemy === s.player;
      logEvent(s, `⭕ ENCIRCLED: ${c.name}'s forces ${n === 1 ? `in ${name}` : `in ${n} regions around ${name}`} are cut off from supplies${enemy !== cid ? ` by ${s.countries[enemy].name}` : ''} and fight at half strength.`, 'war', [cid, enemy], involved, involved ? { big: cid === s.player, prov: p } : { prov: p });
      if (enemy !== cid) { bumpSupport(s.countries[enemy], 0.02); bumpSupport(c, -0.03); }
    }
  }
}

function applyLosses(s: GameState, c: Country, loss: number, w: War, popShare: number) {
  if (loss <= 0) return;
  const frac = loss / Math.max(1, c.mil.troops);
  c.mil.troops = Math.max(0, c.mil.troops - loss);
  c.mil.equipArmy *= 1 - frac * 0.8;
  c.mil.casualties += loss;
  c.eco.pop = Math.max(1, c.eco.pop - loss * popShare * 0.3);
  w.casualties[c.id] = (w.casualties[c.id] ?? 0) + loss;
  (w.civ ??= {})[c.id] = (w.civ[c.id] ?? 0) + loss * popShare * 0.3;
  const tol = ({ D: 1.5, F: 1.1, A: 0.8, C: 0.7, M: 0.9 } as Record<string, number>)[c.gov] ?? 1;
  c.mil.exhaustion = clamp(c.mil.exhaustion + frac * 0.6 * tol, 0, 1);
  c.mil.readiness = clamp(c.mil.readiness - frac * 0.5, 0.05, 1);
  void s;
}

/** Ask allies to join one of your wars. Returns the countries that agreed. */
export function callAllies(s: GameState, cid: CountryId): CountryId[] {
  const joined: CountryId[] = [];
  for (const w of s.wars) {
    const side = warSideOf(w, cid);
    if (side < 0) continue;
    const mine = side === 0 ? w.attackers : w.defenders;
    const theirs = side === 0 ? w.defenders : w.attackers;
    for (const x of alliesOf(s, cid)) {
      if (mine.includes(x) || theirs.includes(x) || x === s.player) continue;
      const X = s.countries[x];
      let p = 0.35 + 0.004 * getRelation(s, x, cid) + (getRelation(s, x, theirs[0]) < -20 ? 0.2 : 0) - 0.2 * X.ai.caution - (warsOf(s, x).length ? 0.25 : 0);
      if (strength(s.countries[theirs[0]]) > 2 * strength(X) + strength(s.countries[cid])) p -= 0.2;
      if (nextRand(s) < clamp(p, 0.05, 0.9)) {
        mine.push(x);
        w.startProvs[x] = X.provinces.length;
        onEnterWar(s, X, 'ally');
        addRelation(s, x, theirs[0], -20);
        joined.push(x);
        logEvent(s, `${X.name} answers ${s.countries[cid].name}'s call and joins the ${w.name}.`, 'war', [x, cid], true);
      } else logEvent(s, `${X.name} declined ${s.countries[cid].name}'s call to arms.`, 'diplo', [x, cid]);
    }
  }
  return joined;
}
