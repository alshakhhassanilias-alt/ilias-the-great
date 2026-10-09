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

export const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

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

const baseCache = new Float32Array(N_COUNTRIES * N_COUNTRIES).fill(-999);
export function baseRelation(a: CountryId, b: CountryId): number {
  if (a === b) return 100;
  if (a >= N_COUNTRIES || b >= N_COUNTRIES) return 0;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const idx = lo * N_COUNTRIES + hi;
  if (baseCache[idx] > -900) return baseCache[idx];
  const A = COUNTRY_BASE[lo], B = COUNTRY_BASE[hi];
  let r = 0;
  if (A.region === B.region) r += 8;
  if (S_NATO.has(lo) && S_NATO.has(hi)) r += 26;
  else if (S_WEST.has(lo) && S_WEST.has(hi)) r += 14;
  if (S_EU.has(lo) && S_EU.has(hi)) r += 14;
  if (S_CSTO.has(lo) && S_CSTO.has(hi)) r += 22;
  if (S_EAST.has(lo) && S_EAST.has(hi)) r += 14;
  if ((S_WEST.has(lo) && S_EAST.has(hi)) || (S_EAST.has(lo) && S_WEST.has(hi))) r -= 14;
  if (S_ARAB.has(lo) && S_ARAB.has(hi)) r += 14;
  if (S_WEST.has(lo) && ADV[hi] !== undefined) r += ADV[hi];
  if (S_WEST.has(hi) && ADV[lo] !== undefined) r += ADV[lo];
  if (A.gov === 'D' && B.gov === 'D') r += 10;
  else if ((A.gov === 'D') !== (B.gov === 'D')) r -= 3;
  r += RIV.get(lo * 1000 + hi) ?? 0;
  r += (hash01('rel', lo, hi) - 0.5) * 18;
  baseCache[idx] = clamp(r, -100, 100);
  return baseCache[idx];
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
  return clamp(baseRelation(a, b) + (s.relDelta[k] ?? 0) + treatyBonus(s.treaties[k]) - (areAtWar(s, a, b) ? 60 : 0), -100, 100);
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
export function touchTreaties(s: GameState) { const i = treatyIdx.get(s); if (i) i.dirty = true; }
function index(s: GameState): TreatyIndex {
  let i = treatyIdx.get(s);
  const n = s.countries.length;
  if (!i || i.dirty || i.tick !== s.tick) {
    i = { tick: s.tick, n, dirty: false, ally: Array.from({ length: n }, () => []), trade: Array.from({ length: n }, () => []), nap: Array.from({ length: n }, () => []), coop: Array.from({ length: n }, () => []) };
    for (const [k, t] of Object.entries(s.treaties)) {
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
