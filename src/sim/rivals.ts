/**
 * Rivals as characters. Two leaders measure themselves against you:
 *   - the one to catch: the nation just above you in the world power race (at the top, the one hunting you);
 *   - your nemesis: your named rival (rival.ts), the neighbour you are compared with and who works against you.
 * They declare a national focus of their own each January (often answering yours), court your client states, send
 * you messages, and every overtake, either way, is a moment: big news, a reward or a sting, and their reaction.
 */
import { clamp } from './util';
import { hash01 } from './rng';
import { logEvent } from './log';
import { cableText } from './cables';
import { powerTable } from './power';
import { strengthIndex } from './military';
import { addInfluence, clientsOf } from './influence';
import { addRelation as addRelationR } from './relations';
import { alliesOf, getRelation, isAtWar } from './relations';
import { gainPC } from './domestic';
import { approval } from './approval';
import { FOCI, focusById, type FocusId } from './focus';
import type { Country, GameState } from './types';

export interface Rivals {
  /** the nation to catch (just above you; at the top, the one just behind) */
  chase: number;
  /** last month's rank and the country just above, to detect overtakes */
  rank: number; above: number; below: number;
  /** overtakes won and lost */
  won: number; lost: number;
  /** who you have overtaken, and when */
  passed: Record<number, number>;
  /** your best place in the race so far, and when the last overtake made the news */
  best?: number; newsAt?: number;
  /** the history of each rivalry: what happened between you, newest last (a few entries per rival) */
  hist?: Record<number, { tick: number; text: string; them: boolean }[]>;
  /** the nemesis's latest scheme against you, and whether you have answered it */
  scheme?: { id: SchemeId; by: number; tick: number; answered?: boolean };
}
export type SchemeId = 'smear' | 'ally' | 'opposition' | 'incident' | 'squeeze';
export const SCHEMES: Record<SchemeId, { title: string; text: (them: string, you: string, x?: string) => string; answer: string }> = {
  smear: { title: 'A smear campaign', text: (t, y) => `${t}'s state media and paid accounts flood the world with stories about corruption in ${y}. Reputation −3.`, answer: 'Expose the campaign' },
  ally: { title: 'Courting your ally', text: (t, _y, x) => `${t} offers ${x} cheap loans and a defence deal to pull it away from you. Your relations with ${x} −6.`, answer: 'Outbid them' },
  opposition: { title: 'Money for your opposition', text: (t) => `Investigators trace foreign money from ${t} to opposition groups and protest organisers at home. Approval −2, liberals and unions restless.`, answer: 'Expel their agents' },
  incident: { title: 'A border incident', text: (t) => `${t}'s troops fire across the border; two of our soldiers are wounded. The country is angry and scared. Stability −2.`, answer: 'A firm, measured answer' },
  squeeze: { title: 'A trade squeeze', text: (t) => `${t} holds our exports at its customs posts and warns its firms off our market. Cash −0.3% of GDP.`, answer: 'Retaliate in kind' },
};
/** Remember something between you and a rival (shown in the rivalry history, and recalled in their messages). */
export function remember(s: GameState, id: number, text: string, them = true) {
  const R = ensureRivals(s);
  const h = ((R.hist ??= {})[id] ??= []);
  h.push({ tick: s.tick, text, them });
  if (h.length > 8) h.splice(0, h.length - 8);
}

export function ensureRivals(s: GameState): Rivals {
  if (!s.rivals) {
    const rows = powerTable(s), i = rows.findIndex((r) => r.id === s.player);
    s.rivals = { chase: i > 0 ? rows[i - 1].id : rows[1]?.id ?? -1, rank: i + 1, above: i > 0 ? rows[i - 1].id : -1, below: rows[i + 1]?.id ?? -1, won: 0, lost: 0, passed: {} };
  }
  return s.rivals;
}
export const nemesisOf = (s: GameState) => (s.rival >= 0 && s.countries[s.rival]?.alive ? s.rival : -1);
const leaderName = (c: Country) => c.leader?.name ?? `${c.name}'s leader`;
const youName = (s: GameState) => s.legacy?.leader ?? s.countries[s.player].name;
const pick = <T,>(xs: T[], s: GameState, salt: string, id: number) => xs[Math.floor(hash01(salt, id, s.tick) * xs.length)];

/** What a rival leader declares for the year: what they need most, or an answer to your own focus. */
export function rivalFocus(s: GameState, c: Country, answer: boolean): FocusId {
  const me = s.countries[s.player];
  const e = c.eco;
  if (isAtWar(s, c.id) || (answer && me.focus === 'rearm')) return 'rearm';
  if (e.stability < 45) return 'welfare';
  if (e.debt / Math.max(1, e.gdp) > 1.1) return 'reform';
  if (answer && me.focus === 'diplomacy') return 'diplomacy';
  if (answer && me.focus === 'science') return 'science';
  const tr: string[] = c.leader?.traits ?? [];
  if (tr.includes('hawk') || tr.includes('strongman') || tr.includes('nationalist')) return hash01('rf', c.id, s.tick) < 0.6 ? 'rearm' : 'industry';
  if (tr.includes('dove') || tr.includes('reformer')) return hash01('rf', c.id, s.tick) < 0.5 ? 'diplomacy' : 'science';
  return (['industry', 'science', 'diplomacy'] as FocusId[])[Math.floor(hash01('rf2', c.id, s.tick) * 3)];
}

/** Monthly: overtakes; each January the rivals declare their year; the nemesis courts your clients. */
export function stepRivals(s: GameState) {
  const me = s.countries[s.player];
  if (!me?.alive) return;
  const R = ensureRivals(s);
  // January: the rivals' declarations (others keep no focus: only the leaders you are measured against declare one)
  if (s.tick % 52 === 1) {
    const set = new Set([R.chase, nemesisOf(s)].filter((x) => x >= 0 && x !== s.player));
    for (const c of s.countries) if (c.id !== s.player && c.focus && !set.has(c.id)) c.focus = undefined;
    for (const id of set) {
      const c = s.countries[id];
      if (!c.alive) continue;
      const f = rivalFocus(s, c, id === nemesisOf(s));
      const F = focusById(f)!;
      c.focus = f;
      logEvent(s, `🎙 ${leaderName(c)} declares ${c.name}'s year: ${F.icon} ${F.name}. "${F.motto}"`, 'diplo', [id, s.player], true);
      remember(s, id, `declared a year of ${F.name.toLowerCase()}`);
      const mine = focusById(me.focus);
      const line = mine && mine.id === f ? `So ${youName(s)} has chosen ${mine.name.toLowerCase()} too. We will see who does it better.`
        : pick([`${F.motto} By December the world will know which of us chose well.`, `${youName(s)} has made its plans; we have made ours. Watch this year closely.`, `This will be ${c.name}'s year. ${F.motto}`], s, 'rq', id);
      cableText(s, id, line, getRelation(s, id, s.player) > 30 ? 'neutral' : 'cold');
    }
  }
  if (s.tick % 4 !== 3) return;
  const rows = powerTable(s), i = rows.findIndex((r) => r.id === s.player);
  if (i < 0) return;
  const rank = i + 1, above = i > 0 ? rows[i - 1].id : -1, below = rows[i + 1]?.id ?? -1;
  // you passed the country that was above you
  // only a new best place is a moment (and pays): swapping places back and forth with a neighbour in the table is not
  const best = R.best ?? R.rank;
  const quiet = s.tick - (R.newsAt ?? -999) < 13;
  if (rank < R.rank && R.above >= 0 && s.countries[R.above]?.alive && rows.findIndex((r) => r.id === R.above) > i && s.tick - (R.passed[R.above] ?? -999) > 26) {
    const T = s.countries[R.above];
    R.passed[R.above] = s.tick;
    R.won++;
    const record = rank < best;
    remember(s, T.id, `you overtook them for #${rank}`, false);
    if (record && !quiet) {
      R.newsAt = s.tick;
      gainPC(s, 6);
      s.stats.apprBoost = (s.stats.apprBoost ?? 0) + 2;
      logEvent(s, `📈 ${me.name.toUpperCase()} OVERTAKES ${T.name.toUpperCase()}: now #${rank} in the world power race, its best yet. Political capital +6, approval +2.`, 'info', [s.player, T.id], true, rank <= 60 ? { big: true, prov: me.capital } : undefined);
      if (rank <= 60) cableText(s, T.id, pick([`Enjoy the view from #${rank}, ${youName(s)}. It will not last.`, `A good year for ${me.name}. Ours is coming.`, `Congratulations are in order, I suppose. We are not finished.`], s, 'ov', T.id), getRelation(s, T.id, s.player) > 30 ? 'neutral' : 'cold');
    } else logEvent(s, `📈 ${me.name} passes ${T.name}: #${rank} in the world power race.`, 'info', [s.player, T.id], false);
  } else if (rank > R.rank && above >= 0 && above === R.below && s.tick - (s.stats[`ovl:${above}`] ?? -999) > 26) {
    // the one below you passed you
    const T = s.countries[above];
    s.stats[`ovl:${above}`] = s.tick;
    R.lost++;
    remember(s, T.id, `they overtook you for #${rank - 1}`);
    if (!quiet && rank <= 60) {
      R.newsAt = s.tick;
      s.stats.apprBoost = (s.stats.apprBoost ?? 0) - 1.5;
      logEvent(s, `📉 ${T.name} overtakes ${me.name} in the world power race: you slip to #${rank}. Approval −1.5.`, 'danger', [s.player, T.id], true, { big: true, prov: T.capital });
      cableText(s, T.id, pick([`#${rank - 1}. It has a nice ring to it, ${youName(s)}.`, `The world has noticed who is rising, and who is not.`, `No hard feelings. Try to keep up.`], s, 'ol', T.id), 'cold');
    } else logEvent(s, `📉 ${T.name} passes ${me.name}: you are #${rank} in the world power race.`, 'danger', [s.player, T.id], false);
  }
  R.best = Math.min(best, rank);
  R.rank = rank; R.above = above; R.below = below;
  R.chase = above >= 0 ? above : below;
  schemes(s);
  // the nemesis competes for your clients
  const n = nemesisOf(s);
  if (n >= 0 && s.countries[n].eco.gdp > 0.25 * me.eco.gdp && s.tick % 12 === 3) {
    const cl = clientsOf(s, s.player).filter((t) => getRelation(s, n, t) > -30 && !alliesOf(s, t).includes(s.player));
    if (cl.length) {
      const t = cl[Math.floor(hash01('nc', n, s.tick) * cl.length)];
      addInfluence(s, t, n, 4 + 4 * clamp(s.countries[n].eco.gdp / me.eco.gdp, 0.3, 1.5));
      if (s.tick - (s.stats.nemCourt ?? -999) > 40) {
        s.stats.nemCourt = s.tick;
        logEvent(s, `🕸 ${s.countries[n].name} is courting ${s.countries[t].name}, one of your client states, with money and promises. Defend your influence there (Diplomacy).`, 'diplo', [s.player, n, t], true);
      }
    }
  }
}

/** Every few months the nemesis works against you: the harder they hate you, the more often (answer it from your desk). */
function schemes(s: GameState) {
  const R = ensureRivals(s);
  const n = nemesisOf(s);
  if (n < 0) return;
  const N = s.countries[n], me = s.countries[s.player];
  const rel = getRelation(s, n, s.player);
  if (rel > 10 || isAtWar(s, n)) return;
  // the higher you rise, the harder they push: a top-five power is schemed against far more often
  const gap = (52 - Math.min(30, Math.max(0, -rel) / 2)) * (R.rank > 0 && R.rank <= 5 ? 0.6 : R.rank > 0 && R.rank <= 12 ? 0.8 : 1);
  if (s.tick - (R.scheme?.tick ?? -999) < gap || hash01('sch', n, s.tick) > 0.25) return;
  const allies = alliesOf(s, s.player).filter((a) => a !== n && s.countries[a]?.alive);
  const opts: SchemeId[] = ['smear', 'squeeze', ...(allies.length ? ['ally' as SchemeId] : []), ...(me.gov === 'D' || me.gov === 'F' ? ['opposition' as SchemeId] : []), ...(s.countries[n].region === me.region ? ['incident' as SchemeId] : [])];
  const id = opts[Math.floor(hash01('sch2', n, s.tick) * opts.length)];
  const x = id === 'ally' ? allies.sort((a, b) => s.countries[b].eco.gdp - s.countries[a].eco.gdp)[0] : undefined;
  switch (id) {
    case 'smear': me.reputation = clamp(me.reputation - 3, 0, 100); break;
    case 'ally': if (x !== undefined) { addRelationR(s, s.player, x, -6); addRelationR(s, n, x, 6); } break;
    case 'opposition': s.stats.apprBoost = (s.stats.apprBoost ?? 0) - 2; break;
    case 'incident': me.eco.stability = clamp(me.eco.stability - 2, 0, 100); addRelationR(s, n, s.player, -5); break;
    case 'squeeze': me.eco.cash = Math.max(0, me.eco.cash - 0.003 * me.eco.gdp); break;
  }
  R.scheme = { id, by: n, tick: s.tick };
  const S = SCHEMES[id];
  remember(s, n, S.title.toLowerCase());
  logEvent(s, `🕸 ${S.title.toUpperCase()}: ${S.text(N.name, me.name, x !== undefined ? s.countries[x].name : undefined)}`, 'danger', [s.player, n], true);
  const past = (R.hist?.[n] ?? []).filter((h) => s.tick - h.tick > 52 && !h.them).slice(-1)[0];
  if (past && hash01('schc', n, s.tick) < 0.6) cableText(s, n, `Do you remember when ${past.text.replace(/\bthem\b/, 'us').replace(/\btheir\b/, 'our')}? ${N.name} remembers.`, 'cold');
}
/** Answer the nemesis's latest scheme: political capital, and it costs them. */
export function actAnswerScheme(s: GameState) {
  const R = ensureRivals(s);
  const sc = R.scheme;
  if (!sc || sc.answered) return { ok: false, message: 'Nothing to answer' };
  const c = s.countries[s.player];
  if ((c.politics?.pc ?? 0) < 8) return { ok: false, message: 'Needs 8 political capital' };
  if (c.politics) c.politics.pc -= 8;
  sc.answered = true;
  addRelationR(s, sc.by, s.player, -6);
  switch (sc.id) {
    case 'smear': c.reputation = clamp(c.reputation + 4, 0, 100); break;
    case 'ally': for (const a of alliesOf(s, s.player)) addRelationR(s, s.player, a, 4); break;
    case 'opposition': s.stats.apprBoost = (s.stats.apprBoost ?? 0) + 2.5; break;
    case 'incident': c.eco.stability = clamp(c.eco.stability + 2, 0, 100); s.stats.apprBoost = (s.stats.apprBoost ?? 0) + 1; break;
    case 'squeeze': { const N = s.countries[sc.by]; if (N) N.eco.cash = Math.max(0, N.eco.cash - 0.002 * N.eco.gdp); break; }
  }
  remember(s, sc.by, `you answered their ${SCHEMES[sc.id].title.toLowerCase()}`, false);
  return { ok: true, message: `${SCHEMES[sc.id].answer}: done (−8 capital, relations with ${s.countries[sc.by].name} −6).` };
}

export interface H2H { key: string; label: string; a: string; b: string; lead: 1 | 0 | -1; ra: number }
/** Head to head: you against another nation on what matters. lead: 1 you, −1 them. ra: your share 0..1 for the bar. */
export function headToHead(s: GameState, aId: number, bId: number): { rows: H2H[]; you: number; them: number } {
  const A = s.countries[aId], B = s.countries[bId];
  const pt = powerTable(s);
  const pw = (id: number) => pt.find((r) => r.id === id)?.score ?? 0;
  const techs = (c: Country) => (c.rs ? c.rs.lv.reduce((t, v) => t + v, 0) : c.eco.tech / 10);
  const f1 = (v: number) => v.toFixed(1);
  const money = (v: number) => (v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : `$${(v / 1e9).toFixed(0)}B`);
  const rows: H2H[] = [];
  const add = (key: string, label: string, a: number, b: number, fa: string, fb: string, lowWins = false) => {
    const lead = Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(a)) ? 0 : (a > b) !== lowWins ? 1 : -1;
    const sa = lowWins ? 1 / Math.max(1e-6, a) : Math.max(0, a), sb = lowWins ? 1 / Math.max(1e-6, b) : Math.max(0, b);
    rows.push({ key, label, a: fa, b: fb, lead: lead as 1 | 0 | -1, ra: sa + sb > 0 ? sa / (sa + sb) : 0.5 });
  };
  add('power', 'World power', pw(aId), pw(bId), f1(pw(aId)), f1(pw(bId)));
  add('gdp', 'Economy', A.eco.gdp, B.eco.gdp, money(A.eco.gdp), money(B.eco.gdp));
  add('growth', 'Growth', A.eco.growth, B.eco.growth, `${(A.eco.growth * 100).toFixed(1)}%`, `${(B.eco.growth * 100).toFixed(1)}%`);
  add('mil', 'Military', strengthIndex(A), strengthIndex(B), `${(strengthIndex(A) * 1000 / 1e3).toFixed(0)}K`, `${(strengthIndex(B) * 1000 / 1e3).toFixed(0)}K`);
  add('tech', 'Technology', techs(A), techs(B), `${techs(A).toFixed(0)} rungs`, `${techs(B).toFixed(0)} rungs`);
  const ca = clientsOf(s, aId).length, cb = clientsOf(s, bId).length;
  add('inf', 'Clients', ca, cb, `${ca}`, `${cb}`);
  add('stab', 'Stability', A.eco.stability, B.eco.stability, A.eco.stability.toFixed(0), B.eco.stability.toFixed(0));
  add('rep', 'Reputation', A.reputation, B.reputation, A.reputation.toFixed(0), B.reputation.toFixed(0));
  return { rows, you: rows.filter((r) => r.lead === 1).length, them: rows.filter((r) => r.lead === -1).length };
}

/** The approval of the government of another country (for the rival cards). */
export const theirApproval = (s: GameState, c: Country) => approval(s, c);
export { FOCI };
