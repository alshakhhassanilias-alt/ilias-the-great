/**
 * Economic simulation. One tick = one week; all flows are annual rates multiplied by DT.
 *
 * Output (supply side):
 *   Y* = A · K^α · L^(1-α) · infraF · energyF · tradeF · stabilityF · taxF · warF
 * Real GDP converges to Y* (speed ~8/yr); nominal GDP = real GDP × price level.
 * K grows with private investment (rate depends on confidence & corporate tax) and state industrial
 * policy; A grows with a country trend plus education/R&D spending; L follows population and
 * mobilisation. Unemployment, inflation, stability, debt, interest and trade are all derived from this.
 */
import { charFragile, charInfl, charLabour, charLocked, charRate, charRevenue, charShock, charStab, charTfp } from './character';
import { policyTfp } from './turns';
import { mods } from './doctrines';
import { DT } from './types';
import type { Budget, Country, GameState } from './types';
import type { Geo } from './geo';
import { clamp, fmtMoney } from './util';
import { setPriceLevel } from './util';
import { DEFICIT_LABEL, record } from './treasury';
import { logEvent } from './log';
import { stepMilitary } from './military';
import { getRelation, pairOf, warsOf } from './relations';
import { HIST_EVERY, HIST_MAX } from './types';

export const ALPHA = 0.35;
export const DELTA = 0.05;

export const taxBurden = (b: Pick<Budget, 'taxIncome' | 'taxCorporate' | 'taxVat'>) =>
  0.5 * b.taxIncome + 0.2 * b.taxCorporate + 0.55 * b.taxVat;

/** Output multiplier from distortionary taxation (only rates above "efficient" levels hurt). */
export function taxFactor(b: Budget, collection = 1): number {
  // distortion depends on the *effective* rate actually collected, not the statutory headline rate
  const d =
    1.6 * Math.pow(Math.max(0, b.taxIncome * collection - 0.3), 1.5) +
    1.4 * Math.pow(Math.max(0, b.taxCorporate * collection - 0.25), 1.5) +
    1.2 * Math.pow(Math.max(0, b.taxVat * collection - 0.18), 1.5);
  return clamp(1 - d, 0.3, 1);
}
export const stabilityFactor = (s: number) => (s >= 60 ? 1 : 1 - 0.35 * Math.pow((60 - s) / 60, 1.5));
export const infraFactor = (infra: number) => 0.8 + 0.4 * (infra / 100);
export const needInfra = (infra: number) => 0.01 + 0.0004 * infra;

export function energyFactor(e: Country['eco'], priceE: number): number {
  const netImportShare = Math.max(0, e.energyDemand - e.energyCap) / Math.max(e.energyDemand, 1);
  return clamp(1 - 0.6 * e.energyUnmet - 0.08 * Math.max(0, priceE - 1) * netImportShare, 0.3, 1);
}

export function laborUsed(c: Country): number {
  const e = c.eco;
  return Math.max(1, e.laborForce * (1 - e.unemployment) - c.mil.troops * 0.9);
}

export interface Factors { infra: number; energy: number; trade: number; stab: number; tax: number; war: number }
export function factors(c: Country, priceE: number): Factors {
  const e = c.eco;
  return {
    infra: infraFactor(e.infra),
    energy: energyFactor(e, priceE),
    trade: 1 + 0.15 * (e.tradeIndex - 1),
    // output answers to stability over months, not weeks: a coup scare does not halve a year's GDP
    stab: stabilityFactor(e.prev.stabOut ?? e.stability),
    tax: taxFactor(c.budget, e.collection),
    war: 1 - 0.5 * e.damage,
  };
}
const prodFactors = (f: Factors) => f.infra * f.energy * f.trade * f.stab * f.tax * f.war;
export const demandSide = (f: Factors) => f.energy * Math.min(1, f.trade) * f.stab * f.tax * f.war;

export function potentialOutput(c: Country, priceE: number, tfp = c.eco.tfp): number {
  const e = c.eco;
  return tfp * Math.pow(e.capital, ALPHA) * Math.pow(laborUsed(c), 1 - ALPHA) * prodFactors(factors(c, priceE));
}

/** Raw risk-sensitive component of the borrowing cost (changes in debt, inflation and stability move it). */
const rateRaw = (e: Country['eco']) =>
  0.8 * Math.max(0, e.inflation - 0.02) + 0.04 * Math.max(0, e.debt / Math.max(e.gdp, 1) - 0.6) + 0.1 * Math.max(0, 0.7 - e.stability / 100);
/**
 * AI governments reinvest every spare budget point (infrastructure, schools, industry), which on top of a growth trend
 * that already assumes normal investment compounds into implausible booms. Growth well above a country's realistic
 * outlook meets diminishing returns. The player's country is exempt: there, a boom is the player's doing.
 */
const aiAnchor = (c: Country) => (c.isPlayer ? 0 : 2 * Math.max(0, c.eco.growth - c.eco.baseGrowth - 0.006));
/** Income per person of the richest large economies: the frontier everyone else converges toward (weekly cache). */
let frontierCache = { tick: -1, st: null as GameState | null, v: 1 };
export function frontierGdppc(s: GameState): number {
  if (frontierCache.tick === s.tick && frontierCache.st === s) return frontierCache.v;
  const big = s.countries.filter((c) => c.alive && c.eco.pop > 2e7).map((c) => c.eco.gdp / c.eco.pop).sort((a, b) => b - a);
  frontierCache = { tick: s.tick, st: s, v: big[Math.min(2, big.length - 1)] ?? 50000 };
  return frontierCache.v;
}
/** Market interest rate: the country's calibrated starting rate plus how much its fundamentals have changed since. */
export function marketRate(e: Country['eco']): number {
  return clamp((e.prev.rate0 ?? 0.03) + rateRaw(e) - (e.prev.raw0 ?? 0), 0.005, 0.25);
}

const REGIONAL_POP: Record<string, number> = { EU: -0.003, EA: -0.0035, RU: -0.0025, AF: 0.004, ME: 0.003, SA: 0.001, NA: 0.001 };
/** Demographic trend as a function of income and region (births fall as countries get richer). */
export function popTrend(gdppc: number, region: string, years = 0): number {
  let g = 0.03 - 0.0085 * Math.log(Math.max(gdppc, 500) / 1000) + (REGIONAL_POP[region] ?? 0);
  // the demographic transition runs its course: high birth rates fall everywhere over the century, and very low ones
  // partly recover, so the world's population levels off (as the UN projects) instead of exploding or dying out
  if (years > 0) g = g > 0 ? g * Math.exp(-years / 50) : g * (0.4 + 0.6 * Math.exp(-years / 80));
  return clamp(g, -0.01, 0.035);
}
/** Income per person in today's money: prices rise over the centuries, birth rates follow real living standards. */
export function realGdppc(s: GameState, c: Country): number {
  const f = frontierGdppc(s);
  s.stats.frontier0 ??= f;
  return (c.eco.gdp / Math.max(c.eco.pop, 1)) * (s.stats.frontier0 / Math.max(f, 1));
}
export function popGrowthRate(c: Country, s: GameState): number {
  let g = popTrend(realGdppc(s, c), c.region, s.tick / 52);
  g += clamp((c.budget.social / Math.max(c.eco.baseSocial, 0.01) - 1) * 0.004, -0.004, 0.004);
  g -= 0.05 * c.eco.foodUnmet;
  g -= 0.002 * Math.max(0, 50 - c.eco.stability) / 50;
  return g;
}

export function revenueAnnual(c: Country): number {
  return c.eco.gdp * c.eco.collection * taxBurden(c.budget) * (c.eco.prev.revMult ?? 1);
}
export const diffTaxMult = (s: GameState, c: Country) => (c.isPlayer ? (s.settings.difficulty === 'hard' ? 0.95 : s.settings.difficulty === 'easy' ? 1.05 : 1) : 1);
/** Fiscal position implied by the *current* policy settings (updates the instant a lever moves). */
export function fiscalNow(c: Country, s: GameState) {
  const revenue = revenueAnnual(c) * diffTaxMult(s, c);
  const spending = plannedSpendingAnnual(c);
  return { revenue, spending, balance: revenue - spending };
}
export function plannedSpendingAnnual(c: Country): number {
  const b = c.budget;
  return (b.social + b.infra + b.industry + b.education + b.military + b.intel) * c.eco.gdp + c.eco.debt * c.eco.avgRate;
}

/** Share of a country's weight that is un-integrated conquered land. */
function occupationOf(c: Country, s: GameState, geo: Geo): number {
  let tot = 0, occ = 0;
  for (const p of c.provinces) {
    const w = geo.provinces[p].w;
    tot += w;
    if (s.core[p] !== c.id) occ += w * (1 - s.integ[p]);
  }
  return tot > 0 ? occ / tot : 0;
}

function pushHist(arr: number[], v: number) {
  arr.push(v);
  if (arr.length > HIST_MAX) arr.shift();
}

const r5 = (v: number) => Number(v.toPrecision(5));
export function recordHistory(c: Country) {
  const e = c.eco, h = c.hist;
  pushHist(h.gdp, r5(e.gdp));
  pushHist(h.mil, r5(c.budget.military * e.gdp));
  pushHist(h.stab, r5(e.stability));
  if (!c.isPlayer) return; // full set of series is only kept for the player (keeps saves small)
  pushHist(h.gdppc, r5(e.gdp / Math.max(e.pop, 1)));
  pushHist(h.debt, r5(e.debt / Math.max(e.gdp, 1)));
  pushHist(h.infl, r5(e.inflation));
  pushHist(h.unemp, r5(e.unemployment));
  pushHist(h.pop, r5(e.pop));
  pushHist(h.trade, r5(e.exports - e.imports));
}

/** World-level aggregation used by trade, market and sanctions. */
export interface WorldAgg {
  gdp: number;
  availE: number;
  availF: number;
  sanctionedBy: number[]; // share of world economy sanctioning country i
  boost: number[]; // trade agreement boost
  selfHarm: number[];
}

export function aggregateWorld(s: GameState): WorldAgg {
  const n = s.countries.length;
  let gdp = 0;
  let expE = 0, needE = 0, expF = 0, needF = 0;
  for (const c of s.countries) {
    if (!c.alive) continue;
    gdp += c.eco.gdp;
    const ne = c.eco.energyCap - c.eco.energyDemand, nf = c.eco.foodCap - c.eco.foodDemand;
    if (ne > 0) expE += ne; else needE -= ne;
    if (nf > 0) expF += nf; else needF -= nf;
  }
  const availE = needE > 0 ? Math.min(1, (expE * 0.98) / needE) : 1;
  const availF = needF > 0 ? Math.min(1, (expF * 0.98) / needF) : 1;
  s.market.scarcityE = needE / Math.max(expE, 1);
  s.market.scarcityF = needF / Math.max(expF, 1);
  s.market.priceE += (clamp(0.6 + 0.4 * Math.pow(s.market.scarcityE / 0.9, 1.8), 0.5, 3.5) - s.market.priceE) * 0.1;
  s.market.priceF += (clamp(0.7 + 0.3 * Math.pow(s.market.scarcityF / 0.9, 1.6), 0.6, 3) - s.market.priceF) * 0.1;
  const sanctionedBy = new Array(n).fill(0), boost = new Array(n).fill(0), selfHarm = new Array(n).fill(0);
  const share = (c: Country) => clamp((2.5 * c.eco.gdp) / Math.max(gdp, 1), 0.01, 0.5);
  for (const [k, t] of Object.entries(s.treaties)) {
    const [a, b] = pairOf(k);
    const A = s.countries[a], B = s.countries[b];
    if (!A.alive || !B.alive) continue;
    if (t.trade) {
      boost[a] += clamp(0.02 + 0.5 * (B.eco.gdp / gdp), 0.02, 0.12);
      boost[b] += clamp(0.02 + 0.5 * (A.eco.gdp / gdp), 0.02, 0.12);
    }
    if (t.sAB) { sanctionedBy[b] += (t.sAB === 2 ? 1 : 0.5) * share(A); selfHarm[a] += (t.sAB === 2 ? 1 : 0.5) * share(B) * 0.35; }
    if (t.sBA) { sanctionedBy[a] += (t.sBA === 2 ? 1 : 0.5) * share(B); selfHarm[b] += (t.sBA === 2 ? 1 : 0.5) * share(A) * 0.35; }
  }
  return { gdp, availE, availF, sanctionedBy, boost, selfHarm };
}

export function updateTradeAndResources(c: Country, s: GameState, w: WorldAgg) {
  const e = c.eco;
  e.sanctionShare = Math.min(0.95, w.sanctionedBy[c.id]);
  const warLoad = Math.min(3, warsOf(s, c.id).length);
  const raw = 1 + 0.01 * c.mil.bld.port + Math.min(0.45, w.boost[c.id]) - 0.9 * e.sanctionShare - 0.8 * e.blockade - w.selfHarm[c.id] - 0.06 * warLoad * (1 + charLocked(c)) - (e.prev.tariff ?? 0);
  e.tradeIndex = clamp(raw / e.tradeBase, 0.15, 1.5);
  // energy & food balances
  e.energyDemand = e.prev.eInt * e.realGdp;
  e.foodDemand = e.prev.fPc * e.pop * (1 + 0.1 * Math.log(Math.max(e.realGdp / Math.max(e.pop, 1) / e.prev.gdppc0, 0.2)));
  const access = clamp(1 - 0.7 * e.sanctionShare - e.blockade, 0, 1);
  const accE = access * (1 - (e.prev.banE ?? 0)), accF = access * (1 - (e.prev.banF ?? 0));
  const shortE = Math.max(0, e.energyDemand - e.energyCap), shortF = Math.max(0, e.foodDemand - e.foodCap);
  const unE = (shortE * (1 - accE * w.availE)) / Math.max(e.energyDemand, 1);
  const unF = (shortF * (1 - accF * w.availF)) / Math.max(e.foodDemand, 1);
  e.energyUnmet += (unE - e.energyUnmet) * 0.25;
  e.foodUnmet += (unF - e.foodUnmet) * 0.25;
}

export function tradeFlows(c: Country, s: GameState) {
  const e = c.eco;
  const pE = s.market.priceE, pF = s.market.priceF;
  const neE = e.energyCap - e.energyDemand, neF = e.foodCap - e.foodDemand;
  const goods = e.openness * e.gdp * e.tradeIndex * 0.8;
  e.exports = goods * (1 + e.goodsBias) + Math.max(0, neE) * pE * e.price + Math.max(0, neF) * pF * e.price;
  e.imports = goods * (1 - e.goodsBias) + Math.max(0, -neE) * pE * e.price * (1 - e.energyUnmet) + Math.max(0, -neF) * pF * e.price * (1 - e.foodUnmet);
}

export function stepCountryEconomy(c: Country, s: GameState, geo: Geo, w: WorldAgg) {
  const e = c.eco, b = c.budget;
  const priceE = s.market.priceE;
  const diffTax = diffTaxMult(s, c);

  updateTradeAndResources(c, s, w);
  e.occupation = occupationOf(c, s, geo);
  // national traits and challenges, measured against where the country started (the baseline is real 2024 data)
  if (e.prev.chT0 === undefined) { e.prev.chT0 = charTfp(c) + (1 - ALPHA) * charLabour(c); e.prev.chS0 = charStab(c); e.prev.chR0 = charRate(c); e.prev.chV0 = charRevenue(c, 1); }
  e.prev.revMult = charRevenue(c, priceE) / Math.max(0.5, e.prev.chV0 ?? 1);
  e.lfShare = clamp(e.lfShare * (1 + charLabour(c) * DT), 0.25, 0.75);

  // ---- labour ----
  e.pop *= 1 + popGrowthRate(c, s) * DT;
  e.laborForce = e.pop * e.lfShare;

  // ---- productive capacity ----
  const pot = potentialOutput(c, priceE);
  e.potential = pot;
  const f = factors(c, priceE);
  const slump = 1 - clamp(demandSide(f) / e.prev.F0, 0, 1);
  const uTarget = clamp(e.uNat + 0.6 * slump + 0.1 * e.occupation, 0.01, 0.6);
  e.unemployment += (uTarget - e.unemployment) * (1 - Math.exp(-DT * 2.5));

  const prevReal = e.realGdp;
  e.realGdp += (pot - e.realGdp) * (1 - Math.exp(-DT * 8));
  const g = (Math.log(e.realGdp) - Math.log(prevReal)) / DT;
  e.growth += (g - e.growth) * 0.1;

  // ---- inflation & prices ----
  const cb = !!c.politics?.laws.some((l) => l.id === 'central_bank'); // an independent central bank (player law)
  e.monetary = Math.max(0, e.monetary * (1 - (cb ? 0.6 : 0.3) * DT));
  const balance = e.exports - e.imports;
  const fxStress = clamp((-(balance / e.gdp - e.prev.bal0) - 0.03) * 4 + Math.max(0, -e.reserves / e.gdp - 0.1) * 1.5, 0, 1);
  const overheating = Math.max(0, e.uNat - e.unemployment) * 0.6;
  const energyShock = 0.025 * Math.max(0, priceE - 1) * Math.min(1, Math.max(0, e.energyDemand - e.energyCap) / Math.max(e.energyDemand, 1) * 4);
  const piTarget = 0.02 + 1.2 * e.monetary + overheating + energyShock * charShock(c) + charInfl(c) + 0.12 * fxStress + 0.04 * (e.stability < 25 ? (25 - e.stability) / 25 : 0);
  e.inflation += (piTarget - e.inflation) * (1 - Math.exp(-DT * 2.5));
  // prices are in dollars: inflation above the world's ~3% is mostly lost to a weaker currency, so a country does not
  // get richer in dollars by printing money (Turkey's or Argentina's dollar GDP barely moved through years of inflation)
  e.price *= 1 + (e.inflation <= 0.03 ? e.inflation : 0.03 + 0.1 * (e.inflation - 0.03)) * DT;
  e.gdp = e.realGdp * e.price;
  e.reserves += balance * DT + (0.12 * e.gdp - e.reserves) * 0.5 * DT;

  // ---- capital ----
  const confidence = clamp(0.7 + 0.3 * Math.min(1, e.stability / 60), 0.4, 1) *
    clamp(1 - 1.2 * Math.max(0, b.taxCorporate - 0.25), 0.4, 1) * clamp(1 - 0.5 * Math.max(0, e.inflation - 0.08), 0.5, 1);
  const privInv = e.savings * confidence * e.realGdp;
  const stateInv = 0.7 * b.industry * e.realGdp;
  e.capital = Math.max(1, e.capital * (1 - DELTA * DT * (1 + 2 * e.damage)) + (privInv + stateInv) * DT);

  // ---- productivity ----
  // the long run: the 2024 growth outlook fades over a couple of decades into convergence. Countries far behind the
  // richest catch up fastest; at the frontier, productivity grows about 1% a year. (Without this, a 2024 boom
  // compounds for centuries: Guyana's 20% a year would make it the world's largest economy.)
  if (s.tick % 52 === c.id % 52) {
    const gdppc = e.gdp / Math.max(e.pop, 1);
    const gap = clamp(Math.log(Math.max(frontierGdppc(s), gdppc) / Math.max(gdppc, 1)) / Math.log(20), 0, 1);
    const target = (1 - ALPHA) * (0.012 + 0.018 * gap);
    e.tfpTrend += (target - e.tfpTrend) * (e.tfpTrend > target + 0.02 ? 1 / 8 : 1 / 20);
    e.baseGrowth = e.tfpTrend / (1 - ALPHA) + popTrend(realGdppc(s, c), c.region, s.tick / 52);
  }
  const gTfp = e.tfpTrend + mods(c).tfp + policyTfp(c) + charTfp(c) - (e.prev.chT0 ?? 0) - charFragile(s, c) + 0.4 * (b.education - e.baseEdu) + 0.01 * (e.tradeIndex - 1) - 0.02 * slump - 0.02 * e.damage - aiAnchor(c);
  // productivity knocked far below its normal path (war, collapse, years of turmoil) slowly recovers toward it,
  // as post-conflict economies do; ordinary policy differences (within 10%) are left alone
  const path = (e.prev.tfpPath ?? e.tfp) * (1 + e.tfpTrend * DT);
  e.prev.tfpPath = path;
  const recovery = 0.1 * Math.max(0, Math.log(path / e.tfp) - 0.1);
  e.tfp *= 1 + (gTfp + recovery) * DT;
  e.tech = clamp(e.tech + DT * (0.25 + 40 * Math.max(-0.02, b.education - 0.02)) * (1 - e.tech / 110), 5, 100);

  // ---- infrastructure ----
  const dInfra = 400 * (b.infra - needInfra(e.infra)) * (1 - e.infra / 110);
  e.infra = clamp(e.infra + dInfra * DT, 5, 100);

  // ---- resources capacity ----
  e.prev.eInt *= 1 - 0.012 * DT; // efficiency gains
  e.energyCap *= 1 + (0.015 + 0.8 * b.industry + 0.08 * Math.max(0, priceE - 1)) * DT * (1 - 0.5 * e.damage);
  e.foodCap *= 1 + (0.012 + 0.0002 * e.tech) * DT * (1 - 0.4 * e.damage);

  // ---- war damage recovers ----
  e.damage = Math.max(0, e.damage - 0.012 * DT * 52 * 0.25);

  // ---- fiscal ----
  const revenue = e.gdp * e.collection * diffTax * taxBurden(b) * (e.prev.revMult ?? 1);
  const mkt = marketRate(e) - (cb ? 0.005 : 0) + charRate(c) - (e.prev.chR0 ?? 0);
  e.avgRate += (mkt - e.avgRate) * 0.2 * DT * 5;
  e.interest = e.debt * e.avgRate;
  const upkeep = stepMilitary(c, s, geo);
  const other = (b.social + b.infra + b.industry + b.education + b.intel) * e.gdp;
  const spending = other + upkeep.total + e.interest;
  e.revenue = revenue;
  e.spending = spending;
  e.cash += (revenue - spending) * DT;
  if (e.cash < 0) {
    // the treasury is empty: the rest of this week's deficit is covered by issuing bonds
    record(s, c, DEFICIT_LABEL, e.cash, -e.cash);
    e.debt -= e.cash; e.cash = 0;
    if (c.isPlayer && !e.dry) {
      e.dry = true;
      logEvent(s, `🏦 The treasury is empty. From now on the deficit (${fmtMoney(spending - revenue)} a year) is covered by borrowing, and one-off costs are borrowed too. Raise taxes or cut spending in the Economy tab to stop the debt growing.`, 'danger', [c.id], true);
    }
  } else if (e.dry && e.cash > 0.01 * e.gdp) e.dry = false;
  // debt crisis: when the debt can no longer be serviced (very high, or interest eating a large share of revenue), the
  // country defaults and restructures down to a level it can carry, as real defaulters do (Greece 2012, Argentina,
  // Zambia). Markets stay wary for years (the rate premium fades as stability returns).
  const debtRatio = e.debt / e.gdp;
  const unsustainable = debtRatio > 4 || (debtRatio > 1.2 && e.interest > 0.35 * Math.max(e.revenue, 1));
  if (unsustainable && s.tick > 26 && s.tick - e.lastDefault > 260) {
    const before = e.debt;
    e.debt = Math.min(e.debt * 0.5, Math.max(0.7 * e.gdp, e.debt * 0.25));
    e.stability = Math.max(0, e.stability - 20);
    e.monetary += 0.04;
    e.lastDefault = s.tick;
    logEvent(s, `${c.name} defaulted on its sovereign debt (${(debtRatio * 100).toFixed(0)}% of GDP); creditors accepted a ${Math.round((1 - e.debt / before) * 100)}% haircut.`, c.isPlayer ? 'danger' : 'econ', [c.id], true);
  }

  // ---- stability ----
  const soc = b.social / Math.max(e.baseSocial, 0.01);
  const burdenExcess = Math.max(0, taxBurden(b) * e.collection - e.baseTaxRevenue - 0.05);
  const parts: Record<string, number> = {
    base: e.prev.stab0,
    growth: clamp(80 * (e.growth - Math.min(e.baseGrowth, 0.03)), -10, 6),
    jobs: -100 * Math.max(0, e.unemployment - e.uNat - 0.02),
    prices: -100 * Math.max(0, e.inflation - Math.max(0.05, e.prev.infl0)),
    services: clamp((soc - 1) * 30, -14, 10),
    taxes: -40 * burdenExcess,
    war: -35 * c.mil.exhaustion - 25 * e.damage,
    shortages: -40 * e.foodUnmet - 30 * e.energyUnmet,
    occupation: -30 * e.occupation,
    debt: debtRatio > 2 ? -15 : 0,
    // doctrines, laws, ministers and national projects: bonuses stack with diminishing returns (at most about +9)
    doctrine: (() => { const v = mods(c).stab; return v > 0 ? 9 * (1 - Math.exp(-v / 9)) : v; })(),
    factions: c.politics?.stab ?? 0,
    national: charStab(c) - (e.prev.chS0 ?? 0),
  };
  e.stabParts = parts;
  const target = Object.values(parts).reduce((t, v) => t + v, 0);
  e.stability = clamp(e.stability + (target - e.stability) * (1 - Math.exp(-DT * 2)), 0, 100);
  const so = e.prev.stabOut ?? e.stability;
  e.prev.stabOut = so + (e.stability - so) * (1 - Math.exp(-DT * 1.5));

  // ---- growth explanation (annualised log contributions, smoothed) ----
  const lnNow: Record<string, number> = {
    capital: ALPHA * Math.log(e.capital),
    labor: (1 - ALPHA) * Math.log(laborUsed(c)),
    tfp: Math.log(e.tfp),
    infra: Math.log(f.infra),
    energy: Math.log(f.energy),
    trade: Math.log(f.trade),
    stability: Math.log(f.stab),
    taxes: Math.log(f.tax),
    war: Math.log(f.war),
  };
  for (const key of Object.keys(lnNow)) {
    const prev = e.prev['ln_' + key];
    if (prev !== undefined) e.explain[key] = (e.explain[key] ?? 0) * 0.9 + 0.1 * ((lnNow[key] - prev) / DT);
    e.prev['ln_' + key] = lnNow[key];
  }
  e.explain.convergence = (e.explain.convergence ?? 0) * 0.9 + 0.1 * (g - ((c.eco.explain.capital ?? 0) + (e.explain.labor ?? 0) + (e.explain.tfp ?? 0) + (e.explain.infra ?? 0) + (e.explain.energy ?? 0) + (e.explain.trade ?? 0) + (e.explain.stability ?? 0) + (e.explain.taxes ?? 0) + (e.explain.war ?? 0)));
}

export function stepEconomies(s: GameState, geo: Geo) {
  for (const _ of stepEconomiesGen(s, geo)) { /* run to completion */ }
}
/** The same, in slices (yields every few countries) so a slow device never freezes on one week. */
/** The world's price level (output-weighted), relative to the start of the game: what display money is divided by. */
export function updatePriceLevel(s: GameState) {
  let num = 0, den = 0;
  for (const c of s.countries) if (c.alive) { num += c.eco.price * c.eco.realGdp; den += c.eco.realGdp; }
  const wpi = den > 0 ? num / den : 1;
  s.stats.wpi0 ??= wpi;
  s.stats.wpi = wpi;
  setPriceLevel(wpi / s.stats.wpi0);
}
export function* stepEconomiesGen(s: GameState, geo: Geo): Generator<void> {
  updatePriceLevel(s);
  const w = aggregateWorld(s);
  let n = 0;
  for (const c of s.countries) {
    if (!c.alive) continue;
    stepCountryEconomy(c, s, geo, w);
    tradeFlows(c, s);
    if (++n % 10 === 0) yield;
  }
  if (s.tick % HIST_EVERY === 0) {
    for (const c of s.countries) if (c.alive) recordHistory(c);
    pushHist(s.worldHist.gdp, w.gdp);
  }
}

/** Dependence of a country on another (trade): rough 0..1 score used by AI. */
export function tradeDependence(s: GameState, a: number, b: number): number {
  const A = s.countries[a], B = s.countries[b];
  const rel = getRelation(s, a, b);
  return clamp((B.eco.gdp / Math.max(A.eco.gdp + B.eco.gdp, 1)) * A.eco.openness * (rel > 0 ? 1 : 0.5), 0, 1);
}
