/**
 * What each minister tells you at the cabinet table: concrete numbers, names, places and dates, in their own
 * voice. This replaces the old "1 war development in the news" summary with something you can act on.
 */
import type { Country, GameState, Minister } from '../sim/types';
import { mtraitById } from '../sim/cabinet';
import { drivers, stabilityParts } from './explain';
import { fmtMoney } from '../sim/util';
import { dateLabel } from '../sim/tick';
import { alliesOf, enemiesOf, getRelation, isAtWar, warsOf } from '../sim/relations';
import { strength } from '../sim/military';
import { warSupport } from '../sim/warsupport';
import { approval } from '../sim/approval';
import { traitsText } from '../sim/leaders';
import { isMajor } from '../sim/drama';
import { PROPOSAL_LABEL, type Proposal } from '../sim/diplomacy';

export interface Report { opener: string; headline: string; lines: string[]; tone: 'good' | 'warn' | 'bad' | 'calm'; go?: 'economy' | 'military' | 'diplomacy' | 'overview' | 'goals'; goLabel?: string }

const OPENER: Record<string, string> = {
  technocrat: 'The figures, Prime Minister:', populist: 'People on the street tell me:', hardliner: 'Bluntly:', reformer: 'We can do better than this:',
  loyalist: 'As always, at your service:', ambitious: 'If it were my call:', fixer: 'Between the two of us:', veteran: 'Straight talk:', charismatic: 'Here is the story:',
};
const pc = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const sgn = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;

export function leaderTitle(c: Country) {
  return c.gov === 'M' ? 'Your Majesty' : c.gov === 'D' || c.gov === 'F' ? 'Prime Minister' : c.gov === 'C' ? 'General Secretary' : 'Mr President';
}

export function ministerReport(s: GameState, c: Country, m: Minister, near: Set<number> = new Set()): Report {
  const opener = (OPENER[m.trait] ?? 'Briefly:').replace('Prime Minister', leaderTitle(c));
  const e = c.eco;
  if (m.role === 'finance') {
    const deficit = e.spending - e.revenue;
    const bal = deficit / Math.max(1, e.gdp);
    const nom = e.growth + e.inflation;
    const ratio = e.debt / e.gdp;
    const proj = (e.debt + deficit * 2) / (e.gdp * Math.pow(1 + nom, 2));
    const d = drivers(c).filter((x) => x.key !== 'convergence');
    const up = d.filter((x) => x.v > 0.0008)[0], down = d.filter((x) => x.v < -0.0008)[0];
    const lines: string[] = [];
    lines.push(`Debt is ${pc(ratio, 0)} of GDP (${fmtMoney(e.debt)}); at this pace it will be ${pc(proj, 0)} by ${dateLabel(s.tick + 104)}.`);
    lines.push(`Growth ${pc(e.growth)}${up ? `, carried by ${up.label.toLowerCase()} (${sgn(up.v * 100, 2)} pts)` : ''}${down ? `; ${down.label.toLowerCase()} is costing us ${sgn(down.v * 100, 2)} pts` : ''}.`);
    lines.push(`Inflation ${pc(e.inflation)}${e.inflation > 0.05 ? ' and rising prices are eating wages' : e.inflation < 0 ? ', prices are falling' : ''} · unemployment ${pc(e.unemployment)} · treasury ${fmtMoney(e.cash)}${deficit > 0 && e.cash > 0 ? ` (${Math.max(0, Math.round(e.cash / (deficit / 52)))} weeks of deficit)` : ''}.`);
    const headline = bal > 0.04 ? `We are borrowing ${fmtMoney(deficit)} a year, ${pc(bal)} of GDP. That cannot go on.`
      : bal > 0.015 ? `A deficit of ${fmtMoney(deficit)} a year (${pc(bal)} of GDP). Manageable, for now.`
      : bal < -0.005 ? `We run a surplus of ${fmtMoney(-deficit)} a year. Room to invest or cut taxes.`
      : `The budget is roughly balanced (${bal > 0 ? '−' : '+'}${fmtMoney(Math.abs(deficit))} a year).`;
    return { opener, headline, lines, tone: bal > 0.04 || ratio > 1.2 || e.inflation > 0.08 ? 'bad' : bal > 0.015 || e.growth < 0 ? 'warn' : 'good', go: 'economy', goLabel: 'Open the budget' };
  }
  if (m.role === 'foreign') {
    const others = s.countries.filter((x) => x.alive && x.id !== c.id);
    const rel = (x: Country) => getRelation(s, c.id, x.id);
    const friend = others.filter((x) => !isAtWar(s, x.id) || true).sort((a, b) => rel(b) - rel(a))[0];
    const foes = others.filter((x) => rel(x) < -30).sort((a, b) => strength(b) - strength(a));
    const plotters = others.filter((x) => x.goal && x.goal.target === c.id && x.goal.kind !== 'growth');
    const lines: string[] = [];
    const offer = s.offers[0];
    if (offer) {
      const L = s.countries[offer.from].leader;
      lines.push(`${L ? `${L.name} of ${s.countries[offer.from].name}` : s.countries[offer.from].name} wants ${offer.kind === 'peace' ? 'peace' : `a ${PROPOSAL_LABEL[offer.kind as Proposal].toLowerCase()}`}${s.offers.length > 1 ? `, and ${s.offers.length - 1} more offer${s.offers.length > 2 ? 's' : ''} wait` : ''}.`);
    }
    for (const p of plotters.slice(0, 2)) lines.push(`⚠ ${p.leader ? `${p.leader.name} (${traitsText(p.leader)}) of ` : ''}${p.name} has one aim: ${p.goal!.text.toLowerCase()}.`);
    const rv = s.rival >= 0 ? s.countries[s.rival] : null;
    if (rv?.alive && !plotters.includes(rv)) lines.push(`Our rival ${rv.name}${rv.leader ? `, under ${rv.leader.name},` : ''} is ${rv.intent ? rv.intent.charAt(0).toLowerCase() + rv.intent.slice(1) : 'watching us'} (relations ${sgn(rel(rv), 0)}).`);
    if (friend) lines.push(`Closest friend: ${friend.name} (${sgn(rel(friend), 0)})${foes[0] ? ` · most dangerous enemy: ${foes[0].name} (${sgn(rel(foes[0]), 0)})` : ''}. ${alliesOf(s, c.id).length} allies, reputation ${c.reputation.toFixed(0)}.`);
    const nAll = alliesOf(s, c.id).length;
    const headline = plotters.length ? `${plotters[0].name} is coming for us. ${nAll >= 2 ? 'Our allies must know it.' : 'We need friends, quickly.'}`
      : offer ? `${s.countries[offer.from].name} is knocking at our door.`
      : nAll >= 3 ? `Our alliances hold: ${nAll} capitals would stand with us${foes.length ? `, against ${foes.length} openly hostile governments` : ''}.`
      : foes.length >= 3 ? `${foes.length} governments are openly hostile, and we have ${nAll ? `only ${nAll} ${nAll === 1 ? 'ally' : 'allies'}` : 'no allies'}.`
      : 'A quiet month in the embassies. A good time to make friends.';
    return { opener, headline, lines: lines.slice(0, 3), tone: plotters.length ? 'bad' : foes.length >= 3 && nAll < 3 ? 'warn' : 'calm', go: 'diplomacy', goLabel: 'Diplomacy' };
  }
  if (m.role === 'defence') {
    const lines: string[] = [];
    const wars = warsOf(s, c.id);
    const foes = enemiesOf(s, c.id);
    for (const w of wars.slice(0, 2)) {
      const mine = w.fronts.filter((f) => f.by === c.id).length, theirs = w.fronts.length - mine;
      const en = (w.attackers.includes(c.id) ? w.defenders : w.attackers)[0];
      lines.push(`${w.name}: ${mine} offensive${mine === 1 ? '' : 's'} of ours, ${theirs} of theirs; ${Math.round((w.casualties[c.id] ?? 0) / 1000)}k of our soldiers lost against ${Math.round((w.casualties[en] ?? 0) / 1000)}k of theirs.`);
    }
    if (wars.length) lines.push(`War support ${Math.round(warSupport(c) * 100)}% · readiness ${pc(c.mil.readiness, 0)} · exhaustion ${pc(c.mil.exhaustion, 0)}.`);
    // a threat is a hostile neighbour, or a hostile great power that is truly hostile
    const threats = s.countries.filter((x) => x.alive && x.id !== c.id && (near.has(x.id) ? getRelation(s, c.id, x.id) < -20 : isMajor(s, x.id) && getRelation(s, c.id, x.id) < -55)).sort((a, b) => Number(near.has(b.id)) - Number(near.has(a.id)) || strength(b) - strength(a));
    const t = threats[0];
    const ratio = t ? strength(t) / Math.max(1, strength(c)) : 0;
    if (!wars.length) lines.push(`${Math.round(c.mil.troops / 1000)}k troops at ${pc(c.mil.readiness, 0)} readiness; budget ${pc(c.budget.military)} of GDP.${t ? ` ${t.name} ${ratio > 1 ? `outguns us ${ratio.toFixed(1)} to 1` : `is weaker than us (${(1 / ratio).toFixed(1)} to 1)`}.` : ''}`);
    const hot = s.wars.filter((w) => !w.attackers.includes(c.id) && !w.defenders.includes(c.id) && [...w.attackers, ...w.defenders].some((x) => isMajor(s, x)))[0];
    if (hot && lines.length < 3) lines.push(`Watch ${hot.name}: ${hot.fronts.length} active fronts.`);
    const headline = wars.length ? (foes.length > 1 ? `We are fighting on ${foes.length} fronts.` : `The war with ${s.countries[foes[0]]?.name ?? 'the enemy'} goes on.`)
      : t && ratio > 2.5 ? `${t.name} could crush us. ${ratio.toFixed(1)} times our strength.`
      : c.mil.readiness < 0.6 ? `Readiness is ${pc(c.mil.readiness, 0)}. The army is not ready for a fight.`
      : 'The army is ready. No one is marching on us today.';
    return { opener, headline, lines: lines.slice(0, 3), tone: wars.length || (t && ratio > 2.5) ? 'bad' : c.mil.readiness < 0.6 ? 'warn' : 'good', go: 'military', goLabel: 'War room' };
  }
  // interior
  const h = c.hist.stab;
  const d12 = h.length >= 4 ? h[h.length - 1] - h[h.length - 4] : 0;
  const parts = stabilityParts(c).filter((p) => Math.abs(p.v) >= 1).sort((a, b) => a.v - b.v);
  const worst = parts[0], best = parts[parts.length - 1];
  const appr = approval(s, c);
  const lines: string[] = [];
  lines.push(`Stability ${e.stability.toFixed(0)} (${d12 >= 0 ? '+' : '−'}${Math.abs(d12).toFixed(0)} in 12 weeks)${worst && worst.v < 0 ? `. Biggest drag: ${worst.label.toLowerCase()} (${worst.v.toFixed(0)})` : ''}${best && best.v > 0 ? `; holding us up: ${best.label.toLowerCase()} (+${best.v.toFixed(0)})` : ''}.`);
  const vote = s.legacy?.status === 'office' ? s.legacy.nextVote : s.stats.nextVote;
  const free = c.gov === 'D' || c.gov === 'F';
  lines.push(`Approval ${appr.toFixed(0)}%${vote !== undefined ? ` · ${free ? 'the election' : 'the party congress'} is on ${dateLabel(vote)}` : ''} · unemployment ${pc(e.unemployment)}.`);
  if (e.occupation > 0.05) lines.push(`Newly conquered regions are restless (occupation unrest ${pc(e.occupation, 0)}).`);
  const headline = e.stability < 30 ? `The streets are close to boiling over. Stability ${e.stability.toFixed(0)}.`
    : d12 <= -4 ? `Something is souring the public mood: stability ${d12.toFixed(0)} in three months.`
    : appr < 40 ? `The public is losing patience with us: ${appr.toFixed(0)}% approval.`
    : appr > 62 ? `The country is behind you: ${appr.toFixed(0)}% approval.`
    : 'Order holds. Grumbling, but no more than usual.';
  return { opener, headline, lines, tone: e.stability < 30 ? 'bad' : d12 <= -4 || appr < 40 ? 'warn' : 'good', go: 'overview' };
}
export const traitOf = (m: Minister) => mtraitById(m.trait);
