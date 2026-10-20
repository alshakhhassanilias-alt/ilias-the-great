/**
 * Changing the political system: possible, but never a click. Every path takes three steps over at least half a
 * year, costs political capital at each step, and carries a real risk: generals who stage a coup against an
 * opening, crowds who fill the squares against emergency rule, voters who reject a referendum. A failed step ends
 * the attempt; a finished one changes the country for good (and the world notices: democracies warm to a new
 * democracy, autocrats to a new autocracy).
 *
 * The systems: democracy (D), flawed democracy (F), authoritarian regime (A), one-party state (C), monarchy (M).
 * What they mean in play: laws pass by vote (D), a loyal parliament (F) or decree (A, C, M); elections in D and F;
 * the military and business count for more in autocracies, voters and liberals in democracies.
 */
import { clamp } from './util';
import { nextRand } from './rng';
import { logEvent } from './log';
import { changeGov, GOV_LABEL } from './alignment';
import { sway, spendPC, factionOf } from './domestic';
import { approval } from './approval';
import { addRec } from './minds';
import type { Country, GameState } from './types';

export type Gov = 'D' | 'F' | 'A' | 'C' | 'M';
interface Risk { p: number; what: string }
export interface RegimeStage { title: string; desc: string; pc: number; wait: number; risk: (s: GameState, c: Country) => Risk | null; apply: (s: GameState, c: Country) => void }
export interface RegimePath { id: string; to: Gov; from: Gov[]; icon: string; title: string; pitch: string; stages: RegimeStage[] }

const mood = (c: Country, f: Parameters<typeof factionOf>[1]) => factionOf(c, f)?.mood ?? 50;
const stab = (c: Country, v: number) => { c.eco.stability = clamp(c.eco.stability + v, 0, 100); };

export const GOV_MEANS: Record<string, string> = {
  D: 'Laws go to a free parliament vote; elections every term; liberals and voters count most; democracies trust you.',
  F: 'Elections, but a loyal parliament passes most of what you ask; the press is half free.',
  A: 'Laws by decree (+30% capital cost, a little legitimacy each time); no real elections; the army and business count most.',
  C: 'The party decides: laws by decree, the state runs the commanding heights; workers and the army count most.',
  M: 'The crown rules: laws by decree, legitimacy from tradition; the army, business and the regions count most.',
};

export const PATHS: RegimePath[] = [
  {
    id: 'democratise', to: 'D', from: ['F', 'M'], icon: '🗳', title: 'Full democracy', pitch: 'Free courts, a free press and elections nobody can rig.',
    stages: [
      { title: 'Free the courts and the press', desc: 'Judges and editors stop taking orders. Liberals cheer; the security services sulk.', pc: 12, wait: 13, risk: () => null, apply: (_s, c) => { sway(c, 'liberals', 12); sway(c, 'military', -4); stab(c, -2); } },
      { title: 'A constitutional convention', desc: 'A new constitution with real checks and balances. The generals may not accept it.', pc: 15, wait: 13,
        risk: (_s, c) => (mood(c, 'military') < 40 ? { p: 0.3, what: 'the generals move against the convention' } : null), apply: (_s, c) => { sway(c, 'liberals', 6); sway(c, 'nationalists', -3); } },
      { title: 'The founding election', desc: 'A free election under the new constitution. An unpopular government may see the people vote the change down.', pc: 10, wait: 0,
        risk: (s, c) => (approval(s, c) < 40 ? { p: 0.45, what: 'voters reject the new constitution in the referendum' } : null), apply: () => undefined },
    ],
  },
  {
    id: 'open', to: 'F', from: ['A', 'C', 'M'], icon: '🔓', title: 'Political opening', pitch: 'Release prisoners, legalise opposition parties, hold multi-party elections. The first step away from one-man rule.',
    stages: [
      { title: 'Release political prisoners', desc: 'Dissidents walk free. The world takes note; hardliners take offence.', pc: 12, wait: 13, risk: () => null, apply: (s, c) => { sway(c, 'liberals', 14); sway(c, 'military', -5); sway(c, 'nationalists', -4); c.reputation = clamp(c.reputation + 4, 0, 100); addRec(s, c.id, 'reform', 0.4); } },
      { title: 'Legalise opposition parties', desc: 'Rival parties may organise and campaign. The old guard in the army may strike first.', pc: 15, wait: 13,
        risk: (_s, c) => (mood(c, 'military') < 45 ? { p: 0.3, what: 'hardline officers attempt a coup to stop the opening' } : null), apply: (_s, c) => { sway(c, 'liberals', 6); stab(c, -3); } },
      { title: 'Multi-party elections', desc: 'The first contested vote in a generation. You can still lose it.', pc: 10, wait: 0,
        risk: (s, c) => (approval(s, c) < 35 ? { p: 0.4, what: 'the vote turns into a protest against the regime and the process is suspended' } : null), apply: () => undefined },
    ],
  },
  {
    id: 'emergency', to: 'A', from: ['D', 'F'], icon: '⚠', title: 'Emergency rule', pitch: 'Declare an emergency, postpone the elections, rule by decree. Fast, effective, and never forgiven by liberals.',
    stages: [
      { title: 'Declare a state of emergency', desc: 'Special powers, curfews, the army on the streets. Liberals and the press are outraged.', pc: 10, wait: 13, risk: () => null, apply: (s, c) => { sway(c, 'liberals', -14); sway(c, 'military', 6); c.reputation = clamp(c.reputation - 4, 0, 100); addRec(s, c.id, 'repress', 0.4); } },
      { title: 'Postpone the elections', desc: 'The vote is "delayed until order is restored". If you are unpopular, the squares fill with protesters.', pc: 12, wait: 13,
        risk: (s, c) => (approval(s, c) < 45 ? { p: 0.4, what: 'mass protests force you to back down and restore the election calendar' } : null), apply: (_s, c) => { sway(c, 'liberals', -8); stab(c, -3); } },
      { title: 'Rule by decree', desc: 'Parliament is suspended; the courts are packed. There is no going back quietly.', pc: 12, wait: 0, risk: () => null, apply: (s, c) => { addRec(s, c.id, 'repress', 0.6); c.reputation = clamp(c.reputation - 6, 0, 100); } },
    ],
  },
  {
    id: 'crown', to: 'M', from: ['D', 'F', 'A'], icon: '👑', title: 'Restore the crown', pitch: 'A royal house as the symbol of the nation, and the source of power.',
    stages: [
      { title: 'A royalist movement', desc: 'Rallies, a royal heir in the media, the old flags back on the streets.', pc: 10, wait: 13, risk: () => null, apply: (_s, c) => { sway(c, 'nationalists', 8); sway(c, 'liberals', -6); } },
      { title: 'A referendum on the monarchy', desc: 'The people are asked. If they are unhappy with you, they say no.', pc: 12, wait: 13,
        risk: (s, c) => (approval(s, c) < 50 && (c.gov === 'D' || c.gov === 'F') ? { p: 0.45, what: 'the referendum on the monarchy is lost' } : null), apply: (_s, c) => { sway(c, 'regions', 4); } },
      { title: 'The coronation', desc: 'A crown, a cathedral, a new oath of loyalty from the army.', pc: 15, wait: 0, risk: () => null, apply: (_s, c) => { stab(c, 5); sway(c, 'military', 5); sway(c, 'liberals', -8); } },
    ],
  },
  {
    id: 'party', to: 'C', from: ['A', 'F'], icon: '☭', title: 'One-party state', pitch: 'The party above all: a vanguard, the state running industry, one list on the ballot.',
    stages: [
      { title: 'Found the vanguard party', desc: 'One party absorbs the others. Workers are promised everything.', pc: 10, wait: 13, risk: () => null, apply: (_s, c) => { sway(c, 'labour', 8); sway(c, 'business', -10); } },
      { title: 'Nationalise the commanding heights', desc: 'Banks, energy and heavy industry pass to the state. Capital flees.', pc: 15, wait: 13,
        risk: (_s, c) => (mood(c, 'business') < 30 ? { p: 0.25, what: 'a run on the banks and a general strike by managers derail the takeover' } : null), apply: (_s, c) => { sway(c, 'business', -15); c.eco.capital *= 0.98; c.budget.industry = clamp(c.budget.industry + 0.01, 0, 0.12); } },
      { title: 'A one-party constitution', desc: 'The leading role of the party is written into the constitution.', pc: 12, wait: 0, risk: () => null, apply: (s, c) => { sway(c, 'liberals', -15); addRec(s, c.id, 'repress', 0.5); } },
    ],
  },
];
export const pathById = (id: string) => PATHS.find((p) => p.id === id);
export const pathsFor = (c: Country) => PATHS.filter((p) => p.from.includes(c.gov as Gov));

/** Take the next step of a path (starting it if needed). */
export function actRegimeStep(s: GameState, id: string): { ok: boolean; message: string } {
  const c = s.countries[s.player], P = c.politics;
  const path = pathById(id);
  if (!P || !path) return { ok: false, message: 'Not possible' };
  if (P.reform && P.reform.path !== id) return { ok: false, message: `Finish or abandon the ${pathById(P.reform.path)?.title.toLowerCase()} first` };
  if (!P.reform && !path.from.includes(c.gov as Gov)) return { ok: false, message: `Not possible from a ${GOV_LABEL[c.gov]}` };
  if (!P.reform && s.tick - (s.stats.reformFail ?? -999) < 52) return { ok: false, message: `After a failed attempt, wait ${52 - (s.tick - s.stats.reformFail!)} more weeks` };
  const R = P.reform ?? { path: id, stage: 0, next: s.tick, since: s.tick };
  if (s.tick < R.next) return { ok: false, message: `The next step is possible in ${R.next - s.tick} weeks` };
  const st = path.stages[R.stage];
  if (!spendPC(c, st.pc)) return { ok: false, message: `Needs ${st.pc} political capital` };
  P.reform = R;
  const risk = st.risk(s, c);
  if (risk && nextRand(s) < risk.p) {
    P.reform = undefined;
    s.stats.reformFail = s.tick;
    stab(c, -8);
    logEvent(s, `💥 ${path.title.toUpperCase()} FAILS: ${risk.what}. The attempt is over; it can be tried again in a year.`, 'danger', [c.id], true, { big: true, prov: c.capital });
    return { ok: false, message: `It failed: ${risk.what}.` };
  }
  st.apply(s, c);
  R.stage++;
  R.next = s.tick + st.wait;
  if (R.stage >= path.stages.length) {
    P.reform = undefined;
    changeGov(s, c, path.to, `${st.title.toLowerCase()} completes the ${path.title.toLowerCase()}`);
    return { ok: true, message: `${c.name} is now a ${GOV_LABEL[path.to]}.` };
  }
  R.note = `${st.title}: done. Next: ${path.stages[R.stage].title.toLowerCase()} (from week ${R.next - s.tick > 0 ? `+${R.next - s.tick}` : 'now'}).`;
  logEvent(s, `🏛 ${path.icon} ${path.title}, step ${R.stage} of ${path.stages.length}: ${st.title.toLowerCase()}.`, 'info', [c.id], true);
  return { ok: true, message: R.note };
}
export function actAbandonReform(s: GameState) {
  const P = s.countries[s.player].politics;
  if (!P?.reform) return { ok: false, message: 'Nothing under way' };
  const t = pathById(P.reform.path)?.title ?? 'the change';
  P.reform = undefined;
  logEvent(s, `🏛 The ${t.toLowerCase()} is abandoned.`, 'info', [s.player], true);
  return { ok: true, message: `${t} abandoned.` };
}
