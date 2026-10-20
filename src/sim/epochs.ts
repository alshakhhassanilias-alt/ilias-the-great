/**
 * The long run of history. Over decades and centuries the map should change the way it has in every real century:
 *
 *   assimilation  conquered land that has been governed and integrated for two generations stops dreaming of its old
 *                 flag: its people come to see themselves as citizens of the country that holds it
 *   revival       annexed nations whose land is still not integrated rise again when their conqueror weakens
 *                 (Poland in 1918, the Baltic states in 1991)
 *   independence  big countries crack along their far edges in hard times: a lost war, years of turmoil, a weak
 *                 centre (the end of empires, South Sudan, Eritrea); a stable democracy almost never splits
 *   collapse      an overstretched empire in deep crisis loses all its unintegrated conquests at once (1918, 1991)
 *   union         neighbours that have been allies, friends and alike for long enough merge (Germany 1990,
 *                 Tanganyika and Zanzibar 1964); a much bigger partner absorbs, equals found a new name
 *   empire        a country that rules many other peoples takes an imperial title, and drops it when they are gone
 *
 * Everything is slow and rare by design: a few changes a decade worldwide, so that after a century the map is
 * recognisably different and after a few centuries it is unrecognisable. A breakaway that its parent will not
 * accept is fought over as a war of independence. The player decides about their own country (see events9.ts).
 */
import type { Country, CountryId, GameState, Military } from './types';
import type { Geo } from './geo';
import { hash01, nextRand } from './rng';
import { clamp, keyOf } from './util';
import { logEvent } from './log';
import { chronicle } from './chronicle';
import { transferProvince, declareWar } from './war';
import { addRelation, getRelation, hasAlliance, isAtWar, touchTreaties } from './relations';
import { neighborsOf } from './diplomacy';
import { strength } from './military';
import { crownLeader } from './leaders';
import { choosePlan } from './plans';
import { pushInbox, INBOX_MAX } from './events';
import { placeName } from './places';

const YEAR = 52;
/** generations of integrated rule before conquered land counts as the conqueror's own */
export const ASSIMILATION_YEARS = 50;

// ------------------------------------------------------------------ the weekly step
export function stepEpochs(s: GameState, geo: Geo) {
  if (s.tick < 2 * YEAR) return;
  if (s.tick % YEAR === 7) { assimilate(s); treatyHousekeeping(s); }
  if (s.tick % 26 === 11) considerUnions(s, geo);
  for (const c of s.countries) {
    if (!c.alive || (s.tick + c.id * 7) % YEAR !== 0) continue;
    retitle(s, c);
    if (considerRevival(s, geo, c)) continue;
    considerIndependence(s, geo, c);
  }
}

// ------------------------------------------------------------------ assimilation
function assimilate(s: GameState) {
  for (let p = 0; p < s.owner.length; p++) {
    const o = s.owner[p], k = s.core[p];
    if (o === k || o < 0 || s.integ[p] < 0.98) continue;
    if (s.tick - (s.stats[`held:${p}`] ?? 0) < ASSIMILATION_YEARS * YEAR) continue;
    s.core[p] = o;
  }
}

// ------------------------------------------------------------------ treaties lapse
/**
 * Trade agreements between AI countries are renegotiated and lapse, as real ones do: at once when the two have fallen
 * out, now and then when they are far apart. Without this, every pair of countries ends up with one over the
 * centuries (and the world slows down counting them).
 */
function treatyHousekeeping(s: GameState) {
  let changed = false;
  for (const k in s.treaties) {
    const t = s.treaties[k];
    const dash = k.indexOf('-'), a = +k.slice(0, dash), b = +k.slice(dash + 1);
    const A = s.countries[a], B = s.countries[b];
    if (!A?.alive || !B?.alive) { delete s.treaties[k]; changed = true; continue; }
    if (t.trade && !A.isPlayer && !B.isPlayer && (getRelation(s, a, b) < 0 || (A.region !== B.region && nextRand(s) < 0.03))) { t.trade = false; changed = true; }
    if (!t.trade && !t.nap && !t.alliance && !t.coop && !t.sAB && !t.sBA) { delete s.treaties[k]; changed = true; }
  }
  if (changed) touchTreaties(s);
}

// ------------------------------------------------------------------ geometry helpers
/** Connected groups of the given provinces (land and short sea links, as the map defines adjacency). */
export function clusters(geo: Geo, provs: number[]): number[][] {
  const set = new Set(provs), seen = new Set<number>(), out: number[][] = [];
  for (const p of provs) {
    if (seen.has(p)) continue;
    const group: number[] = [], stack = [p];
    seen.add(p);
    while (stack.length) {
      const q = stack.pop()!;
      group.push(q);
      for (const n of geo.adj[q]) if (set.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
    out.push(group);
  }
  return out.sort((a, b) => b.length - a.length);
}
const weightOf = (geo: Geo, provs: number[]) => provs.reduce((t, p) => t + geo.provinces[p].w, 0);

/**
 * The far edge of a country: a connected region of its own heartland, grown outward from the province farthest from
 * the capital (farthest first), up to about a quarter of the country, never reaching the capital's core.
 */
export function peripheryOf(s: GameState, geo: Geo, c: Country): number[] {
  const own = new Set(c.provinces.filter((p) => s.core[p] === c.id && p !== c.capital));
  if (own.size < 4) return [];
  const d = (p: number) => geo.dist(c.capital, p);
  const far = [...own].sort((a, b) => d(b) - d(a));
  const dmax = d(far[0]);
  const total = weightOf(geo, c.provinces);
  const maxN = Math.max(2, Math.floor(own.size / 4));
  // grow from each of the farthest few provinces and keep the biggest region (a lone island is a last resort)
  let best: number[] = [];
  for (const start of far.slice(0, 6)) {
    const out: number[] = [start], seen = new Set([start]);
    let w = geo.provinces[start].w;
    let frontier = [...geo.adj[start]];
    while (out.length < maxN) {
      const next = frontier.filter((q) => own.has(q) && !seen.has(q) && d(q) >= 0.45 * dmax).sort((a, b) => d(b) - d(a))[0];
      if (next === undefined || w + geo.provinces[next].w > total / 4) break;
      seen.add(next); out.push(next); w += geo.provinces[next].w;
      frontier = frontier.concat(geo.adj[next]);
    }
    if (out.length > best.length) best = out;
    if (best.length >= maxN) break;
  }
  return best;
}

// ------------------------------------------------------------------ pressure
/** How shaky the centre is, as a multiplier on the chance that a region breaks away (1 = an ordinary year). */
function weakness(s: GameState, c: Country): number {
  const st = c.eco.stability;
  let k = st < 20 ? 6 : st < 35 ? 2.5 : st < 50 ? 1 : 0.35;
  if (isAtWar(s, c.id)) k *= 1.5;
  if (c.mil.exhaustion > 0.6) k *= 1.6;
  const lost = s.stats[`lostWar:${c.id}`];
  if (lost !== undefined && s.tick - lost < 5 * YEAR) k *= 2.5;
  if (c.eco.lastDefault > 0 && s.tick - c.eco.lastDefault < 3 * YEAR) k *= 1.5;
  return k;
}

// ------------------------------------------------------------------ revival of annexed nations
function considerRevival(s: GameState, geo: Geo, c: Country): boolean {
  const groups = new Map<number, number[]>();
  for (const p of c.provinces) { const k = s.core[p]; if (k !== c.id && k >= 0 && p !== c.capital) (groups.get(k) ?? groups.set(k, []).get(k)!).push(p); }
  for (const [k, provs] of groups) {
    const K = s.countries[k];
    if (!K || K.alive) continue; // a living nation takes its land back by war or treaty, not by revolt
    const block = clusters(geo, provs)[0];
    const integ = block.reduce((t, p) => t + s.integ[p], 0) / block.length;
    const chance = 0.05 * Math.pow(1 - integ, 2) * weakness(s, c) * (s.tick - (s.stats[`fallen:${k}`] ?? 0) > 3 * YEAR ? 1 : 0.2);
    if (nextRand(s) >= chance) continue;
    if (c.isPlayer) { bidForPlayer(s, k, block[0], block.length); return true; }
    breakAway(s, geo, c, block, { revive: k });
    return true;
  }
  // an empire in deep crisis loses everything it never made its own
  const foreignW = [...groups.values()].reduce((t, g) => t + weightOf(geo, g), 0);
  if (!c.isPlayer && foreignW > 0.3 * weightOf(geo, c.provinces) && c.eco.stability < 20 && nextRand(s) < 0.12) {
    collapse(s, geo, c, groups);
    return true;
  }
  return false;
}

function collapse(s: GameState, geo: Geo, c: Country, groups: Map<number, number[]>) {
  const born: string[] = [];
  const oldName = c.name;
  for (const [k, provs] of groups) {
    const block = clusters(geo, provs)[0];
    const integ = block.reduce((t, p) => t + s.integ[p], 0) / block.length;
    if (integ > 0.9) continue;
    const X = breakAway(s, geo, c, block, { revive: s.countries[k]?.alive ? undefined : k, quietNews: true, how: 'collapse' });
    if (X) born.push(X.name);
  }
  if (!born.length) return;
  const text = `💥 THE ${oldName.toUpperCase()} BREAKS APART: ${born.length === 1 ? born[0] : `${born.slice(0, -1).join(', ')} and ${born[born.length - 1]}`} ${born.length === 1 ? 'declares' : 'declare'} independence.`;
  logEvent(s, text, 'territory', [c.id], true, { big: true, prov: c.capital });
  chronicle(s, 'collapse', `${oldName} broke apart: ${born.join(', ')} regained or won independence.`, [c.id]);
}

// ------------------------------------------------------------------ independence of a region
function considerIndependence(s: GameState, geo: Geo, c: Country) {
  if (c.provinces.length < 6) return;
  const size = Math.min(3, c.provinces.length / 12);
  const chance = 0.004 * size * weakness(s, c) * (c.gov === 'D' ? 0.6 : 1);
  if (nextRand(s) >= chance) return;
  const block = peripheryOf(s, geo, c);
  if (block.length < 2) return;
  if (c.isPlayer) { bidForPlayer(s, -1, block[0], block.length); return; }
  breakAway(s, geo, c, block, {});
}

function bidForPlayer(s: GameState, revive: number, p0: number, n: number) {
  if (s.inbox.length >= INBOX_MAX || s.inbox.some((i) => i.id === 'independence_bid')) return;
  if (s.tick - (s.stats.indepBid ?? -9999) < 8 * YEAR) return;
  s.stats.indepBid = s.tick;
  pushInbox(s, 'independence_bid', { k: revive, p0, n, t: s.tick }, 30);
}

/** The block of provinces a bid for independence covers (recomputed when the player answers). */
export function bidBlock(s: GameState, geo: Geo, d: { k: number; p0: number }): number[] {
  const c = s.countries[s.player];
  const pool = d.k >= 0 ? c.provinces.filter((p) => s.core[p] === d.k && p !== c.capital) : peripheryOf(s, geo, c);
  if (!pool.includes(d.p0)) return [];
  return clusters(geo, pool).find((g) => g.includes(d.p0)) ?? [];
}

// ------------------------------------------------------------------ founding a nation
interface BreakOpts { revive?: number; name?: string; peaceful?: boolean; quietNews?: boolean; how?: 'independence' | 'revival' | 'collapse' }

/**
 * Carve `provs` out of `P` as a new (or revived) nation. Unless `peaceful`, the parent decides whether to let it go;
 * a strong, hard-line parent fights a war of independence instead.
 */
export function breakAway(s: GameState, geo: Geo, P: Country, provs: number[], o: BreakOpts): Country | null {
  provs = provs.filter((p) => s.owner[p] === P.id && p !== P.capital);
  if (!provs.length || provs.length >= P.provinces.length) return null;
  // land that was once another nation, now gone, brings that nation back (Austria, not "the Vienna Republic")
  if (o.revive === undefined && !o.name) {
    const w = new Map<number, number>();
    for (const p of provs) { const k = geo.provinces[p].country0; w.set(k, (w.get(k) ?? 0) + geo.provinces[p].w); }
    const [k0, wk] = [...w].sort((a, b) => b[1] - a[1])[0];
    const K = s.countries[k0];
    if (k0 !== P.id && K && !K.alive && wk > 0.6 * weightOf(geo, provs) && !s.countries.some((c) => c.alive && c.name === (K.baseName ?? K.name))) o = { ...o, revive: k0 };
  }
  const share = weightOf(geo, provs) / Math.max(1e-9, weightOf(geo, P.provinces));
  const X = makeNation(s, geo, P, provs, share, o.revive, o.name);
  const how = o.how ?? (o.revive !== undefined ? 'revival' : 'independence');
  X.origin = { tick: s.tick, from: P.id, how };
  const verb = how === 'revival' ? `rises again, breaking free from ${P.name}` : `declares independence from ${P.name}`;
  if (!o.quietNews) logEvent(s, `🏳 A NEW NATION: ${X.name} ${verb}.`, 'territory', [X.id, P.id], true, { big: true, prov: X.capital });
  chronicle(s, how === 'revival' ? 'revived' : 'born', `${X.name} ${how === 'revival' ? 'was restored' : 'was founded'}, breaking away from ${P.name}.`, [X.id, P.id]);
  // does the parent let it go?
  const hard = P.gov !== 'D' && P.ai.aggression > 0.35;
  const able = strength(P) > 2.5 * strength(X) && P.eco.stability > 25 && !P.isPlayer && P.mil.exhaustion < 0.5;
  if (!o.peaceful && hard && able && nextRand(s) < 0.6) {
    addRelation(s, P.id, X.id, -60);
    declareWar(s, geo, P.id, X.id, `it will not let ${X.name} go`);
  } else addRelation(s, P.id, X.id, o.peaceful ? 10 : -25);
  return X;
}

/** Build the new country: a fair share of the parent's people, output, debt and army, with its own government. */
function makeNation(s: GameState, geo: Geo, P: Country, provs: number[], share: number, revive?: number, forced?: string): Country {
  const old = revive !== undefined ? s.countries[revive] : undefined;
  const id = old ? old.id : s.countries.length;
  const eco = JSON.parse(JSON.stringify(P.eco)) as Country['eco'];
  for (const k of ['pop', 'realGdp', 'potential', 'capital', 'energyCap', 'foodCap', 'energyDemand', 'foodDemand', 'laborForce', 'gdp', 'debt', 'cash', 'reserves', 'exports', 'imports', 'revenue', 'spending', 'interest', 'damage', 'occupation'] as const) (eco[k] as number) = 0;
  eco.explain = {}; eco.stabParts = {}; eco.lastDefault = -9999; eco.dry = false;
  delete eco.prev.tfpPath; delete eco.prev.stabOut;
  const mil = JSON.parse(JSON.stringify(P.mil)) as Military;
  const k = share * 0.8;
  mil.troops = P.mil.troops * k; mil.equipArmy = P.mil.equipArmy * k; mil.equipAir = P.mil.equipAir * k * 0.6; mil.equipNavy = P.mil.equipNavy * k * 0.5;
  P.mil.troops -= mil.troops; P.mil.equipArmy -= mil.equipArmy; P.mil.equipAir -= mil.equipAir; P.mil.equipNavy -= mil.equipNavy;
  Object.assign(mil, { casualties: 0, exhaustion: 0, focus: [], ops: [], camps: [], nuclear: false, warSupport: 0.6, lastCas: 0, pocket: 0, wsParts: {}, warEconomy: false });
  const name = forced ?? (old ? (old.baseName ?? old.name) : newNationName(s, geo, P, provs));
  const r = (t: string) => hash01(t, id, s.tick, s.settings.seed);
  const gov = old ? (r('gov') < 0.6 ? 'D' : 'F') : P.gov === 'D' ? (r('gov') < 0.75 ? 'D' : 'F') : (r('gov') < 0.35 ? 'D' : r('gov') < 0.7 ? 'F' : 'A');
  const ag = clamp(0.1 + 0.4 * r('ag') + (gov === 'D' ? -0.05 : 0.08), 0.02, 1.1);
  const X: Country = {
    ...(old ?? {}),
    id, name, iso3: old?.iso3 ?? isoFor(s, name), gov, region: P.region, color: hueFor(s, geo, provs, id), estimated: true, alive: true,
    capital: provs.reduce((b, p) => (geo.provinces[p].w > geo.provinces[b].w ? p : b), provs[0]), provinces: [],
    eco, budget: { ...P.budget }, mil,
    ai: { aggression: ag, expansion: clamp(ag * (0.4 + 0.6 * r('ex')), 0, 1), trade: 0.4 + 0.5 * r('tr'), ideology: 0.3 + 0.5 * r('id'), caution: 0.3 + 0.5 * r('ca') },
    reputation: 60, isPlayer: false,
    hist: { gdp: [], gdppc: [], debt: [], mil: [], stab: [], infl: [], unemp: [], pop: [], trade: [] },
    baseline: { gdp: 0, pop: 0, provinces: provs.length }, lastWarDecl: -9999, intent: '',
    orient: (P.orient ?? 0) * 0.4, hostile: 0, culture: old ? keyOf(old) : P.culture ?? keyOf(P),
  };
  // what belonged to the old state's machinery does not carry over
  for (const f of ['leader', 'goal', 'mood', 'doctrine', 'generals', 'cabinet', 'politics', 'nat', 'course', 'story', 'coursesDone', 'chal', 'progs', 'key', 'baseName', 'origin'] as const) delete (X as Partial<Country>)[f];
  if (old) { X.key = keyOf(old); X.culture = keyOf(old); }
  s.countries[id] = X;
  for (const p of provs) transferProvince(s, geo, p, id, true);
  for (const p of provs) { s.core[p] = id; s.integ[p] = 1; s.stats[`held:${p}`] = s.tick; }
  // the new state's share of the national debt, and a modest treasury
  const debt = P.eco.debt * share;
  P.eco.debt -= debt; X.eco.debt = debt;
  X.eco.cash = 0.03 * X.eco.gdp; X.eco.reserves = 0.08 * X.eco.gdp;
  X.eco.stability = clamp(Math.max(P.eco.stability, 45) + 10, 0, 75);
  X.baseline = { gdp: X.eco.gdp, pop: X.eco.pop, provinces: X.provinces.length };
  crownLeader(s, X, Math.round(hash01('gen', id, s.tick) * 1e6));
  X.goal = choosePlan(s, geo, X);
  s.stats[`founded:${id}`] = s.tick;
  return X;
}

// ------------------------------------------------------------------ unions
function considerUnions(s: GameState, geo: Geo) {
  for (const A of s.countries) {
    if (!A.alive || A.provinces.length === 0) continue;
    for (const b of neighborsOf(s, geo, A.id)) {
      if (b <= A.id) continue;
      const B = s.countries[b];
      if (!unionReady(s, A, B)) continue;
      // twice a year, a ready pair takes the step with a small chance: a union is a once-in-generations event
      // big old nations rarely give up their sovereignty; small neighbours more readily
      if (nextRand(s) >= 0.004 * 6 / (6 + A.provinces.length + B.provinces.length)) continue;
      const player = A.isPlayer ? A : B.isPlayer ? B : null;
      if (player) {
        const other = player === A ? B : A;
        if (s.inbox.length < INBOX_MAX && !s.inbox.some((i) => i.id === 'union_offer') && s.tick - (s.stats.unionOffer ?? -9999) > 15 * YEAR) {
          s.stats.unionOffer = s.tick;
          pushInbox(s, 'union_offer', { o: other.id }, 30);
        }
        continue;
      }
      unite(s, geo, A.eco.gdp >= B.eco.gdp ? A : B, A.eco.gdp >= B.eco.gdp ? B : A);
      return;
    }
  }
}

export function unionReady(s: GameState, A: Country, B: Country): boolean {
  if (!A.alive || !B.alive || A.id === B.id) return false;
  if (!hasAlliance(s, A.id, B.id) || isAtWar(s, A.id) || isAtWar(s, B.id)) return false;
  const same = A.gov === B.gov || (A.gov !== 'D' && B.gov !== 'D' && A.gov !== 'C' && B.gov !== 'C');
  if (!same || A.region !== B.region) return false;
  if (A.eco.stability < 50 || B.eco.stability < 50) return false;
  if (getRelation(s, A.id, B.id) < 85) return false;
  // no superstates by stealth: a union stays a regional power, and a country digests one union before the next
  if (A.provinces.length + B.provinces.length > 45) return false;
  for (const X of [A, B]) if (s.tick - (s.stats[`united:${X.id}`] ?? -9999) < 30 * YEAR) return false;
  // nations that only recently became independent do not give it up again
  for (const X of [A, B]) if (s.tick - (s.stats[`founded:${X.id}`] ?? -9999) < 40 * YEAR) return false;
  return true;
}

/** `keep` absorbs `join`. Partners of similar size found a union with a new name. */
export function unite(s: GameState, geo: Geo, keep: Country, join: Country, forcedName?: string) {
  const equals = join.eco.gdp > 0.4 * keep.eco.gdp;
  const before = keep.name, other = join.name;
  const name = forcedName ?? (equals ? unionName(s, keep, join) : keep.name);
  // the junior partner's debts, savings and soldiers come along
  keep.eco.debt += join.eco.debt; keep.eco.cash += Math.max(0, join.eco.cash); keep.eco.reserves += join.eco.reserves;
  keep.mil.troops += join.mil.troops; keep.mil.equipArmy += join.mil.equipArmy; keep.mil.equipAir += join.mil.equipAir; keep.mil.equipNavy += join.mil.equipNavy;
  keep.mil.nuclear ||= join.mil.nuclear;
  const provs = [...join.provinces];
  for (const p of provs) transferProvince(s, geo, p, keep.id, true);
  for (const p of provs) { s.core[p] = keep.id; s.integ[p] = 1; s.stats[`held:${p}`] = s.tick; }
  s.stats[`fallen:${join.id}`] = s.tick;
  s.stats[`united:${keep.id}`] = s.tick;
  if (name !== keep.name) { keep.key ??= keep.name; keep.baseName = name; keep.name = name; }
  join.origin = { ...(join.origin ?? { tick: s.tick, from: keep.id, how: 'union' }) };
  const text = equals ? `🤝 A NEW UNION: ${before} and ${other} unite as ${name}.` : `🤝 UNIFICATION: ${other} joins ${before} by treaty.`;
  logEvent(s, text, 'territory', [keep.id, join.id], true, { big: true, prov: keep.capital });
  chronicle(s, 'union', equals ? `${before} and ${other} united as ${name}.` : `${other} joined ${before}.`, [keep.id, join.id]);
}

// ------------------------------------------------------------------ imperial titles
function retitle(s: GameState, c: Country) {
  const foreign = c.provinces.filter((p) => s.core[p] !== c.id).length;
  const imperial = c.provinces.length >= 8 && foreign >= Math.max(4, 0.35 * c.provinces.length);
  const base = c.baseName ?? c.name;
  const isTitled = c.name !== base;
  if (imperial && !isTitled) {
    const title = c.gov === 'D' ? `Commonwealth of ${base}` : c.gov === 'C' ? `People's Union of ${base}` : `Empire of ${base}`;
    c.key ??= keyOf(c); c.baseName = base; c.name = title;
    logEvent(s, `👑 ${base} now rules so many peoples that it styles itself the ${title}.`, 'territory', [c.id], c.isPlayer, c.isPlayer ? { prov: c.capital } : undefined);
    chronicle(s, 'renamed', `${base} became the ${title}.`, [c.id]);
  } else if (!imperial && isTitled && foreign < 0.15 * c.provinces.length) {
    const was = c.name;
    c.name = base;
    chronicle(s, 'renamed', `The ${was} dropped its imperial title and is ${base} again.`, [c.id]);
  }
}

// ------------------------------------------------------------------ names
const ENDINGS: Record<string, string[]> = {
  EU: ['ia', 'onia', 'avia', 'land', 'ania', 'eria'], RU: ['ia', 'ovia', 'iya', 'ania'], ME: ['stan', 'ia', 'an', 'iyya'],
  AF: ['a', 'ia', 'ana', 'ania', 'i'], SA: ['pur', 'desh', 'stan', 'ia'], EA: ['an', 'ia', 'ong', 'ei'], SEA: ['ia', 'aya', 'am', 'ara'],
  LA: ['a', 'ia', 'ana', 'ina'], NA: ['ia', 'land', 'ana'], OC: ['ia', 'a', 'ua'],
};
const DIRS: [number, string][] = [[0, 'East'], [90, 'South'], [180, 'West'], [270, 'North']];
const FORMS_D = ['Republic of {X}', '{X} Republic', 'Federation of {X}', 'Free State of {X}'];
const FORMS_A = ['State of {X}', '{X} Republic', 'Republic of {X}'];

/** A believable name for a breakaway state: after its main city, its direction, or a new name for an old land. */
export function newNationName(s: GameState, geo: Geo, P: Country, provs: number[]): string {
  const r = (t: string) => hash01(t, provs[0], s.tick, s.settings.seed);
  const main = provs.reduce((b, p) => (geo.provinces[p].w > geo.provinces[b].w ? p : b), provs[0]);
  const city = placeName(main);
  const taken = new Set(s.countries.filter((c) => c.alive).map((c) => c.name));
  const forms = P.gov === 'D' ? FORMS_D : FORMS_A;
  const form = forms[Math.floor(r('form') * forms.length)];
  const roll = r('kind');
  const candidates: string[] = [];
  if (roll < 0.35) candidates.push(form.replace('{X}', coined(r, P.region, city)));
  if (roll < 0.7) candidates.push(form.replace('{X}', city));
  // which side of the parent it lies on
  const [cx, cy] = geo.provinces[P.capital].seed, [px, py] = geo.provinces[main].seed;
  const ang = ((Math.atan2(py - cy, px - cx) * 180) / Math.PI + 360) % 360;
  const dir = DIRS.reduce((b, d) => (Math.min(Math.abs(ang - d[0]), 360 - Math.abs(ang - d[0])) < Math.min(Math.abs(ang - b[0]), 360 - Math.abs(ang - b[0])) ? d : b))[1];
  // "East Canada" only for land that borders the rest of the country; an island gets a name of its own
  const rest = new Set(P.provinces.filter((p) => !provs.includes(p)));
  const attached = provs.some((p) => geo.adj[p].some((q) => rest.has(q)));
  if (attached) candidates.push(`${dir} ${shortName(P.baseName ?? P.name)}`);
  candidates.push(form.replace('{X}', coined(r, P.region, city)), `${city} Free State`);
  return candidates.find((n) => !taken.has(n) && n.length <= 30) ?? `${form.replace('{X}', coined(r, P.region, city + s.tick))}`;
}

/** A coined name for a land: the first syllables of its main city with a regional ending (Kraków → Krakovia). */
function coined(r: (t: string) => number, region: string, city: string): string {
  const word = city.normalize('NFD').split(/[\s.,'-]+/).filter((w) => w.length > 2).sort((a, b) => b.length - a.length)[0] ?? city;
  const letters = word.replace(/[^A-Za-z]/g, '');
  const m = /^[^aeiouy]*[aeiouy]+[^aeiouy]{0,2}/i.exec(letters);
  let stem = (m ? m[0] : letters.slice(0, 4)) || 'Nova';
  stem = stem.replace(/[aeiouy]+$/i, '') || stem;
  const ends = ENDINGS[region] ?? ENDINGS.EU;
  const end = ends[Math.floor(r('end') * ends.length)];
  const w = stem + end;
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

const SHORT_NAMES: Record<string, string> = {
  'United Arab Emirates': 'Emirates', 'United States of America': 'America', 'United Kingdom': 'Britain', 'Central African Rep.': 'Central Africa',
  'Dem. Rep. Congo': 'Congo', 'Dominican Rep.': 'Dominica', 'Bosnia and Herz.': 'Bosnia', 'S. Sudan': 'South Sudan', 'N. Cyprus': 'Cyprus',
  'W. Sahara': 'Sahara', 'Eq. Guinea': 'Guinea', 'Solomon Is.': 'Solomons', 'Czechia': 'Czech', 'Saudi Arabia': 'Arabia', 'South Africa': 'South Africa',
  'New Zealand': 'Zealand', 'Papua New Guinea': 'Papua', 'Sri Lanka': 'Lanka', 'Costa Rica': 'Costa Rica', 'El Salvador': 'Salvador',
};
/** One word (or a well-known short form) for a country, to build union names from */
export function shortName(n: string): string {
  if (SHORT_NAMES[n]) return SHORT_NAMES[n];
  const core = n.replace(/^(Republic|Federation|State|Free State|Kingdom|Union|Empire|Commonwealth|People's Union) of /, '').replace(/ (Republic|Union|Free State|Commonwealth)$/, '');
  if (/ and /.test(core)) return shortName(core.replace(/^United /, '').split(' and ')[0]);
  if (/-/.test(core)) return core.split(' ')[0];
  const words = core.split(' ');
  return words.length === 1 ? core : /^(North|South|East|West|New|Upper|Lower|Greater)$/.test(words[0]) ? `${words[0]} ${words[1]}` : words[0];
}
function unionName(s: GameState, A: Country, B: Country): string {
  const a = A.baseName ?? A.name, b = B.baseName ?? B.name;
  const r = hash01('union', A.id, B.id, s.tick);
  const short = shortName;
  const opts = [
    `${short(a)}-${short(b)} Union`,
    `United ${short(a)} and ${short(b)}`,
    `Federation of ${short(a)} and ${short(b)}`,
    `Commonwealth of ${short(a)}`,
  ];
  const name = opts[Math.floor(r * opts.length)];
  return name.length <= 32 ? name : `Union of ${short(a)}`;
}

function isoFor(s: GameState, name: string): string {
  const core = name.replace(/^(Republic|Federation|State|Free State|Kingdom|Union) of /, '').replace(/[^A-Za-z]/g, '').toUpperCase();
  const used = new Set(s.countries.map((c) => c.iso3));
  for (let i = 0; i < 26; i++) { const t = (core.slice(0, 2) + (core[2 + i] ?? String.fromCharCode(65 + i))).padEnd(3, 'X'); if (!used.has(t)) return t; }
  return `N${String(s.countries.length).padStart(2, '0')}`.slice(0, 3);
}

/** A colour that stands out from the neighbours on the map. */
function hueFor(s: GameState, geo: Geo, provs: number[], id: number): number {
  const near = new Set<number>();
  for (const p of provs) for (const q of geo.adj[p]) { const o = s.owner[q]; if (o >= 0 && o !== id) near.add(s.countries[o].color); }
  let best = 0, bestD = -1;
  for (let i = 0; i < 24; i++) {
    const h = (i * 15 + Math.floor(hash01('hue', id) * 15)) % 360;
    let d = 360;
    for (const n of near) { const x = Math.abs(h - n); d = Math.min(d, Math.min(x, 360 - x)); }
    if (d > bestD) { bestD = d; best = h; }
  }
  return best;
}

