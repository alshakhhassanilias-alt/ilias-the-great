/**
 * Long-term plans. Every AI government has one aim it works toward for years: win back lost land, press a claim,
 * deter a dangerous neighbour, dominate its region, build the bomb, join a bloc, leave one, found its own, contain a
 * troublemaker (the player included), get rich, or simply restore order and pay off its debts.
 *
 * The aim is chosen, not drawn: each candidate is scored by what the leader cares about (their agenda), how the public
 * feels, and how feasible it is right now. Two leaders facing the same map choose differently. The aim is worked on
 * every month (arms, partners, applications, pressure, programmes), its progress is measured, and patience runs out
 * when it stalls: the government gives up and picks something else. A new leader brings a new aim.
 */
import type { Geo } from './geo';
import { clamp } from './util';
import { nextRand } from './rng';
import { logEvent } from './log';
import { claimStrength } from './war';
import { addRelation, alliesOf, getRelation, hasAlliance, isAtWar, orgsOf, sanctionLevel } from './relations';
import { applyTreaty, evaluateProposal, imposeSanction, liftSanction, neighborsOf } from './diplomacy';
import { strength } from './military';
import { isMajor } from './drama';
import { aggOf } from './coalitions';
import { admitted, applicationVotes, foundOrg, joinOrg, threatened } from './alignment';
import { agendaOf, commitOf, moodOf, opinionOf } from './minds';
import { issueUltimatum, memberValue } from './membership';
import { canStart, runsOf, startProject } from './projects';
import { assessAttack, mainThreat } from './ai';
import type { Country, CountryId, GameState, NatGoal, Org } from './types';

export type PlanKind = 'recover' | 'sanctions' | 'revanche' | 'claims' | 'security' | 'dominance' | 'nukes' | 'join' | 'exit' | 'bloc' | 'contain' | 'growth';
export const PLAN_ICON: Record<PlanKind, string> = { recover: '🩹', sanctions: '🔓', revanche: '⚔', claims: '🗺', security: '🛡', dominance: '👑', nukes: '☢', join: '🤝', exit: '🚪', bloc: '🏛', contain: '🧱', growth: '📈' };
const REGION_NAME: Record<string, string> = { NA: 'North America', LA: 'Latin America', EU: 'Europe', RU: 'Eurasia', ME: 'the Middle East', AF: 'Africa', SA: 'South Asia', EA: 'East Asia', SEA: 'Southeast Asia', OC: 'Oceania' };
export const mainThreatOf = (s: GameState, geo: Geo, c: Country) => mainThreat(s, geo, c);

interface Cand { kind: PlanKind; target: number; ref?: number; text: string; u: number }
const name = (s: GameState, id: number) => s.countries[id]?.name ?? '?';
const cooling = (s: GameState, c: Country, kind: string, target: number) => s.tick - (s.stats[`planCd:${c.id}:${kind}:${target}`] ?? -9999) < 260;

/** Who holds whose land, worked out once per week for everyone (provinces held by someone other than their core owner). */
let lostCache: { st: GameState; tick: number; by: Map<number, Map<number, number>> } | null = null;
function lostLand(s: GameState, c: Country): [number, number] | null {
  if (!lostCache || lostCache.st !== s || lostCache.tick !== s.tick) {
    const by = new Map<number, Map<number, number>>();
    for (let p = 0; p < s.owner.length; p++) {
      const core = s.core[p], own = s.owner[p];
      if (core === own || !s.countries[own]?.alive) continue;
      const m = by.get(core) ?? new Map<number, number>();
      m.set(own, (m.get(own) ?? 0) + 1);
      by.set(core, m);
    }
    lostCache = { st: s, tick: s.tick, by };
  }
  const lost = lostCache.by.get(c.id);
  return lost?.size ? [...lost.entries()].sort((a, b) => b[1] - a[1])[0] : null;
}
const odds = (s: GameState, geo: Geo, c: Country, t: number) => clamp(assessAttack(s, geo, c, s.countries[t]).ratio / 1.6, 0, 1);
function regionShare(s: GameState, c: Country) {
  let mine = 0, all = 0;
  for (const x of s.countries) if (x.alive && x.region === c.region) { const v = strength(x); all += v; if (x.id === c.id) mine += v; }
  return all > 0 ? mine / all : 0;
}
const hasNuclearFriend = (s: GameState, c: Country) => alliesOf(s, c.id).some((a) => s.countries[a]?.mil.nuclear) || orgsOf(s, c.id).some((o) => o.kind === 'defence' && o.members.some((m) => m !== c.id && s.countries[m]?.mil.nuclear));

/** The best organisation for a country to join now, with its prospective value. */
function bestOrgToJoin(s: GameState, c: Country): { o: Org; v: number } | null {
  let best: { o: Org; v: number } | null = null;
  for (const o of s.orgs ?? []) {
    if (o.members.includes(c.id) || o.members.length < 3) continue;
    if (o.camp !== 0 && (c.orient ?? 0) * o.camp < 0.3) continue;
    if (o.kind === 'defence' && (orgsOf(s, c.id).some((x) => x.kind === 'defence') || !threatened(s, c))) continue;
    // blocs are regional (BRICS aside): enough members must share the applicant's region
    const local = o.members.filter((m) => s.countries[m]?.region === c.region).length;
    if (o.key !== 'brics' && local < o.members.length * (o.kind === 'union' ? 0.5 : 0.25)) continue;
    // a great power does not queue up for a small club it would not lead
    if (o.kind !== 'defence' && strength(c) > 1.5 * Math.max(...o.members.map((m) => strength(s.countries[m])))) continue;
    if (o.kind === 'economic' && orgsOf(s, c.id).filter((x) => x.kind === 'economic').length >= 2) continue;
    const v = memberValue(s, { ...o, members: [...o.members, c.id] }, c.id).v;
    if (v <= 0.15 || (best && v <= best.v)) continue;
    // only a bid with a real chance: at least half the members would say yes today
    const votes = applicationVotes(s, o, c.id);
    if (votes.filter((x) => x.yes).length < votes.length * 0.5) continue;
    best = { o, v };
  }
  return best;
}

/** Score every aim open to this government and pick the best (keeping the current one unless something is clearly better). */
export function choosePlan(s: GameState, geo: Geo, c: Country, fresh = false): NatGoal {
  const a = agendaOf(s, c), m = moodOf(c), e = c.eco;
  const C: Cand[] = [];
  const add = (kind: PlanKind, target: number, text: string, u: number, ref?: number) => { if (u > 0 && !cooling(s, c, kind, ref ?? target)) C.push({ kind, target, text, u, ref }); };
  if (e.debt / e.gdp > 1.6 || e.stability < 30) add('recover', -1, e.stability < 30 ? 'Restore order at home' : 'Get its debt under control', 1.2);
  if (e.sanctionShare > 0.15) add('sanctions', -1, 'Break out of sanctions', 0.5 + a.wealth);
  const lost = lostLand(s, c);
  if (lost) add('revanche', lost[0], `Win back ${lost[1]} lost region${lost[1] > 1 ? 's' : ''} from ${name(s, lost[0])}`, (a.expansion * 1.5 + m.shame * 0.6 + a.prestige * 0.4) * (0.4 + 0.6 * odds(s, geo, c, lost[0])));
  let claim = -1, cv = 0.3;
  for (const o of s.countries) if (o.alive && o.id !== c.id) { const v = claimStrength(c.id, o.id); if (v > cv) { cv = v; claim = o.id; } }
  if (claim >= 0 && c.ai.expansion > 0.15) add('claims', claim, `Press its claims on ${name(s, claim)}`, (a.expansion * 1.3 + a.prestige * 0.3) * (0.25 + 0.75 * odds(s, geo, c, claim)));
  const th = mainThreat(s, geo, c);
  // a leader elected to stand up to someone starts by doing exactly that
  const promised = fresh && !!c.leader?.mandate?.startsWith('promising to stand up to');
  if (th.who >= 0 && th.th > 0.25) add('security', th.who, `Deter ${name(s, th.who)}`, a.security * 1.5 + m.threat * 0.8 + (promised ? 0.35 : 0));
  const share = regionShare(s, c);
  if (share > 0.25 && a.expansion + a.prestige > 0.32) add('dominance', -1, `Become the dominant power in ${REGION_NAME[c.region] ?? 'its region'}`, (a.expansion + a.prestige) * 1.2 * clamp(share * 2, 0, 1));
  // the bomb takes a big economy and a real scientific base
  if (!c.mil.nuclear && s.settings.nukes !== false && e.tech >= 40 && s.countries.filter((x) => x.alive && x.eco.gdp > e.gdp).length < 35) {
    const nukeFoe = s.countries.find((x) => x.alive && x.mil.nuclear && x.id !== c.id && getRelation(s, c.id, x.id) < -35 && (neighborsOf(s, geo, c.id).includes(x.id) || isMajor(s, x.id)));
    const u = a.security * 1.4 * m.threat + (nukeFoe ? 0.35 : 0) + (c.gov === 'A' || c.gov === 'C' ? a.prestige * 0.6 : 0) - (hasNuclearFriend(s, c) ? 0.45 : 0) - (c.gov === 'D' ? 0.3 : 0) - c.ai.caution * 0.2 - Math.max(0, commitOf(c)) * 0.2;
    if (u > 0.4) add('nukes', nukeFoe?.id ?? -1, nukeFoe ? `Build the bomb to face ${nukeFoe.name}` : 'Build a nuclear deterrent', u);
  }
  const j = bestOrgToJoin(s, c);
  if (j) add('join', -1, `Join ${j.o.name}`, ((j.o.kind === 'defence' ? a.security : a.wealth) * 1.3 + Math.max(0, commitOf(c)) * 0.3) * clamp(j.v * 2, 0, 1), j.o.id);
  for (const o of orgsOf(s, c.id)) {
    const mv = s.stats[`mv:${o.id}:${c.id}`];
    if (mv !== undefined && mv < -0.08 + Math.max(0, -commitOf(c) - 0.3) * 0.25 && commitOf(c) < -0.3) add('exit', -1, `Make ${o.name} pay its way, or leave it`, 0.45 - mv * 2, o.id);
  }
  if (isMajor(s, c.id) && commitOf(c) > -0.1 && a.prestige + a.ideology > 0.38 && !(s.orgs ?? []).some((o) => o.founder === c.id && o.members.includes(c.id))) {
    const friends = s.countries.filter((x) => x.alive && x.id !== c.id && !x.isPlayer && getRelation(s, c.id, x.id) > 45 && strength(x) < strength(c)).length;
    if (friends >= 3) add('bloc', -1, 'Build its own bloc', (a.prestige + a.ideology) * 0.9);
  }
  // the troublemaker: whoever alarms this government most (aggression, contempt, power), the player included
  let alarm = 0, who = -1;
  for (const x of s.countries) {
    if (!x.alive || x.id === c.id || hasAlliance(s, c.id, x.id)) continue;
    const near = s.stats[`nb:${c.id}:${x.id}`] === 1;
    if (!near && !(isMajor(s, c.id) && isMajor(s, x.id))) continue;
    // a country with a clean record and no aggression alarms nobody: skip the judgement
    if (!s.rec?.[x.id] && aggOf(s, x.id) < 5 && !isMajor(s, x.id)) continue;
    const op = opinionOf(s, c.id, x.id).v;
    const v = clamp(aggOf(s, x.id) / 60 + Math.max(0, -op - 10) / 40, 0, 1) * (near ? 1 : 0.4) * clamp(strength(x) / Math.max(1, strength(c)), 0.2, 1.5);
    if (v > alarm) { alarm = v; who = x.id; }
  }
  if (who >= 0 && alarm > 0.35) add('contain', who, `Contain ${name(s, who)}`, a.security * 1.4 * alarm + a.ideology * 0.3 * alarm);
  const rank = s.countries.filter((x) => x.alive && x.eco.gdp > e.gdp).length + 1;
  add('growth', -1, rank > 3 ? `Climb from #${rank} to #${Math.max(1, rank - 3)} in the world economy` : rank === 1 ? 'Stay the world’s leading economy' : 'Become the world’s leading economy', a.wealth * 1.2 + 0.08);
  const cur = c.goal;
  for (const k of C) if (!fresh && cur && cur.kind === k.kind && cur.target === k.target && (cur.ref ?? -1) === (k.ref ?? -1)) k.u += 0.2; // continuity
  C.sort((x, y) => y.u - x.u);
  const best = C[0];
  if (cur && !fresh && cur.kind === best.kind && cur.target === best.target && (cur.ref ?? -1) === (best.ref ?? -1)) { cur.text = best.text; return cur; }
  const g: NatGoal = { kind: best.kind, target: best.target, ref: best.ref, text: best.text, since: s.tick, progress: 0, best: 0, patience: 1, step: 0 };
  s.stats[`plan:${best.kind}`] = (s.stats[`plan:${best.kind}`] ?? 0) + 1;
  if (s.tick > 0 && best.kind !== 'growth' && best.kind !== 'recover') news(s, c, `🎯 ${c.leader ? `${c.leader.name} of ` : ''}${c.name} sets a long-term aim: ${best.text.charAt(0).toLowerCase() + best.text.slice(1)}.`, best.target === s.player);
  return g;
}

/** Plan news reaches the player when it concerns a big power, the player, a neighbour of the player or the rival. */
function news(s: GameState, c: Country, text: string, important = false, big = false) {
  const relevant = isMajor(s, c.id) || c.goal?.target === s.player || s.stats[`nb:${s.player}:${c.id}`] === 1 || s.rival === c.id;
  if (relevant || important) logEvent(s, text, 'diplo', [c.id, ...(c.goal && c.goal.target >= 0 ? [c.goal.target] : [])], important, big ? { big: true, prov: c.capital } : undefined);
}
function finish(s: GameState, c: Country, ok: boolean, text: string, important = false) {
  const g = c.goal!;
  s.stats[`plan:${g.kind}:${ok ? 'ok' : 'fail'}`] = (s.stats[`plan:${g.kind}:${ok ? 'ok' : 'fail'}`] ?? 0) + 1;
  s.stats[`planCd:${c.id}:${g.kind}:${g.ref ?? g.target}`] = s.tick;
  news(s, c, text, important || g.target === s.player);
  delete c.goal;
}
/** Progress toward the aim, 0..1 (1 = achieved). */
function measure(s: GameState, geo: Geo, c: Country, g: NatGoal): number {
  switch (g.kind as PlanKind) {
    case 'recover': return clamp(Math.min((1.6 - c.eco.debt / c.eco.gdp) / 0.4 + 0.5, (c.eco.stability - 30) / 20 + 0.5), 0, 1);
    case 'sanctions': return clamp(1 - c.eco.sanctionShare / 0.15, 0, 1);
    case 'revanche': { const l = lostLand(s, c); return !l || l[0] !== g.target ? 1 : clamp(odds(s, geo, c, g.target) * 0.6, 0, 0.9); }
    case 'claims': return claimStrength(c.id, g.target) < 0.3 ? 1 : clamp(odds(s, geo, c, g.target) * 0.6, 0, 0.9);
    case 'security': {
      const T = s.countries[g.target]; if (!T?.alive) return 1;
      const mine = strength(c) + 0.6 * alliesOf(s, c.id).filter((x) => !hasAlliance(s, x, g.target)).reduce((t, x) => t + strength(s.countries[x]), 0);
      return clamp(mine / Math.max(1, strength(T)) / 1.2, 0, 1);
    }
    case 'dominance': return clamp(regionShare(s, c) / 0.5, 0, 1);
    case 'nukes': { if (c.mil.nuclear) return 1; const r = runsOf(s, c.id).find((x) => x.id === 'nuclear'); return r ? clamp(r.done / Math.max(1, r.weeks), 0, 0.99) : 0; }
    case 'join': { const o = s.orgs?.find((x) => x.id === g.ref); return !o ? 0 : o.members.includes(c.id) ? 1 : clamp(o.members.slice(0, 10).reduce((t, x) => t + getRelation(s, c.id, x), 0) / Math.min(10, o.members.length) / 40, 0, 0.9); }
    case 'exit': { const o = s.orgs?.find((x) => x.id === g.ref); return !o || !o.members.includes(c.id) ? 1 : 0.5; }
    case 'bloc': return (s.orgs ?? []).some((o) => o.founder === c.id && o.members.includes(c.id)) ? 1 : clamp(g.step! / 12, 0, 0.9);
    case 'contain': { const T = s.countries[g.target]; return !T?.alive ? 1 : clamp(1 - aggOf(s, g.target) / 40 - Math.max(0, -opinionOf(s, c.id, g.target).v - 10) / 60, 0, 1); }
    case 'growth': default: return 0.5;
  }
}

/** Monthly: work toward the aim, measure progress, and give up when patience runs out. */
export function pursuePlan(s: GameState, geo: Geo, c: Country) {
  const g = c.goal;
  if (!g || !c.leader) return;
  const T = g.target >= 0 ? s.countries[g.target] : undefined;
  if (g.target >= 0 && !T?.alive) { finish(s, c, true, `${c.name} no longer needs its aim: ${name(s, g.target)} is gone.`); return; }
  g.step = (g.step ?? 0) + 1;
  const kind = g.kind as PlanKind;
  // ---- act
  const court = (ids: CountryId[], v: number) => { for (const x of ids.slice(0, 5)) if (s.countries[x]?.alive && x !== c.id) addRelation(s, c.id, x, v); };
  const tryAlly = (x: CountryId) => { if (x === s.player || hasAlliance(s, c.id, x) || isAtWar(s, x)) return; if (evaluateProposal(s, geo, c.id, x, 'alliance').accept && evaluateProposal(s, geo, x, c.id, 'alliance').accept) applyTreaty(s, c.id, x, 'alliance'); };
  switch (kind) {
    case 'revanche': case 'claims': case 'security': case 'contain': {
      // the enemy of my enemy: court the countries that dislike the target
      const foes = s.countries.filter((x) => x.alive && x.id !== c.id && x.id !== g.target && getRelation(s, x.id, g.target) < -25 && getRelation(s, c.id, x.id) > 0).sort((a, b) => strength(b) - strength(a)).map((x) => x.id);
      court(foes, 0.8);
      if (g.step % 6 === 0 && foes.length) tryAlly(foes[0]);
      if (kind === 'contain' && T && g.step % 6 === 3 && sanctionLevel(s, c.id, g.target) === 0 && getRelation(s, c.id, g.target) < -20 && T.eco.gdp < c.eco.gdp * 2) imposeSanction(s, c.id, g.target, 1);
      break;
    }
    case 'dominance': {
      // lean on the weaker neighbours: friends are offered protection, the rest feel the pressure
      for (const x of neighborsOf(s, geo, c.id).map((n) => s.countries[n]).filter((n) => strength(n) < strength(c) * 0.6)) addRelation(s, c.id, x.id, getRelation(s, c.id, x.id) > 20 ? 0.6 : -0.6);
      break;
    }
    case 'nukes': {
      const run = runsOf(s, c.id).find((x) => x.id === 'nuclear');
      if (!run && !c.mil.nuclear && !canStart(s, c.id, 'nuclear') && !runsOf(s, c.id).length) { startProject(s, c.id, 'nuclear'); s.stats[`nukeStart:${c.id}`] = s.tick; }
      if (run && run.done / Math.max(1, run.weeks) > 0.3 && !s.stats[`nukeSeen:${c.id}`]) nuclearDiscovered(s, geo, c);
      // under sanctions and in pain, a pragmatic government may trade the programme for relief
      if (run && s.stats[`nukeSeen:${c.id}`] && moodOf(c).pain > 0.45 && (c.leader.traits.includes('pragmatist') || c.leader.traits.includes('reformer') || c.leader.traits.includes('dove')) && nextRand(s) < 0.08) {
        s.projects = s.projects.filter((x) => x !== run);
        for (const x of s.countries) if (x.alive && sanctionLevel(s, x.id, c.id) > 0 && (x.orient ?? 0) > 0.3) liftSanction(s, x.id, c.id);
        c.hostile = Math.max(0, (c.hostile ?? 0) - 0.2);
        finish(s, c, false, `☢ ${c.name} agrees to halt its nuclear programme in return for sanctions relief.`, true);
        return;
      }
      break;
    }
    case 'join': {
      const o = s.orgs?.find((x) => x.id === g.ref);
      if (!o) break;
      court(o.members.slice().sort((a, b) => strength(s.countries[b]) - strength(s.countries[a])), 1.2);
      if (o.kind === 'defence' && c.budget.military < 0.02) { c.budget.military += 0.001; c.eco.prev.mil0 = Math.max(c.eco.prev.mil0 ?? 0, c.budget.military); }
      if (g.step >= 9 && g.step % 6 === 3 && !isAtWar(s, c.id)) {
        const votes = applicationVotes(s, o, c.id);
        const yes = votes.filter((v) => v.yes).length;
        // no government applies in public to be humiliated: it waits until most members are on side
        if (!admitted(o, votes) && yes < votes.length * 0.75) { g.patience = (g.patience ?? 1) - 0.12; g.note = `waiting for support (${yes} of ${votes.length} members would say yes)`; break; }
        if (admitted(o, votes)) { joinOrg(s, o, c.id, 'its application was accepted'); finish(s, c, true, `🤝 ${c.name} achieves its aim: it joins ${o.name}.`); return; }
        const no = votes.filter((v) => !v.yes).map((v) => name(s, v.m));
        g.patience = (g.patience ?? 1) - 0.34;
        g.note = `turned down (${no.slice(0, 3).join(', ')}${no.length > 3 ? ` +${no.length - 3}` : ''} voted no)`;
        news(s, c, `🚫 ${c.name}'s bid to join ${o.name} is turned down: ${no.slice(0, 3).join(', ')}${no.length > 3 ? ` and ${no.length - 3} more` : ''} voted no.`, o.members.includes(s.player));
      }
      break;
    }
    case 'exit': {
      const o = s.orgs?.find((x) => x.id === g.ref);
      if (o && o.members.includes(c.id) && !o.ultimatum) issueUltimatum(s, o, c.id);
      if (o && !o.ultimatum && o.members.includes(c.id) && g.step > 3) { finish(s, c, false, `🤝 ${c.name} settles for more burden-sharing and stays in ${o.name}.`); return; }
      break;
    }
    case 'bloc': {
      const friends = s.countries.filter((x) => x.alive && x.id !== c.id && !x.isPlayer && getRelation(s, c.id, x.id) > 45 && strength(x) < strength(c) && !orgsOf(s, x.id).some((o) => o.kind !== 'economic' && (o.camp * (c.orient ?? 0) < -0.2 || o.members.includes(c.id))))
        .sort((a, b) => getRelation(s, c.id, b.id) - getRelation(s, c.id, a.id)).slice(0, 5);
      court(friends.map((f) => f.id), 1);
      if (g.step >= 12 && friends.length >= 2 && (s.orgs ?? []).length < 16) {
        const threat = mainThreat(s, geo, c);
        const local = friends.filter((f) => f.region === c.region);
        const kind = threat.th > 0.35 && local.length >= 2 ? 'defence' : local.length >= 3 ? 'union' : 'economic';
        foundOrg(s, c.id, kind, (kind === 'economic' ? friends : local).map((f) => f.id));
        finish(s, c, true, `🏛 ${c.name} achieves its aim: its own bloc.`);
        return;
      }
      break;
    }
    case 'sanctions': {
      for (const x of s.countries) if (x.alive && sanctionLevel(s, x.id, c.id) > 0) addRelation(s, c.id, x.id, 0.8);
      break;
    }
  }
  // ---- measure
  const p = measure(s, geo, c, g);
  if (p >= 1) {
    const done: Partial<Record<PlanKind, string>> = {
      recover: `${c.name} has put its house in order.`, sanctions: `${c.name} has broken out of the sanctions.`, revanche: `⚔ ${c.name} achieves its aim: its lost land is back.`,
      claims: `🗺 ${c.name} has settled its claims on ${name(s, g.target)}.`, security: `🛡 ${c.name} now feels secure against ${name(s, g.target)}.`, dominance: `👑 ${c.name} is now the dominant power in its region.`,
      nukes: `☢ ${c.name} achieves its aim: it has the bomb.`, exit: `🚪 ${c.name} is out.`, contain: `🧱 ${c.name} eases its containment of ${name(s, g.target)}: the danger has passed.`,
    };
    if (kind !== 'growth' && kind !== 'join' && kind !== 'bloc') { finish(s, c, true, done[kind] ?? `${c.name} achieves its aim.`, kind === 'nukes'); return; }
  }
  g.progress = +p.toFixed(3);
  // patience: stalling costs it, progress restores some
  if (p > (g.best ?? 0) + 0.03) { g.best = p; g.patience = Math.min(1, (g.patience ?? 1) + 0.05); }
  else if (kind !== 'growth' && kind !== 'recover' && kind !== 'exit') g.patience = (g.patience ?? 1) - (kind === 'nukes' ? 0.008 : kind === 'contain' ? 0.012 : 0.02);
  if ((g.patience ?? 1) <= 0) {
    const why: Partial<Record<PlanKind, string>> = {
      revanche: `${c.name} gives up on winning back its land from ${name(s, g.target)}, for now: the odds are not there.`, claims: `${c.name} shelves its claims on ${name(s, g.target)}.`,
      security: `${c.name} gives up trying to match ${name(s, g.target)} and looks for other ways to stay safe.`, dominance: `${c.name}'s bid to dominate its region has stalled; it scales back its ambitions.`,
      nukes: `☢ ${c.name}'s nuclear programme is shelved.`, join: `🚫 ${c.name} abandons its bid to join ${s.orgs?.find((x) => x.id === g.ref)?.name ?? 'the bloc'}.`,
      contain: `${c.name} stops trying to contain ${name(s, g.target)}.`, bloc: `${c.name} fails to gather enough partners for a bloc of its own.`, sanctions: `${c.name} learns to live with the sanctions.`,
    };
    finish(s, c, false, why[kind] ?? `${c.name} abandons its aim.`);
  }
}

/** The world finds out about a secret programme: sanctions from the camp that fears it, alarm next door, maybe sabotage. */
function nuclearDiscovered(s: GameState, geo: Geo, c: Country) {
  s.stats[`nukeSeen:${c.id}`] = s.tick;
  logEvent(s, `🛰 Intelligence agencies report that ${c.name} is secretly building a nuclear weapon.`, 'danger', [c.id], isMajor(s, c.id) || s.stats[`nb:${s.player}:${c.id}`] === 1, { big: isMajor(s, c.id), prov: c.capital });
  for (const n of neighborsOf(s, geo, c.id)) addRelation(s, c.id, n, -10);
  for (const x of s.countries) {
    if (!x.alive || x.id === c.id || x.isPlayer) continue;
    const rel = getRelation(s, x.id, c.id);
    if (rel < 25 && (x.orient ?? 0) * (c.orient ?? 0) < 0.2 && isMajor(s, x.id) && sanctionLevel(s, x.id, c.id) === 0) imposeSanction(s, x.id, c.id, 1);
  }
  if ((c.orient ?? 0) < 0.3) c.hostile = clamp((c.hostile ?? 0) + 0.2, 0, 1);
  // a hostile great power may sabotage it
  const saboteur = s.countries.find((x) => x.alive && x.id !== c.id && !x.isPlayer && isMajor(s, x.id) && getRelation(s, x.id, c.id) < -40 && strength(x) > strength(c) * 2);
  const run = runsOf(s, c.id).find((x) => x.id === 'nuclear');
  if (saboteur && run && nextRand(s) < 0.4) {
    run.done = Math.max(0, run.done - run.weeks * 0.3);
    logEvent(s, `💥 A mysterious explosion wrecks ${c.name}'s main enrichment site. ${saboteur.name} denies everything.`, 'danger', [c.id, saboteur.id], isMajor(s, c.id) || isMajor(s, saboteur.id));
    addRelation(s, c.id, saboteur.id, -25);
  }
}

/** How a plan pushes the AI's day-to-day choices. */
export function planMilBias(c: Country): number {
  const k = c.goal?.kind as PlanKind | undefined;
  return k === 'revanche' || k === 'claims' || k === 'dominance' ? 1.25 : k === 'security' || k === 'contain' ? 1.15 : k === 'growth' ? 0.92 : k === 'recover' ? 0.85 : 1;
}
export function planWarPull(s: GameState, c: Country, t: CountryId): number {
  const g = c.goal;
  if (!g) return 0;
  if ((g.kind === 'revanche' || g.kind === 'claims') && g.target === t) return 0.18;
  if (g.kind === 'dominance' && strength(s.countries[t]) < strength(c) * 0.5) return 0.08;
  if (g.kind === 'contain' && g.target === t) return 0.04;
  if (g.kind === 'growth' || g.kind === 'recover') return -0.1;
  return 0;
}
export const planTradeBias = (c: Country) => (c.goal?.kind === 'growth' ? 1.5 : c.goal?.kind === 'sanctions' ? 1.3 : 1);
