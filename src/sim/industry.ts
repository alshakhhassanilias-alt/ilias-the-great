/**
 * Industries and world markets: what your country makes, and who it competes with.
 *
 * Eight sectors (farming, energy, mining, heavy industry, manufacturing, electronics and chips, the defence industry,
 * finance and services). Every country has a capacity in each; its production is that capacity times the size of its
 * economy, and its share of world production ranks it ("the world's #3 steel maker").
 *
 * Each sector trades on a world market. Demand grows with the world economy (and swings with booms and gluts); supply
 * grows as countries build capacity. The price follows: build into a scarce, booming market and every level pays well;
 * pile into a glut and it pays little. Every country invests (the AI by its own strategy), so the market keeps moving.
 *
 * You expand a sector with an investment programme: it costs money and time, each level dearer than the last, and the
 * advanced sectors need the research (and the energy) to back them. Each level adds to output (more in a dear market)
 * and has its own payoff: food, energy, cheaper weapons, technology, tax revenue.
 */
import { clamp, fmtMoney, keyOf } from './util';
import { hash01, nextRand } from './rng';
import { logEvent } from './log';
import { fund } from './actions';
import { ensureResearch } from './research';
import type { Country, GameState } from './types';

export type SectorId = 'agri' | 'energy' | 'mining' | 'heavy' | 'manuf' | 'tech' | 'arms' | 'services';
export const SECTORS: { id: SectorId; icon: string; name: string; maker: string; w: number; desc: string; payoff: string; branch: number; costK: number }[] = [
  { id: 'agri', icon: '🌾', name: 'Farming & food', maker: 'food producer', w: 0.6, desc: 'Grain, meat and the food industry.', payoff: 'Food output +6% per level', branch: 3, costK: 0.8 },
  { id: 'energy', icon: '🛢', name: 'Energy', maker: 'energy producer', w: 0.7, desc: 'Oil, gas, power stations and the grid.', payoff: 'Energy output +6% per level', branch: 1, costK: 1.1 },
  { id: 'mining', icon: '⛏', name: 'Mining & metals', maker: 'mining nation', w: 0.6, desc: 'Ores, lithium, rare earths and the refineries.', payoff: 'Export earnings: treasury income that rises with the price', branch: 0, costK: 0.9 },
  { id: 'heavy', icon: '🏗', name: 'Steel & heavy industry', maker: 'steel maker', w: 0.8, desc: 'Steel, cement, shipyards and machine tools.', payoff: 'Infrastructure +1 and capital +1% per level', branch: 0, costK: 1 },
  { id: 'manuf', icon: '🚗', name: 'Manufacturing', maker: 'manufacturer', w: 1, desc: 'Cars, machinery, consumer goods.', payoff: 'Exports and jobs: the biggest share of output', branch: 0, costK: 1 },
  { id: 'tech', icon: '💾', name: 'Electronics & chips', maker: 'chip maker', w: 1.1, desc: 'Semiconductors, computers, phones.', payoff: 'Technology +1 and military technology +0.5 per level', branch: 2, costK: 1.4 },
  { id: 'arms', icon: '🛡', name: 'Defence industry', maker: 'arms maker', w: 0.5, desc: 'Tanks, aircraft, missiles and ships.', payoff: 'Army costs −3% per level; arms sales abroad win influence', branch: 4, costK: 1.2 },
  { id: 'services', icon: '🏦', name: 'Finance & services', maker: 'financial centre', w: 1.2, desc: 'Banks, insurance, software, tourism.', payoff: 'Tax collection +0.5% per level', branch: 2, costK: 1 },
];
export const sectorById = (id: SectorId) => SECTORS.find((x) => x.id === id)!;
const IDS = SECTORS.map((x) => x.id);

/** Who leads each sector today (rough, 2023-24): extra starting capacity. */
const STRONG: Partial<Record<SectorId, Record<string, number>>> = {
  agri: { 'United States of America': 2, Brazil: 2.5, Argentina: 2, Ukraine: 2, Russia: 1.5, Australia: 1.5, Canada: 1.5, France: 1, India: 1, Thailand: 1, 'New Zealand': 1.5, Netherlands: 1 },
  energy: { 'Saudi Arabia': 3, Russia: 3, 'United States of America': 2, Qatar: 3, 'United Arab Emirates': 2.5, Norway: 2.5, Iran: 2, Iraq: 2, Kuwait: 2.5, Canada: 2, Kazakhstan: 1.5, Algeria: 1.5, Nigeria: 1, Australia: 1.5, Venezuela: 1.5 },
  mining: { China: 2.5, Australia: 3, Chile: 3, 'Dem. Rep. Congo': 2.5, Indonesia: 2, Russia: 2, 'South Africa': 2, Peru: 2, Brazil: 1.5, Zambia: 1.5, Kazakhstan: 1.5, Canada: 1.5 },
  heavy: { China: 3, Japan: 2, 'South Korea': 2, India: 1.5, Germany: 1.5, Russia: 1.5, Turkey: 1, 'United States of America': 1, Brazil: 1 },
  manuf: { China: 3, Germany: 2.5, Japan: 2.5, 'South Korea': 2, 'United States of America': 1.5, Mexico: 1.5, Italy: 1.5, Vietnam: 1.5, Czechia: 1.5, Poland: 1, Thailand: 1, Turkey: 1, India: 1, Taiwan: 2 },
  tech: { Taiwan: 4, 'South Korea': 3, 'United States of America': 2.5, Japan: 2, China: 2, Netherlands: 1.5, Israel: 1.5, Singapore: 1.5, Malaysia: 1.5, Germany: 1, Ireland: 1, Vietnam: 1 },
  arms: { 'United States of America': 4, Russia: 3, France: 2, China: 2, Germany: 1.5, 'United Kingdom': 1.5, Israel: 1.5, Italy: 1, 'South Korea': 1.5, Turkey: 1, Sweden: 1, Spain: 0.5, Ukraine: 0.5 },
  services: { 'United States of America': 2.5, 'United Kingdom': 2.5, Switzerland: 2.5, Singapore: 2.5, Luxembourg: 2.5, Ireland: 2, Netherlands: 1.5, Japan: 1, Germany: 1, France: 1, 'Hong Kong': 2, 'United Arab Emirates': 1.5, Thailand: 1, Greece: 1, Spain: 1 },
};

export interface Industry { lv: Record<SectorId, number>; lv0: Record<SectorId, number>; prog?: { id: SectorId; start: number; until: number; cost: number }[] }

export function initIndustry(c: Country): Industry {
  const e = c.eco, k = keyOf(c);
  const gdppc = e.gdp / Math.max(1, e.pop);
  const rich = clamp(Math.log(Math.max(1000, gdppc) / 2000) / Math.log(30), 0, 1); // 0 poor … 1 rich
  const base: Record<SectorId, number> = {
    agri: 2 + 2 * clamp(e.foodCap / Math.max(1, e.foodDemand) - 0.6, 0, 1.4),
    energy: 1.5 + 2 * clamp(e.energyCap / Math.max(1, e.energyDemand) - 0.4, 0, 1.6),
    mining: 1.2 + 0.8 * hash01('mine', c.id),
    heavy: 1.2 + 1.8 * clamp(e.tech / 100, 0, 1),
    manuf: 1.2 + 2 * clamp(e.tech / 100, 0, 1) * (0.6 + e.openness * 0.4),
    tech: 0.6 + 2.2 * clamp((e.tech - 40) / 60, 0, 1),
    arms: 0.5 + 1.8 * clamp((c.mil.milTech - 35) / 65, 0, 1),
    services: 1 + 2.6 * rich,
  };
  for (const id of IDS) base[id] = +(base[id] + (STRONG[id]?.[k] ?? 0)).toFixed(2);
  return { lv: { ...base }, lv0: { ...base } };
}
export function ensureIndustry(c: Country): Industry {
  if (!c.ind) c.ind = initIndustry(c);
  return c.ind;
}

// ------------------------------------------------------------------ the world market
/** How much a country produces in a sector: capacity times the size of its economy. */
const prodOf = (c: Country, id: SectorId) => (c.ind?.lv[id] ?? 0) * Math.pow(Math.max(1e9, c.eco.realGdp) / 1e12, 0.7);
export interface MarketState { price: Record<SectorId, number>; avgX?: number; supply0?: Record<SectorId, number>; demand0?: number; shock?: { id: SectorId; k: number; until: number; text: string } | null; ranks?: Record<SectorId, number[]>; shares?: Record<SectorId, Record<number, number>> }
export function marketOf(s: GameState): MarketState {
  if (!s.mkt) s.mkt = { price: Object.fromEntries(IDS.map((id) => [id, 1])) as Record<SectorId, number>, shock: null };
  return s.mkt;
}

/** Monthly: recompute world supply, demand, prices, shares and rankings. */
function stepMarket(s: GameState) {
  const m = marketOf(s);
  const alive = s.countries.filter((c) => c.alive);
  const worldGdp = alive.reduce((t, c) => t + c.eco.realGdp, 0);
  const supply: Record<SectorId, number> = Object.fromEntries(IDS.map((id) => [id, 0])) as Record<SectorId, number>;
  for (const c of alive) { ensureIndustry(c); for (const id of IDS) supply[id] += prodOf(c, id); }
  if (!m.supply0) { m.supply0 = { ...supply }; m.demand0 = worldGdp; }
  const dem = worldGdp / (m.demand0 || worldGdp);
  for (const id of IDS) {
    const shock = m.shock && m.shock.id === id && s.tick < m.shock.until ? m.shock.k : 1;
    // demand for goods grows a little slower than the world economy, services a little faster
    const d = Math.pow(dem, id === 'services' || id === 'tech' ? 1.03 : id === 'agri' || id === 'mining' ? 0.9 : 0.95) * shock;
    const sup = supply[id] / Math.max(1e-9, m.supply0[id]);
    const target = clamp(Math.pow(d / Math.max(0.2, sup), 1.3), 0.45, 2.6);
    m.price[id] += (target - m.price[id]) * 0.25; // markets adjust over months
  }
  // shares and the top producers
  m.ranks = {} as Record<SectorId, number[]>; m.shares = {} as Record<SectorId, Record<number, number>>;
  for (const id of IDS) {
    const list = alive.map((c) => ({ id: c.id, p: prodOf(c, id) })).sort((a, b) => b.p - a.p);
    m.ranks[id] = list.slice(0, 10).map((x) => x.id);
    const sh: Record<number, number> = {};
    for (const x of list) sh[x.id] = x.p / Math.max(1e-9, supply[id]);
    m.shares[id] = sh;
  }
  // the world's average industrial build-up (the yardstick for industryFactor)
  let ax = 0, aw = 0;
  for (const c of alive) { const w = Math.sqrt(c.eco.gdp); ax += w * industryX(s, c); aw += w; }
  m.avgX = ax / Math.max(1, aw);
  if (m.shock && s.tick >= m.shock.until) {
    logEvent(s, `${sectorById(m.shock.id).icon} The ${m.shock.k > 1 ? 'boom' : 'glut'} in ${sectorById(m.shock.id).name.toLowerCase()} is over; the market settles.`, 'econ', [], false);
    m.shock = null;
  }
  // now and then a sector booms or gluts (a chip shortage, a steel glut, an oil shock)
  if (!m.shock && s.tick > 26 && nextRand(s) < 0.025) {
    const id = IDS[Math.floor(nextRand(s) * IDS.length)];
    const up = nextRand(s) < 0.55;
    const TEXT: Record<SectorId, [string, string]> = {
      agri: ['Failed harvests on three continents: food prices soar', 'Record harvests everywhere: farm prices collapse'],
      energy: ['An energy crunch: oil and gas prices spike', 'An oil glut: energy prices slump'],
      mining: ['A scramble for battery metals: mining prices soar', 'A mining glut: metal prices slump'],
      heavy: ['A world construction boom: steel is scarce', 'A steel glut: mills run half empty'],
      manuf: ['A consumer boom: factories cannot keep up', 'Weak demand: warehouses fill with unsold goods'],
      tech: ['A chip shortage: semiconductor prices soar', 'A chip glut: semiconductor prices crash'],
      arms: ['A world arms race: defence orders pile up', 'Peace dividend: arms orders dry up'],
      services: ['A financial boom: banks and software firms thrive', 'A financial crunch: banks retrench'],
    };
    m.shock = { id, k: up ? 1.35 : 0.72, until: s.tick + 78 + Math.floor(nextRand(s) * 78), text: TEXT[id][up ? 0 : 1] };
    logEvent(s, `${sectorById(id).icon} WORLD MARKETS: ${m.shock.text}.`, 'econ', [], true);
  }
}

// ------------------------------------------------------------------ effects
/** Industry built since the start, worth more in dear markets, with diminishing returns (a share of output). */
function industryX(s: GameState, c: Country): number {
  const ind = c.ind;
  if (!ind) return 0;
  const m = marketOf(s);
  let x = 0;
  for (const sec of SECTORS) {
    const d = ind.lv[sec.id] - ind.lv0[sec.id];
    const eff = d > 0 ? d / (1 + 0.12 * d) : d; // each extra level adds a little less
    x += 0.012 * sec.w * eff * Math.sqrt(m.price[sec.id]);
  }
  return x;
}
/**
 * The output multiplier from industry: what you have built (and what it is worth on today's markets) against what the
 * average country has built. The whole world investing at the usual pace changes nothing; out-building it pays.
 */
export function industryFactor(s: GameState, c: Country): number {
  if (!c.ind) return 1;
  return clamp(1 + industryX(s, c) - (marketOf(s).avgX ?? 0), 0.85, 1.4);
}
/** Monthly treasury income from mining and arms exports above the starting capacity (a little more in a dear market). */
export function exportEarnings(s: GameState, c: Country): number {
  const ind = c.ind;
  if (!ind) return 0;
  const m = marketOf(s);
  const mine = Math.max(0, ind.lv.mining - ind.lv0.mining) * 0.0012 * m.price.mining;
  const arms = Math.max(0, ind.lv.arms - ind.lv0.arms) * 0.0006 * m.price.arms;
  return (mine + arms) * c.eco.gdp; // a year
}
/** cheaper weapons from a home defence industry (on the level rounded to a tenth, the same granularity mods() caches on) */
export const armsCostMult = (c: Country) => (c.ind ? clamp(1 - 0.03 * Math.max(0, Math.round(c.ind.lv.arms * 10) / 10 - Math.round(c.ind.lv0.arms * 10) / 10), 0.7, 1) : 1);
export const industryKey = (c: Country) => (c.ind ? Math.round(c.ind.lv.arms * 10) : -1);

function levelUp(s: GameState, c: Country, id: SectorId, amount: number) {
  const ind = ensureIndustry(c), e = c.eco;
  ind.lv[id] = +(ind.lv[id] + amount).toFixed(3);
  switch (id) {
    case 'agri': e.foodCap *= 1 + 0.06 * amount; break;
    case 'energy': e.energyCap *= 1 + 0.06 * amount; break;
    case 'heavy': e.infra = clamp(e.infra + 1 * amount, 5, 100); e.capital *= 1 + 0.01 * amount; break;
    case 'tech': e.tech = clamp(e.tech + 1 * amount, 5, 100); c.mil.milTech = clamp(c.mil.milTech + 0.5 * amount, 0, 140); break;
    case 'services': e.collection = clamp(e.collection + 0.005 * amount, 0.3, 1); break;
    default: break;
  }
}

// ------------------------------------------------------------------ expansion
export const MAX_PROGS = 2;
/** What it takes to add the next level to a sector: cost, weeks, and anything that stands in the way. */
export function expansionOf(s: GameState, c: Country, id: SectorId): { cost: number; weeks: number; why: string | null } {
  const ind = ensureIndustry(c), sec = sectorById(id);
  const built = ind.lv[id] - ind.lv0[id];
  const cost = 0.005 * sec.costK * c.eco.gdp * Math.pow(1.22, Math.max(0, built));
  const weeks = Math.round(26 + 6 * Math.max(0, built));
  const rs = ensureResearch(c);
  const need = Math.floor(ind.lv[id] / 2) - 1; // the research rung this level needs
  let why: string | null = null;
  if (rs.lv[sec.branch] < need) why = `Needs rung ${need} in ${['Industry', 'Energy', 'Digital', 'Society', 'Defence'][sec.branch]} research (you have ${rs.lv[sec.branch]})`;
  else if ((id === 'heavy' || id === 'manuf' || id === 'tech') && built >= 2 && c.eco.energyCap < 0.85 * c.eco.energyDemand) why = 'Your energy supply cannot power more industry: build energy first (you make less than 85% of what you use)';
  else if ((id === 'tech' || id === 'services') && c.eco.tech < 30 + 6 * ind.lv[id]) why = `Needs a more advanced workforce (technology ${(30 + 6 * ind.lv[id]).toFixed(0)}; you have ${c.eco.tech.toFixed(0)})`;
  else if (ind.prog?.some((p) => p.id === id)) why = 'Already expanding';
  else if ((ind.prog?.length ?? 0) >= MAX_PROGS) why = `At most ${MAX_PROGS} programmes at a time`;
  return { cost, weeks, why };
}
export function actExpandSector(s: GameState, id: SectorId) {
  const c = s.countries[s.player];
  const x = expansionOf(s, c, id);
  if (x.why) return { ok: false, message: x.why };
  const f = fund(s, c.id, x.cost, `${sectorById(id).name}: expansion`);
  if (!f.ok) return f;
  const ind = ensureIndustry(c);
  (ind.prog ??= []).push({ id, start: s.tick, until: s.tick + x.weeks, cost: x.cost });
  return { ok: true, message: `${sectorById(id).icon} Expansion of ${sectorById(id).name.toLowerCase()} under way: ready in ${x.weeks} weeks. ${f.message}` };
}
export function actCancelExpansion(s: GameState, id: SectorId) {
  const ind = ensureIndustry(s.countries[s.player]);
  const before = ind.prog?.length ?? 0;
  ind.prog = (ind.prog ?? []).filter((p) => p.id !== id);
  return before !== ind.prog.length ? { ok: true, message: 'Programme cancelled (the money spent is gone).' } : { ok: false, message: 'Nothing to cancel' };
}

/** Where your country stands in a sector: rank, world share, price. */
export function sectorStanding(s: GameState, c: Country, id: SectorId) {
  const m = marketOf(s);
  const share = m.shares?.[id]?.[c.id] ?? 0;
  const rank = m.shares?.[id] ? 1 + Object.values(m.shares[id]).filter((v) => v > share).length : 0;
  return { lv: ensureIndustry(c).lv[id], share, rank, price: m.price[id], leaders: m.ranks?.[id] ?? [] };
}

// ------------------------------------------------------------------ the AI
/**
 * Monthly: industries grow with the economy on their own (firms invest), a little faster where the market pays and in
 * what suits the country. AI governments add to it; for the player this natural growth is slower: the rest is up to you.
 */
function drift(s: GameState, c: Country, k: number) {
  const ind = ensureIndustry(c), m = marketOf(s);
  const g = clamp(c.eco.growth, -0.05, 0.08);
  const rich = c.eco.gdp / Math.max(1, c.eco.pop) > 15000;
  for (const sec of SECTORS) {
    const fit = sec.id === 'services' ? (rich ? 1.2 : 0.7) : sec.id === 'arms' ? 0.5 + (c.ai?.aggression ?? 0.5) * 0.6 : 1;
    if (expansionOf(s, c, sec.id).why?.startsWith('Needs')) continue;
    // about as fast as demand grows at the going price: a dear market draws investment, a glut chokes it off
    const v = ind.lv[sec.id] * (0.001 + 0.22 * Math.max(0, g)) * fit * (0.3 + 0.7 * m.price[sec.id]) * k / 12;
    ind.lv[sec.id] += Math.max(0, v) * (0.6 + 0.8 * hash01('inv', c.id, sec.id.length, Math.floor(s.tick / 52)));
  }
}

// ------------------------------------------------------------------ the weekly step
export function stepIndustry(s: GameState) {
  if (s.tick % 4 === 0) stepMarket(s);
  const P = s.countries[s.player];
  for (const c of s.countries) {
    if (!c.alive) continue;
    const ind = ensureIndustry(c);
    if (s.tick % 4 !== c.id % 4) continue;
    drift(s, c, c.id === s.player ? 0.5 : 1);
    c.eco.prev.indF = industryFactor(s, c);
    c.eco.prev.exportInc = exportEarnings(s, c); // booked as revenue in economy.ts
    void ind;
  }
  // the player's programmes complete
  const ind = P.alive ? ensureIndustry(P) : null;
  for (const p of [...(ind?.prog ?? [])]) {
    if (s.tick < p.until) continue;
    ind!.prog = ind!.prog!.filter((x) => x !== p);
    levelUp(s, P, p.id, 1);
    P.eco.prev.indF = industryFactor(s, P);
    const st = sectorStanding(s, P, p.id);
    logEvent(s, `${sectorById(p.id).icon} INDUSTRY: the ${sectorById(p.id).name.toLowerCase()} expansion is complete (level ${st.lv.toFixed(1)}). ${sectorById(p.id).payoff}.`, 'econ', [P.id], true);
  }
}
export { fmtMoney };
