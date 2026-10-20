/** Treaties, relations and war-status queries. No economy / AI imports (keeps the module graph acyclic). */
import {
  ARAB_LEAGUE, COUNTRY_BASE, CSTO, EAST_PARTNERS, EU, NATO, RIVALRIES, WEST_PARTNERS,
} from '../data/countryData';
import { hash01 } from './rng';
import { clamp } from './util';
import type { CountryId, GameState, Treaty, War } from './types';

export const NAME_TO_ID: Record<string, number> = {};
COUNTRY_BASE.forEach((c, i) => { NAME_TO_ID[c.name] = i; });
export const N_COUNTRIES = COUNTRY_BASE.length;
const idSet = (names: string[]) => new Set(names.map((n) => NAME_TO_ID[n]).filter((x) => x !== undefined));
const S_NATO = idSet(NATO), S_EU = idSet(EU), S_CSTO = idSet(CSTO), S_ARAB = idSet(ARAB_LEAGUE);
const S_WEST = idSet([...NATO, ...EU, ...WEST_PARTNERS]);
const S_EAST = idSet(EAST_PARTNERS);
const ADV: Record<number, number> = {};
for (const [n, v] of Object.entries({ Russia: -28, 'North Korea': -30, Iran: -30, China: -10, Syria: -15, Belarus: -18, Venezuela: -8, Cuba: -5 })) if (NAME_TO_ID[n] !== undefined) ADV[NAME_TO_ID[n]] = v;
const RIV = new Map<number, number>();
for (const [a, b, v] of RIVALRIES) {
  const ia = NAME_TO_ID[a], ib = NAME_TO_ID[b];
  if (ia === undefined || ib === undefined) throw new Error(`Unknown rivalry country ${a}/${b}`);
  RIV.set(Math.min(ia, ib) * 1000 + Math.max(ia, ib), v);
}

const KEYS: string[] = new Array(N_COUNTRIES * N_COUNTRIES);
/** "lo-hi" key of a country pair (cached: it is looked up hundreds of thousands of times a year) */
export const pairKey = (a: number, b: number) => {
  const lo = a < b ? a : b, hi = a < b ? b : a;
  if (hi >= N_COUNTRIES || lo < 0) return `${lo}-${hi}`;
  const i = lo * N_COUNTRIES + hi;
  return KEYS[i] ?? (KEYS[i] = `${lo}-${hi}`);
};

const PAIRS = new Map<string, [number, number]>();
/** the two country ids of a "lo-hi" pair key (cached; treaty tables are walked every week) */
export const pairOf = (k: string): [number, number] => {
  let v = PAIRS.get(k);
  if (!v) { const i = k.indexOf('-'); v = [Number(k.slice(0, i)), Number(k.slice(i + 1))]; PAIRS.set(k, v); }
  return v;
};

export function getTreaty(s: GameState, a: CountryId, b: CountryId): Treaty | undefined {
  return s.treaties[pairKey(a, b)];
}
export function ensureTreaty(s: GameState, a: CountryId, b: CountryId): Treaty {
  const k = pairKey(a, b);
  touchTreaties(s);
  return (s.treaties[k] ??= { trade: false, nap: false, alliance: false, coop: false, sAB: 0, sBA: 0 });
}
/** sanction level a imposes on b: 0 none, 1 sanction, 2 embargo */
export function sanctionLevel(s: GameState, a: CountryId, b: CountryId): number {
  const t = getTreaty(s, a, b);
  if (!t) return 0;
  return a < b ? t.sAB : t.sBA;
}
export function setSanction(s: GameState, from: CountryId, to: CountryId, level: number) {
  const t = ensureTreaty(s, from, to);
  if (from < to) t.sAB = level; else t.sBA = level;
}
export const hasTrade = (s: GameState, a: CountryId, b: CountryId) => !!getTreaty(s, a, b)?.trade;
export const hasAlliance = (s: GameState, a: CountryId, b: CountryId) => !!getTreaty(s, a, b)?.alliance;
export const hasNap = (s: GameState, a: CountryId, b: CountryId) => !!getTreaty(s, a, b)?.nap;
export const hasCoop = (s: GameState, a: CountryId, b: CountryId) => !!getTreaty(s, a, b)?.coop;

// ---------------------------------------------------------------------------------------------------------------
// Relations = what never changes (geography, old rivalries, chemistry)
//           + what the world is like now (camps, organisations, forms of government) — all of it state that moves
//           + long memory (decades) + recent memory (months) + treaties − war.
// At the start this reproduces the 2024 picture exactly; after that, nothing about the blocs is fixed.

/** Starting orientation: the 2024 Western camp +1, the Eastern camp −1, everyone else 0. */
export function initialOrient(id: CountryId): number { return S_WEST.has(id) ? 1 : S_EAST.has(id) ? -1 : 0; }
/** Starting hostility: how far the West treats a country as an adversary in 2024 (0..1). */
export function initialHostile(id: CountryId): number { return ADV[id] !== undefined ? -ADV[id] / 30 : 0; }
export const orientOf = (s: GameState, id: CountryId) => s.countries[id]?.orient ?? initialOrient(id);
export const hostileOf = (s: GameState, id: CountryId) => s.countries[id]?.hostile ?? initialHostile(id);

const staticCache = new Float64Array(N_COUNTRIES * N_COUNTRIES).fill(-999);
/** The part of a relationship that does not change: neighbourhood, historic rivalries and friendships, chemistry. */
export function staticRelation(a: CountryId, b: CountryId): number {
  if (a === b) return 100;
  if (a >= N_COUNTRIES || b >= N_COUNTRIES) return 0;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const idx = lo * N_COUNTRIES + hi;
  if (staticCache[idx] > -900) return staticCache[idx];
  const A = COUNTRY_BASE[lo], B = COUNTRY_BASE[hi];
  let r = 0;
  if (A.region === B.region) r += 8;
  r += RIV.get(lo * 1000 + hi) ?? 0;
  r += (hash01('rel', lo, hi) - 0.5) * 18;
  staticCache[idx] = r;
  return staticCache[idx];
}

/** Camps: same side warms, opposite sides chill, and the West's adversaries are treated as such. */
export function campRelation(s: GameState, a: CountryId, b: CountryId): number {
  const A = s.countries[a], B = s.countries[b];
  const oa = A?.orient ?? initialOrient(a), ob = B?.orient ?? initialOrient(b);
  const m = Math.min(oa < 0 ? -oa : oa, ob < 0 ? -ob : ob);
  let r = oa * ob > 0 ? 14 * m : oa * ob < 0 ? -14 * m : 0;
  if (ob > 0) r -= 30 * (A?.hostile ?? initialHostile(a)) * ob;
  if (oa > 0) r -= 30 * (B?.hostile ?? initialHostile(b)) * oa;
  return r;
}
/** Forms of government: democracies trust each other. */
export function govRelation(s: GameState, a: CountryId, b: CountryId): number {
  const ga = s.countries[a]?.gov ?? COUNTRY_BASE[a].gov, gb = s.countries[b]?.gov ?? COUNTRY_BASE[b].gov;
  const theo = (x: CountryId) => !!s.countries[x]?.politics?.laws.some((l) => l.id === 'clerics');
  // democracies distrust a theocracy (only the player has laws, so only the player's pairs need the check)
  const t = (a === s.player || b === s.player) && ((theo(a) && gb === 'D') || (theo(b) && ga === 'D')) ? -6 : 0;
  return (ga === 'D' && gb === 'D' ? 10 : (ga === 'D') !== (gb === 'D') ? -3 : 0) + t;
}

// organisation membership as one bit per organisation, rebuilt when membership changes
let orgCache: { st: GameState; ver: number; masks: Int32Array; bonus: number[] } | null = null;
function orgMasks(s: GameState) {
  const ver = s.orgVer ?? 0;
  if (orgCache && orgCache.st === s && orgCache.ver === ver) return orgCache;
  const masks = new Int32Array(N_COUNTRIES), bonus: number[] = [];
  (s.orgs ?? []).slice(0, 31).forEach((o, i) => { bonus[i] = o.bonus; for (const m of o.members) if (m < N_COUNTRIES) masks[m] |= 1 << i; });
  orgCache = { st: s, ver, masks, bonus };
  return orgCache;
}
/** Shared organisations (NATO, the EU, the CSTO ... and any founded later). */
export function orgRelation(s: GameState, a: CountryId, b: CountryId): number {
  if (!s.orgs?.length || a >= N_COUNTRIES || b >= N_COUNTRIES) return 0;
  const M = orgMasks(s);
  let both = M.masks[a] & M.masks[b], r = 0, i = 0;
  while (both) { if (both & 1) r += M.bonus[i]; both >>>= 1; i++; }
  return r;
}
export const orgsOf = (s: GameState, id: CountryId) => (s.orgs ?? []).filter((o) => o.members.includes(id));
export const touchOrgs = (s: GameState) => { s.orgVer = (s.orgVer ?? 0) + 1; };

/** Everything except treaties, war and recent memory: what the relationship is "made of" today. */
export function baseRelation(a: CountryId, b: CountryId, s?: GameState): number {
  if (a === b) return 100;
  const st = staticRelation(a, b);
  if (!s) return st;
  const k = pairKey(a, b);
  return clamp(st + campRelation(s, a, b) + govRelation(s, a, b) + orgRelation(s, a, b) + (s.relHist?.[k] ?? 0), -100, 100);
}

export function treatyBonus(t: Treaty | undefined): number {
  if (!t) return 0;
  let r = 0;
  if (t.alliance) r += 30;
  if (t.coop) r += 16;
  if (t.trade) r += 10;
  if (t.nap) r += 6;
  r -= t.sAB === 2 ? 30 : t.sAB === 1 ? 16 : 0;
  r -= t.sBA === 2 ? 30 : t.sBA === 1 ? 16 : 0;
  return r;
}

export function getRelation(s: GameState, a: CountryId, b: CountryId): number {
  if (a === b) return 100;
  const k = pairKey(a, b);
  return clamp(staticRelation(a, b) + campRelation(s, a, b) + govRelation(s, a, b) + orgRelation(s, a, b) + (s.relHist?.[k] ?? 0) + (s.relDelta[k] ?? 0) + treatyBonus(s.treaties[k]) - (areAtWar(s, a, b) ? 60 : 0), -100, 100);
}
export function addRelation(s: GameState, a: CountryId, b: CountryId, d: number) {
  const k = pairKey(a, b);
  s.relDelta[k] = clamp((s.relDelta[k] ?? 0) + d, -80, 80);
}

// ---- wars ----
export const warSideOf = (w: War, c: CountryId): 0 | 1 | -1 => (w.attackers.includes(c) ? 0 : w.defenders.includes(c) ? 1 : -1);
export function warBetween(s: GameState, a: CountryId, b: CountryId): War | undefined {
  for (const w of s.wars) {
    const sa = warSideOf(w, a), sb = warSideOf(w, b);
    if (sa >= 0 && sb >= 0 && sa !== sb) return w;
  }
  return undefined;
}
export const areAtWar = (s: GameState, a: CountryId, b: CountryId) => !!warBetween(s, a, b);
export function warsOf(s: GameState, c: CountryId): War[] {
  return s.wars.filter((w) => warSideOf(w, c) >= 0);
}
export const isAtWar = (s: GameState, c: CountryId) => s.wars.some((w) => warSideOf(w, c) >= 0);
export function enemiesOf(s: GameState, c: CountryId): CountryId[] {
  const out = new Set<number>();
  for (const w of s.wars) {
    const side = warSideOf(w, c);
    if (side < 0) continue;
    for (const e of side === 0 ? w.defenders : w.attackers) out.add(e);
  }
  return [...out];
}
// Per-state index of treaty partners, rebuilt lazily (invalidated by touchTreaties / on tick change).
interface TreatyIndex { tick: number; n: number; ally: number[][]; trade: number[][]; nap: number[][]; coop: number[][] }
const treatyIdx = new WeakMap<GameState, TreatyIndex & { dirty: boolean }>();
const treatyVer = new WeakMap<GameState, number>();
export const treatyVersion = (s: GameState) => treatyVer.get(s) ?? 0;
export function touchTreaties(s: GameState) { treatyVer.set(s, treatyVersion(s) + 1); const i = treatyIdx.get(s); if (i) i.dirty = true; }
/** While the weekly tick runs, AI queries may use the index as it was at the start of the week (rebuilt once per tick). */
let inTick = false;
export const setInTick = (v: boolean) => { inTick = v; };
export const isInTick = () => inTick;
function index(s: GameState): TreatyIndex {
  let i = treatyIdx.get(s);
  const n = s.countries.length;
  if (!i || i.tick !== s.tick || (i.dirty && !inTick)) {
    i = { tick: s.tick, n, dirty: false, ally: Array.from({ length: n }, () => []), trade: Array.from({ length: n }, () => []), nap: Array.from({ length: n }, () => []), coop: Array.from({ length: n }, () => []) };
    for (const k in s.treaties) {
      const t = s.treaties[k];
      const dash = k.indexOf('-');
      const a = +k.slice(0, dash), b = +k.slice(dash + 1);
      if (t.alliance) { i.ally[a].push(b); i.ally[b].push(a); }
      if (t.trade) { i.trade[a].push(b); i.trade[b].push(a); }
      if (t.nap) { i.nap[a].push(b); i.nap[b].push(a); }
      if (t.coop) { i.coop[a].push(b); i.coop[b].push(a); }
    }
    treatyIdx.set(s, i);
  }
  return i;
}
export function alliesOf(s: GameState, c: CountryId): CountryId[] {
  return index(s).ally[c].filter((x) => s.countries[x].alive);
}
export function partnersOf(s: GameState, c: CountryId, kind: 'trade' | 'nap' | 'coop'): CountryId[] {
  return index(s)[kind][c].filter((x) => s.countries[x].alive);
}

/** Countries that have guaranteed `c`'s security. */
export function guarantorsOf(s: GameState, c: CountryId): CountryId[] {
  return s.guarantees.filter((g) => g.endsWith(`>${c}`)).map((g) => Number(g.split('>')[0])).filter((x) => s.countries[x]?.alive);
}
export function guaranteedBy(s: GameState, c: CountryId): CountryId[] {
  return s.guarantees.filter((g) => g.startsWith(`${c}>`)).map((g) => Number(g.split('>')[1])).filter((x) => s.countries[x]?.alive);
}
export const hasGuarantee = (s: GameState, from: CountryId, to: CountryId) => s.guarantees.includes(`${from}>${to}`);

/** Why do two countries feel the way they do? Mirrors getRelation part by part, so the UI can explain it. */
export function relationBreakdown(s: GameState, a: CountryId, b: CountryId): { label: string; v: number }[] {
  if (a === b) return [];
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const A = COUNTRY_BASE[lo], B = COUNTRY_BASE[hi];
  const parts: { label: string; v: number }[] = [];
  const add = (label: string, v: number) => { if (Math.abs(v) >= 0.5) parts.push({ label, v: Math.round(v) }); };
  if (A.region === B.region) add('Same region', 8);
  const rv = RIV.get(lo * 1000 + hi) ?? 0;
  if (rv) add(rv < 0 ? 'Historic rivalry' : 'Historic friendship', rv);
  add('Chemistry', staticRelation(a, b) - (A.region === B.region ? 8 : 0) - rv);
  const oa = orientOf(s, a), ob = orientOf(s, b);
  const camp = 14 * Math.min(Math.abs(oa), Math.abs(ob)) * Math.sign(oa * ob);
  add(camp > 0 ? (oa > 0 ? 'Both in the Western camp' : 'Both in the Eastern camp') : 'Rival camps', camp);
  const adv = -30 * (hostileOf(s, a) * Math.max(0, ob) + hostileOf(s, b) * Math.max(0, oa));
  add('Treated as an adversary by the West', adv);
  const g = govRelation(s, a, b);
  add(g > 0 ? 'Both democracies' : 'Different political systems', g);
  for (const o of s.orgs ?? []) if (o.members.includes(a) && o.members.includes(b)) add(`Both in ${o.name}`, o.bonus);
  const hist = s.relHist?.[pairKey(a, b)] ?? 0;
  add(hist > 0 ? 'Years of friendship (lasting)' : 'Years of enmity (lasting)', hist);
  const pk = pairKey(a, b);
  const t = s.treaties[pk];
  if (t?.alliance) add('Alliance', 30);
  if (t?.coop) add('Military cooperation', 16);
  if (t?.trade) add('Trade agreement', 10);
  if (t?.nap) add('Non-aggression pact', 6);
  const sa = sanctionLevel(s, a, b), sb = sanctionLevel(s, b, a);
  if (sa) add(`${COUNTRY_BASE[a].name} sanctions ${COUNTRY_BASE[b].name}`, sa === 2 ? -30 : -16);
  if (sb) add(`${COUNTRY_BASE[b].name} sanctions ${COUNTRY_BASE[a].name}`, sb === 2 ? -30 : -16);
  const memory = s.relDelta[pk] ?? 0;
  if (Math.abs(memory) >= 0.5) add(memory > 0 ? 'Recent goodwill (fades over time)' : 'Recent grievances (fade over time)', Math.round(memory));
  if (areAtWar(s, a, b)) add('At war', -60);
  return parts;
}
