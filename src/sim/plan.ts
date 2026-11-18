/**
 * The State of the Nation: the player's year. On 1 January the game stops for a moment: last year's report card
 * (graded against what is normal for the country), the rivals, and three decisions for the year ahead:
 *   - a national focus (focus.ts): one area much stronger, something real given up for it;
 *   - a pledge: one objective you promise to deliver this year (kept: capital +12 and approval +3; broken: approval −4);
 *   - then "Begin the year".
 * A good year is rewarded (political capital and approval), and the grades build a record you can look back on.
 */
import { snapshot } from './dynasty';
import { clamp } from './util';
import { logEvent } from './log';
import { approval } from './approval';
import { powerRank } from './power';
import { clientsOf } from './influence';
import { gainPC } from './domestic';
import { focusById, type FocusId } from './focus';
import { START_YEAR, type GameState } from './types';

export interface Snap { /** every country's real output when the year began (for the world growth table) */ world?: number[]; tick: number; real: number; stab: number; appr: number; rank: number; debt: number; rep: number; goals: number; kept: number; techs: number; clients: number; prov: number }
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
export interface ReportLine { key: string; label: string; text: string; pts: number }
export interface Report { year: number; grade: Grade; score: number; headline: string; lines: ReportLine[]; pledge?: { title: string; kept: boolean }; focus?: FocusId; reward: string }
export interface Plan {
  year: number;
  /** the State of the Nation is waiting for the player */
  pending: boolean;
  /** when this year's plan was made */
  started: number;
  snap: Snap;
  pledge?: { id: string; title: string; done?: boolean };
  report?: Report;
  history: YearRec[];
  /** a mid-year change of focus has been made */
  switched?: boolean;
  /** the country when the game began (the yearly 'then and now') */
  snap0?: import('./dynasty').Snapshot;
  /** the world power race: the top ten now, and as it stood a year ago */
  top?: number[]; topPrev?: number[];
}

/**
 * One year of your record, kept for good: the grade and the full report card, who governed, the numbers as the year
 * closed, and its biggest moments. (Older saves only have the first five fields.)
 */
export interface YearRec {
  year: number; grade: Grade; score: number; focus?: FocusId; pledge?: boolean;
  headline?: string; lines?: ReportLine[]; pledgeTitle?: string;
  leader?: string; term?: number; gen?: number; office?: boolean;
  /** income per head (real), growth over the year, stability, approval, world power rank, debt (share of GDP) */
  gdppc?: number; growth?: number; stab?: number; appr?: number; rank?: number; debt?: number;
  gdp?: number; pop?: number; troops?: number; prov?: number; rep?: number; unemp?: number; infl?: number; wars?: number;
  /** where your growth ranked among all the world's economies that year (1 = fastest), and out of how many */
  growthRank?: number; growthOf?: number;
  /** the year's biggest moments, from the news */
  moments?: string[];
  /** career records this year set ("best year", "fastest growth" ...) */
  records?: string[];
}
export const GPA: Record<Grade, number> = { S: 4.3, A: 4, B: 3, C: 2, D: 1, F: 0 };
/** what a grade average reads as */
export const gpaGrade = (v: number): Grade => (v >= 4.15 ? 'S' : v >= 3.5 ? 'A' : v >= 2.5 ? 'B' : v >= 1.5 ? 'C' : v >= 0.5 ? 'D' : 'F');

/** The year's biggest moments for you, from the news: wars, elections, land, promises, crises (at most five). */
function momentsOf(s: GameState, from: number, to: number): string[] {
  const P = s.player;
  const weight = (text: string, kind: string, big?: boolean) => {
    let w = big ? 3 : 1;
    if (/ELECTION|PARTY CONGRESS|PALACE COUP|COUP|CAPITAL FALLS|wiped off the map|INTERVENTION|declared war|PEACE|surrender|WORLD CRISIS|GREAT AMBITION|CHAPTER .* WRITTEN|RECORD/.test(text)) w += 4;
    if (/PROMISE KEPT|PROMISE BROKEN|STAR WON|TROPHY|overtakes|passes|RED LINE|ENCIRCLED|UPRISING|default/i.test(text)) w += 2;
    if (kind === 'war' || kind === 'territory' || kind === 'peace') w += 1;
    if (/in review: grade|^🏅 RECORD YEAR|GOOD YEARS IN A ROW|^🎙|declares .*'s year/.test(text)) w = -1; // the year's own verdict, and other leaders' slogans, are not its story
    return w;
  };
  const seen = new Set<string>();
  return s.log
    .filter((e) => e.tick > from && e.tick <= to && e.countries.includes(P) && (e.important || e.big))
    .map((e) => ({ e, w: weight(e.text, e.kind, e.big) }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w || a.e.tick - b.e.tick)
    .filter((x) => { const k = x.e.text.slice(0, 40); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 5)
    .sort((a, b) => a.e.tick - b.e.tick)
    .map((x) => (x.e.text.length > 170 ? `${x.e.text.slice(0, 168)}…` : x.e.text));
}

/** The records a year sets against every earlier year of the same career (the first year sets none). */
export function recordsOf(prev: YearRec[], r: YearRec): string[] {
  const past = prev.filter((h) => h.gdppc !== undefined);
  if (past.length < 2) return [];
  const out: string[] = [];
  if (r.score > Math.max(...prev.map((h) => h.score))) out.push('Best year of the career');
  if (r.growth !== undefined && r.growth > Math.max(...past.map((h) => h.growth ?? -1)) && r.growth > 0.02) out.push(`Fastest growth yet (${(r.growth * 100).toFixed(1)}%)`);
  if (r.appr !== undefined && r.appr > Math.max(...past.map((h) => h.appr ?? 0)) && r.appr > 50) out.push(`Highest approval yet (${r.appr.toFixed(0)}%)`);
  if (r.rank !== undefined && r.rank < Math.min(...past.map((h) => h.rank ?? 999))) out.push(`Highest world rank yet (#${r.rank})`);
  if (r.gdppc !== undefined && r.gdppc > Math.max(...past.map((h) => h.gdppc ?? 0)) * 1.0001 && out.length === 0 && r.score >= 57) out.push('The country has never been richer');
  return out.slice(0, 3);
}
/** How many years in a row, up to now, were graded B or better. */
export function goodStreak(h: YearRec[]): number { let n = 0; for (let i = h.length - 1; i >= 0 && GPA[h[i].grade] >= 3; i--) n++; return n; }

export const PLEDGE_MISS = 4;
export const SWITCH_PC = 15;

function snapOf(s: GameState): Snap {
  const c = s.countries[s.player];
  return {
    world: s.countries.map((x) => (x.alive ? Math.round(x.eco.realGdp) : 0)),
    tick: s.tick, real: c.eco.realGdp, stab: c.eco.stability, appr: approval(s, c), rank: powerRank(s, s.player),
    debt: c.eco.debt / Math.max(1, c.eco.gdp), rep: c.reputation, goals: Object.keys(s.goalsDone).length,
    kept: c.politics?.gov?.kept ?? 0, techs: c.rs ? c.rs.lv.reduce((t, v) => t + v, 0) : -1, clients: clientsOf(s, s.player).length, prov: c.provinces.length,
  };
}
export const yearNow = (s: GameState) => START_YEAR + Math.floor(s.tick / 52);

export function ensurePlan(s: GameState): Plan {
  if (!s.plan) s.plan = { year: yearNow(s), pending: false, started: s.tick, snap: snapOf(s), history: [] };
  if (!s.plan.snap0 && s.countries[s.player]?.alive) s.plan.snap0 = snapshot(s);
  return s.plan;
}

const gradeOf = (score: number): Grade => (score >= 85 ? 'S' : score >= 70 ? 'A' : score >= 57 ? 'B' : score >= 44 ? 'C' : score >= 32 ? 'D' : 'F');
export const GRADE_WORD: Record<Grade, string> = { S: 'A historic year', A: 'An excellent year', B: 'A good year', C: 'A mixed year', D: 'A poor year', F: 'A disastrous year' };

/** Grade the year since the snapshot: growth against the country's normal, order, approval, power and promises. */
export function yearReport(s: GameState, P: Plan): Report {
  const c = s.countries[s.player];
  const a = P.snap, b = snapOf(s);
  const weeks = Math.max(13, b.tick - a.tick);
  const yrs = weeks / 52;
  const g = Math.pow(Math.max(0.01, b.real / Math.max(1, a.real)), 1 / yrs) - 1;
  const trend = Number.isFinite(c.eco.baseGrowth) ? clamp(c.eco.baseGrowth, -0.01, 0.07) : 0.02;
  const lines: ReportLine[] = [];
  const L = (key: string, label: string, text: string, pts: number) => lines.push({ key, label, text, pts: Math.round(pts * 10) / 10 });
  const sg = (v: number, d = 0) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
  L('growth', 'Growth', `${sg(g * 100, 1)}% (normal here: ${(trend * 100).toFixed(1)}%)`, clamp(500 * (g - trend), -14, 14));
  L('stab', 'Order', `stability ${a.stab.toFixed(0)} → ${b.stab.toFixed(0)}`, clamp(0.6 * (b.stab - a.stab) + 0.15 * (b.stab - 55), -12, 10));
  L('appr', 'Approval', `${a.appr.toFixed(0)}% → ${b.appr.toFixed(0)}%`, clamp(0.5 * (b.appr - a.appr) + 0.2 * (b.appr - 50), -10, 10));
  L('rank', 'World power', b.rank === a.rank ? `held #${b.rank}` : `#${a.rank} → #${b.rank}`, clamp(4 * (a.rank - b.rank), -10, 12));
  L('debt', 'Public debt', `${(a.debt * 100).toFixed(0)}% → ${(b.debt * 100).toFixed(0)}% of GDP`, clamp(-60 * (b.debt - a.debt), -8, 6));
  const goals = b.goals - a.goals, kept = b.kept - a.kept, techs = a.techs < 0 || b.techs < 0 ? 0 : b.techs - a.techs, cl = b.clients - a.clients, pv = b.prov - a.prov;
  L('done', 'Delivered', `${goals} objective${goals === 1 ? '' : 's'}, ${kept} coalition demand${kept === 1 ? '' : 's'}, ${techs} technolog${techs === 1 ? 'y' : 'ies'}`, Math.min(14, 3.5 * goals + 2.5 * kept + 1.5 * techs));
  if (cl || pv) L('reach', 'Reach', [cl ? `${sg(cl)} client state${Math.abs(cl) === 1 ? '' : 's'}` : '', pv ? `${sg(pv)} region${Math.abs(pv) === 1 ? '' : 's'}` : ''].filter(Boolean).join(', '), clamp(3 * cl + 1 * pv, -8, 8));
  if (c.mil.exhaustion > 0.25) L('war', 'War', `war weariness ${(c.mil.exhaustion * 100).toFixed(0)}%`, -clamp(12 * c.mil.exhaustion, 0, 8));
  const pl = P.pledge;
  if (pl) L('pledge', 'Your promise', `${pl.title}: ${pl.done ? 'kept' : 'broken'}`, pl.done ? 8 : -6);
  const score = clamp(50 + lines.reduce((t, l) => t + l.pts, 0), 0, 100);
  const grade = gradeOf(score);
  const best = [...lines].sort((x, y) => y.pts - x.pts)[0], worst = [...lines].sort((x, y) => x.pts - y.pts)[0];
  const good: Record<string, string> = { growth: 'the economy outran its normal pace', stab: 'order held', appr: 'the public warmed to you', rank: `${c.name} climbed the world table`, debt: 'the books got healthier', done: 'you delivered', reach: 'your reach grew', pledge: 'you kept your word' };
  const bad: Record<string, string> = { growth: 'growth disappointed', stab: 'order frayed', appr: 'the public turned sour', rank: 'rivals pulled ahead', debt: 'debt piled up', done: 'little got done', reach: 'ground was lost', war: 'the war wore people down', pledge: 'you broke your promise' };
  const headline = best && best.pts > 2 && worst && worst.pts < -2 ? `${cap(good[best.key] ?? 'some things went well')}, but ${bad[worst.key] ?? 'not everything did'}.`
    : best && best.pts > 2 ? `${cap(good[best.key] ?? 'it went well')}.` : worst && worst.pts < -2 ? `${cap(bad[worst.key] ?? 'it went badly')}.` : 'A steady year: nothing broke, nothing soared.';
  const reward = grade === 'S' ? 'Political capital +12, approval +3' : grade === 'A' ? 'Political capital +8, approval +2' : grade === 'B' ? 'Political capital +4' : grade === 'F' ? 'Approval −2' : '';
  return { year: P.year, grade, score: Math.round(score), headline, lines, pledge: pl ? { title: pl.title, kept: !!pl.done } : undefined, focus: c.focus, reward };
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Weekly: on 1 January, close last year (report card, the pledge judged) and open the State of the Nation. */
export function stepPlan(s: GameState) {
  const c = s.countries[s.player];
  if (!c?.alive) return;
  const P = ensurePlan(s);
  if (s.tick === 0 || s.tick % 52 !== 0 || yearNow(s) === P.year) return;
  const R = yearReport(s, P);
  if (P.pledge && !P.pledge.done) {
    s.stats.apprBoost = (s.stats.apprBoost ?? 0) - PLEDGE_MISS;
    logEvent(s, `💔 PROMISE BROKEN: "${P.pledge.title}" was not delivered in ${P.year}. Approval −${PLEDGE_MISS}.`, 'danger', [s.player], true);
  }
  if (R.grade === 'S' || R.grade === 'A' || R.grade === 'B') gainPC(s, R.grade === 'S' ? 12 : R.grade === 'A' ? 8 : 4);
  if (R.grade === 'S' || R.grade === 'A') s.stats.apprBoost = (s.stats.apprBoost ?? 0) + (R.grade === 'S' ? 3 : 2);
  if (R.grade === 'F') s.stats.apprBoost = (s.stats.apprBoost ?? 0) - 2;
  const L = s.legacy;
  const real0 = P.snap.real, years = Math.max(0.25, (s.tick - P.snap.tick) / 52);
  const rec: YearRec = {
    year: P.year, grade: R.grade, score: R.score, focus: c.focus, pledge: P.pledge ? !!P.pledge.done : undefined,
    headline: R.headline, lines: R.lines, ...(P.pledge ? { pledgeTitle: P.pledge.title } : {}),
    ...(L && s.settings.mode === 'legacy' ? { leader: L.leader, term: L.term, gen: s.dynasty?.gen ?? 1, office: L.status === 'office' } : {}),
    gdppc: c.eco.realGdp / Math.max(1, c.eco.pop), growth: Math.pow(Math.max(0.01, c.eco.realGdp / Math.max(1, real0)), 1 / years) - 1,
    stab: c.eco.stability, appr: approval(s, c), rank: powerRank(s, s.player), debt: c.eco.debt / Math.max(1, c.eco.gdp),
    gdp: c.eco.gdp, pop: c.eco.pop, troops: c.mil.troops, prov: c.provinces.length, rep: c.reputation, unemp: c.eco.unemployment, infl: c.eco.inflation,
    wars: s.wars.filter((w) => w.attackers.includes(c.id) || w.defenders.includes(c.id)).length,
    moments: momentsOf(s, P.started, s.tick),
  };
  // the world growth table: every economy's growth over the same year
  const w0 = P.snap.world;
  if (w0 && w0.length) {
    const gs: { id: number; g: number }[] = [];
    for (const x of s.countries) if (x.alive && (w0[x.id] ?? 0) > 0 && x.eco.pop > 3e5) gs.push({ id: x.id, g: x.eco.realGdp / w0[x.id] });
    gs.sort((a, b) => b.g - a.g);
    const at = gs.findIndex((x) => x.id === c.id);
    if (at >= 0) { rec.growthRank = at + 1; rec.growthOf = gs.length; }
  }
  rec.records = recordsOf(P.history, rec);
  if (rec.growthRank !== undefined && rec.growthRank <= 10 && rec.records.length < 3) rec.records.push(rec.growthRank === 1 ? 'The fastest-growing economy on earth' : `#${rec.growthRank} fastest-growing economy on earth`);
  P.history.push(rec);
  if (P.history.length > 200) P.history.splice(0, P.history.length - 200);
  // a record year, or a run of good years, is news: it deserves its moment
  const streak = goodStreak(P.history);
  if (rec.records.length) logEvent(s, `🏅 RECORD YEAR: ${rec.records.join(' · ')}.`, 'info', [s.player], true, { big: true });
  // a run of good years pays: the country trusts a government that keeps delivering
  if (streak >= 3 && GPA[R.grade] >= 3) {
    const pc = streak >= 5 ? 10 : 6;
    gainPC(s, pc);
    s.stats.apprBoost = (s.stats.apprBoost ?? 0) + (streak >= 5 ? 3 : 2);
    logEvent(s, `🔥 ${streak} GOOD YEARS IN A ROW: ${streak >= 5 ? 'people are starting to call it a golden age' : 'the country has found its stride'}. Political capital +${pc}, approval +${streak >= 5 ? 3 : 2}.`, 'info', [s.player], true, { big: !rec.records.length });
  }
  logEvent(s, `📋 ${P.year} in review: grade ${R.grade}. ${R.headline}`, 'info', [s.player], true);
  P.report = R;
  if (P.top) P.topPrev = P.top;
  P.top = s.countries.filter((x) => x.alive).map((x) => x.id).sort((a, b) => powerRank(s, a) - powerRank(s, b)).slice(0, 10);
  P.year = yearNow(s);
  P.snap = snapOf(s);
  P.pledge = undefined;
  P.switched = false;
  P.started = s.tick;
  // in opposition (Legacy) the government is not yours: no plan, no focus
  const away = s.settings.mode === 'legacy' && !!s.legacy && s.legacy.status !== 'office';
  if (away) c.focus = undefined;
  P.pending = !away && s.settings.yearPlan !== false;
}

/** Begin the year: the focus (free on 1 January) and the pledge (one of the objectives on the table). */
export function actBeginYear(s: GameState, focus: FocusId | null, pledge: string | null, title?: string) {
  const c = s.countries[s.player];
  const P = ensurePlan(s);
  if (focus && !focusById(focus)) return { ok: false, message: 'Unknown focus' };
  const was = c.focus;
  c.focus = focus ?? undefined;
  if (pledge && !s.goalsActive.includes(pledge)) return { ok: false, message: 'That objective is no longer on the table' };
  if (pledge && !P.pledge?.done) P.pledge = { id: pledge, title: title ?? pledge };
  P.pending = false;
  const F = focusById(c.focus);
  if (F && F.id !== was) logEvent(s, `${F.icon} ${P.year} is declared a year of ${F.name.toLowerCase()}: "${F.motto}"`, 'info', [s.player], true);
  return { ok: true, message: F ? `${F.icon} ${F.name}${P.pledge ? ` · you promised: ${P.pledge.title}` : ''}` : 'The year begins.' };
}

/** Changing course in the middle of the year: once, for political capital (free in the first month). */
export function switchCost(s: GameState) {
  const P = ensurePlan(s);
  if (s.tick - P.started < 5 || !s.countries[s.player].focus) return 0;
  return SWITCH_PC;
}
export function actSwitchFocus(s: GameState, focus: FocusId) {
  const c = s.countries[s.player];
  const P = ensurePlan(s);
  if (c.focus === focus) return { ok: false, message: 'Already your focus' };
  if (P.switched) return { ok: false, message: 'You already changed course once this year' };
  const cost = switchCost(s);
  if (cost && (c.politics?.pc ?? 0) < cost) return { ok: false, message: `Changing course mid-year needs ${cost} political capital` };
  if (cost && c.politics) { c.politics.pc -= cost; P.switched = true; }
  c.focus = focus;
  const F = focusById(focus)!;
  logEvent(s, `${F.icon} Change of course: the rest of ${P.year} is a year of ${F.name.toLowerCase()}.`, 'info', [s.player], true);
  return { ok: true, message: `${F.icon} ${F.name}${cost ? ` (−${cost} capital)` : ''}` };
}
