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
import { stanceOf, type Goal as NegoGoal } from '../sim/negotiate';
import { backChannelOdds, trackOf } from '../sim/detente';
import { LAWS, forecast, hasLaw } from '../sim/domestic';
import { budgetReport } from '../sim/treasury';
import { store } from '../state/store';

/** The best partners for a deal right now, by their odds at the table (names and percentages for the tips). */
function bestDeals(s: GameState, geo: Geo, goal: NegoGoal, n = 3): { id: number; p: number }[] {
  const me = s.player;
  const tr = (id: number) => s.treaties[id < me ? `${id}-${me}` : `${me}-${id}`];
  return s.countries.filter((x) => x.alive && x.id !== me && getRelation(s, me, x.id) > -20 && !(tr(x.id) as unknown as Record<string, unknown> | undefined)?.[goal])
    .sort((a, b) => getRelation(s, me, b.id) - getRelation(s, me, a.id)).slice(0, 14)
    .map((x) => ({ id: x.id, p: stanceOf(s, geo, x.id, { goal, give: [] }).p })).sort((a, b) => b.p - a.p).slice(0, n);
}
const names = (s: GameState, xs: { id: number; p: number }[]) => xs.map((x) => `${s.countries[x.id].name} (${Math.round(x.p * 100)}%)`).join(', ');
const negoFix = (s: GameState, x: { id: number } | undefined, goal: NegoGoal, verb: string): Fix | undefined => (x ? { label: `${verb} ${s.countries[x.id].name}`, open: () => store.openNego(x.id, goal) } : undefined);

export type GuideLevel = 'full' | 'limited' | 'none';
export const guideLevel = (s: GameState): GuideLevel => (s.settings.difficulty === 'easy' ? 'full' : s.settings.difficulty === 'hard' ? 'none' : 'limited');

export interface Fix { label: string; run?: (s: GameState, geo: Geo) => ActionResult; tab?: Tab; open?: () => void }

/** How to complete each objective (shown on easy and normal), with a one-tap action on easy. */
export function goalHelp(id: string, s: GameState, c: Country, geo: Geo): { how: string; fix?: Fix } {
  const H: Record<string, () => { how: string; fix?: Fix }> = {
    growth: () => ({ how: 'Invest in factories and infrastructure, keep taxes moderate and stay out of costly wars.', fix: { label: 'Build factories (1% of GDP)', run: (g) => buildProject(g, g.player, 'industry', 0.01) } }),
    trade: () => { const b = bestDeals(s, geo, 'trade'); return { how: b.length ? `Best odds for a trade agreement right now: ${names(s, b)}. Sweeten the deal with an investment package if they hesitate.` : 'Improve relations first: nobody is close to saying yes.', fix: negoFix(s, b[0], 'trade', 'Negotiate trade with') }; },
    hub: () => { const b = bestDeals(s, geo, 'trade'); return { how: b.length ? `Next trade partners to sign: ${names(s, b)}.` : 'Improve relations first.', fix: negoFix(s, b[0], 'trade', 'Negotiate trade with') }; },
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
    diplomat: () => { const b = [...bestDeals(s, geo, 'trade', 2), ...bestDeals(s, geo, 'nap', 2)].sort((x, y) => y.p - x.p); return { how: b.length ? `Easiest deals on the table: ${names(s, b.slice(0, 3))}.` : 'Improve relations first.', fix: negoFix(s, b[0], 'trade', 'Talk to') }; },
    guardian: () => { const x = s.countries.filter((y) => y.alive && y.id !== c.id && y.eco.gdp < c.eco.gdp * 0.3 && getRelation(s, c.id, y.id) > 20).sort((a, b) => getRelation(s, c.id, b.id) - getRelation(s, c.id, a.id))[0]; return { how: x ? `${x.name} likes you (relations ${getRelation(s, c.id, x.id).toFixed(0)}) and is small enough to protect: guarantee its independence from its Diplomacy tab.` : 'Find a small friendly country and guarantee its independence.', fix: x ? { label: `Open ${x.name}`, open: () => { store.select(x.id, null, true); store.setTab('diplomacy'); } } : undefined }; },
    benefactor: () => { const x = s.countries.filter((y) => y.alive && y.id !== c.id && y.eco.gdp / Math.max(1, y.eco.pop) < 5000 && getRelation(s, c.id, y.id) > -10).sort((a, b) => getRelation(s, c.id, b.id) - getRelation(s, c.id, a.id))[0]; return { how: x ? `${x.name} is poor and open to you: send an aid package from its Diplomacy tab.` : 'Send an aid package to a poorer country from its Diplomacy tab.', fix: x ? { label: `Open ${x.name}`, open: () => { store.select(x.id, null, true); store.setTab('diplomacy'); } } : undefined }; },
    broker: () => { const w = s.wars.filter((x) => !x.attackers.includes(c.id) && !x.defenders.includes(c.id)).sort((a, b) => a.start - b.start)[0]; return { how: w ? `The ${w.name} has dragged on since week ${w.start}: offer mediation from either side's Diplomacy tab.` : 'Wait for a war you are not part of, then offer mediation.', fix: w ? { label: 'Open the war room', open: () => store.openWarRoom(w.id) } : undefined }; },
    balance: () => { const B = budgetReport(s, c); return { how: `The deficit is ${(B.balancePct * -100).toFixed(1)}% of GDP. Switch on the fiscal rule, run a spending review or a tax enforcement drive (Economy tab, "Raise money").`, fix: { label: 'Open Economy', tab: 'economy' } }; },
    winback: () => { const f = [...(c.politics?.factions ?? [])].sort((a, b) => a.mood - b.mood)[0]; return { how: f ? `The angriest faction is at ${Math.round(f.mood)}/100. The Politics tab shows exactly what they want; a law they like, or "call in a favour" elsewhere, buys you room.` : '', fix: { label: 'Open Politics', tab: 'politics' } }; },
    reconcile: () => { const nb = new Set(neighborsOf(s, geo, c.id)); const foes = s.countries.filter((y) => y.alive && y.id !== c.id && getRelation(s, c.id, y.id) < -40); const near = foes.filter((y) => nb.has(y.id) || y.id === s.rival || y.eco.gdp > c.eco.gdp); const x = (near.length ? near : foes).sort((a, b) => backChannelOdds(s, b.id).p - backChannelOdds(s, a.id).p)[0]; return { how: x ? `${x.name} is the most likely to answer a back channel (${Math.round(backChannelOdds(s, x.id).p * 100)}%). Then gestures, then a summit.` : 'You have no bitter enemies left.', fix: x ? { label: `Open ${x.name}`, open: () => { store.select(x.id, null, true); store.setTab('diplomacy'); } } : undefined }; },
    lawmaker: () => { const best = LAWS.filter((l) => !hasLaw(c, l.id) && !(l.excl && hasLaw(c, l.excl))).map((l) => ({ l, f: forecast(c, l, 0) })).sort((a, b) => b.f.yes - a.f.yes)[0]; return { how: best ? `Most likely to pass: the ${best.l.title} (${Math.round(best.f.yes * 100)}% yes, ${best.f.cost} capital).` : 'Every law is already in force.', fix: { label: 'Open Politics', tab: 'politics' } }; },
    assembly: () => ({ how: 'When a World Assembly vote arrives in your inbox, vote with the side that is winning.' }),
    respect: () => ({ how: 'Keep your word: honour alliances, send aid, mediate wars. Aggression and broken treaties cost reputation.' }),
    contain: () => { const r = s.rival >= 0 ? s.countries[s.rival] : null; const foes = r ? s.countries.filter((x) => x.alive && x.id !== r.id && x.id !== c.id && getRelation(s, x.id, r.id) < -30).slice(0, 4).map((x) => x.name) : []; return { how: r ? `Sanction ${r.name} first. ${foes.length ? `Most likely to follow: ${foes.join(', ')}.` : 'Few countries dislike them enough yet.'}` : 'Sanction a rival and win friends to join you.' }; },
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
    detente: () => { const r = s.rival; if (r < 0) return { how: 'Once you have a rival, improve relations (or start the reconciliation process in their Diplomacy tab), then propose a non-aggression pact.' }; const rel = getRelation(s, c.id, r); const p = stanceOf(s, geo, r, { goal: 'nap', give: [] }).p; return rel < -25 ? { how: `Relations with ${s.countries[r].name} are ${rel.toFixed(0)}: too low for a pact. Start the reconciliation process in their Diplomacy tab (back channel: ${Math.round(backChannelOdds(s, r).p * 100)}% chance they answer${trackOf(s, r) ? `, you are at step ${trackOf(s, r)!.stage}` : ''}).`, fix: { label: `Open ${s.countries[r].name}`, open: () => { store.select(r, null, true); store.setTab('diplomacy'); } } } : { how: `A pact with ${s.countries[r].name} has ${Math.round(p * 100)}% odds as it stands.`, fix: negoFix(s, { id: r }, 'nap', 'Negotiate a pact with') }; },
    offensive: () => ({ how: 'Concentrate on a few targets: make them priorities in the battle report and back them with air strikes.' }),
    victory: () => ({ how: 'Take land, then offer peace with "demand territory" once your war score is high.' }),
    navy: () => ({ how: 'Buy warships in the Military tab, or build the Carrier Fleet megaproject.' }),
  };
  if (id.startsWith('d:')) return dynHelp(id, s, c);
  return (H[id] ?? (() => ({ how: '' })))();
}

/** Help for objectives generated for the player's path (goals2.ts). */
function dynHelp(id: string, s: GameState, c: Country): { how: string; fix?: Fix } {
  const [, kind, a] = id.split(':');
  const t = Number(a), T = s.countries[t];
  const open = (tab: Tab, sel = c.id) => ({ open: () => { store.select(sel, null, true); store.setTab(tab); } });
  switch (kind) {
    case 'overtake': case 'rich': return { how: 'Invest in factories, infrastructure and technology; keep taxes moderate and stay out of costly wars.', fix: { label: 'Build factories (1% of GDP)', run: (g) => buildProject(g, g.player, 'industry', 0.01) } };
    case 'tech': return { how: 'Fund education and the technology fund law, or a tech megaproject.', fix: { label: 'Open the economy', tab: 'economy' } };
    case 'outgun': case 'hegemon': return { how: 'Recruit troops, buy equipment and start weapons programmes in the Military tab.', fix: { label: 'Open the military', tab: 'military' } };
    case 'friend': case 'thaw': return { how: `Sign deals, send aid and vote with ${T?.name ?? 'them'} at the Assembly; a summit helps.`, fix: T ? { label: `Talk to ${T.name}`, ...open('diplomacy', t) } : undefined };
    case 'ally': return { how: `Relations with ${T?.name} are good enough to ask. Sweeten it at the table if they hesitate.`, fix: negoFix(s, { id: t }, 'alliance', 'Negotiate an alliance with') };
    case 'trade': return { how: `${T?.name} is open to a trade deal; offer one at the negotiating table.`, fix: negoFix(s, { id: t }, 'trade', 'Negotiate trade with') };
    case 'beat': case 'capital': case 'reclaim': return { how: 'Mass your armies on one front, back them with air strikes and keep supply lines short.', fix: { label: 'Open the war room', tab: 'military' } };
    case 'prestige': return { how: 'Reputation grows with aid, mediation, keeping treaties and staying at peace.', fix: { label: 'Open diplomacy', tab: 'diplomacy' } };
    case 'order': return { how: 'Stability follows growth, jobs, prices and the factions\' mood: give the angriest faction something.', fix: { label: 'Open politics', tab: 'politics' } };
    case 'bloc': return { how: 'Invite friendly countries into your organisation from the Diplomacy tab.', fix: { label: 'Open diplomacy', tab: 'diplomacy' } };
  }
  return { how: '' };
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
