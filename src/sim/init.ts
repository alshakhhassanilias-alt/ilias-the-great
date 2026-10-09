/**
 * Builds a fresh GameState from the real-world baseline (src/data/countryData.ts).
 * Every model parameter is *calibrated* so that the starting GDP, population, budget, debt and
 * military spending reproduce the baseline data exactly, and the economy initially grows at its
 * baseline rate. Values derived here (capital stock, tech, infrastructure, tax-rate split ...) are
 * game-generated estimates, not real statistics.
 */
import {
  BILATERAL_ALLIANCES, COUNTRY_BASE, CSTO, DEBT_RATIO, ENERGY_RATIO, EU, FOOD_RATIO, GROWTH, NATO,
  type CountryBase,
} from '../data/countryData';
import type { Geo } from './geo';
import { hash01 } from './rng';
import { logEvent } from './log';
import { clamp } from './util';
import { ALPHA, DELTA, popTrend, aggregateWorld, demandSide, factors, tradeFlows, marketRate, needInfra, potentialOutput, taxBurden } from './economy';
import { ensureTreaty, NAME_TO_ID } from './relations';
import { equipTotal } from './military';
import {
  type Budget, type Country, type Economy, type GameState, type Military, type Personality, type Settings, START_YEAR,
} from './types';

const TECH_BONUS: Record<string, number> = {
  'United States of America': 10, Japan: 6, Germany: 6, Switzerland: 6, 'South Korea': 6, Israel: 8, Taiwan: 8,
  Singapore: 8, Sweden: 6, China: 8, Russia: 4, India: 3, 'United Kingdom': 5, France: 5, Netherlands: 4, Finland: 4,
};
const MIL_EDGE: Record<string, number> = {
  'United States of America': 10, China: 4, Israel: 10, Russia: 2, 'United Kingdom': 6, France: 6, Japan: 4, 'South Korea': 4,
  Turkey: 3, Iran: 0, India: 1, Ukraine: 5, Taiwan: 3, Australia: 4, 'North Korea': -2,
};
const INFRA_BONUS: Record<string, number> = { China: 10, Japan: 10, Germany: 10, 'South Korea': 8, Singapore: 12, Netherlands: 8, Switzerland: 8, 'United Arab Emirates': 8, Russia: -5, Canada: -3, Brazil: -4 };
const INFLATION0: Record<string, number> = {
  Argentina: 0.25, Turkey: 0.25, Venezuela: 0.25, Iran: 0.25, Lebanon: 0.2, Sudan: 0.2, Nigeria: 0.2, Egypt: 0.2, Ethiopia: 0.2,
  Russia: 0.07, Ukraine: 0.08, Pakistan: 0.22, Ghana: 0.18, Syria: 0.2, Yemen: 0.15, Zimbabwe: 0.25, Myanmar: 0.15, 'Sri Lanka': 0.1,
  Japan: 0.03, China: 0.01, Switzerland: 0.02, Brazil: 0.045, India: 0.055, Mexico: 0.055, 'United States of America': 0.03,
};
const FRAGILE = new Set(['Somalia', 'Yemen', 'Sudan', 'Syria', 'Haiti', 'Afghanistan', 'Libya', 'Dem. Rep. Congo', 'Central African Rep.', 'S. Sudan', 'Mali', 'Myanmar', 'Burkina Faso', 'Niger', 'Chad', 'Lebanon', 'Venezuela', 'Somaliland', 'Eritrea']);
const AGGRESSION: Record<string, number> = {
  Russia: 0.9, China: 0.6, 'North Korea': 0.9, Iran: 0.7, Israel: 0.5, Azerbaijan: 0.7, Turkey: 0.5, Pakistan: 0.5, India: 0.45,
  'Saudi Arabia': 0.4, Ethiopia: 0.5, Rwanda: 0.6, Venezuela: 0.5, Armenia: 0.35, Serbia: 0.4, Eritrea: 0.5, Egypt: 0.3,
  'Costa Rica': 0.02, Switzerland: 0.04, Japan: 0.12, Germany: 0.12, Ireland: 0.04, Iceland: 0.02, Austria: 0.05, 'New Zealand': 0.06,
  Canada: 0.1, Sweden: 0.1, Norway: 0.1, Finland: 0.1, 'United States of America': 0.35, 'United Kingdom': 0.2, France: 0.25,
};

const RATIO_E: Record<string, number> = { NA: 1.0, LA: 1.05, EU: 0.6, RU: 1.2, ME: 1.3, AF: 0.95, SA: 0.7, EA: 0.6, SEA: 0.95, OC: 0.8 };
const RATIO_F: Record<string, number> = { NA: 1.2, LA: 1.2, EU: 0.95, RU: 1.1, ME: 0.55, AF: 0.9, SA: 0.95, EA: 0.8, SEA: 1.0, OC: 0.9 };

function initEconomy(B: CountryBase, coastal: boolean): { eco: Economy; budget: Budget; mil: Military; ai: Personality } {
  const pop = Math.max(B.popM * 1e6, 800);
  const gdp = B.gdpB * 1e9;
  const gdppc = gdp / pop;
  const lg = Math.log10(Math.max(gdppc, 300) / 1000);
  const rn = (k: string) => hash01(B.name, k);

  const lfShare = clamp(0.36 + 0.05 * Math.log10(Math.max(gdppc, 300) / 300), 0.34, 0.5);
  const kOverY = clamp(2.2 + 0.4 * (lg + 0.5), 2.2, 3.6);
  const g0 = clamp((GROWTH[B.name] ?? (1.2 + 4.5 * Math.exp(-gdppc / 12000))) / 100, -0.02, 0.09);
  const popG = popTrend(gdppc, B.region);
  const tfpTrend = (1 - ALPHA) * (g0 - popG);

  // ---- fiscal baseline ----
  const revT = clamp(0.08 + 0.15 * Math.log10(Math.max(gdppc, 300) / 600), 0.09, 0.45);
  const collection = clamp(0.55 + 0.12 * Math.log10(Math.max(gdppc, 300) / 1000) + (B.gov === 'D' ? 0.05 : 0), 0.5, 0.97);
  const unit = 0.5 * 0.3 + 0.2 * 0.25 + 0.55 * 0.15;
  const m = revT / collection / unit;
  const taxIncome = clamp(0.3 * m, 0.02, 0.7), taxCorporate = clamp(0.25 * m, 0.02, 0.6), taxVat = clamp(0.15 * m, 0.0, 0.35);
  const baseTaxRevenue = collection * taxBurden({ taxIncome, taxCorporate, taxVat });

  const mil = B.milPct / 100;
  const debtRatio = (DEBT_RATIO[B.name] ?? (gdppc > 25000 ? 75 : gdppc > 10000 ? 60 : gdppc > 3000 ? 50 : 45)) / 100;
  const infl0 = Math.min(0.25, INFLATION0[B.name] ?? (gdppc > 20000 ? 0.03 : gdppc > 5000 ? 0.045 : 0.07));
  const stab0 = clamp(
    ({ D: 70, M: 64, F: 54, A: 54, C: 60 } as Record<string, number>)[B.gov] + 6 * Math.log10(Math.max(gdppc, 300) / 5000) - (FRAGILE.has(B.name) ? 22 : 0) + (rn('stab') - 0.5) * 8,
    18, 88,
  );

  const infra0 = clamp(22 + 22 * (lg + 0) + (INFRA_BONUS[B.name] ?? 0) + (rn('infra') - 0.5) * 8, 12, 88);
  const tech0 = clamp(10 + 30 * Math.log10(Math.max(gdppc, 300) / 400) + (TECH_BONUS[B.name] ?? 0), 8, 95);

  const infraSpend = needInfra(infra0);
  const industry = 0.01;
  const edu = clamp(0.03 + 0.01 * lg + (rn('edu') - 0.5) * 0.008, 0.02, 0.058);
  const intelSpend = Math.min(0.004, 0.08 * mil);
  const deficit = debtRatio > 1.2 ? 0.035 : B.gov === 'D' ? 0.03 : 0.022;
  const e: Economy = {
    pop, laborForce: pop * lfShare, lfShare,
    realGdp: gdp, price: 1, gdp, potential: gdp,
    capital: kOverY * gdp, tfp: 1, tfpTrend,
    infra: infra0, tech: tech0,
    energyCap: 0, energyDemand: 0, foodCap: 0, foodDemand: 0, energyUnmet: 0, foodUnmet: 0,
    debt: debtRatio * gdp, cash: 0.03 * gdp, reserves: 0.12 * gdp, avgRate: 0.03,
    inflation: infl0, unemployment: 0, uNat: clamp(0.045 + 0.05 * rn('u') + (gdppc < 3000 ? 0.02 : 0), 0.03, 0.14),
    monetary: 0, openness: clamp(0.95 * Math.pow(Math.max(B.gdpB, 0.5), -0.19), 0.1, 1.2), goodsBias: (rn('gb') - 0.5) * 0.04,
    exports: 0, imports: 0, tradeIndex: 1, sanctionShare: 0, blockade: 0,
    stability: stab0, damage: 0, savings: 0.2, baseGrowth: g0, baseSocial: 0, baseEdu: edu,
    baseTaxRevenue, collection, popGrowthMod: 0,
    revenue: revT * gdp, spending: 0, interest: 0, growth: g0, explain: {}, lastDefault: -9999,
    tradeBase: 1, prev: {}, occupation: 0,
  };
  e.unemployment = e.uNat;
  // starting borrowing cost: realistic by income level (Japan's huge debt is cheap because it is domestically held)
  const rate0 = B.name === 'Japan' ? 0.01 : (gdppc > 30000 ? 0.02 : gdppc > 12000 ? 0.03 : gdppc > 4000 ? 0.045 : 0.06) + Math.max(0, infl0 - 0.02) * 0.7 + (FRAGILE.has(B.name) ? 0.03 : 0);
  e.prev.rate0 = rate0;
  e.prev.raw0 = 0.8 * Math.max(0, e.inflation - 0.02) + 0.04 * Math.max(0, debtRatio - 0.6) + 0.1 * Math.max(0, 0.7 - e.stability / 100);
  e.avgRate = marketRate(e);
  e.interest = e.debt * e.avgRate;

  const spendTotal = revT + deficit;
  const social = Math.max(0.04, spendTotal - (e.interest / gdp) - mil - intelSpend - infraSpend - industry - edu);
  e.baseSocial = social;
  const budget: Budget = {
    taxIncome, taxCorporate, taxVat, social, infra: infraSpend, industry, education: edu, military: mil, intel: intelSpend,
    milArmy: 0.42, milAir: 0.33, milNavy: 0.25,
  };
  if (!coastal) { budget.milArmy = 0.55; budget.milAir = 0.43; budget.milNavy = 0.02; }
  else if (gdppc < 5000) { budget.milArmy = 0.6; budget.milAir = 0.22; budget.milNavy = 0.18; }

  // ---- military ----
  const troops = Math.max(B.troopsK * 1000, 50);
  const milBudget = mil * gdp;
  let unitCost = 1.6 * (0.8 * gdppc + 8000);
  if (milBudget > 0 && unitCost * troops > 0.6 * milBudget) unitCost = (0.6 * milBudget) / troops;
  unitCost = Math.max(unitCost, 800);
  const equip = Math.max((0.25 * milBudget) / 0.05, troops * 1500);
  const mi: Military = {
    troops,
    equipArmy: equip * budget.milArmy, equipAir: equip * budget.milAir, equipNavy: equip * budget.milNavy,
    readiness: 0.55 + 0.25 * clamp(B.milPct / 4, 0, 1), supply: 0.6,
    intel: clamp(0.2 + 0.25 * lg + (B.nuclear ? 0.1 : 0), 0.08, 0.9),
    milTech: clamp(tech0 + (MIL_EDGE[B.name] ?? 0) - (gdppc < 3000 ? 4 : 0), 5, 100), exhaustion: 0, casualties: 0,
    commit: 0.6, autoAdvance: true, focus: [], upkeep: 0, procurement: 0, nuclear: B.nuclear, warEconomy: false, unitCost,
  };

  const ag = clamp(
    AGGRESSION[B.name] ?? 0.15 + Math.min(0.5, 0.05 * B.milPct) + (B.gov === 'A' || B.gov === 'C' ? 0.12 : B.gov === 'D' ? -0.04 : 0.04) + 0.2 * rn('ag'),
    0.02, 1.3,
  );
  const ai: Personality = {
    aggression: ag,
    expansion: clamp(ag * (0.5 + rn('ex') * 0.7), 0, 1),
    trade: clamp(0.4 + 0.5 * rn('tr') + (B.popM < 20 && gdppc > 15000 ? 0.1 : 0), 0.2, 1),
    ideology: clamp((B.gov === 'A' || B.gov === 'C' ? 0.6 : 0.4) + 0.3 * rn('id'), 0, 1),
    caution: clamp(0.3 + 0.5 * rn('ca') + (B.gov === 'D' ? 0.1 : 0), 0.1, 1),
  };

  // resources (caps scaled globally later so the world market balances)
  const eInt = 0.065 * (gdppc < 6000 ? 1.15 : 1);
  const fShare = clamp(0.34 - 0.11 * Math.log10(Math.max(gdppc, 300) / 400), 0.035, 0.34);
  const tiny = B.popM < 1.5 && gdppc > 8000;
  const eRatio = ENERGY_RATIO[B.name] ?? (tiny ? 0.3 : RATIO_E[B.region] ?? 0.9);
  const fRatio = FOOD_RATIO[B.name] ?? (tiny ? 0.3 : RATIO_F[B.region] ?? 1);
  e.energyDemand = eInt * gdp;
  e.energyCap = eRatio * e.energyDemand;
  e.foodDemand = fShare * gdp;
  e.foodCap = fRatio * e.foodDemand;
  e.prev = { rate0: e.prev.rate0, raw0: e.prev.raw0, mil0: mil, troops0: troops, eInt, fPc: e.foodDemand / pop, gdppc0: gdppc, stab0, infl0, milEdge: mi.milTech - tech0 };
  e.savings = clamp((g0 + DELTA) * kOverY - 0.7 * industry, 0.05, 0.42);
  return { eco: e, budget, mil: mi, ai };
}

function pickHues(geo: Geo, nCountries: number): number[] {
  const nb: Set<number>[] = Array.from({ length: nCountries }, () => new Set());
  geo.adj.forEach((list, p) => {
    const a = geo.country0[p];
    for (const q of list) { const b = geo.country0[q]; if (a !== b) { nb[a].add(b); nb[b].add(a); } }
  });
  const hues = new Array(nCountries).fill(-1);
  const palette = [8, 28, 48, 70, 100, 140, 165, 190, 210, 232, 255, 280, 305, 330];
  const order = [...Array(nCountries).keys()].sort((a, b) => nb[b].size - nb[a].size);
  for (const c of order) {
    let best = palette[0], bestScore = -1;
    for (const h of palette) {
      let score = 360;
      for (const o of nb[c]) {
        if (hues[o] < 0) continue;
        const d = Math.abs(((h - hues[o] + 540) % 360) - 180);
        score = Math.min(score, 180 - d); // circular difference
      }
      score += hash01('hue', c, h) * 12;
      if (score > bestScore) { bestScore = score; best = h; }
    }
    hues[c] = best + Math.round((hash01('hj', c) - 0.5) * 14);
  }
  return hues;
}

export function createGame(geo: Geo, settings: Settings, player: number): GameState {
  const n = COUNTRY_BASE.length;
  const hues = pickHues(geo, n);
  const countries: Country[] = COUNTRY_BASE.map((B, id) => {
    const provs = geo.provs0[id];
    const coastal = provs.some((p) => geo.provinces[p].coast > 0.15);
    const { eco, budget, mil, ai } = initEconomy(B, coastal);
    const cap = provs.find((p) => geo.provinces[p].isCapital0) ?? provs[0];
    return {
      id, name: B.name, iso3: B.iso3, gov: B.gov, region: B.region, color: hues[id], estimated: B.estimated, alive: provs.length > 0,
      capital: cap, provinces: [...provs], eco, budget, mil, ai, reputation: 70, isPlayer: id === player,
      hist: { gdp: [], gdppc: [], debt: [], mil: [], stab: [], infl: [], unemp: [], pop: [], trade: [] },
      baseline: { gdp: eco.gdp, pop: eco.pop, provinces: provs.length }, lastWarDecl: -9999,
    };
  });

  const state: GameState = {
    version: 1, tick: 0, rng: settings.seed >>> 0, settings, player, countries,
    owner: geo.provinces.map((p) => p.country0), core: geo.provinces.map((p) => p.country0), integ: geo.provinces.map(() => 1),
    treaties: {}, relDelta: {}, wars: [], nextWarId: 1,
    market: { priceE: 1, priceF: 1, scarcityE: 0.9, scarcityF: 0.9 }, log: [], victory: null, worldHist: { gdp: [] }, offers: [], nextOfferId: 1, logSeq: 0, offerLog: {}, pendingEvent: null, eventCooldown: {}, lastEventTick: 0, goalsDone: {}, goalBase: { trade: 0, allies: 0, rank: 0, gdp: 0, tech: 0, debt: 0 }, intelUntil: {}, opCooldown: {},
  };

  // normalise energy & food so the world market is balanced at the start (supply 3% above demand)
  let sE = 0, dE = 0, sF = 0, dF = 0;
  for (const c of countries) { sE += c.eco.energyCap; dE += c.eco.energyDemand; sF += c.eco.foodCap; dF += c.eco.foodDemand; }
  for (const c of countries) { c.eco.energyCap *= (dE / sE) * 1.03; c.eco.foodCap *= (dF / sF) * 1.03; }

  // ---- initial treaties ----
  const ids = (names: string[]) => names.map((nm) => NAME_TO_ID[nm]).filter((x) => x !== undefined);
  const pairs = (list: number[], f: (a: number, b: number) => void) => { for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) f(list[i], list[j]); };
  pairs(ids(NATO), (a, b) => { ensureTreaty(state, a, b).alliance = true; });
  pairs(ids(CSTO), (a, b) => { ensureTreaty(state, a, b).alliance = true; });
  for (const [a, b] of BILATERAL_ALLIANCES) { const t = ensureTreaty(state, NAME_TO_ID[a], NAME_TO_ID[b]); t.alliance = true; t.coop = true; }
  pairs(ids(EU), (a, b) => { ensureTreaty(state, a, b).trade = true; });
  const trade = (names: string[]) => pairs(ids(names), (a, b) => { ensureTreaty(state, a, b).trade = true; });
  trade(['Brunei', 'Cambodia', 'Indonesia', 'Laos', 'Malaysia', 'Myanmar', 'Philippines', 'Singapore', 'Thailand', 'Vietnam']);
  trade(['Argentina', 'Brazil', 'Paraguay', 'Uruguay']);
  trade(['United States of America', 'Canada', 'Mexico']);
  trade(['Russia', 'Belarus', 'Kazakhstan', 'Armenia', 'Kyrgyzstan']);
  trade(['Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Kuwait', 'Bahrain', 'Oman']);
  trade(['Norway', 'Iceland', 'Switzerland', 'Liechtenstein']);
  for (const nm of ['Canada', 'Mexico', 'Japan', 'South Korea', 'Australia', 'United Kingdom', 'Israel', 'Colombia', 'Chile', 'Peru', 'Singapore', 'Philippines', 'Taiwan'])
    ensureTreaty(state, NAME_TO_ID['United States of America'], NAME_TO_ID[nm]).trade = true;
  for (const nm of ['Russia', 'Pakistan', 'Cambodia', 'Laos', 'Myanmar', 'Vietnam', 'Thailand', 'Singapore', 'Indonesia', 'Malaysia', 'Brazil', 'Australia', 'Kazakhstan', 'Iran', 'Saudi Arabia', 'South Korea', 'Japan'])
    ensureTreaty(state, NAME_TO_ID['China'], NAME_TO_ID[nm]).trade = true;
  for (const nm of ['United Kingdom', 'Switzerland', 'Norway', 'Japan', 'South Korea', 'Canada', 'Turkey'])
    for (const eu of ids(['Germany', 'France', 'Italy', 'Spain', 'Netherlands'])) ensureTreaty(state, NAME_TO_ID[nm], eu).trade = true;
  for (const [a, b] of [['India', 'United Arab Emirates'], ['India', 'Japan'], ['India', 'Russia'], ['Turkey', 'Russia'], ['Turkey', 'Azerbaijan'], ['Egypt', 'Saudi Arabia'], ['Brazil', 'China'], ['South Africa', 'China'], ['Nigeria', 'China'], ['Iran', 'Russia'], ['Iran', 'Iraq'], ['Ethiopia', 'China']])
    ensureTreaty(state, NAME_TO_ID[a], NAME_TO_ID[b]).trade = true;
  pairs(ids(['Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Kuwait', 'Bahrain', 'Oman']), (a, b) => { ensureTreaty(state, a, b).nap = true; });
  pairs(ids(['Brazil', 'Argentina', 'Chile', 'Uruguay', 'Paraguay', 'Colombia', 'Peru']), (a, b) => { ensureTreaty(state, a, b).nap = true; });
  pairs(ids(['Germany', 'France', 'Italy', 'Spain', 'Netherlands', 'Belgium', 'Austria', 'Switzerland', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Ireland']), (a, b) => { ensureTreaty(state, a, b).nap = true; });
  for (const [a, b] of [['United States of America', 'Japan'], ['United States of America', 'South Korea'], ['United States of America', 'Australia'], ['United States of America', 'United Kingdom'], ['United States of America', 'Israel']])
    ensureTreaty(state, NAME_TO_ID[a], NAME_TO_ID[b]).coop = true;

  // ---- calibrate each economy against the world aggregates ----
  const w = aggregateWorld(state);
  for (const c of countries) {
    const e = c.eco;
    e.tradeBase = 1 + Math.min(0.45, w.boost[c.id]);
    e.tfp = 1;
    const f = factors(c, 1);
    e.prev.F0 = demandSide(f);
    e.tfp = e.realGdp / potentialOutput(c, 1, 1);
    e.prev.tfp0 = e.tfp;
    e.prev.K0 = e.capital;
    e.potential = e.realGdp;
    e.explain = {};
    e.prev.milBase = equipTotal(c.mil);
    tradeFlows(c, state);
    e.prev.bal0 = (e.exports - e.imports) / e.gdp;
  }

  // ---- starting conditions apply to the player's country ----
  const P = countries[player];
  if (settings.start === 'crisis') {
    P.eco.debt *= 1.4; P.eco.cash = 0; P.eco.inflation = Math.min(0.2, P.eco.inflation + 0.04); P.eco.stability -= 10; P.eco.avgRate = marketRate(P.eco);
  } else if (settings.start === 'prosperous') {
    P.eco.cash = 0.12 * P.eco.gdp; P.eco.debt *= 0.75; P.eco.stability = Math.min(95, P.eco.stability + 5);
  }
  const ranked = [...countries].sort((a, b) => b.eco.gdp - a.eco.gdp);
  state.goalBase = {
    trade: Object.values(state.treaties).filter((t, i) => t.trade && Object.keys(state.treaties)[i].split('-').map(Number).includes(player)).length,
    allies: Object.keys(state.treaties).filter((k) => state.treaties[k].alliance && k.split('-').map(Number).includes(player)).length,
    rank: ranked.findIndex((c) => c.id === player) + 1, gdp: P.eco.gdp, tech: P.eco.tech, debt: P.eco.debt / P.eco.gdp,
  };
  logEvent(state, `Game begins January ${START_YEAR}. You lead ${P.name}.`, 'info', [player]);
  return state;
}
