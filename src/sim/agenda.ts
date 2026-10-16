/**
 * Agenda cards (Legacy mode). At the start of every term you are dealt five national ambitions and commit
 * to up to three. Each is a promise to the country: deliver it within the term and your legacy grows (and
 * so do your chances at the next election); fail and it counts against you. Some cards also open a
 * one-off initiative you can launch during the term.
 */
import type { Country, GameState, AgendaPick } from './types';
import { clamp } from './util';
import { strength } from './military';
import { alliesOf, isAtWar, partnersOf } from './relations';
import { fund } from './actions';
import { levelOf } from './buildings';
import { approval } from './events3';

export type AgendaCat = 'economy' | 'power' | 'diplomacy' | 'society' | 'territory';
export interface AgendaCard {
  id: string; cat: AgendaCat; icon: string; title: string; pitch: string; goal: string;
  points: number;
  /** a value captured when the card is picked (e.g. the GDP at the start of the term) */
  base: (s: GameState, c: Country) => number;
  progress: (s: GameState, c: Country, p: AgendaPick) => { value: number; text: string };
  /** cards judged only at the end of the term (e.g. "no war") complete then */
  atTermEnd?: boolean;
  when?: (s: GameState, c: Country) => boolean;
  /** a one-off initiative unlocked by this card */
  action?: { label: string; desc: string; cost: number; run: (s: GameState, c: Country) => string };
}

const rankBy = (s: GameState, f: (c: Country) => number, c: Country) => s.countries.filter((x) => x.alive).sort((a, b) => f(b) - f(a)).findIndex((x) => x.id === c.id) + 1;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const lostCores = (s: GameState, c: Country) => { let n = 0; for (let p = 0; p < s.core.length; p++) if (s.core[p] === c.id && s.owner[p] !== c.id) n++; return n; };
const forts = (s: GameState, c: Country) => c.provinces.reduce((t, p) => t + levelOf(s, p, 'fort'), 0);

export const AGENDA: AgendaCard[] = [
  // ------------------------------------------------ economy
  { id: 'miracle', cat: 'economy', icon: '📈', title: 'Economic Miracle', pitch: '“A decade of growth in four years.”', goal: 'Grow real GDP by 8% this term', points: 90,
    base: (_s, c) => c.eco.realGdp, progress: (_s, c, p) => { const g = c.eco.realGdp / p.base - 1; return { value: clamp(g / 0.08, 0, 1), text: `${pct(g)} / 8%` }; },
    action: { label: 'Investment summit', desc: 'Capital stock +1% of GDP', cost: 0.004, run: (_s, c) => { c.eco.capital += 0.01 * c.eco.realGdp; return 'Investors pledged billions at the summit.'; } } },
  { id: 'books', cat: 'economy', icon: '⚖', title: 'Balanced Books', pitch: '“We will not leave our debts to our children.”', goal: 'Cut public debt by 6 points of GDP', points: 80,
    when: (_s, c) => c.eco.debt / c.eco.gdp > 0.4,
    base: (_s, c) => c.eco.debt / c.eco.gdp, progress: (_s, c, p) => { const d = p.base - c.eco.debt / c.eco.gdp; return { value: clamp(d / 0.06, 0, 1), text: `${(d * 100).toFixed(1)} / 6 points` }; } },
  { id: 'jobs', cat: 'economy', icon: '🏭', title: 'A Job for Everyone', pitch: '“Every citizen who wants work will find it.”', goal: 'Bring unemployment below 5%', points: 70,
    when: (_s, c) => c.eco.unemployment > 0.045,
    base: (_s, c) => c.eco.unemployment, progress: (_s, c, p) => ({ value: clamp((p.base - c.eco.unemployment) / Math.max(0.005, p.base - 0.05), 0, 1), text: `${pct(c.eco.unemployment)} now` }) },
  { id: 'energy', cat: 'economy', icon: '⚡', title: 'Energy Independence', pitch: '“No foreign power will turn off our lights.”', goal: 'Produce all the energy you use', points: 80,
    when: (_s, c) => c.eco.energyCap < c.eco.energyDemand,
    base: (_s, c) => c.eco.energyCap / c.eco.energyDemand, progress: (_s, c) => { const r = c.eco.energyCap / c.eco.energyDemand; return { value: clamp(r, 0, 1), text: `${(r * 100).toFixed(0)}% self-sufficient` }; },
    action: { label: 'National energy fund', desc: 'Energy production +4%', cost: 0.006, run: (_s, c) => { c.eco.energyCap *= 1.04; return 'New power stations broke ground across the country.'; } } },
  { id: 'prices', cat: 'economy', icon: '🛒', title: 'Stable Prices', pitch: '“Your wages will be worth something again.”', goal: 'Hold inflation under 3% at the end of the term', points: 60, atTermEnd: true,
    base: (_s, c) => c.eco.inflation, progress: (_s, c) => ({ value: c.eco.inflation < 0.03 ? 1 : clamp(1 - (c.eco.inflation - 0.03) / 0.05, 0, 0.95), text: `inflation ${pct(c.eco.inflation)}` }) },
  { id: 'tech', cat: 'economy', icon: '🔬', title: 'Technological Leap', pitch: '“Tomorrow’s industries will be born here.”', goal: 'Raise technology by 6 points', points: 85,
    base: (_s, c) => c.eco.tech, progress: (_s, c, p) => ({ value: clamp((c.eco.tech - p.base) / 6, 0, 1), text: `+${(c.eco.tech - p.base).toFixed(1)} / 6` }),
    action: { label: 'Research moonshot', desc: 'Technology +1.5', cost: 0.006, run: (_s, c) => { c.eco.tech += 1.5; return 'Laboratories hired thousands of scientists.'; } } },
  { id: 'build', cat: 'economy', icon: '🛤', title: 'Build the Nation', pitch: '“Roads, rails and power lines to every town.”', goal: 'Raise infrastructure by 8 points', points: 75,
    base: (_s, c) => c.eco.infra, progress: (_s, c, p) => ({ value: clamp((c.eco.infra - p.base) / 8, 0, 1), text: `+${(c.eco.infra - p.base).toFixed(1)} / 8` }),
    action: { label: 'Great works programme', desc: 'Infrastructure +2', cost: 0.006, run: (_s, c) => { c.eco.infra = Math.min(100, c.eco.infra + 2); return 'Cranes rose over every city.'; } } },
  { id: 'climb', cat: 'economy', icon: '🏆', title: 'Climb the Rankings', pitch: '“We will be counted among the great economies.”', goal: 'Rise 2 places in the world GDP ranking', points: 100,
    when: (s, c) => rankBy(s, (x) => x.eco.gdp, c) > 2,
    base: (s, c) => rankBy(s, (x) => x.eco.gdp, c), progress: (s, c, p) => { const r = rankBy(s, (x) => x.eco.gdp, c); return { value: clamp((p.base - r) / 2, 0, 1), text: `#${r} (was #${p.base})` }; } },
  // ------------------------------------------------ society
  { id: 'harmony', cat: 'society', icon: '🤝', title: 'National Harmony', pitch: '“One people, at peace with itself.”', goal: 'Reach stability 70', points: 70,
    when: (_s, c) => c.eco.stability < 68,
    base: (_s, c) => c.eco.stability, progress: (_s, c) => ({ value: clamp(c.eco.stability / 70, 0, 1), text: `${c.eco.stability.toFixed(0)} / 70` }) },
  { id: 'popular', cat: 'society', icon: '🗳', title: 'The People’s Choice', pitch: '“A government the nation is proud of.”', goal: 'Reach 62% approval', points: 75,
    base: (s, c) => approval(s, c), progress: (s, c) => { const a = approval(s, c); return { value: clamp(a / 62, 0, 1), text: `${a.toFixed(0)}% / 62%` }; } },
  { id: 'welfare', cat: 'society', icon: '🏥', title: 'Welfare State', pitch: '“Nobody left behind: hospitals, schools, pensions.”', goal: 'Spend 3 more points of GDP on public services and keep stability above 55', points: 65,
    base: (_s, c) => c.budget.social, progress: (_s, c, p) => { const d = c.budget.social - p.base; return { value: clamp(d / 0.03, 0, 1) * (c.eco.stability >= 55 ? 1 : 0.8), text: `+${(d * 100).toFixed(1)} / 3 points` }; } },
  // ------------------------------------------------ power
  { id: 'rearm', cat: 'power', icon: '🛡', title: 'Rearmament', pitch: '“Strength is the only language they understand.”', goal: 'Increase military strength by 25%', points: 80,
    base: (_s, c) => strength(c), progress: (_s, c, p) => { const g = strength(c) / p.base - 1; return { value: clamp(g / 0.25, 0, 1), text: `+${(g * 100).toFixed(0)}% / 25%` }; },
    action: { label: 'Emergency arms package', desc: 'Army equipment +0.4% of GDP', cost: 0.004, run: (_s, c) => { c.mil.equipArmy += 0.004 * c.eco.gdp; return 'Factories switched to munitions.'; } } },
  { id: 'fortress', cat: 'power', icon: '🏰', title: 'Fortress Nation', pitch: '“Nobody will ever cross our borders again.”', goal: 'Build fortresses worth 5 levels', points: 60,
    base: (s, c) => forts(s, c), progress: (s, c, p) => { const n = forts(s, c) - p.base; return { value: clamp(n / 5, 0, 1), text: `${n} / 5 levels` }; } },
  { id: 'victory', cat: 'power', icon: '🎖', title: 'Victory in Arms', pitch: '“Our enemies will learn to fear us.”', goal: 'Win a war this term', points: 120,
    when: (s, c) => isAtWar(s, c.id) || c.ai.aggression >= 0 /* always possible */,
    base: (s) => s.warHistory?.length ?? 0, progress: (s, c, p) => { const won = (s.warHistory ?? []).slice(p.base).some((r) => (r.a === c.id && r.winner === 'a') || (r.b === c.id && r.winner === 'b')); return { value: won ? 1 : isAtWar(s, c.id) ? 0.3 : 0, text: won ? 'won' : isAtWar(s, c.id) ? 'war under way' : 'no war yet' }; } },
  { id: 'great', cat: 'power', icon: '🦅', title: 'Great Power', pitch: '“Our voice will be heard in every capital.”', goal: 'Rise 3 places in the military ranking', points: 90,
    when: (s, c) => rankBy(s, strength, c) > 3,
    base: (s, c) => rankBy(s, strength, c), progress: (s, c, p) => { const r = rankBy(s, strength, c); return { value: clamp((p.base - r) / 3, 0, 1), text: `#${r} (was #${p.base})` }; } },
  // ------------------------------------------------ territory
  { id: 'reclaim', cat: 'territory', icon: '🗺', title: 'Reclaim Our Lands', pitch: '“What was taken from us will be returned.”', goal: 'Win back every lost region of your homeland', points: 130,
    when: (s, c) => lostCores(s, c) > 0,
    base: (s, c) => lostCores(s, c), progress: (s, c, p) => { const n = lostCores(s, c); return { value: clamp(1 - n / Math.max(1, p.base), 0, 1), text: `${n} still occupied` }; } },
  { id: 'expand', cat: 'territory', icon: '⚑', title: 'Expand the Borders', pitch: '“A greater nation for a greater people.”', goal: 'Gain 3 regions', points: 110,
    when: (_s, c) => c.ai.expansion >= 0,
    base: (_s, c) => c.provinces.length, progress: (_s, c, p) => { const n = c.provinces.length - p.base; return { value: clamp(n / 3, 0, 1), text: `${Math.max(0, n)} / 3 regions` }; } },
  // ------------------------------------------------ diplomacy
  { id: 'alliance', cat: 'diplomacy', icon: '🛡', title: 'The Great Alliance', pitch: '“Together, nobody can touch us.”', goal: 'Have 3 more allies', points: 75,
    base: (s, c) => alliesOf(s, c.id).length, progress: (s, c, p) => { const n = alliesOf(s, c.id).length - p.base; return { value: clamp(n / 3, 0, 1), text: `${Math.max(0, n)} / 3 new allies` }; } },
  { id: 'trade', cat: 'diplomacy', icon: '🚢', title: 'Trading Nation', pitch: '“Our ships in every port.”', goal: 'Sign 4 new trade agreements', points: 65,
    base: (s, c) => partnersOf(s, c.id, 'trade').length, progress: (s, c, p) => { const n = partnersOf(s, c.id, 'trade').length - p.base; return { value: clamp(n / 4, 0, 1), text: `${Math.max(0, n)} / 4 new` }; } },
  { id: 'peace', cat: 'diplomacy', icon: '🕊', title: 'Peace in Our Time', pitch: '“Not one soldier will die in a war of ours.”', goal: 'Stay out of every war for the whole term', points: 85, atTermEnd: true,
    when: (s, c) => !isAtWar(s, c.id),
    base: () => 0, progress: (s, c, p) => { const broke = (s.stats[`legacyWar:${c.id}`] ?? -1) >= p.start; return { value: broke ? 0 : clamp((s.tick - p.start) / 208, 0, 0.99), text: broke ? 'broken: a war came' : 'at peace' }; } },
  { id: 'respect', cat: 'diplomacy', icon: '🌐', title: 'Respected Abroad', pitch: '“A trusted friend to all nations.”', goal: 'Reach reputation 75', points: 60,
    when: (_s, c) => c.reputation < 73,
    base: (_s, c) => c.reputation, progress: (_s, c) => ({ value: clamp(c.reputation / 75, 0, 1), text: `${c.reputation.toFixed(0)} / 75` }),
    action: { label: 'World tour', desc: 'Reputation +4, relations with 6 partners +5', cost: 0.001, run: (s, c) => { c.reputation = clamp(c.reputation + 4, 0, 100); for (const x of partnersOf(s, c.id, 'trade').slice(0, 6)) { const k = c.id < x ? `${c.id}-${x}` : `${x}-${c.id}`; s.relDelta[k] = clamp((s.relDelta[k] ?? 0) + 5, -80, 80); } return 'Your world tour made headlines everywhere.'; } } },
];
export const agendaById = (id: string) => AGENDA.find((a) => a.id === id)!;

/** Deal a hand of five cards, mixing categories, from those that make sense for the country right now. */
export function dealHand(s: GameState, c: Country, salt: number): string[] {
  // only ambitions that make sense now and are not already fulfilled
  const ok = AGENDA.filter((a) => (!a.when || a.when(s, c)) && a.progress(s, c, { id: a.id, start: s.tick, base: a.base(s, c), done: false }).value < 0.85);
  const rnd = (i: number) => { let x = (s.tick * 7919 + salt * 104729 + i * 15485863 + c.id * 31) | 0; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967295; };
  const shuffled = ok.map((a, i) => ({ a, r: rnd(i) })).sort((x, y) => x.r - y.r).map((x) => x.a);
  const hand: AgendaCard[] = [];
  const cats = new Set<string>();
  for (const a of shuffled) { if (hand.length >= 5) break; if (!cats.has(a.cat) || hand.length >= 4) { hand.push(a); cats.add(a.cat); } }
  for (const a of shuffled) { if (hand.length >= 5) break; if (!hand.includes(a)) hand.push(a); }
  return hand.map((a) => a.id);
}

/** Launch the initiative a card unlocks (once per term). */
export function actAgendaAction(s: GameState, id: string) {
  const L = s.legacy, c = s.countries[s.player];
  const pick = L?.agenda.find((p) => p.id === id);
  const card = agendaById(id);
  if (!L || !pick || !card.action) return { ok: false, message: 'Not on your agenda' };
  const key = `agact:${id}:${L.term}`;
  if (s.stats[key]) return { ok: false, message: 'Already launched this term' };
  const f = fund(s, c.id, card.action.cost * c.eco.gdp, `Agenda: ${card.title}`);
  if (!f.ok) return f;
  s.stats[key] = 1;
  return { ok: true, message: card.action.run(s, c) };
}
