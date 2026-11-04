/**
 * The national focus: once a year (in the State of the Nation) the leader declares what the year is for. Each focus
 * makes one thing much stronger and costs something real elsewhere, so the choice matters and changes from year to
 * year. Rivals declare one too (rivals.ts). This module only holds the data and the multipliers, so the systems that
 * read it (research, industry, influence, doctrines, factions, approval) can import it without import cycles.
 */
import type { Country, FactionId } from './types';
import type { Eff } from './doctrines';

export type FocusId = 'industry' | 'science' | 'diplomacy' | 'rearm' | 'welfare' | 'reform';
export type FocusKey = 'rp' | 'indCost' | 'indWeeks' | 'inf' | 'law';
export interface Focus {
  id: FocusId; icon: string; name: string; motto: string; color: string;
  pros: string[]; cons: string[];
  mult: Partial<Record<FocusKey, number>>;
  eff: Eff;
  /** faction moods (points on their mood target) */
  mood: Partial<Record<FactionId, number>>;
  /** approval points */
  appr?: number;
}
export const FOCI: Focus[] = [
  { id: 'industry', icon: '🏭', name: 'Industrial drive', motto: 'Build, build, build.', color: '#5eaaff',
    pros: ['Industry expansions 25% cheaper and 20% faster', 'Productivity +0.2% a year', 'Business and the regions pleased (+5)'],
    cons: ['Research 15% slower', 'Liberals grumble about smokestacks (−5)'],
    mult: { indCost: 0.75, indWeeks: 0.8, rp: 0.85 }, eff: { tfp: 0.002 }, mood: { business: 5, regions: 5, liberals: -5 } },
  { id: 'science', icon: '🔬', name: 'Research push', motto: 'Win the future.', color: '#b48cf0',
    pros: ['Research 35% faster', 'Liberals pleased (+5)'],
    cons: ['Industry expansions 15% dearer', 'The army feels neglected (−5)'],
    mult: { rp: 1.35, indCost: 1.15 }, eff: {}, mood: { liberals: 5, military: -5 } },
  { id: 'diplomacy', icon: '🕊', name: 'Diplomatic offensive', motto: 'Friends in every capital.', color: '#34d3b6',
    pros: ['Influence gains +40%', 'Treaties easier to sign (+0.08)', 'Reputation +3 a year'],
    cons: ['Defence −4%', 'Nationalists and the army call you soft (−5)'],
    mult: { inf: 1.4 }, eff: { accept: 0.08, rep: 3, def: 0.96 }, mood: { liberals: 4, nationalists: -5, military: -5 } },
  { id: 'rearm', icon: '🛡', name: 'Rearmament', motto: 'Peace through strength.', color: '#ff6252',
    pros: ['Army running costs −15%', 'Offence +6%, defence +8%, enemies more wary', 'Military and nationalists pleased (+6)'],
    cons: ['Productivity −0.2% a year', 'Reputation −2 a year', 'Liberals alarmed (−6)'],
    mult: {}, eff: { cost: 0.85, off: 1.06, def: 1.08, deter: 0.9, rep: -2, tfp: -0.002 }, mood: { military: 6, nationalists: 6, liberals: -6 } },
  { id: 'welfare', icon: '🤲', name: 'Social peace', motto: 'No one left behind.', color: '#5bd48c',
    pros: ['Stability +4', 'Approval +3', 'Unions and regions pleased (+6)'],
    cons: ['Productivity −0.2% a year', 'Business frets about the bill (−5)'],
    mult: {}, eff: { stab: 4, tfp: -0.002 }, mood: { labour: 6, regions: 6, business: -5 }, appr: 3 },
  { id: 'reform', icon: '✂', name: 'Reform year', motto: 'Hard choices now, growth later.', color: '#f2b84b',
    pros: ['Productivity +0.5% a year', 'Laws cost 25% less political capital', 'Business and liberals pleased (+5)'],
    cons: ['Approval −3', 'Stability −2', 'Unions furious (−8)'],
    mult: { law: 0.75 }, eff: { tfp: 0.005, stab: -2 }, mood: { business: 5, liberals: 5, labour: -8 }, appr: -3 },
];
export const focusById = (id: string | undefined) => (id ? FOCI.find((f) => f.id === id) : undefined);
export const focusMult = (c: Country, k: FocusKey) => focusById(c.focus)?.mult[k] ?? 1;
export const focusMood = (c: Country, f: FactionId) => focusById(c.focus)?.mood[f] ?? 0;
