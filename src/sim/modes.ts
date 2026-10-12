/**
 * Game modes and how much the player steers.
 *
 * Every area (economy, military, diplomacy) runs at one of three control levels, changeable at any time:
 *   auto    — your ministers run it (the same logic the AI countries use), aiming at the focus you set
 *   guided  — they propose, you approve (a treasury proposal in your inbox, recruitment handled for you)
 *   hands   — you do everything yourself
 * Sandbox worlds can also start in a different state (depression, cold war, lasting peace) and have
 * random events or nuclear weapons switched off.
 */
import type { Geo } from './geo';
import type { Country, ControlArea, ControlLevel, GameState, Settings } from './types';
import { manageEconomy } from './ai';
import { acceptOffer, declineOffer, evaluateProposal, neighborsOf, propose } from './diplomacy';
import { addRelation, areAtWar, getRelation, hasTrade, NAME_TO_ID, warsOf } from './relations';
import { pushInbox } from './events';
import { clamp } from './util';
import { crisisById } from './crises';
import { logEvent } from './log';

export const ctl = (s: GameState, area: ControlArea): ControlLevel => s.settings.control?.[area] ?? 'hands';
export const mode = (s: GameState) => s.settings.mode ?? 'sandbox';

export const CONTROL_PRESETS: Record<string, { label: string; desc: string; control: Record<ControlArea, ControlLevel> }> = {
  leader: { label: 'Leader', desc: 'Make the big calls; ministers and generals handle the rest', control: { economy: 'auto', military: 'auto', diplomacy: 'auto' } },
  strategist: { label: 'Strategist', desc: 'Advisers propose, you approve; you command your armies', control: { economy: 'guided', military: 'guided', diplomacy: 'guided' } },
  commander: { label: 'Commander', desc: 'Every slider, every order, every treaty is yours', control: { economy: 'hands', military: 'hands', diplomacy: 'hands' } },
};
export function presetOf(c?: Record<ControlArea, ControlLevel>): string {
  for (const [k, v] of Object.entries(CONTROL_PRESETS)) if (c && v.control.economy === c.economy && v.control.military === c.military && v.control.diplomacy === c.diplomacy) return k;
  return 'custom';
}
export function setControl(s: GameState, area: ControlArea, level: ControlLevel) {
  s.settings.control = { ...(s.settings.control ?? { economy: 'hands', military: 'hands', diplomacy: 'hands' }), [area]: level };
  const P = s.countries[s.player];
  if (area === 'military') P.mil.autoAdvance = level !== 'hands' ? true : P.mil.autoAdvance;
  return { ok: true, message: `${area[0].toUpperCase()}${area.slice(1)}: ${level === 'auto' ? 'your ministers take over' : level === 'guided' ? 'advisers will propose, you decide' : 'you are in full control'}.` };
}

// ------------------------------------------------------------------ world starts (sandbox)
const WEST = ['United States of America', 'United Kingdom', 'France', 'Germany', 'Canada', 'Italy', 'Japan', 'Poland', 'Australia', 'South Korea', 'Netherlands', 'Spain'];
const EAST = ['Russia', 'China', 'Iran', 'North Korea', 'Belarus', 'Syria', 'Venezuela', 'Cuba'];

export function applyWorldStart(s: GameState) {
  const st = s.settings;
  if (st.nukes === false) for (const c of s.countries) c.mil.nuclear = false;
  switch (st.world) {
    case 'depression':
      s.crisis = { id: 'recession', start: 0, end: 110 };
      for (const c of s.countries) { c.eco.stability = clamp(c.eco.stability - 8, 5, 100); c.eco.unemployment += 0.025; c.eco.tfp *= 0.985; }
      logEvent(s, `${crisisById('recession').icon} The world wakes up in a deep depression: markets have crashed, factories stand idle.`, 'econ', [], true);
      break;
    case 'coldwar':
      s.crisis = { id: 'coldwar', start: 0, end: 260 };
      for (const a of WEST) for (const b of EAST) { const ia = NAME_TO_ID[a], ib = NAME_TO_ID[b]; if (ia !== undefined && ib !== undefined) addRelation(s, ia, ib, -35); }
      logEvent(s, '🧊 A new cold war divides the world into hostile camps.', 'danger', [], true);
      break;
    case 'peace':
      for (let i = 0; i < s.countries.length; i++) for (let j = i + 1; j < s.countries.length; j++) if (getRelation(s, i, j) < 30) addRelation(s, i, j, 14);
      logEvent(s, '🕊 An era of détente: borders are quiet and old enemies talk.', 'peace', [], true);
      break;
  }
}

// ------------------------------------------------------------------ the autopilot
/** Runs every week for the player's country in the areas they delegated. */
export function stepAutopilot(s: GameState, geo: Geo) {
  const P = s.countries[s.player];
  if (!P.alive) return;
  // in opposition (or exile) a rival government runs the country: everything is on autopilot
  const out = !!s.legacy && s.settings.mode === 'legacy' && s.legacy.status === 'opposition';
  const eco = out ? 'auto' : ctl(s, 'economy'), mil = out ? 'auto' : ctl(s, 'military'), dip = out ? 'auto' : ctl(s, 'diplomacy');
  if ((eco === 'auto' || mil !== 'hands') && s.tick % 4 === (s.player % 4)) {
    const before = { ...P.budget };
    manageEconomy(s, geo, P, eco === 'auto', mil !== 'hands');
    if (eco === 'auto') focusNudge(P, s.settings.econFocus ?? 'growth');
    else { const mb = P.budget.military; Object.assign(P.budget, before); P.budget.military = mb; }
  }
  if (mil !== 'hands') P.mil.autoAdvance = mil === 'auto' ? true : P.mil.autoAdvance;
  if (eco === 'guided' && s.tick % 13 === 6) proposeBudget(s, geo, P);
  if (dip === 'auto') autoDiplomacy(s, geo, P);
}

function focusNudge(c: Country, focus: string) {
  const b = c.budget, e = c.eco;
  if (focus === 'stability' && e.stability < 70 && b.social < e.baseSocial * 1.2) b.social += 0.001;
  if (focus === 'growth') { if (b.infra < 0.05) b.infra += 0.0005; if (b.education < 0.065) b.education += 0.0005; }
  if (focus === 'military' && b.military < 0.06) b.military += 0.001;
}

/** Guided economy: the treasury proposes what the autopilot would do; you approve or reject it in the inbox. */
function proposeBudget(s: GameState, geo: Geo, c: Country) {
  if (s.inbox.some((x) => x.id === 'treasury_plan')) return;
  const before = { ...c.budget };
  const cash = c.eco.cash, debt = c.eco.debt, cap = c.eco.capital;
  manageEconomy(s, geo, c, true, false);
  const after = { ...c.budget };
  // undo: this was only a dry run
  Object.assign(c.budget, before); c.eco.cash = cash; c.eco.debt = debt; c.eco.capital = cap;
  const data: Record<string, number> = {};
  for (const k of Object.keys(after) as (keyof typeof after)[]) if (Math.abs(after[k] - before[k]) > 0.0004) data[k] = after[k];
  if (Object.keys(data).length) pushInbox(s, 'treasury_plan', data, 12);
}

function autoDiplomacy(s: GameState, geo: Geo, c: Country) {
  // answer offers the way a sensible foreign ministry would (never peace treaties: those stay yours)
  for (const o of [...s.offers]) {
    if (o.kind === 'peace') continue;
    if (o.kind === 'alliance' && getRelation(s, c.id, o.from) < 40) { declineOffer(s, o.id); continue; } // alliances drag you into wars: only with real friends
    const rel = getRelation(s, c.id, o.from);
    const ev = evaluateProposal(s, geo, o.from, c.id, o.kind);
    if (rel > 5 && ev.score > ev.needed - 0.2 && !areAtWar(s, c.id, o.from)) acceptOffer(s, geo, o.id, () => undefined); else declineOffer(s, o.id);
  }
  // every half year, open trade with a friendly neighbour
  if (s.tick % 26 === 9 && !warsOf(s, c.id).length) {
    const cand = neighborsOf(s, geo, c.id).filter((x) => !hasTrade(s, c.id, x) && getRelation(s, c.id, x) > 10).sort((a, b) => getRelation(s, c.id, b) - getRelation(s, c.id, a))[0];
    if (cand !== undefined) propose(s, geo, c.id, cand, 'trade');
  }
}

export function settingsSummary(st: Settings) {
  const c = st.control ?? DEFAULT_CONTROL;
  return `${st.mode === 'legacy' ? 'Legacy' : 'Sandbox'} · economy ${c.economy} · military ${c.military} · diplomacy ${c.diplomacy}`;
}
const DEFAULT_CONTROL: Record<ControlArea, ControlLevel> = { economy: 'hands', military: 'hands', diplomacy: 'hands' };
