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
import type { Geo } from './geo';
import { nextRand } from './rng';
import { clamp } from './util';
import { CLAIMS } from '../data/countryData';
import {
  addRelation, alliesOf, areAtWar, getRelation, hasAlliance, NAME_TO_ID, touchTreaties, pairKey, warBetween, warSideOf, warsOf,
} from './relations';
import { potentialOutput } from './economy';
import { airPower, landPower, navalPower, strength } from './military';
import type { CountryId, Country, GameState, LogKind, ProvId, War } from './types';

import { logEvent } from './log';
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
export function transferProvince(s: GameState, geo: Geo, p: ProvId, to: CountryId): number {
  const from = s.owner[p];
  if (from === to) return 0;
  const A = s.countries[from], B = s.countries[to];
  const totalW = A.provinces.reduce((t, q) => t + geo.provinces[q].w, 0) || 1;
  const f = Math.min(1, geo.provinces[p].w / totalW);
  for (const k of SHARED_KEYS) {
    const amt = (A.eco[k] as number) * f;
    (A.eco[k] as number) -= amt;
    (B.eco[k] as number) += amt * (k === 'capital' ? 0.8 : 1);
  }
  // keep output continuous across the transfer: recalibrate each side's productivity coefficient
  for (const X of [A, B]) {
    if (X.provinces.length === 0 && X === A) continue;
    const pot = potentialOutput(X, s.market.priceE);
    if (pot > 0 && X.eco.realGdp > 0) X.eco.tfp *= X.eco.realGdp / pot;
    X.eco.gdp = X.eco.realGdp * X.eco.price;
  }
  A.provinces = A.provinces.filter((q) => q !== p);
  B.provinces.push(p);
  s.owner[p] = to;
  s.integ[p] = s.core[p] === to ? 1 : 0;
  for (const w of s.wars) w.fronts = w.fronts.filter((fr) => fr.prov !== p);
  for (const c of [A, B]) c.mil.focus = c.mil.focus.filter((q) => s.owner[q] !== c.id);
  if (A.provinces.length === 0) eliminateCountry(s, A, to);
  else if (p === A.capital) {
    A.capital = A.provinces.reduce((best, q) => (geo.provinces[q].w > geo.provinces[best].w ? q : best), A.provinces[0]);
    A.eco.stability = Math.max(0, A.eco.stability - 12);
    A.mil.exhaustion = Math.min(1, A.mil.exhaustion + 0.2);
    logEvent(s, `${A.name} lost its capital region; the government relocated.`, 'war', [A.id, to], true);
  }
  return f;
}

function eliminateCountry(s: GameState, c: Country, by: CountryId) {
  c.alive = false;
  c.eco.pop = 0;
  logEvent(s, `${c.name} has been annexed by ${s.countries[by].name} and no longer exists.`, 'territory', [c.id, by], true);
  for (const w of [...s.wars]) {
    w.attackers = w.attackers.filter((x) => x !== c.id);
    w.defenders = w.defenders.filter((x) => x !== c.id);
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

export function declareWar(s: GameState, geo: Geo, a: CountryId, d: CountryId): DeclareResult {
  const chk = canDeclareWar(s, a, d);
  if (!chk.ok) return chk;
  const A = s.countries[a], D = s.countries[d];
  const justified = claimStrength(a, d) > 0.3 || getRelation(s, a, d) < -60;
  let severity = justified ? 2 : 7;
  const treaty = s.treaties[pairKey(a, d)];
  if (treaty?.nap) { severity += 6; A.reputation = Math.max(0, A.reputation - 10); logEvent(s, `${A.name} broke its non-aggression pact with ${D.name}.`, 'diplo', [a, d], true); }
  if (treaty?.alliance) { severity += 4; }
  if (treaty) { treaty.alliance = false; treaty.nap = false; treaty.trade = false; treaty.coop = false; touchTreaties(s); }
  const war: War = {
    id: s.nextWarId++, name: `${A.name}–${D.name} War`, attackers: [a], defenders: [d], start: s.tick, fronts: [], casualties: {}, gained: {}, lost: {},
    startProvs: { [a]: A.provinces.length, [d]: D.provinces.length },
  };
  s.wars.push(war);
  A.lastWarDecl = s.tick;
  addRelation(s, a, d, -40);
  aggressionFallout(s, a, d, severity);
  logEvent(s, `${A.name} declared war on ${D.name}!`, 'war', [a, d], true);

  // alliance calls
  if (s.settings.defensiveAlliances) {
    for (const x of alliesOf(s, d)) {
      if (x === a || hasAlliance(s, x, a)) continue;
      const X = s.countries[x];
      if (x === s.player || joinsDefense(s, x, d, a)) {
        war.defenders.push(x);
        war.startProvs[x] = X.provinces.length;
        addRelation(s, x, a, -25);
        logEvent(s, `${X.name} honours its alliance and joins the war on ${D.name}'s side.`, 'war', [x, d], x === s.player || d === s.player);
      } else {
        X.reputation = Math.max(0, X.reputation - 4);
        logEvent(s, `${X.name} declined to defend its ally ${D.name}.`, 'diplo', [x, d]);
      }
    }
    for (const x of alliesOf(s, a)) {
      if (x === d || war.attackers.includes(x) || war.defenders.includes(x) || x === s.player) continue;
      const X = s.countries[x];
      if (X.ai.aggression > 0.4 && getRelation(s, x, d) < -45 && nextRand(s) < 0.3) {
        war.attackers.push(x);
        war.startProvs[x] = X.provinces.length;
        logEvent(s, `${X.name} joins ${A.name}'s war against ${D.name}.`, 'war', [x, a, d]);
      }
    }
  }
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
export interface PeaceTerms { kind: PeaceKind; share?: number }

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
    const n = Math.max(1, Math.round((t.share ?? 0.2) * donor.provinces.length));
    return { from: b, to: a, provs: ranked.slice(0, Math.min(n, donor.provinces.length - 1 || 1)) };
  }
  if (t.kind === 'concede') {
    const donor = s.countries[a];
    const theirs = new Set(s.countries[b].provinces);
    const ranked = [...donor.provinces].filter((p) => p !== donor.capital).sort((p, q) => {
      const near = (x: number) => geo.adj[x].some((n) => theirs.has(n)) ? 0 : 1;
      return near(p) - near(q) || geo.provinces[p].w - geo.provinces[q].w;
    });
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
  const capitalLost = B.provinces.length > 0 && !B.provinces.includes(B.capital);
  const reasons: string[] = [];
  let will = 0.9 * B.mil.exhaustion; reasons.push(`War exhaustion ${(B.mil.exhaustion * 100).toFixed(0)}%`);
  will += 0.5 * -score; if (score < 0) reasons.push('Losing the war'); else if (score > 0.2) reasons.push('Winning the war');
  will += 0.2 * Math.min(1, years / 3);
  if (capitalLost) will += 0.35;
  if (B.eco.stability < 25) { will += 0.3; reasons.push('Domestic unrest'); }
  will -= 0.25 * B.ai.aggression;
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
  if (b === s.player) required = Infinity;
  return { accept: will >= required, willingness: will, required, reasons };
}

/** Execute a peace treaty between principals a and b. */
export function makePeace(s: GameState, geo: Geo, a: CountryId, b: CountryId, t: PeaceTerms) {
  const w = warBetween(s, a, b);
  if (!w) return;
  const A = s.countries[a], B = s.countries[b];
  if (t.kind === 'restore') {
    for (const p of [...A.provinces, ...B.provinces]) {
      const core = s.core[p];
      if (s.owner[p] !== core && s.countries[core].alive && (warSideOf(w, core) >= 0) && (s.owner[p] === a || s.owner[p] === b)) transferProvince(s, geo, p, core);
    }
  }
  const tp = termProvinces(s, geo, a, b, t);
  if (tp) for (const p of tp.provs) if (s.owner[p] === tp.from) transferProvince(s, geo, p, tp.to);
  const lbl = ({ status_quo: 'ceasefire on current lines', restore: 'a return to pre-war borders', demand: 'territorial concessions', concede: 'concessions by the sender', surrender: 'total surrender' } as const)[t.kind];
  logEvent(s, `${A.name} and ${B.name} signed peace (${lbl}).`, 'peace', [a, b], a === s.player || b === s.player);
  w.attackers = w.attackers.filter((x) => x !== a && x !== b);
  w.defenders = w.defenders.filter((x) => x !== a && x !== b);
  if (!w.attackers.length || !w.defenders.length) {
    logEvent(s, `The ${w.name} has ended.`, 'peace', [a, b]);
    endWar(s, w);
  }
  A.mil.exhaustion *= 0.8; B.mil.exhaustion *= 0.8;
  addRelation(s, a, b, 10);
  const tr = s.treaties[pairKey(a, b)];
  if (tr && !tr.nap) tr.nap = false;
  A.mil.focus = []; B.mil.focus = [];
}

export function forcePeaceAll(s: GameState, geo: Geo, c: CountryId) {
  for (const w of [...warsOf(s, c)]) {
    const side = warSideOf(w, c);
    for (const e of [...(side === 0 ? w.defenders : w.attackers)]) {
      if (warBetween(s, c, e)) makePeace(s, geo, c, e, { kind: 'status_quo' });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------------------------
const wr = (s: GameState, c: CountryId) => Math.pow(Math.max(1, warsOf(s, c).length), 0.7);

function competence(s: GameState, c: Country): number {
  if (c.isPlayer) return 1;
  return s.settings.difficulty === 'hard' ? 1.1 : s.settings.difficulty === 'easy' ? 0.92 : 1;
}

interface Candidate { prov: ProvId; amphibious: boolean; supply: number; score: number }

function supplyReach(c: Country): number {
  return 55 * (0.6 + 0.8 * (0.5 * c.eco.infra / 100 + 0.5 * c.eco.tech / 100));
}
function seaReach(c: Country): number {
  const np = navalPower(c.mil);
  if (np < 5e8) return 0;
  return 25 + 80 * clamp(Math.sqrt(np / 1e12), 0, 1);
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
  const base: ProvId[] = mineProvs.filter((p) => s.integ[p] >= 0.35 || s.core[p] === s.owner[p]);
  const out = new Map<ProvId, Candidate>();
  const reach = supplyReach(c);
  for (const p of mineProvs) {
    for (const q of geo.adj[p]) {
      if (!enemies.has(s.owner[q])) continue;
      let dmin = Infinity;
      for (const b of base) { const d = geo.dist(b, q); if (d < dmin) dmin = d; }
      const supply = clamp(1.1 - Math.pow(dmin / reach, 1.3) * 0.55, 0.3, 1);
      const imp = geo.provinces[q].w * (q === s.countries[s.owner[q]].capital ? 3 : 1) + 0.3;
      out.set(q, { prov: q, amphibious: false, supply, score: (imp * supply) / (1 + 0.6 * geo.provinces[q].terrain) });
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
        const supply = clamp(0.8 - 0.5 * (dmin / sr), 0.3, 0.8) * (0.8 + 0.2 * Math.max(0, sup));
        const imp = geo.provinces[q].w * (q === E.capital ? 3 : 1) + 0.3;
        out.set(q, { prov: q, amphibious: true, supply, score: (imp * supply * 0.7) / (1 + 0.6 * geo.provinces[q].terrain) });
      }
    }
  }
  return [...out.values()];
}

interface Strike { c: Country; supply: number; amphibious: boolean; share: number }

export function stepWars(s: GameState, geo: Geo) {
  for (const c of s.countries) c.eco.blockade = 0;
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
        const nTargets = clamp(Math.floor(Math.sqrt(off / 50000)), 1, 4);
        let chosen: Candidate[];
        if (c.isPlayer && !c.mil.autoAdvance) {
          const focus = new Set(c.mil.focus);
          chosen = cands.filter((x) => focus.has(x.prov)).slice(0, nTargets);
        } else {
          const existing = new Set(w.fronts.filter((f) => f.by === cid).map((f) => f.prov));
          chosen = cands.map((x) => ({ ...x, score: x.score + (existing.has(x.prov) ? 1.2 : 0) + (c.isPlayer && c.mil.focus.includes(x.prov) ? 2 : 0) }))
            .sort((a, b) => b.score - a.score).slice(0, nTargets);
        }
        for (const ch of chosen) {
          const list = strikes.get(ch.prov) ?? [];
          list.push({ c, supply: ch.supply, amphibious: ch.amphibious, share: off / chosen.length });
          strikes.set(ch.prov, list);
          if (!w.fronts.some((f) => f.prov === ch.prov && f.by === cid)) w.fronts.push({ prov: ch.prov, by: cid, progress: 0, amphibious: ch.amphibious });
        }
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

    // --- 3. resolve each battle
    for (const [p, list] of strikes) {
      const e = s.owner[p];
      const E = s.countries[e];
      if (!E.alive) continue;
      const tp = threatened.get(e)!;
      const sumImp = tp.reduce((t, q) => t + imp(q, e), 0);
      const sumDef = tp.reduce((t, q) => t + defW(q, e), 0);
      const defTroops = (E.mil.troops * (1 - 0.6 * E.mil.commit) * E.mil.readiness / wr(s, e)) * (defW(p, e) / sumDef) * (1 + 0.25 * E.eco.infra / 100);
      const terrain = geo.provinces[p].terrain;
      const fort = 1.15 + 0.2 * (E.eco.infra / 100) + (p === E.capital ? 0.25 : 0);
      const Pd = Math.max(1, landPower(E.mil, defTroops) * fort * (1 + 0.9 * terrain) * competence(s, E));
      let Pa = 0;
      const contrib: { st: Strike; pa: number; air: number }[] = [];
      for (const st of list) {
        const C = st.c;
        const air = airSuperiority(C, E);
        const intel = 1 + 0.2 * (C.mil.intel - E.mil.intel);
        const pa = landPower(C.mil, st.share) * st.supply * (1 + 0.18 * air) * intel * (st.amphibious ? 0.55 + 0.3 * Math.max(0, navalSuperiority(C, E)) : 1) * competence(s, C);
        contrib.push({ st, pa, air });
        Pa += pa;
      }
      if (Pa <= 0) continue;
      const noise = 1 + (nextRand(s) - 0.5) * 0.16;
      const ratio = (Pa * noise) / Pd;
      const sizeScale = Math.pow(140 / Math.max(60, geo.provinces[p].area), 0.35);
      const nuclearBrake = E.mil.nuclear ? contrib.reduce((t, x) => t + (x.st.c.mil.nuclear ? 0.85 : 0.45) * x.pa, 0) / Pa : 1; // fear of escalation limits advances on nuclear powers
      const amph = contrib.every((x) => x.st.amphibious) ? 0.7 : 1;
      const raw = 0.055 * clamp(Math.log(ratio) + 0.25, -1.2, 1.6) * sizeScale;
      const delta = (raw > 0 ? Math.min(raw, 0.045) * nuclearBrake : raw) * (raw > 0 ? amph : 1);
      // casualties
      const defShare = defTroops;
      const defLossFrac = 0.0065 * Math.pow(clamp(ratio, 0.3, 3), 0.5) * (1 + 0.2 * Math.max(0, contrib[0].air));
      const defLoss = Math.min(E.mil.troops * 0.5, defShare * defLossFrac);
      applyLosses(s, E, defLoss, w, 0.7);
      for (const { st, pa } of contrib) {
        const frac = pa / Pa;
        const atkLossFrac = 0.0075 * Math.pow(clamp(1 / ratio, 0.3, 3), 0.5) * (0.7 + 0.6 * terrain);
        applyLosses(s, st.c, Math.min(st.c.mil.troops * 0.5, st.share * atkLossFrac), w, 1);
        void frac;
      }
      E.eco.damage = Math.min(1, E.eco.damage + 0.0025 * (imp(p, e) / sumImp) * Math.min(2, ratio));
      for (const { st } of contrib) {
        let front = w.fronts.find((f) => f.prov === p && f.by === st.c.id);
        if (front) { front.atk = Math.round(st.share); front.def = Math.round(defTroops); }
        if (!front) { front = { prov: p, by: st.c.id, progress: 0, amphibious: st.amphibious }; w.fronts.push(front); }
        front.progress = clamp(front.progress + delta * (contrib.length > 1 ? 1.1 : 1) * ((contrib.find((x) => x.st === st)!.pa) / Pa) * contrib.length, 0, 1.2);
      }
      const best = w.fronts.filter((f) => f.prov === p).sort((a, b) => b.progress - a.progress)[0];
      if (best && best.progress >= 1) {
        const winner = best.by;
        const f = transferProvince(s, geo, p, winner);
        w.gained[winner] = (w.gained[winner] ?? 0) + f;
        w.lost[e] = (w.lost[e] ?? 0) + f;
        const W = s.countries[winner];
        const name = geo.provinces[p].name || `a region of ${s.countries[s.core[p]].name}`;
        E.mil.exhaustion = Math.min(1, E.mil.exhaustion + 0.1 * f * 6);
        logEvent(s, `${W.name} captured ${name} from ${E.name}.`, 'territory', [winner, e], winner === s.player || e === s.player);
      }
    }
    // --- 4. unattended fronts decay
    w.fronts = w.fronts.filter((fr) => {
      if (strikes.has(fr.prov)) return true;
      fr.progress -= 0.15;
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
        if (nav > 0.15 && isCoastalCountry(s, geo, Y) && isCoastalCountry(s, geo, X)) Y.eco.blockade = Math.min(0.7, Y.eco.blockade + 0.35 * nav);
      }
      A.mil.equipAir *= 0.9995; D.mil.equipAir *= 0.9995;
      A.mil.equipNavy *= 0.9996; D.mil.equipNavy *= 0.9996;
    }
    // --- 6. exhaustion from the economic cost of fighting
    for (const cid of [...w.attackers, ...w.defenders]) {
      const c = s.countries[cid];
      if (!c.alive) continue;
      const tol = ({ D: 1.5, F: 1.1, A: 0.8, C: 0.7, M: 0.9 } as Record<string, number>)[c.gov] ?? 1;
      c.mil.exhaustion = clamp(c.mil.exhaustion + (0.0007 + 0.04 * c.eco.damage / 52 + 0.002 * c.eco.occupation) * tol, 0, 1);
    }
  }
  // integration of conquered land
  for (let p = 0; p < s.owner.length; p++) if (s.integ[p] < 1) s.integ[p] = Math.min(1, s.integ[p] + 0.004);
}

function applyLosses(s: GameState, c: Country, loss: number, w: War, popShare: number) {
  if (loss <= 0) return;
  const frac = loss / Math.max(1, c.mil.troops);
  c.mil.troops = Math.max(0, c.mil.troops - loss);
  c.mil.equipArmy *= 1 - frac * 0.8;
  c.mil.casualties += loss;
  c.eco.pop = Math.max(1, c.eco.pop - loss * popShare * 0.3);
  w.casualties[c.id] = (w.casualties[c.id] ?? 0) + loss;
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
        addRelation(s, x, theirs[0], -20);
        joined.push(x);
        logEvent(s, `${X.name} answers ${s.countries[cid].name}'s call and joins the ${w.name}.`, 'war', [x, cid], true);
      } else logEvent(s, `${X.name} declined ${s.countries[cid].name}'s call to arms.`, 'diplo', [x, cid]);
    }
  }
  return joined;
}
