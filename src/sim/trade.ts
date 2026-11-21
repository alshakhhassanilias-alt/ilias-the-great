/**
 * Trade as a weapon and a weakness.
 *
 * STRATEGIC GOODS. Besides energy and food (economy.ts), two goods decide who can build a modern economy:
 *   chips    — made by a handful of countries (Taiwan alone makes ~40%); without them productivity and military
 *              technology stall;
 *   minerals — lithium, cobalt, nickel, copper and rare earths, most of them refined in China.
 * Each country needs them in proportion to the size and sophistication of its economy. It gets them from the
 * producers that still sell to it: an export ban, an embargo or a war with a supplier cuts its share. When a
 * producer is at war, blockaded or bombed, the whole world is short and prices jump (a war over Taiwan is a
 * world chip crisis). High prices pay producers.
 *
 * EXPORT BANS. Any producer can stop selling a good to a country: chips, minerals, energy or food. The target
 * loses the share of world supply that came from you; you lose the sales and the relationship.
 *
 * TARIFFS. Tariffs on a country raise a little revenue and please protectionists, but cut trade with it on both
 * sides; the target often hits back. Two big economies with tariffs on each other are in a trade war.
 *
 * THE BUSINESS CYCLE. Recessions do not come out of nowhere: years of expansion, expensive oil or chips, trade
 * wars and high inflation are warning signs. The recession risk is shown, and when it is high a recession
 * can start early.
 */
import type { Country, CountryId, GameState } from './types';
import { addRelation, areAtWar, getRelation, sanctionLevel } from './relations';
import { NAME_TO_ID } from './relations';
import { addGrudge } from './leaders';
import { sway } from './domestic';
import { logEvent } from './log';
import { hash01 } from './rng';
import { clamp, fmtMoney, keyOf } from './util';
import { DT } from './types';

export type Good = 'chips' | 'minerals' | 'energy' | 'food';
export const GOODS: Record<Good, { icon: string; label: string; short: string; desc: string }> = {
  chips: { icon: '💾', label: 'Semiconductors', short: 'chips', desc: 'Without chips, productivity and military technology stall.' },
  minerals: { icon: '⛏', label: 'Critical minerals', short: 'minerals', desc: 'Lithium, cobalt, nickel and rare earths for batteries, motors and weapons.' },
  energy: { icon: '🛢', label: 'Oil and gas', short: 'energy', desc: 'Fuel for factories, homes and armies.' },
  food: { icon: '🌾', label: 'Grain and food', short: 'food', desc: 'Bread on the table; shortages bring people onto the streets.' },
};

/** share of world supply at the start (approximate, 2023-24) */
const SUPPLY: Record<'chips' | 'minerals', Record<string, number>> = {
  chips: { Taiwan: 0.4, 'South Korea': 0.17, China: 0.12, 'United States of America': 0.09, Japan: 0.07, Netherlands: 0.03, Malaysia: 0.03, Singapore: 0.02, Germany: 0.02, Israel: 0.02, Ireland: 0.01, Vietnam: 0.01, Philippines: 0.01 },
  minerals: { China: 0.55, Australia: 0.1, 'Dem. Rep. Congo': 0.08, Chile: 0.07, Indonesia: 0.06, Russia: 0.04, 'South Africa': 0.04, Peru: 0.02, Brazil: 0.02, Zambia: 0.01, Kazakhstan: 0.01 },
};
const SUP_ID: Record<'chips' | 'minerals', [number, number][]> = {
  chips: Object.entries(SUPPLY.chips).map(([n, v]) => [NAME_TO_ID[n], v] as [number, number]).filter(([i]) => i !== undefined),
  minerals: Object.entries(SUPPLY.minerals).map(([n, v]) => [NAME_TO_ID[n], v] as [number, number]).filter(([i]) => i !== undefined),
};
export const supplyShare = (c: Country, g: 'chips' | 'minerals') => SUPPLY[g][keyOf(c)] ?? 0;
export const producers = (g: 'chips' | 'minerals') => SUP_ID[g];

export interface Ban { from: CountryId; to: CountryId; good: Good; since: number }
export const bansOf = (s: GameState) => s.bans ?? [];
export const hasBan = (s: GameState, from: CountryId, to: CountryId, good: Good) => bansOf(s).some((b) => b.from === from && b.to === to && b.good === good);
const tKey = (a: CountryId, b: CountryId) => `${a}>${b}`;
export const hasTariff = (s: GameState, from: CountryId, to: CountryId) => (s.tariffs?.[tKey(from, to)] ?? -1) >= 0;

/** How open producer p is to selling to country i (0..1). */
function openTo(s: GameState, p: CountryId, i: CountryId, g: Good, fighting?: Set<number>): number {
  if (p === i) return 1;
  if ((s.bans?.length && hasBan(s, p, i, g)) || ((!fighting || (fighting.has(p) && fighting.has(i))) && areAtWar(s, p, i))) return 0;
  const sl = Math.max(sanctionLevel(s, p, i), sanctionLevel(s, i, p));
  return sl >= 2 ? 0 : sl === 1 ? 0.6 : 1;
}
/** How much of its normal output a producer can still ship (war, blockade, bombing). */
function capacity(s: GameState, P: Country): number {
  if (!P.alive) return 0;
  const war = s.wars.some((w) => w.attackers.includes(P.id) || w.defenders.includes(P.id));
  return clamp((1 - P.eco.damage * 1.5) * (1 - P.eco.blockade) * (war ? 0.75 : 1), 0, 1);
}

/** Monthly: world prices for chips and minerals, every country's shortfall, and the cost of bans and tariffs. */
export function stepTrade(s: GameState) {
  if (s.tick % 4 !== 0) return;
  const M = s.market;
  const tIdx = tariffIndex(s);
  for (const g of ['chips', 'minerals'] as const) {
    const lost = SUP_ID[g].reduce((t, [p, sh]) => t + sh * (1 - capacity(s, s.countries[p])), 0);
    const key = g === 'chips' ? 'priceC' : 'priceM';
    const target = clamp(1 + 2.2 * lost + (g === 'chips' && s.crisis?.id === 'boom' ? 0.15 : 0), 0.8, 4);
    M[key] = (M[key] ?? 1) + (target - (M[key] ?? 1)) * 0.35;
  }
  // energy and food: a ban by an exporter takes its share of world exports off the importer's market
  let expE = 0, expF = 0;
  for (const c of s.countries) if (c.alive) { expE += Math.max(0, c.eco.energyCap - c.eco.energyDemand); expF += Math.max(0, c.eco.foodCap - c.eco.foodDemand); }
  const banE = new Map<CountryId, number>(), banF = new Map<CountryId, number>();
  for (const b of bansOf(s)) {
    const F = s.countries[b.from];
    if (!F?.alive) continue;
    if (b.good === 'energy') banE.set(b.to, (banE.get(b.to) ?? 0) + Math.max(0, F.eco.energyCap - F.eco.energyDemand) / Math.max(1, expE));
    if (b.good === 'food') banF.set(b.to, (banF.get(b.to) ?? 0) + Math.max(0, F.eco.foodCap - F.eco.foodDemand) / Math.max(1, expF));
  }
  const fighting = new Set<number>();
  for (const w of s.wars) { for (const x of w.attackers) fighting.add(x); for (const x of w.defenders) fighting.add(x); }
  const cap = { chips: SUP_ID.chips.map(([p]) => capacity(s, s.countries[p])), minerals: SUP_ID.minerals.map(([p]) => capacity(s, s.countries[p])) };
  for (const c of s.countries) {
    if (!c.alive) continue;
    const pv = c.eco.prev;
    pv.banE = Math.min(0.9, banE.get(c.id) ?? 0);
    pv.banF = Math.min(0.9, banF.get(c.id) ?? 0);
    for (const g of ['chips', 'minerals'] as const) {
      let avail = 0;
      SUP_ID[g].forEach(([p, sh], k) => { avail += sh * openTo(s, p, c.id, g, fighting) * cap[g][k]; });
      // other suppliers make up some of the gap over time; what is left is the shortfall
      const short = clamp((1 - avail) * 0.7 - 0.15, 0, 1);
      pv[g === 'chips' ? 'shC' : 'shM'] = Math.round(short * 1000) / 1000;
    }
    pv.tariff = tariffHit(s, c.id, tIdx);
    pv.tarRev = 0;
  }
  for (const k in s.tariffs ?? {}) {
    const j = k.indexOf('>'); const a = Number(k.slice(0, j)), b = Number(k.slice(j + 1));
    const A = s.countries[a];
    if (A?.alive && s.countries[b]?.alive) A.eco.prev.tarRev = (A.eco.prev.tarRev ?? 0) + 0.04 * A.eco.imports * dependence(s, a, b);
  }
}

/** Share of trade a country loses to tariffs (its own and those on it). */
function tariffHit(s: GameState, i: CountryId, idx: Map<CountryId, CountryId[]>): number {
  let hit = 0;
  for (const o of idx.get(i) ?? []) if (s.countries[o]?.alive) hit += 0.6 * dependence(s, i, o);
  return Math.min(0.35, hit);
}
/** who has tariffs with whom (either direction), built once per pass instead of scanning every tariff per country */
function tariffIndex(s: GameState): Map<CountryId, CountryId[]> {
  const idx = new Map<CountryId, CountryId[]>();
  for (const k in s.tariffs ?? {}) {
    const j = k.indexOf('>'); const a = Number(k.slice(0, j)), b = Number(k.slice(j + 1));
    (idx.get(a) ?? idx.set(a, []).get(a)!).push(b);
    (idx.get(b) ?? idx.set(b, []).get(b)!).push(a);
  }
  return idx;
}
/** how much of a country's trade is with another (rough: the partner's size, closeness and openness) */
export function dependence(s: GameState, a: CountryId, b: CountryId): number {
  const A = s.countries[a], B = s.countries[b];
  const rel = getRelation(s, a, b);
  return clamp((B.eco.gdp / Math.max(A.eco.gdp + B.eco.gdp, 1)) * A.eco.openness * (rel > 0 ? 1 : 0.5), 0, 0.6);
}

/** Effects of shortages and high prices, every week (tfp and milTech per year scaled by DT). */
export function stepTradeEffects(s: GameState) {
  const pc = s.market.priceC ?? 1, pm = s.market.priceM ?? 1;
  const worldGdp = s.worldHist.gdp[s.worldHist.gdp.length - 1] ?? 1e14;
  for (const c of s.countries) {
    if (!c.alive) continue;
    const pv = c.eco.prev, e = c.eco;
    const techW = 0.4 + e.tech / 100;
    const shC = pv.shC ?? 0, shM = pv.shM ?? 0;
    const drag = 0.014 * shC * techW + 0.004 * Math.max(0, pc - 1) * techW + 0.007 * shM + 0.0025 * Math.max(0, pm - 1);
    if (drag > 0) e.tfp *= 1 - drag * DT;
    if (shC > 0.05) c.mil.milTech = Math.max(0, c.mil.milTech - 0.8 * shC * DT);
    // producers earn from high prices
    const w = supplyShare(c, 'chips') * Math.max(0, pc - 1) + supplyShare(c, 'minerals') * Math.max(0, pm - 1) * 0.6;
    if (w > 0) e.cash += w * 0.0015 * worldGdp * DT * capacity(s, c);
    // tariff revenue for the imposer: a small share of what it still imports from the target
    if (pv.tarRev) e.cash += pv.tarRev * DT;
  }
}

// ------------------------------------------------------------------ actions
export function banBlocked(s: GameState, from: CountryId, to: CountryId, good: Good): string | null {
  const F = s.countries[from];
  if (from === to || !s.countries[to]?.alive) return 'Pick another country';
  if (hasBan(s, from, to, good)) return null;
  if (good === 'chips' || good === 'minerals') { if (supplyShare(F, good) < 0.01) return `You do not produce ${GOODS[good].short}`; }
  else if (good === 'energy' ? F.eco.energyCap <= F.eco.energyDemand : F.eco.foodCap <= F.eco.foodDemand) return `You do not export ${GOODS[good].short}`;
  return null;
}
/** What a ban would do to the target: the share of its supply that is yours. */
export function banBite(s: GameState, from: CountryId, to: CountryId, good: Good): number {
  const F = s.countries[from];
  if (good === 'chips' || good === 'minerals') return clamp(supplyShare(F, good) * 0.7, 0, 1);
  let exp = 0;
  for (const c of s.countries) if (c.alive) exp += good === 'energy' ? Math.max(0, c.eco.energyCap - c.eco.energyDemand) : Math.max(0, c.eco.foodCap - c.eco.foodDemand);
  const mine = good === 'energy' ? Math.max(0, F.eco.energyCap - F.eco.energyDemand) : Math.max(0, F.eco.foodCap - F.eco.foodDemand);
  const T = s.countries[to];
  const needs = good === 'energy' ? T.eco.energyDemand > T.eco.energyCap : T.eco.foodDemand > T.eco.foodCap;
  return needs ? clamp(mine / Math.max(1, exp), 0, 1) : 0;
}

export function setBan(s: GameState, from: CountryId, to: CountryId, good: Good, on: boolean, quiet = false) {
  const F = s.countries[from], T = s.countries[to];
  if (on && !hasBan(s, from, to, good)) {
    (s.bans ??= []).push({ from, to, good, since: s.tick });
    addRelation(s, to, from, -15);
    addGrudge(s, to, from, `cut off its ${GOODS[good].short}`, 8);
    if (!quiet) logEvent(s, `${GOODS[good].icon} ${F.name} bans ${GOODS[good].short} exports to ${T.name}.`, 'econ', [from, to], from === s.player || to === s.player || banBite(s, from, to, good) > 0.1, to === s.player || from === s.player ? { prov: T.capital } : undefined);
  } else if (!on && hasBan(s, from, to, good)) {
    s.bans = bansOf(s).filter((b) => !(b.from === from && b.to === to && b.good === good));
    addRelation(s, to, from, 6);
    if (!quiet) logEvent(s, `${GOODS[good].icon} ${F.name} lifts its ban on ${GOODS[good].short} exports to ${T.name}.`, 'econ', [from, to], from === s.player || to === s.player);
  }
}
export function actBan(s: GameState, to: CountryId, good: Good, on: boolean): { ok: boolean; message: string } {
  const why = on ? banBlocked(s, s.player, to, good) : null;
  if (why) return { ok: false, message: why };
  setBan(s, s.player, to, good, on);
  if (on) aiRespond(s, to, s.player);
  return { ok: true, message: on ? `Export ban in force: ${s.countries[to].name} loses about ${Math.round(banBite(s, s.player, to, good) * 100)}% of its ${GOODS[good].short} supply.` : 'Ban lifted.' };
}

export function setTariff(s: GameState, from: CountryId, to: CountryId, on: boolean, quiet = false) {
  const T = (s.tariffs ??= {});
  const F = s.countries[from], X = s.countries[to];
  if (on && !hasTariff(s, from, to)) {
    T[tKey(from, to)] = s.tick;
    addRelation(s, to, from, -8);
    if (!quiet) logEvent(s, `🧱 ${F.name} slaps tariffs on goods from ${X.name}.${hasTariff(s, to, from) && F.eco.gdp > 5e11 && X.eco.gdp > 5e11 ? ' A trade war is on.' : ''}`, 'econ', [from, to], from === s.player || to === s.player || (F.eco.gdp > 1e12 && X.eco.gdp > 1e12));
  } else if (!on && hasTariff(s, from, to)) {
    delete T[tKey(from, to)];
    addRelation(s, to, from, 4);
    if (!quiet) logEvent(s, `🤝 ${F.name} lifts its tariffs on ${X.name}.`, 'econ', [from, to], from === s.player || to === s.player);
  }
}
export function actTariff(s: GameState, to: CountryId, on: boolean): { ok: boolean; message: string } {
  if (to === s.player || !s.countries[to]?.alive) return { ok: false, message: 'Pick another country' };
  setTariff(s, s.player, to, on);
  const me = s.countries[s.player];
  if (on) { sway(me, 'labour', 4); sway(me, 'nationalists', 3); sway(me, 'business', -5); aiRespond(s, to, s.player); }
  else sway(me, 'business', 3);
  const dep = dependence(s, s.player, to);
  return { ok: true, message: on ? `Tariffs on ${s.countries[to].name}: about ${Math.round(dep * 60)}% of the trade between you is at risk; they may hit back.` : 'Tariffs lifted.' };
}

/** An AI country answers a ban or tariffs: it hits back in kind if it can, or swallows it. */
function aiRespond(s: GameState, ai: CountryId, by: CountryId) {
  const A = s.countries[ai], B = s.countries[by];
  if (A.isPlayer || !A.alive) return;
  const r = hash01('retal', ai, s.tick);
  const strong = A.eco.gdp > 0.3 * B.eco.gdp;
  if (!strong && r > 0.25) return;
  if (!hasTariff(s, ai, by)) { setTariff(s, ai, by, true); return; }
  for (const g of ['minerals', 'chips', 'energy', 'food'] as Good[]) if (!banBlocked(s, ai, by, g) && !hasBan(s, ai, by, g) && banBite(s, ai, by, g) > 0.05) { setBan(s, ai, by, g, true); return; }
}

/** AI: trade wars between hostile big economies, bans by producers on enemies, and lifting them when relations mend. */
export function stepTradeAI(s: GameState) {
  if (s.tick % 13 !== 6) return;
  // "big" is a share of the world economy (about the size of the Netherlands in 2024), not a dollar figure prices outgrow
  const world = s.countries.reduce((t, c) => t + (c.alive ? c.eco.gdp : 0), 0);
  const BIG = 0.008 * world;
  const big = s.countries.filter((c) => c.alive && !c.isPlayer && c.eco.gdp > BIG);
  // tariffs an AI government set lapse when the quarrel is over, when the target is gone, or after a decade of calmer relations
  for (const k of Object.keys(s.tariffs ?? {})) {
    const j = k.indexOf('>'); const a = Number(k.slice(0, j)), b = Number(k.slice(j + 1));
    const A = s.countries[a], B = s.countries[b];
    if (!A?.alive || !B?.alive) { delete s.tariffs![k]; continue; }
    if (A.isPlayer) continue;
    const rel = getRelation(s, a, b), age = s.tick - s.tariffs![k];
    if ((rel > -10 && hash01('twl2', a * 1000 + b, s.tick) < 0.3) || (age > 520 && rel > -40 && hash01('twl3', a * 1000 + b, s.tick) < 0.1)) setTariff(s, a, b, false, true);
  }
  for (const A of big) {
    for (const B of s.countries) {
      if (!B.alive || B.id === A.id || B.eco.gdp < BIG) continue;
      const rel = getRelation(s, A.id, B.id);
      if (rel < -50 && !hasTariff(s, A.id, B.id) && hash01('tw', A.id * 1000 + B.id, s.tick) < 0.012) setTariff(s, A.id, B.id, true);
      if (rel < -65 && hash01('ban', A.id * 1000 + B.id, s.tick) < 0.008) {
        const g = (['minerals', 'chips', 'energy'] as Good[]).find((x) => !banBlocked(s, A.id, B.id, x) && !hasBan(s, A.id, B.id, x) && banBite(s, A.id, B.id, x) > 0.08);
        if (g) setBan(s, A.id, B.id, g, true);
      }
    }
  }
  // bans end when relations recover (or the target is gone)
  for (const b of [...bansOf(s)]) {
    if (s.countries[b.from].isPlayer) continue;
    if (!s.countries[b.to]?.alive || (getRelation(s, b.from, b.to) > -20 && s.tick - b.since > 52)) setBan(s, b.from, b.to, b.good, false);
  }
}

// ------------------------------------------------------------------ the business cycle
export interface CycleSign { label: string; on: boolean; w: number }
/** Warning signs of a world recession and the risk (0..1) that one starts within a year. */
export function recessionRisk(s: GameState): { risk: number; signs: CycleSign[]; phase: string } {
  const last = s.stats.lastRecession ?? -4 * 52; // the last world recession before the game: 2020
  const years = (s.tick - last) / 52;
  const alive = s.countries.filter((c) => c.alive);
  const gdp = alive.reduce((t, c) => t + c.eco.gdp, 0) || 1;
  const infl = alive.reduce((t, c) => t + c.eco.inflation * c.eco.gdp, 0) / gdp;
  const debt = alive.reduce((t, c) => t + c.eco.debt, 0) / gdp;
  const tradeWars = Object.keys(s.tariffs ?? {}).filter((k) => { const [a, b] = k.split('>').map(Number); return hasTariff(s, b, a) && s.countries[a].eco.gdp > 1e12 && s.countries[b].eco.gdp > 1e12; }).length / 2;
  const signs: CycleSign[] = [
    { label: `${Math.round(years)} year${Math.round(years) === 1 ? '' : 's'} since the last recession`, on: years > 5, w: clamp((years - 4) * 0.05, 0, 0.25) },
    { label: `Oil and gas ${s.market.priceE > 1.3 ? 'expensive' : 'affordable'} (${Math.round(s.market.priceE * 100)}% of normal)`, on: s.market.priceE > 1.3, w: clamp((s.market.priceE - 1.2) * 0.35, 0, 0.25) },
    { label: `Chips ${(s.market.priceC ?? 1) > 1.3 ? 'scarce' : 'plentiful'} (${Math.round((s.market.priceC ?? 1) * 100)}% of normal)`, on: (s.market.priceC ?? 1) > 1.3, w: clamp(((s.market.priceC ?? 1) - 1.2) * 0.3, 0, 0.2) },
    { label: `World inflation ${(infl * 100).toFixed(1)}%`, on: infl > 0.05, w: clamp((infl - 0.04) * 3, 0, 0.15) },
    { label: tradeWars ? `${tradeWars} trade war${tradeWars > 1 ? 's' : ''} between big economies` : 'No trade war between big economies', on: tradeWars > 0, w: Math.min(0.2, 0.1 * tradeWars) },
    { label: `World public debt ${(debt * 100).toFixed(0)}% of GDP`, on: debt > 1.05, w: clamp((debt - 1) * 0.3, 0, 0.1) },
  ];
  const risk = clamp(0.06 + signs.reduce((t, x) => t + x.w, 0), 0.03, 0.9);
  const cr = s.crisis?.id;
  const phase = cr === 'recession' ? 'Recession' : cr === 'boom' ? 'Boom' : years < 1.5 ? 'Recovery' : risk > 0.45 ? 'Late expansion: overheating' : 'Expansion';
  return { risk, signs, phase };
}
/** Called before a crisis is chosen: with a high risk, a recession comes early and is the likeliest pick. */
export function recessionDue(s: GameState): boolean {
  if (s.crisis || s.tick % 13 !== 0) return false;
  const r = recessionRisk(s).risk;
  return r > 0.45 && hash01('recession', s.tick, 7) < (r - 0.4) * 0.25;
}
export const fmtGoodPrice = (s: GameState, g: 'chips' | 'minerals') => `${Math.round(((g === 'chips' ? s.market.priceC : s.market.priceM) ?? 1) * 100)}%`;
void fmtMoney;
