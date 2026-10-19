/**
 * Membership as a running sum. Every member of every organisation keeps asking what it gets and what it pays:
 *   protection (how threatened it is, and how much stronger the others make it, if the alliance is believable),
 *   trade and depth, how well it fits (camp, friendships), the prestige of leading it
 *   against
 *   the burden (carrying more of the joint strength, spending more than the partners) and the risk of being dragged
 *   into other members' wars.
 * The leader's agenda weighs each part: a security hawk prizes protection, a mercantilist the market, an ideologue the
 * camp, and a "country first" leader counts the bill twice. A big member whose sum turns negative threatens to walk
 * out unless the others carry more; the partners who value the alliance raise their defence budgets; if not enough
 * changes, it leaves. Nothing is scripted: it all follows from the numbers and the people in charge.
 */
import { clamp } from './util';
import { nextRand } from './rng';
import { logEvent } from './log';
import { addRelation, alliesOf, getRelation, hasTrade, isAtWar, orgsOf } from './relations';
import { strength } from './military';
import { isMajor } from './drama';
import { credibility, leaveOrg } from './alignment';
import { agendaOf, commitOf, moodOf } from './minds';
import type { Country, CountryId, GameState, Org } from './types';

export interface ValuePart { label: string; v: number }
/** How rich the other members are, next to this one (1 = at least as rich together). */
export const richPartners = (s: GameState, o: Org, m: CountryId) => clamp(o.members.filter((x) => x !== m && s.countries[x]?.alive).reduce((t, x) => t + s.countries[x].eco.gdp, 0) / Math.max(1, s.countries[m].eco.gdp), 0, 1);
/** What the other members spend on defence, as a share of their combined GDP. */
export function partnersSpend(s: GameState, o: Org, except: CountryId) {
  const xs = o.members.filter((x) => x !== except && s.countries[x]?.alive).map((x) => s.countries[x]);
  return xs.reduce((t, x) => t + x.budget.military * x.eco.gdp, 0) / Math.max(1, xs.reduce((t, x) => t + x.eco.gdp, 0));
}
const str = (s: GameState, id: CountryId) => (s.countries[id]?.alive ? strength(s.countries[id]) : 0);

/** What membership of `o` is worth to `m` (positive: worth staying or joining). `prospective`: as if m were a member. */
export function memberValue(s: GameState, o: Org, m: CountryId, threat?: number): { v: number; parts: ValuePart[] } {
  const c = s.countries[m];
  const parts: ValuePart[] = [];
  if (!c?.alive) return { v: 0, parts };
  const a = agendaOf(s, c);
  const commit = c.isPlayer ? 0.3 : commitOf(c);
  const others = o.members.filter((x) => x !== m && s.countries[x]?.alive);
  if (!others.length) return { v: -1, parts };
  const t = threat ?? moodOf(c).threat;
  const T = totals(s, o);
  const self = o.members.includes(m) && c.alive;
  const mine = str(s, m), theirs = T.str - (self ? mine : 0);
  const add = (label: string, v: number) => { if (Math.abs(v) >= 0.01) parts.push({ label, v: +v.toFixed(2) }); };
  if (o.kind === 'defence') {
    const P = clamp(t, 0, 1) * clamp((theirs / Math.max(1, mine)) * 0.4, 0, 1.2) * credibility(s, o);
    add('Protection against its threats', P * (0.6 + a.security * 3));
    add('A seat at the table', 0.05);
  } else {
    const trade = others.filter((x) => hasTrade(s, m, x)).length / others.length;
    add(o.kind === 'union' ? 'A deep union: market, money, influence' : 'Market access', (0.15 + (o.depth ?? 0.6) * 0.2 + trade * 0.15) * (0.5 + a.wealth * 2.5));
  }
  const avgRel = others.slice(0, 12).reduce((x, y) => x + getRelation(s, m, y), 0) / Math.min(12, others.length);
  const fit = (o.camp ? (c.orient ?? 0) * o.camp * 0.25 : 0) + clamp(avgRel / 200, -0.25, 0.25);
  // to a "country first" leader, friends are friends only if they pay their way
  add(fit >= 0 ? 'Among friends and its own camp' : 'Out of place among the members', fit * (0.5 + a.ideology * 2) * (fit > 0 && c.leader?.traits.includes('isolationist') ? 0.5 : 1));
  // leading a bloc is a sphere of influence: clients, bases, a say in their affairs (worth less to a "country first" leader)
  if (T.top === m && others.length >= 2) add('A sphere of influence: it leads the bloc', (0.12 + 0.5 * a.prestige + 0.3 * a.expansion) * Math.min(1, others.length / 3) * (c.leader?.traits.includes('isolationist') ? 0.3 : 1));
  if (o.kind === 'defence') {
    const share = mine / Math.max(1, mine + theirs);
    const othersGdp = T.gdp - (self ? c.eco.gdp : 0);
    const avgMil = (T.milGdp - (self ? c.budget.military * c.eco.gdp : 0)) / Math.max(1, othersGdp);
    // what grates is carrying allies who could pay for themselves: nobody expects a poor ally to match a great power
    const rich = clamp(othersGdp / Math.max(1, c.eco.gdp), 0, 1);
    const B = (clamp((share - 0.3) * 0.6, 0, 0.3) + clamp((c.budget.military - avgMil) * 10, 0, 0.3)) * rich;
    add(c.budget.military > avgMil + 0.006 && rich > 0.5 ? 'Pays more than its rich partners for their defence' : 'The cost of the commitment', -B * (1 - 0.6 * commit));
    const atWar = isAtWar(s, m) ? 0 : T.atWar;
    if (atWar) add('Risk of being dragged into members\' wars', -Math.min(0.4, (atWar / others.length) * 1.5) * (1.1 - a.security));
  }
  add(commit >= 0 ? 'Its leader believes in alliances' : 'Its leader puts the country first', commit * 0.2);
  return { v: +parts.reduce((x, y) => x + y.v, 0).toFixed(2), parts: parts.sort((x, y) => Math.abs(y.v) - Math.abs(x.v)) };
}
/** An organisation's sums (strength, GDP, defence spending, its strongest member, members at war), once per week. */
const totalsCache = new Map<string, { str: number; gdp: number; milGdp: number; top: CountryId; atWar: number }>();
function totals(s: GameState, o: Org) {
  const key = `${o.id}:${o.members.length}:${s.tick}`;
  const hit = totalsCache.get(key);
  if (hit) return hit;
  if (totalsCache.size > 400) totalsCache.clear();
  let str = 0, gdp = 0, milGdp = 0, top = -1, best = -1, atWar = 0;
  for (const x of o.members) {
    const X = s.countries[x];
    if (!X?.alive) continue;
    const v = strength(X);
    str += v; gdp += X.eco.gdp; milGdp += X.budget.military * X.eco.gdp;
    if (v > best) { best = v; top = x; }
    if (isAtWar(s, x)) atWar++;
  }
  const out = { str, gdp, milGdp, top, atWar };
  totalsCache.set(key, out);
  return out;
}
export const smoothedValue = (s: GameState, o: Org, m: CountryId) => s.stats[`mv:${o.id}:${m}`];

const bigContributor = (s: GameState, o: Org, m: CountryId) => {
  const total = o.members.reduce((x, y) => x + str(s, y), 0);
  return str(s, m) / Math.max(1, total) > 0.22;
};

/** An unhappy big member puts the others on notice: carry more of the load, or we leave. */
export function issueUltimatum(s: GameState, o: Org, m: CountryId) {
  if (o.ultimatum || !o.members.includes(m)) return;
  const C = s.countries[m];
  o.ultimatum = { by: m, since: s.tick, until: s.tick + 52 + Math.floor(nextRand(s) * 26), avg0: partnersSpend(s, o, m) };
  (o.history ??= []).push({ tick: s.tick, text: `${C.name} threatens to leave` });
  const lead = C.leader ? `${C.leader.name} of ${C.name}` : C.name;
  logEvent(s, `📢 ${lead} threatens to leave ${o.name} unless its allies carry more of the burden. They have about a year.`, 'diplo', [m, ...o.members.slice(0, 3)], isMajor(s, m) || o.members.includes(s.player), { big: isMajor(s, m) && o.members.length > 6 });
  if (o.members.includes(s.player) && !s.inbox.some((x) => x.id === 'burden_demand')) s.inbox.push({ uid: s.nextInbox++, id: 'burden_demand', tick: s.tick, expires: s.tick + 20, urgent: false, data: { o: o.id, by: m } });
}

/** Monthly, a few organisations at a time: members weigh what membership is worth, and act on it. */
export function stepMembership(s: GameState) {
  for (const o of [...(s.orgs ?? [])]) {
    if ((s.tick + o.id) % 8 !== 0 || !s.orgs?.includes(o)) continue;
    for (const m of [...o.members]) {
      if (!s.countries[m]?.alive) continue;
      const k = `mv:${o.id}:${m}`;
      const v = memberValue(s, o, m).v;
      s.stats[k] = s.stats[k] === undefined ? v : s.stats[k] * 0.65 + v * 0.35;
    }
    // during an ultimatum the partners who value the alliance spend more; at the deadline the threatener decides
    const u = o.ultimatum;
    if (u) {
      const T = s.countries[u.by];
      if (!T?.alive || !o.members.includes(u.by)) { delete o.ultimatum; continue; }
      for (const m of o.members) {
        if (m === u.by || m === s.player) continue;
        const M = s.countries[m];
        // only partners who value the alliance, believe in it and can afford it answer the call
        if ((s.stats[`mv:${o.id}:${m}`] ?? 0) > 0.1 && commitOf(M) > -0.2 && moodOf(M).pain < 0.5 && M.budget.military < 0.025 && nextRand(s) < 0.7) { M.budget.military = Math.min(0.025, M.budget.military + 0.003); /* (every two months) */ M.eco.prev.mil0 = Math.max(M.eco.prev.mil0 ?? 0, M.budget.military); addRelation(s, m, u.by, 1); }
      }
      if (s.tick >= u.until) {
        delete o.ultimatum;
        const mv = memberValue(s, o, u.by).v;
        // did the partners deliver? a leader who wants out judges by what they actually spend, not what they promise
        const delivered = partnersSpend(s, o, u.by) - (u.avg0 ?? 0);
        const walks = mv < -0.1 || (richPartners(s, o, u.by) > 0.5 && delivered < 0.0025 && mv < 0.12 && (commitOf(T) < -0.4 || !!T.leader?.traits.includes('isolationist')));
        if (walks && T.id !== s.player) leaveOrg(s, o, u.by, `${T.leader?.name ?? 'its government'} decided the alliance costs more than it gives${delivered < 0.0025 ? ` (the partners raised their defence spending by only ${(Math.max(0, delivered) * 100).toFixed(1)}% of GDP)` : ''}`);
        else logEvent(s, `🤝 ${T.name} drops its threat to leave ${o.name}: the partners raised their defence spending by ${(delivered * 100).toFixed(1)}% of GDP.`, 'diplo', [u.by, ...o.members.slice(0, 2)], isMajor(s, u.by) || o.members.includes(s.player));
      }
      continue;
    }
    for (const m of [...o.members]) {
      if (m === s.player || !s.orgs.includes(o)) continue;
      const C = s.countries[m];
      const mv = s.stats[`mv:${o.id}:${m}`] ?? 0;
      // a leader elected to put the country first makes the demand even while the sum is only just positive
      // the "country first" playbook: renegotiate first, whenever the public feels it carries the alliance
      const iso = !!C.leader?.traits.includes('isolationist');
      const bar = iso && moodOf(C).burden > 0.22 && o.kind === 'defence' && richPartners(s, o, m) > 0.5 ? 0.15 : -0.08 + Math.max(0, -commitOf(C) - 0.3) * 0.25;
      if (mv < bar && (commitOf(C) < -0.3 || iso) && bigContributor(s, o, m) && o.members.length >= 3 && s.tick - (s.stats[`ultAt:${o.id}:${m}`] ?? -999) > 156) { s.stats[`ultAt:${o.id}:${m}`] = s.tick; issueUltimatum(s, o, m); break; }
      // smaller members simply drift out when it stops paying for itself
      if (mv < -0.25 && !bigContributor(s, o, m) && nextRand(s) < 0.12) leaveOrg(s, o, m, 'membership costs it more than it gains');
    }
  }
}

/** The defence partners of a country (via organisations or alliances), for the judgement of free-riders. */
export function defencePartners(s: GameState, id: CountryId): CountryId[] {
  const out = new Set<CountryId>(alliesOf(s, id));
  for (const o of orgsOf(s, id)) if (o.kind === 'defence') for (const m of o.members) if (m !== id) out.add(m);
  return [...out];
}
export const isFreeRider = (s: GameState, x: Country, by: Country) => x.budget.military < Math.min(0.015, by.budget.military * 0.6) && x.eco.gdp > by.eco.gdp * 0.02;
