/**
 * Ambitions that never run out. Each template measures one thing about the country and sets a target from where the
 * country is now and how many times this ambition has already been met (its level): the second economic miracle asks
 * for more than the first. Both the objectives (goals.ts) and the promises of a Legacy term (agenda.ts) are made from
 * these, so there is always a next thing worth doing, sized to the nation you have built.
 */
import type { Country, GameState } from './types';
import { clamp, fmtMoney } from './util';
import { strength } from './military';
import { alliesOf, partnersOf } from './relations';
import { powerRank } from './power';
import { clientsOf } from './influence';
import { approval } from './approval';

export type Cmp = 'ratio' | 'gain' | 'reach' | 'below' | 'drop' | 'rank';
export type AmbCat = 'economy' | 'power' | 'diplomacy' | 'society' | 'territory';
export interface AmbTemplate {
  key: string; cat: AmbCat; icon: string;
  /** titles by level: the first, the second, the third time and beyond */
  titles: string[];
  pitch: string[];
  cmp: Cmp;
  measure: (s: GameState, c: Country) => number;
  /** the target, from the value when the ambition was set and its level */
  target: (base: number, lv: number, s: GameState, c: Country) => number;
  goal: (t: number, base: number) => string;
  fmt: (v: number) => string;
  ok?: (s: GameState, c: Country) => boolean;
  /** judged only at the end (a Legacy promise); never an objective */
  endOnly?: boolean;
}

const gdpRank = (s: GameState, c: Country) => s.countries.filter((x) => x.alive).sort((a, b) => b.eco.gdp - a.eco.gdp).findIndex((x) => x.id === c.id) + 1;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const lvTitle = (t: string[], lv: number) => t[Math.min(lv, t.length - 1)];

export const AMBITIONS: AmbTemplate[] = [
  { key: 'gdp', cat: 'economy', icon: '📈', titles: ['Economic Miracle', 'The Second Miracle', 'A Golden Age', 'The Unstoppable Economy'], pitch: ['“A decade of growth in four years.”', '“We did it once. We will do it again.”', '“The envy of the world.”'],
    cmp: 'ratio', measure: (_s, c) => c.eco.realGdp, target: (_b, lv) => Math.min(0.24, 0.07 + 0.02 * lv), goal: (t) => `Grow the real economy by ${Math.round(t * 100)}%`, fmt: pct },
  { key: 'wealth', cat: 'society', icon: '🏠', titles: ['Prosperity for All', 'A Richer Nation', 'The Good Life'], pitch: ['“Every family better off.”', '“The next generation will live better than we did.”'],
    cmp: 'ratio', measure: (_s, c) => c.eco.realGdp / Math.max(1, c.eco.pop), target: (_b, lv) => Math.min(0.2, 0.05 + 0.015 * lv), goal: (t) => `Raise living standards by ${Math.round(t * 100)}%`, fmt: pct },
  { key: 'power', cat: 'power', icon: '🦅', titles: ['Climb the Ranks', 'Among the Great', 'A Seat at the Top Table', 'The Summit'], pitch: ['“Our voice will be heard in every capital.”', '“Higher still.”'],
    cmp: 'rank', measure: (s, c) => powerRank(s, c.id), target: (b) => (b > 20 ? 4 : b > 8 ? 2 : 1), goal: (t, b) => `Rise ${t} place${t === 1 ? '' : 's'} in the world power race (from #${Math.round(b)})`, fmt: (v) => `#${Math.round(v)}`,
    ok: (s, c) => powerRank(s, c.id) > 1 },
  { key: 'crown', cat: 'power', icon: '👑', titles: ['Hold the Crown', 'The Unchallenged', 'A Century of Primacy'], pitch: ['“First among nations, and staying there.”'],
    cmp: 'below', endOnly: true, measure: (s, c) => powerRank(s, c.id), target: () => 1.5, goal: () => 'Still be the world’s first power at the end of the term', fmt: (v) => `#${Math.round(v)}`,
    ok: (s, c) => powerRank(s, c.id) === 1 },
  { key: 'econrank', cat: 'economy', icon: '🏆', titles: ['Climb the Rankings', 'A Top Economy', 'The Biggest Market'], pitch: ['“We will be counted among the great economies.”'],
    cmp: 'rank', measure: (s, c) => gdpRank(s, c), target: (b) => (b > 15 ? 3 : b > 5 ? 2 : 1), goal: (t, b) => `Rise ${t} place${t === 1 ? '' : 's'} in the world economy ranking (from #${Math.round(b)})`, fmt: (v) => `#${Math.round(v)}`,
    ok: (s, c) => gdpRank(s, c) > 1 },
  { key: 'tech', cat: 'economy', icon: '🔬', titles: ['Technological Leap', 'The Laboratory of the World', 'Frontier Nation'], pitch: ['“Tomorrow’s industries will be born here.”'],
    cmp: 'gain', measure: (s) => s.stats.techsDone ?? 0, target: (_b, lv) => Math.min(12, 3 + lv), goal: (t) => `Make ${t} research breakthroughs`, fmt: (v) => `${Math.round(v)}` },
  { key: 'army', cat: 'power', icon: '🛡', titles: ['Rearmament', 'A Modern Military', 'An Unmatched Force'], pitch: ['“Strength is the only language they understand.”'],
    cmp: 'ratio', measure: (_s, c) => strength(c), target: (_b, lv) => Math.min(0.6, 0.15 + 0.05 * lv), goal: (t) => `Increase military strength by ${Math.round(t * 100)}%`, fmt: (v) => `${Math.round(v / 1000)}k` },
  { key: 'stab', cat: 'society', icon: '🤝', titles: ['National Harmony', 'A Nation at Peace with Itself', 'Unbreakable'], pitch: ['“One people.”'],
    cmp: 'reach', measure: (_s, c) => c.eco.stability, target: (b, lv) => Math.min(92, b + 6 + lv), goal: (t) => `Reach stability ${Math.round(t)}`, fmt: (v) => v.toFixed(0), ok: (_s, c) => c.eco.stability < 86 },
  { key: 'appr', cat: 'society', icon: '🗳', titles: ['The People’s Choice', 'Beloved', 'The Nation’s Favourite'], pitch: ['“A government the nation is proud of.”'],
    cmp: 'reach', measure: (s, c) => approval(s, c), target: (b, lv) => Math.min(84, Math.max(55, b + 6 + lv)), goal: (t) => `Reach ${Math.round(t)}% approval`, fmt: (v) => `${v.toFixed(0)}%`, ok: (s, c) => approval(s, c) < 80 },
  { key: 'rep', cat: 'diplomacy', icon: '🌐', titles: ['Respected Abroad', 'The World’s Conscience', 'Indispensable'], pitch: ['“A trusted friend to all nations.”'],
    cmp: 'reach', measure: (_s, c) => c.reputation, target: (b, lv) => Math.min(97, b + 5 + lv), goal: (t) => `Reach reputation ${Math.round(t)}`, fmt: (v) => v.toFixed(0), ok: (_s, c) => c.reputation < 92 },
  { key: 'infra', cat: 'economy', icon: '🛤', titles: ['Build the Nation', 'The Great Works', 'A Country Rebuilt'], pitch: ['“Roads, rails and power lines to every town.”'],
    cmp: 'gain', measure: (_s, c) => c.eco.infra, target: (b, lv) => Math.min(100 - b, 3 + lv), goal: (t) => `Raise infrastructure by ${t.toFixed(0)} points`, fmt: (v) => v.toFixed(0), ok: (_s, c) => c.eco.infra < 94 },
  { key: 'debt', cat: 'economy', icon: '⚖', titles: ['Balanced Books', 'Pay Down the Debt', 'Free of Creditors'], pitch: ['“We will not leave our debts to our children.”'],
    cmp: 'drop', measure: (_s, c) => c.eco.debt / Math.max(1, c.eco.gdp), target: (_b, lv) => Math.min(0.12, 0.04 + 0.01 * lv), goal: (t) => `Cut public debt by ${Math.round(t * 100)} points of GDP`, fmt: pct, ok: (_s, c) => c.eco.debt / c.eco.gdp > 0.35 },
  { key: 'chest', cat: 'economy', icon: '💰', titles: ['A War Chest', 'A Sovereign Fund', 'The Nation’s Savings'], pitch: ['“Prepared for any storm.”'],
    cmp: 'reach', measure: (_s, c) => c.eco.cash / Math.max(1, c.eco.gdp), target: (b, lv) => Math.max(b + 0.02, 0.03 + 0.01 * lv), goal: (t) => `Hold reserves worth ${Math.round(t * 100)}% of GDP`, fmt: pct, ok: (_s, c) => c.eco.debt / c.eco.gdp < 0.6 },
  { key: 'jobs', cat: 'society', icon: '🏭', titles: ['A Job for Everyone', 'Full Employment', 'Labour Shortage'], pitch: ['“Every citizen who wants work will find it.”'],
    cmp: 'below', measure: (_s, c) => c.eco.unemployment, target: (b, _lv, _s, c) => Math.max(c.eco.uNat - 0.01, b - 0.015), goal: (t) => `Bring unemployment below ${pct(t)}`, fmt: pct, ok: (_s, c) => c.eco.unemployment > c.eco.uNat + 0.01 },
  { key: 'energy', cat: 'economy', icon: '⚡', titles: ['Energy Independence', 'An Energy Exporter', 'Power for the Continent'], pitch: ['“No foreign power will turn off our lights.”'],
    cmp: 'reach', measure: (_s, c) => c.eco.energyCap / Math.max(1, c.eco.energyDemand), target: (b) => Math.min(1.3, Math.max(1, b + 0.1)), goal: (t) => `Produce ${Math.round(t * 100)}% of the energy you use`, fmt: (v) => `${Math.round(v * 100)}%`, ok: (_s, c) => c.eco.energyCap / c.eco.energyDemand < 1.2 },
  { key: 'exports', cat: 'economy', icon: '🚢', titles: ['Trading Nation', 'Workshop of the World', 'Masters of the Sea Lanes'], pitch: ['“Our goods in every port.”'],
    cmp: 'ratio', measure: (_s, c) => c.eco.exports, target: (_b, lv) => Math.min(0.4, 0.1 + 0.04 * lv), goal: (t) => `Grow exports by ${Math.round(t * 100)}%`, fmt: (v) => fmtMoney(v) },
  { key: 'allies', cat: 'diplomacy', icon: '🛡', titles: ['The Great Alliance', 'A Wider Circle', 'The League of Friends'], pitch: ['“Together, nobody can touch us.”'],
    cmp: 'gain', measure: (s, c) => alliesOf(s, c.id).length, target: (_b, lv) => Math.min(4, 1 + Math.floor(lv / 2)), goal: (t) => `Gain ${t} new all${t === 1 ? 'y' : 'ies'}`, fmt: (v) => `${Math.round(v)}` },
  { key: 'clients', cat: 'diplomacy', icon: '🌐', titles: ['A Sphere of Our Own', 'An Empire of Friends', 'The Patron of Nations'], pitch: ['“Others will look to us first.”'],
    cmp: 'gain', measure: (s, c) => clientsOf(s, c.id).length, target: (_b, lv) => Math.min(4, 1 + Math.floor(lv / 2)), goal: (t) => `Win ${t} more client state${t === 1 ? '' : 's'}`, fmt: (v) => `${Math.round(v)}` },
  { key: 'deals', cat: 'diplomacy', icon: '✍', titles: ['Open for Business', 'The Dealmaker', 'Free Trade Champion'], pitch: ['“Ports open, tariffs down.”'],
    cmp: 'gain', measure: (s, c) => partnersOf(s, c.id, 'trade').length, target: (_b, lv) => Math.min(6, 2 + lv), goal: (t) => `Sign ${t} new trade agreements`, fmt: (v) => `${Math.round(v)}` },
];
export const ambByKey = (k: string) => AMBITIONS.find((a) => a.key === k);

/** How far an ambition has come (0..1), from the value it started at. */
export function ambProgress(a: AmbTemplate, s: GameState, c: Country, base: number, lv: number, fixed?: number): { value: number; text: string } {
  const now = a.measure(s, c), t = fixed ?? a.target(base, lv, s, c);
  switch (a.cmp) {
    case 'ratio': { const g = now / Math.max(1e-9, base) - 1; return { value: clamp(g / t, 0, 1), text: `${g >= 0 ? '+' : ''}${(g * 100).toFixed(1)}% / ${Math.round(t * 100)}%` }; }
    case 'gain': { const g = now - base; return { value: clamp(g / Math.max(1e-9, t), 0, 1), text: `${g >= 0 ? '+' : ''}${a.fmt(g)} / ${a.fmt(t)}` }; }
    case 'reach': return { value: now >= t ? 1 : clamp((now - base) / Math.max(1e-9, t - base), 0, 0.99), text: `${a.fmt(now)} / ${a.fmt(t)}` };
    case 'below': return { value: now <= t ? 1 : clamp((base - now) / Math.max(1e-9, base - t), 0, 0.99), text: `${a.fmt(now)} (goal ${a.fmt(t)})` };
    case 'drop': { const d = base - now; return { value: clamp(d / t, 0, 1), text: `${(d * 100).toFixed(1)} / ${Math.round(t * 100)} points` }; }
    case 'rank': { const d = base - now; return { value: clamp(d / t, 0, 1), text: `${a.fmt(now)} (was ${a.fmt(base)})` }; }
  }
}
/** How many times the player has met this ambition (in objectives `g`, or as Legacy promises `p`). */
export const ambLevel = (s: GameState, k: string, where: 'g' | 'p') => s.stats[`amb${where}:${k}`] ?? 0;
export const ambDone = (s: GameState, k: string, where: 'g' | 'p') => { s.stats[`amb${where}:${k}`] = ambLevel(s, k, where) + 1; s.stats[`amb${where}t:${k}`] = s.tick; };
export const ambTitle = (a: AmbTemplate, lv: number) => lvTitle(a.titles, lv);
export const ambPitch = (a: AmbTemplate, lv: number) => lvTitle(a.pitch, lv);
/** The ambitions that make sense for this country now (not already as good as met). */
export function ambOpen(s: GameState, c: Country, where: 'g' | 'p'): AmbTemplate[] {
  return AMBITIONS.filter((a) => {
    if (a.ok && !a.ok(s, c)) return false;
    const base = a.measure(s, c);
    if (!Number.isFinite(base)) return false;
    if (a.endOnly) return where === 'p';
    return ambProgress(a, s, c, base, ambLevel(s, a.key, where)).value < 0.5;
  });
}
