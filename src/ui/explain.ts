import type { Country, GameState } from '../sim/types';
import { ALPHA, factors, fiscalNow, taxBurden } from '../sim/economy';
import { isAtWar } from '../sim/relations';
import { fmtMoney } from '../sim/util';

export const DRIVER_LABEL: Record<string, string> = {
  capital: 'Capital investment (factories, equipment)',
  labor: 'Workforce size & employment',
  tfp: 'Productivity & technology',
  infra: 'Infrastructure quality',
  energy: 'Energy supply & prices',
  trade: 'Trade access & sanctions',
  stability: 'Political stability',
  taxes: 'Tax burden',
  war: 'War damage & mobilisation',
  convergence: 'Adjustment lag (output catching up)',
};

export function drivers(c: Country): { key: string; label: string; v: number }[] {
  const ex = c.eco.explain;
  return Object.keys(DRIVER_LABEL).map((k) => ({ key: k, label: DRIVER_LABEL[k], v: ex[k] ?? 0 })).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
}

export function growthNarrative(c: Country): string {
  const g = c.eco.growth;
  const d = drivers(c).filter((x) => x.key !== 'convergence' && Math.abs(x.v) >= 0.0008);
  const pos = d.filter((x) => x.v > 0).slice(0, 2);
  const neg = d.filter((x) => x.v < 0).slice(0, 2);
  const pp = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)} pts`;
  let t = g >= 0 ? `Real GDP is growing ${(g * 100).toFixed(1)}% a year` : `Real GDP is shrinking ${(-g * 100).toFixed(1)}% a year`;
  if (pos.length) t += `, helped by ${pos.map((x) => `${x.label.toLowerCase()} (${pp(x.v)})`).join(' and ')}`;
  if (neg.length) t += `${pos.length ? ',' : ';'} held back by ${neg.map((x) => `${x.label.toLowerCase()} (${pp(x.v)})`).join(' and ')}`;
  return t + '.';
}

/** Level effects: how far below its full potential is the economy because of each factor? */
export function drags(c: Country, s: GameState): { label: string; pct: number; tip: string }[] {
  const f = factors(c, s.market.priceE);
  const out: { label: string; pct: number; tip: string }[] = [];
  const add = (label: string, factor: number, tip: string) => { if (factor < 0.995) out.push({ label, pct: (factor - 1) * 100, tip }); };
  add('Tax distortion', f.tax, `Total tax burden is ${(taxBurden(c.budget) * c.eco.collection * 100).toFixed(0)}% of GDP; very high rates discourage work and investment.`);
  add('Instability', f.stab, 'Unrest disrupts production and investment.');
  add('Energy shortage', f.energy, 'Not enough power for industry; build energy capacity or secure imports.');
  add('War damage', f.war, 'Bombing and fighting have destroyed productive capacity.');
  if (f.trade < 1) add('Trade barriers', f.trade, 'Sanctions, blockades or war have cut trade.');
  if (f.infra < 1) add('Weak infrastructure', f.infra, 'Poor roads, ports and grids reduce productivity.');
  return out;
}

export interface Alert { level: 'bad' | 'warn' | 'info'; text: string; tab?: 'economy' | 'military' | 'diplomacy' }
export function alertsFor(c: Country, s: GameState): Alert[] {
  const e = c.eco, out: Alert[] = [];
  const fn = fiscalNow(c, s);
  const bal = fn.balance / e.gdp;
  if (bal < -0.06) out.push({ level: 'bad', text: `Budget deficit is ${(-bal * 100).toFixed(1)}% of GDP (${fmtMoney(-fn.balance)}/yr). Debt is rising fast.`, tab: 'economy' });
  else if (bal < -0.035) out.push({ level: 'warn', text: `Deficit of ${(-bal * 100).toFixed(1)}% of GDP is adding to debt.`, tab: 'economy' });
  if (e.debt / e.gdp > 1.5) out.push({ level: 'bad', text: `Debt is ${(100 * e.debt / e.gdp).toFixed(0)}% of GDP; interest costs ${fmtMoney(e.interest)}/yr.`, tab: 'economy' });
  if (e.inflation > 0.08) out.push({ level: 'bad', text: `Inflation is ${(e.inflation * 100).toFixed(1)}%.`, tab: 'economy' });
  if (e.unemployment > e.uNat + 0.04) out.push({ level: 'warn', text: `Unemployment is ${(e.unemployment * 100).toFixed(1)}% (normal ${(e.uNat * 100).toFixed(1)}%).`, tab: 'economy' });
  if (e.energyUnmet > 0.03) out.push({ level: 'bad', text: `Energy shortage: ${(e.energyUnmet * 100).toFixed(0)}% of demand unmet.`, tab: 'economy' });
  if (e.foodUnmet > 0.03) out.push({ level: 'bad', text: `Food shortage: ${(e.foodUnmet * 100).toFixed(0)}% of demand unmet. Famine threatens stability.`, tab: 'economy' });
  if (e.stability < 30) out.push({ level: 'bad', text: `Stability is critical (${e.stability.toFixed(0)}). Risk of upheaval.`, tab: 'economy' });
  else if (e.stability < 45) out.push({ level: 'warn', text: `Stability is low (${e.stability.toFixed(0)}).`, tab: 'economy' });
  if (e.sanctionShare > 0.1) out.push({ level: 'warn', text: `Sanctions are costing you ${(e.sanctionShare * 100).toFixed(0)}% of trade access.`, tab: 'diplomacy' });
  if (e.blockade > 0.1) out.push({ level: 'bad', text: `Naval blockade cuts ${(e.blockade * 100).toFixed(0)}% of sea trade.`, tab: 'military' });
  if (isAtWar(s, c.id)) out.push({ level: 'warn', text: `At war. Exhaustion ${(c.mil.exhaustion * 100).toFixed(0)}%.`, tab: 'military' });
  if (c.mil.readiness < 0.5) out.push({ level: 'warn', text: `Military readiness is only ${(c.mil.readiness * 100).toFixed(0)}%: the budget does not cover upkeep.`, tab: 'military' });
  if (e.occupation > 0.15) out.push({ level: 'warn', text: `Recently conquered land is causing unrest (${(e.occupation * 100).toFixed(0)}%).`, tab: 'economy' });
  void ALPHA;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Stability, sectors, trade profile, advisor, briefing
// ---------------------------------------------------------------------------------------------
import type { Geo } from '../sim/geo';
import { actPropose, actMediate, actCallAllies, buildProject, actBuild, setBudget, type ActionResult } from '../sim/actions';
import { evaluateProposal } from '../sim/diplomacy';
import { alliesOf, areAtWar as warBetween2, getRelation, partnersOf, enemiesOf } from '../sim/relations';
import { strength } from '../sim/military';
import { dateLabel } from '../sim/tick';
import { levelOf } from '../sim/buildings';
import { neighborsOf } from '../sim/diplomacy';

export const STAB_LABEL: Record<string, string> = {
  base: 'Underlying stability (government type & wealth)', growth: 'Economic growth', jobs: 'Unemployment', prices: 'Inflation',
  services: 'Public services', taxes: 'Tax burden', war: 'War weariness & damage', shortages: 'Food & energy shortages', occupation: 'Unrest in conquered land', debt: 'Debt crisis',
};
export function stabilityParts(c: Country): { key: string; label: string; v: number }[] {
  const p = c.eco.stabParts ?? {};
  return Object.keys(STAB_LABEL).map((k) => ({ key: k, label: STAB_LABEL[k], v: p[k] ?? 0 }));
}

export interface Sector { key: string; label: string; share: number; color: string }
/** Rough breakdown of the economy by sector (game-derived from income level, capital and resource balance). */
export function sectorsOf(c: Country): Sector[] {
  const e = c.eco;
  const gdppc = e.gdp / Math.max(e.pop, 1);
  const agri = Math.min(0.4, Math.max(0.012, (0.4 - 0.1 * Math.log10(Math.max(gdppc, 400) / 400)) * Math.pow(Math.min(1.6, Math.max(0.5, e.foodCap / Math.max(e.foodDemand, 1))), 0.4) * 0.55));
  const energy = Math.min(0.14, Math.max(0.01, 0.045 * Math.min(2.5, e.energyCap / Math.max(e.energyDemand, 1)) + 0.01));
  const industry = Math.min(0.45, Math.max(0.1, 0.18 + 0.09 * (e.capital / Math.max(e.realGdp, 1) - 2.8) + 0.03 * Math.min(1.5, e.tech / 60)));
  const services = Math.max(0.1, 1 - agri - energy - industry);
  return [
    { key: 'agri', label: 'Agriculture', share: agri, color: '#7fbf5a' },
    { key: 'energy', label: 'Energy & mining', share: energy, color: '#e0a23c' },
    { key: 'industry', label: 'Industry', share: industry, color: '#5eaaff' },
    { key: 'services', label: 'Services', share: services, color: '#b48cf0' },
  ];
}

export interface Partner { id: number; share: number; volume: number }
/** Estimated export markets (shares are game-derived from partner size, relations and agreements). */
export function tradeProfile(s: GameState, c: Country): Partner[] {
  const raw: { id: number; w: number }[] = [];
  for (const o of s.countries) {
    if (!o.alive || o.id === c.id) continue;
    const rel = getRelation(s, c.id, o.id);
    const agreed = partnersOf(s, c.id, 'trade').includes(o.id);
    const w = Math.sqrt(o.eco.gdp) * (agreed ? 2.4 : 1) * (rel > 0 ? 1 : 0.35) * (rel < -50 ? 0.2 : 1);
    raw.push({ id: o.id, w });
  }
  raw.sort((a, b) => b.w - a.w);
  const top = raw.slice(0, 40);
  const tot = top.reduce((t, x) => t + x.w, 0) || 1;
  return top.slice(0, 6).map((x) => ({ id: x.id, share: x.w / tot, volume: (x.w / tot) * c.eco.exports }));
}

export interface Advice { id: string; level: 'urgent' | 'tip' | 'opportunity'; text: string; label: string; run: (s: GameState, geo: Geo) => ActionResult }
export function advisor(c: Country, s: GameState, geo: Geo): Advice[] {
  const e = c.eco, out: Advice[] = [];
  const fn = fiscalNow(c, s);
  const bal = fn.balance / e.gdp;
  const allies = alliesOf(s, c.id);
  const rivals = s.countries.filter((x) => x.alive && x.id !== c.id && getRelation(s, c.id, x.id) < -30);
  if (e.cash < 0.002 * e.gdp && bal < -0.03)
    out.push({ id: 'deficit', level: 'urgent', text: `The treasury is nearly empty and the deficit is ${(-bal * 100).toFixed(1)}% of GDP.`, label: c.budget.military > 0.02 ? 'Trim defence budget by 0.5% of GDP' : 'Raise VAT by 1 point',
      run: (g) => c.budget.military > 0.02 ? setBudget(g, g.player, 'military', c.budget.military - 0.005) : setBudget(g, g.player, 'taxVat', c.budget.taxVat + 0.01) });
  if (e.stability < 42)
    out.push({ id: 'unrest', level: 'urgent', text: `Stability is only ${e.stability.toFixed(0)}: ${stabilityParts(c).filter((p) => p.v < -2 && p.key !== 'base').sort((a, b) => a.v - b.v)[0]?.label.toLowerCase() ?? 'unrest'} is the biggest drag.`, label: 'Raise public services by 0.5% of GDP',
      run: (g) => setBudget(g, g.player, 'social', c.budget.social + 0.005) });
  if (e.unemployment > e.uNat + 0.035)
    out.push({ id: 'jobs', level: 'tip', text: `Unemployment is ${(e.unemployment * 100).toFixed(1)}%, well above normal.`, label: 'Build factories (1% of GDP)', run: (g) => buildProject(g, g.player, 'industry', 0.01) });
  if (e.energyCap < e.energyDemand * 0.88)
    out.push({ id: 'energy', level: 'tip', text: `You produce only ${((e.energyCap / e.energyDemand) * 100).toFixed(0)}% of the energy you use; shortages cut output.`, label: 'Build power plants (1% of GDP)', run: (g) => buildProject(g, g.player, 'energy', 0.01) });
  if (e.foodCap < e.foodDemand * 0.85)
    out.push({ id: 'food', level: 'tip', text: `Food self-sufficiency is ${((e.foodCap / e.foodDemand) * 100).toFixed(0)}%. A blockade or embargo would hurt.`, label: 'Expand farms (1% of GDP)', run: (g) => buildProject(g, g.player, 'farms', 0.01) });
  if (allies.length === 0 && rivals.length > 0) {
    const cand = s.countries.filter((x) => x.alive && x.id !== c.id && getRelation(s, c.id, x.id) > 20 && strength(x) > strength(c) * 0.7).map((x) => ({ x, ev: evaluateProposal(s, geo, c.id, x.id, 'alliance') })).sort((a, b) => b.ev.score - a.ev.score)[0];
    if (cand) out.push({ id: 'ally', level: 'tip', text: `You stand alone while rivals circle. ${cand.x.name} is the most likely partner (${cand.ev.accept ? 'likely to accept' : 'worth a try'}).`, label: `Propose an alliance to ${cand.x.name}`, run: (g, ge) => actPropose(g, ge, g.player, cand.x.id, 'alliance') });
  }
  const strongNeighbor = neighborsOf(s, geo, c.id).filter((x) => getRelation(s, c.id, x) < 10 && strength(s.countries[x]) > strength(c) * 1.3)[0];
  if (strongNeighbor !== undefined) {
    const front = c.provinces.filter((p) => geo.adj[p].some((q) => s.owner[q] === strongNeighbor)).sort((a, b) => levelOf(s, a, 'fort') - levelOf(s, b, 'fort'))[0];
    if (front !== undefined && levelOf(s, front, 'fort') < 2)
      out.push({ id: 'fort', level: 'tip', text: `${s.countries[strongNeighbor].name} is stronger than you and relations are cold.`, label: `Fortify ${geo.provinces[front].name}`, run: (g, ge) => actBuild(g, ge, g.player, front, 'fort') });
  }
  const wars = enemiesOf(s, c.id);
  if (wars.length && allies.length) out.push({ id: 'callallies', level: 'tip', text: `You are fighting ${s.countries[wars[0]].name}. Your allies have not all joined.`, label: 'Call allies to the war', run: (g) => actCallAllies(g, g.player) });
  const stale = s.wars.find((w) => !w.attackers.includes(c.id) && !w.defenders.includes(c.id) && s.tick - w.start > 30 && s.countries[w.attackers[0]]?.alive && s.countries[w.defenders[0]]?.alive && s.countries[w.attackers[0]].mil.exhaustion + s.countries[w.defenders[0]].mil.exhaustion > 0.5);
  if (stale) out.push({ id: 'mediate', level: 'opportunity', text: `${name2(s, stale.attackers[0])} and ${name2(s, stale.defenders[0])} are exhausted: a good moment to broker peace.`, label: 'Offer mediation (0.25% of GDP)', run: (g, ge) => actMediate(g, ge, g.player, stale.id) });
  if (e.cash > 0.05 * e.gdp) out.push({ id: 'idle', level: 'opportunity', text: `You are sitting on ${fmtMoney(e.cash)} of idle cash.`, label: 'Invest in infrastructure (1% of GDP)', run: (g) => buildProject(g, g.player, 'infra', 0.01) });
  const order = { urgent: 0, tip: 1, opportunity: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]).slice(0, 4);
}
const name2 = (s: GameState, id: number) => s.countries[id].name;

export function briefing(s: GameState, c: Country): { lines: string[]; since: string } {
  const h = c.hist;
  const lines: string[] = [];
  if (h.gdp.length >= 4) {
    const a = h.gdp[h.gdp.length - 4], b = h.gdp[h.gdp.length - 1];
    const d = (b / a - 1) * 100;
    lines.push(`GDP ${d >= 0 ? 'up' : 'down'} ${Math.abs(d).toFixed(1)}% over the last 12 weeks.`);
  }
  if (h.stab.length >= 4) {
    const d = h.stab[h.stab.length - 1] - h.stab[h.stab.length - 4];
    if (Math.abs(d) >= 1) lines.push(`Stability ${d > 0 ? 'rose' : 'fell'} by ${Math.abs(d).toFixed(0)} points.`);
  }
  const recent = s.log.filter((l) => s.tick - l.tick <= 12 && (l.important || l.countries.includes(c.id)));
  const wars = recent.filter((l) => l.kind === 'war').length, diplo = recent.filter((l) => l.kind === 'diplo').length;
  if (wars) lines.push(`${wars} war development${wars > 1 ? 's' : ''} in the news.`);
  if (diplo) lines.push(`${diplo} diplomatic move${diplo > 1 ? 's' : ''} you should know about.`);
  const t = recent[recent.length - 1];
  if (t) lines.push(`Latest: ${t.text}`);
  if (!lines.length) lines.push('A quiet period. Use it to build.');
  return { lines, since: dateLabel(Math.max(0, s.tick - 12)) };
}
void warBetween2;
