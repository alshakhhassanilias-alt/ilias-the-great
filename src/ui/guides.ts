/**
 * Guides that help the player improve their country. How much help appears depends on difficulty:
 *   easy   – full guidance: explanations, how-to tips and one-tap fixes
 *   normal – limited: status lights, short tips, a single top priority
 *   hard   – none: you read the numbers yourself
 */
import type { Geo } from '../sim/geo';
import type { Country, GameState } from '../sim/types';
import type { Tab } from '../state/store';
import { fiscalNow } from '../sim/economy';
import { strength } from '../sim/military';
import { alliesOf, getRelation, isAtWar, partnersOf, sanctionLevel } from '../sim/relations';
import { neighborsOf, evaluateProposal } from '../sim/diplomacy';
import { levelOf } from '../sim/buildings';
import { actBuild, actPropose, buildProject, recruit, setBudget, type ActionResult } from '../sim/actions';
import { canStart } from '../sim/projects';
import { actStartProject } from '../sim/actions';

export type GuideLevel = 'full' | 'limited' | 'none';
export const guideLevel = (s: GameState): GuideLevel => (s.settings.difficulty === 'easy' ? 'full' : s.settings.difficulty === 'hard' ? 'none' : 'limited');

export interface Fix { label: string; run?: (s: GameState, geo: Geo) => ActionResult; tab?: Tab }

/** How to complete each objective (shown on easy and normal), with a one-tap action on easy. */
export function goalHelp(id: string, s: GameState, c: Country, geo: Geo): { how: string; fix?: Fix } {
  const H: Record<string, () => { how: string; fix?: Fix }> = {
    growth: () => ({ how: 'Invest in factories and infrastructure, keep taxes moderate and stay out of costly wars.', fix: { label: 'Build factories (1% of GDP)', run: (g) => buildProject(g, g.player, 'industry', 0.01) } }),
    trade: () => ({ how: 'Propose trade agreements to friendly countries in the Diplomacy tab. Countries that like you say yes.', fix: { label: 'Open Diplomacy', tab: 'diplomacy' } }),
    hub: () => ({ how: 'Keep signing trade deals; a good reputation and the Alliance Builder doctrine make it easier.', fix: { label: 'Open Diplomacy', tab: 'diplomacy' } }),
    infra: () => ({ how: 'Use "Upgrade infrastructure" in the Economy tab, or raise the infrastructure budget.', fix: { label: 'Upgrade infrastructure (1% of GDP)', run: (g) => buildProject(g, g.player, 'infra', 0.01) } }),
    tech: () => ({ how: 'Fund R&D programmes and raise the education budget. The AI Initiative and Education Reform megaprojects help a lot.', fix: { label: 'Fund R&D (1% of GDP)', run: (g) => buildProject(g, g.player, 'research', 0.01) } }),
    techlead: () => ({ how: 'Sustained research spending: R&D programmes, education budget, the AI Initiative.', fix: { label: 'Fund R&D (1% of GDP)', run: (g) => buildProject(g, g.player, 'research', 0.01) } }),
    stable: () => ({ how: 'Raise public services, avoid tax hikes, keep unemployment and inflation low.', fix: { label: 'Public services +0.5% of GDP', run: (g) => setBudget(g, g.player, 'social', g.countries[g.player].budget.social + 0.005) } }),
    debt: () => ({ how: 'Run a surplus: trim spending or raise taxes a little, then repay debt in the Economy tab.', fix: { label: 'Open Economy', tab: 'economy' } }),
    rank: () => ({ how: 'Grow faster than the countries just above you: invest, trade, and avoid wars that wreck your economy.', fix: { label: 'Build factories (1% of GDP)', run: (g) => buildProject(g, g.player, 'industry', 0.01) } }),
    energy: () => ({ how: 'Build power plants, or start the National Power Grid megaproject.', fix: { label: 'Build power plants (1% of GDP)', run: (g) => buildProject(g, g.player, 'energy', 0.01) } }),
    food: () => ({ how: 'Expand farms, or start the Green Revolution megaproject.', fix: { label: 'Expand farms (1% of GDP)', run: (g) => buildProject(g, g.player, 'farms', 0.01) } }),
    jobs: () => ({ how: 'Build factories and keep the economy growing; very high taxes cost jobs.', fix: { label: 'Build factories (1% of GDP)', run: (g) => buildProject(g, g.player, 'industry', 0.01) } }),
    industry: () => ({ how: 'Click one of your regions on the map and build a Factory complex there.' }),
    ally: () => { const cand = bestAlly(s, c, geo); return { how: 'Propose a defensive alliance to a friendly country. Shared enemies help.', fix: cand !== null ? { label: `Propose alliance to ${s.countries[cand].name}`, run: (g, ge) => actPropose(g, ge, g.player, cand, 'alliance') } : { label: 'Open Diplomacy', tab: 'diplomacy' } }; },
    bloc: () => ({ how: 'Ally with countries that are already allied with each other, or bring your allies together.', fix: { label: 'Open Diplomacy', tab: 'diplomacy' } }),
    diplomat: () => ({ how: 'Sign any treaties or give security guarantees (Diplomacy tab of another country).', fix: { label: 'Open Diplomacy', tab: 'diplomacy' } }),
    guardian: () => ({ how: 'Select a small friendly country and use "Guarantee independence" in its Diplomacy tab.' }),
    benefactor: () => ({ how: 'Select a country and send an aid package from its Diplomacy tab.' }),
    broker: () => ({ how: 'Find an exhausted war in the World panel and offer mediation.' }),
    assembly: () => ({ how: 'When a World Assembly vote arrives in your inbox, vote with the side that is winning.' }),
    respect: () => ({ how: 'Keep your word: honour alliances, send aid, mediate wars. Aggression and broken treaties cost reputation.' }),
    contain: () => ({ how: 'Sanction your rival and ask friends to join; countries that dislike them will.' }),
    peace: () => ({ how: 'Stay out of wars. Strong alliances and forts discourage attackers.' }),
    army: () => ({ how: 'Recruit troops and buy equipment in the Military tab; a bigger military budget keeps them ready.', fix: { label: 'Recruit troops', run: (g) => recruit(g, g.player, Math.max(5000, Math.round(g.countries[g.player].mil.troops * 0.1))) } }),
    fortress: () => { const f = weakestBorder(s, c, geo); return { how: 'Click a border region facing a rival and build a Fortress.', fix: f !== null ? { label: `Fortify ${geo.provinces[f].name}`, run: (g, ge) => actBuild(g, ge, g.player, f, 'fort') } : undefined }; },
    airpower: () => ({ how: 'Click one of your regions and build an Airbase there.' }),
    conquer: () => ({ how: 'Keep your offensives supplied, use air strikes on contested regions, and make your target a priority from the battle report.' }),
    spymaster: () => ({ how: 'Raise the intelligence budget in the Military tab, or build Cyber Command.', fix: { label: 'Intelligence budget +0.1% GDP', run: (g) => setBudget(g, g.player, 'intel', g.countries[g.player].budget.intel + 0.001) } }),
    megaproject: () => { const id = ['education', 'agri', 'cyber', 'fortress', 'grid', 'rail'].find((x) => !canStart(s, c.id, x)); return { how: 'Start a megaproject in the Economy tab and keep it funded until it finishes.', fix: id ? { label: 'Start a megaproject', run: (g) => actStartProject(g, g.player, id) } : { label: 'Open Economy', tab: 'economy' } }; },
    doctrine: () => ({ how: 'Pick an economic, military or foreign-policy doctrine in the Overview tab. Each has a clear upside and a catch.', fix: { label: 'Open Overview', tab: 'overview' } }),
    outgrow: () => ({ how: 'Out-invest your rival: factories, infrastructure, research and trade deals.', fix: { label: 'Build factories (1% of GDP)', run: (g) => buildProject(g, g.player, 'industry', 0.01) } }),
    reserves: () => ({ how: 'Run a budget surplus for a while, or borrow once and keep the cash.', fix: { label: 'Open Economy', tab: 'economy' } }),
    inflation: () => ({ how: 'Stop printing money, cut the deficit, and avoid the war economy.', fix: { label: 'Open Economy', tab: 'economy' } }),
    prosperity: () => ({ how: 'Productivity is what makes people richer: research, infrastructure and education.', fix: { label: 'Fund R&D (1% of GDP)', run: (g) => buildProject(g, g.player, 'research', 0.01) } }),
    weather: () => ({ how: 'Answer the crisis decision with the emergency package and keep investing.' }),
    mandate: () => ({ how: 'Approval follows growth, stability and prices: keep the economy healthy and services funded.' }),
    detente: () => ({ how: 'Improve relations with your rival (summit, aid), then propose a non-aggression pact.', fix: s.rival >= 0 ? { label: `Propose a pact to ${s.countries[s.rival].name}`, run: (g, ge) => actPropose(g, ge, g.player, g.rival, 'nap') } : undefined }),
    offensive: () => ({ how: 'Concentrate on a few targets: make them priorities in the battle report and back them with air strikes.' }),
    victory: () => ({ how: 'Take land, then offer peace with "demand territory" once your war score is high.' }),
    navy: () => ({ how: 'Buy warships in the Military tab, or build the Carrier Fleet megaproject.' }),
  };
  return (H[id] ?? (() => ({ how: '' })))();
}

function bestAlly(s: GameState, c: Country, geo: Geo): number | null {
  const cand = s.countries.filter((x) => x.alive && x.id !== c.id && getRelation(s, c.id, x.id) > 15)
    .map((x) => ({ x, ev: evaluateProposal(s, geo, c.id, x.id, 'alliance') })).sort((a, b) => b.ev.score - a.ev.score)[0];
  return cand ? cand.x.id : null;
}
function weakestBorder(s: GameState, c: Country, geo: Geo): number | null {
  const hostile = new Set(neighborsOf(s, geo, c.id).filter((x) => getRelation(s, c.id, x) < 10));
  const front = c.provinces.filter((p) => geo.adj[p].some((q) => hostile.has(s.owner[q]))).sort((a, b) => levelOf(s, a, 'fort') - levelOf(s, b, 'fort'));
  return front.length && levelOf(s, front[0], 'fort') < 3 ? front[0] : null;
}

export interface Check { area: 'Economy' | 'Security' | 'Diplomacy'; status: 'good' | 'warn' | 'bad'; title: string; detail: string; fix?: Fix; weight: number }

/** A health check of the whole country: what is fine, what needs attention, and how to fix it. */
export function countryChecks(s: GameState, c: Country, geo: Geo): Check[] {
  const e = c.eco, out: Check[] = [];
  const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
  const add = (x: Check) => out.push(x);
  // economy
  add({ area: 'Economy', status: e.growth >= 0.02 ? 'good' : e.growth >= 0 ? 'warn' : 'bad', weight: 3, title: `Growth ${pct(e.growth)}`,
    detail: e.growth >= 0.02 ? 'The economy is expanding at a healthy pace.' : 'Growth is weak. Investment (factories, infrastructure, research) and trade lift it.',
    fix: e.growth < 0.02 ? { label: 'Build factories (1% of GDP)', run: (g) => buildProject(g, g.player, 'industry', 0.01) } : undefined });
  const bal = fiscalNow(c, s).balance / e.gdp;
  add({ area: 'Economy', status: bal > -0.01 ? 'good' : bal > -0.04 ? 'warn' : 'bad', weight: 3, title: `Budget ${bal >= 0 ? 'surplus' : 'deficit'} ${pct(Math.abs(bal))}`,
    detail: bal > -0.01 ? 'Spending is covered by taxes.' : 'You spend more than you collect; debt is piling up. Trim spending or raise taxes a little.',
    fix: bal < -0.04 ? { label: 'Raise VAT by 1 point', run: (g) => setBudget(g, g.player, 'taxVat', g.countries[g.player].budget.taxVat + 0.01) } : undefined });
  const debt = e.debt / e.gdp;
  add({ area: 'Economy', status: debt < 0.8 ? 'good' : debt < 1.3 ? 'warn' : 'bad', weight: 2, title: `Debt ${pct(debt, 0)} of GDP`,
    detail: debt < 0.8 ? 'Debt is manageable.' : 'High debt raises interest costs and risks a default. Run surpluses to bring it down.', fix: debt >= 0.8 ? { label: 'Open Economy', tab: 'economy' } : undefined });
  add({ area: 'Economy', status: e.inflation < 0.04 ? 'good' : e.inflation < 0.08 ? 'warn' : 'bad', weight: 2, title: `Inflation ${pct(e.inflation)}`,
    detail: e.inflation < 0.04 ? 'Prices are stable.' : 'Prices are rising fast: stop printing money, cut the deficit, end the war economy.' });
  const unemp = e.unemployment - e.uNat;
  add({ area: 'Economy', status: unemp < 0.015 ? 'good' : unemp < 0.035 ? 'warn' : 'bad', weight: 2, title: `Unemployment ${pct(e.unemployment)}`,
    detail: unemp < 0.015 ? 'Close to its natural level.' : 'Too many people are out of work. Factories and growth create jobs.',
    fix: unemp >= 0.015 ? { label: 'Build factories (1% of GDP)', run: (g) => buildProject(g, g.player, 'industry', 0.01) } : undefined });
  const en = e.energyCap / Math.max(1, e.energyDemand), fd = e.foodCap / Math.max(1, e.foodDemand);
  add({ area: 'Economy', status: en >= 0.95 ? 'good' : en >= 0.7 ? 'warn' : 'bad', weight: 2, title: `Energy ${Math.round(en * 100)}% self-sufficient`,
    detail: en >= 0.95 ? 'You produce what you use.' : 'You depend on imports. A blockade, embargo or energy shock would cut output.',
    fix: en < 0.95 ? { label: 'Build power plants (1% of GDP)', run: (g) => buildProject(g, g.player, 'energy', 0.01) } : undefined });
  add({ area: 'Economy', status: fd >= 0.95 ? 'good' : fd >= 0.7 ? 'warn' : 'bad', weight: 1, title: `Food ${Math.round(fd * 100)}% self-sufficient`,
    detail: fd >= 0.95 ? 'You can feed yourself.' : 'You import food; harvest failures and blockades would hurt.',
    fix: fd < 0.95 ? { label: 'Expand farms (1% of GDP)', run: (g) => buildProject(g, g.player, 'farms', 0.01) } : undefined });
  add({ area: 'Economy', status: e.stability >= 55 ? 'good' : e.stability >= 40 ? 'warn' : 'bad', weight: 3, title: `Stability ${e.stability.toFixed(0)}`,
    detail: e.stability >= 55 ? 'The public is calm.' : 'Low stability cuts output and invites unrest, coups and uprisings.',
    fix: e.stability < 55 ? { label: 'Public services +0.5% of GDP', run: (g) => setBudget(g, g.player, 'social', g.countries[g.player].budget.social + 0.005) } : undefined });
  add({ area: 'Economy', status: e.infra >= 60 ? 'good' : e.infra >= 40 ? 'warn' : 'bad', weight: 1, title: `Infrastructure ${e.infra.toFixed(0)}`,
    detail: e.infra >= 60 ? 'Roads, ports and power lines are in good shape.' : 'Poor infrastructure holds back output and supply lines.',
    fix: e.infra < 60 ? { label: 'Upgrade infrastructure (1% of GDP)', run: (g) => buildProject(g, g.player, 'infra', 0.01) } : undefined });
  // security
  const hostile = neighborsOf(s, geo, c.id).filter((x) => getRelation(s, c.id, x) < 0);
  const threat = hostile.map((x) => s.countries[x]).sort((a, b) => strength(b) - strength(a))[0];
  const mine = strength(c) + 0.6 * alliesOf(s, c.id).reduce((t, a) => t + strength(s.countries[a]), 0);
  if (threat) {
    const r = mine / Math.max(1, strength(threat));
    add({ area: 'Security', status: r >= 1.2 ? 'good' : r >= 0.7 ? 'warn' : 'bad', weight: 3, title: `Army vs ${threat.name}: ${r.toFixed(1)}×`,
      detail: r >= 1.2 ? 'You (with allies) out-match your most dangerous neighbour.' : `${threat.name} could overpower you. Recruit, buy equipment, fortify, or find allies.`,
      fix: r < 1.2 ? { label: 'Recruit troops', run: (g) => recruit(g, g.player, Math.max(5000, Math.round(g.countries[g.player].mil.troops * 0.1))) } : undefined });
  }
  add({ area: 'Security', status: c.mil.readiness >= 0.65 ? 'good' : c.mil.readiness >= 0.45 ? 'warn' : 'bad', weight: 1, title: `Readiness ${Math.round(c.mil.readiness * 100)}%`,
    detail: c.mil.readiness >= 0.65 ? 'Units are trained and supplied.' : 'An underfunded army fights badly. Raise the military budget.',
    fix: c.mil.readiness < 0.65 ? { label: 'Military budget +0.3% of GDP', run: (g) => setBudget(g, g.player, 'military', g.countries[g.player].budget.military + 0.003) } : undefined });
  const wb = weakestBorder(s, c, geo);
  if (hostile.length) add({ area: 'Security', status: wb === null ? 'good' : levelOf(s, wb, 'fort') >= 1 ? 'warn' : 'bad', weight: 1, title: wb === null ? 'Borders fortified' : `Weak border: ${geo.provinces[wb].name}`,
    detail: wb === null ? 'Your threatened borders are fortified.' : 'Fortresses make every attack on a region slower and bloodier.',
    fix: wb !== null ? { label: `Fortify ${geo.provinces[wb].name}`, run: (g, ge) => actBuild(g, ge, g.player, wb, 'fort') } : undefined });
  // diplomacy
  const allies = alliesOf(s, c.id).length;
  const ally = bestAlly(s, c, geo);
  add({ area: 'Diplomacy', status: allies >= 2 ? 'good' : allies === 1 ? 'warn' : hostile.length ? 'bad' : 'warn', weight: hostile.length ? 2 : 1, title: `${allies} ${allies === 1 ? 'ally' : 'allies'}`,
    detail: allies >= 2 ? 'Friends will come to your defence.' : 'Alone, you are a tempting target. A defensive alliance deters attacks.',
    fix: allies < 2 && ally !== null ? { label: `Propose alliance to ${s.countries[ally].name}`, run: (g, ge) => actPropose(g, ge, g.player, ally, 'alliance') } : undefined });
  const tp = partnersOf(s, c.id, 'trade').length;
  add({ area: 'Diplomacy', status: tp >= 5 ? 'good' : tp >= 2 ? 'warn' : 'bad', weight: 1, title: `${tp} trade agreements`,
    detail: tp >= 5 ? 'Your exporters have open markets.' : 'More trade deals mean faster growth.', fix: tp < 5 ? { label: 'Open Diplomacy', tab: 'diplomacy' } : undefined });
  add({ area: 'Diplomacy', status: c.reputation >= 55 ? 'good' : c.reputation >= 35 ? 'warn' : 'bad', weight: 1, title: `Reputation ${c.reputation.toFixed(0)}`,
    detail: c.reputation >= 55 ? 'The world trusts your word.' : 'Low reputation makes deals harder and invites sanctions.' });
  const sanc = s.countries.filter((x) => x.alive && sanctionLevel(s, x.id, c.id) > 0).length;
  if (sanc) add({ area: 'Diplomacy', status: sanc >= 3 ? 'bad' : 'warn', weight: 2, title: `Sanctioned by ${sanc}`, detail: 'Sanctions cut your trade. Improve relations or wait for them to lapse.' });
  if (isAtWar(s, c.id)) add({ area: 'Security', status: c.mil.exhaustion < 0.4 ? 'warn' : 'bad', weight: 3, title: `At war · exhaustion ${Math.round(c.mil.exhaustion * 100)}%`,
    detail: 'Wars drain the economy and stability. Win quickly or negotiate.', fix: { label: 'Open Military', tab: 'military' } });
  return out;
}

/** The single most important thing to do (for normal difficulty). */
export function topPriority(checks: Check[]): Check | null {
  const rank = { bad: 2, warn: 1, good: 0 } as const;
  return [...checks].filter((c) => c.status !== 'good').sort((a, b) => rank[b.status] * 10 + b.weight - (rank[a.status] * 10 + a.weight))[0] ?? null;
}
