/**
 * Great Ambitions: what a nation sets out to become over decades, not years. You choose one (from the third year on);
 * it has three stages, each harder than the last, and each stage reached is a moment for the whole country: a monument
 * raised in the name of the leader who did it, a reward, prestige for the house and points for the legacy. Finish all
 * three and you can take up the next. They are what is left to strive for once the everyday goals feel small.
 */
import type { Country, GameState } from './types';
import { clamp } from './util';
import { logEvent } from './log';
import { powerRank } from './power';
import { clientsOf } from './influence';
import { alliesOf } from './relations';
import { gainPC } from './domestic';

export interface GreatStage { goal: string; test: (s: GameState, c: Country, st: GreatState) => { value: number; text: string }; monument: string; reward: string; pay: (s: GameState, c: Country) => void }
export interface GreatDef { id: string; icon: string; title: string; pitch: string; stages: GreatStage[] }
export interface GreatState { id: string; stage: number; since: number; base: Record<string, number>; done: string[]; monuments: { name: string; tick: number; by: string }[] }

const regionPeers = (s: GameState, c: Country) => s.countries.filter((x) => x.alive && x.region === c.region);
const regionRank = (s: GameState, c: Country) => regionPeers(s, c).sort((a, b) => powerRank(s, a.id) - powerRank(s, b.id)).findIndex((x) => x.id === c.id) + 1;
const friendsInRegion = (s: GameState, c: Country) => {
  const peers = regionPeers(s, c).filter((x) => x.id !== c.id);
  const mine = new Set([...clientsOf(s, c.id), ...alliesOf(s, c.id)]);
  return { n: peers.filter((x) => mine.has(x.id)).length, of: peers.length };
};
const held = (s: GameState, key: string, ok: boolean) => { if (!ok) { delete s.stats[key]; return 0; } s.stats[key] ??= s.tick; return s.tick - s.stats[key]; };
const income = (c: Country) => c.eco.realGdp / Math.max(1, c.eco.pop);
const cash = (p: number) => (_s: GameState, c: Country) => { c.eco.cash += p * c.eco.gdp; };

export const GREAT: GreatDef[] = [
  { id: 'superpower', icon: '🦅', title: 'A World Power', pitch: 'Rise until nothing on Earth outranks you, and stay there.', stages: [
    { goal: 'Enter the world’s top ten powers', test: (s, c) => { const r = powerRank(s, c.id); return { value: r <= 10 ? 1 : clamp(10 / r, 0, 0.95), text: `#${r} now` }; }, monument: 'the Hall of Nations', reward: 'Reputation +6 · political capital +20', pay: (s, c) => { c.reputation = clamp(c.reputation + 6, 0, 100); gainPC(s, 20); } },
    { goal: 'Enter the top three', test: (s, c) => { const r = powerRank(s, c.id); return { value: r <= 3 ? 1 : clamp(3 / r, 0, 0.95), text: `#${r} now` }; }, monument: 'the Triumphal Arch', reward: 'Treasury +2% of GDP · stability +5', pay: (s, c) => { cash(0.02)(s, c); c.eco.stability = clamp(c.eco.stability + 5, 0, 100); } },
    { goal: 'Be the world’s first power for two years', test: (s, c) => { const t = held(s, 'gr:first', powerRank(s, c.id) === 1); return { value: clamp(t / 104, 0, 1), text: powerRank(s, c.id) === 1 ? `#1 for ${(t / 52).toFixed(1)} of 2 years` : `#${powerRank(s, c.id)} now` }; }, monument: 'the Century Tower', reward: 'Reputation +10 · political capital +40', pay: (s, c) => { c.reputation = clamp(c.reputation + 10, 0, 100); gainPC(s, 40); } },
  ] },
  { id: 'prosperity', icon: '🏙', title: 'The Prosperous Nation', pitch: 'Make your people rich: not the state, the people.', stages: [
    { goal: 'Raise income per person 25%', test: (_s, c, st) => { const g = income(c) / st.base.inc - 1; return { value: clamp(g / 0.25, 0, 1), text: `+${(g * 100).toFixed(0)}% / 25%` }; }, monument: 'the People’s Boulevard', reward: 'Stability +4 · approval +3', pay: (s, c) => { c.eco.stability = clamp(c.eco.stability + 4, 0, 100); s.stats.apprBoost = (s.stats.apprBoost ?? 0) + 3; } },
    { goal: 'Raise it 60%', test: (_s, c, st) => { const g = income(c) / st.base.inc - 1; return { value: clamp(g / 0.6, 0, 1), text: `+${(g * 100).toFixed(0)}% / 60%` }; }, monument: 'the Golden Bridge', reward: 'Treasury +2% of GDP · infrastructure +4', pay: (s, c) => { cash(0.02)(s, c); c.eco.infra = Math.min(100, c.eco.infra + 4); } },
    { goal: 'Double it', test: (_s, c, st) => { const g = income(c) / st.base.inc - 1; return { value: clamp(g / 1, 0, 1), text: `+${(g * 100).toFixed(0)}% / 100%` }; }, monument: 'the Garden City', reward: 'Stability +8 · approval +5 · reputation +6', pay: (s, c) => { c.eco.stability = clamp(c.eco.stability + 8, 0, 100); s.stats.apprBoost = (s.stats.apprBoost ?? 0) + 5; c.reputation = clamp(c.reputation + 6, 0, 100); } },
  ] },
  { id: 'sphere', icon: '🌐', title: 'A Sphere of Influence', pitch: 'Gather nations around you: they look to your capital first.', stages: [
    { goal: 'Hold 3 client states', test: (s, c) => { const n = clientsOf(s, c.id).length; return { value: clamp(n / 3, 0, 1), text: `${n} / 3` }; }, monument: 'the House of Friendship', reward: 'Reputation +5 · political capital +15', pay: (s, c) => { c.reputation = clamp(c.reputation + 5, 0, 100); gainPC(s, 15); } },
    { goal: 'Hold 7 client states', test: (s, c) => { const n = clientsOf(s, c.id).length; return { value: clamp(n / 7, 0, 1), text: `${n} / 7` }; }, monument: 'the Congress Palace', reward: 'Treasury +1.5% of GDP · reputation +5', pay: (s, c) => { cash(0.015)(s, c); c.reputation = clamp(c.reputation + 5, 0, 100); } },
    { goal: 'Hold 12 client states', test: (s, c) => { const n = clientsOf(s, c.id).length; return { value: clamp(n / 12, 0, 1), text: `${n} / 12` }; }, monument: 'the Assembly of the Sphere', reward: 'Reputation +10 · political capital +40', pay: (s, c) => { c.reputation = clamp(c.reputation + 10, 0, 100); gainPC(s, 40); } },
  ] },
  { id: 'frontier', icon: '🔭', title: 'The Frontier of Science', pitch: 'Be the country where the future is invented.', stages: [
    { goal: 'Make 12 research breakthroughs', test: (s, _c, st) => { const n = (s.countries[s.player].rs?.got ?? 0) - st.base.rs; return { value: clamp(n / 12, 0, 1), text: `${n} / 12` }; }, monument: 'the National Laboratory', reward: 'Technology +2 · political capital +15', pay: (s, c) => { c.eco.tech += 2; gainPC(s, 15); } },
    { goal: 'Make 30', test: (s, _c, st) => { const n = (s.countries[s.player].rs?.got ?? 0) - st.base.rs; return { value: clamp(n / 30, 0, 1), text: `${n} / 30` }; }, monument: 'the Observatory of the Nation', reward: 'Technology +3 · treasury +1% of GDP', pay: (s, c) => { c.eco.tech += 3; cash(0.01)(s, c); } },
    { goal: 'Make 55', test: (s, _c, st) => { const n = (s.countries[s.player].rs?.got ?? 0) - st.base.rs; return { value: clamp(n / 55, 0, 1), text: `${n} / 55` }; }, monument: 'the Spaceport', reward: 'Technology +5 · reputation +8', pay: (_s, c) => { c.eco.tech += 5; c.reputation = clamp(c.reputation + 8, 0, 100); } },
  ] },
  { id: 'region', icon: '🗺', title: 'Master of the Region', pitch: 'Your neighbourhood, your rules.', stages: [
    { goal: 'Be the strongest power in your region', test: (s, c) => { const r = regionRank(s, c); return { value: r === 1 ? 1 : clamp(1 / r, 0, 0.9), text: `#${r} in the region` }; }, monument: 'the Regional Forum', reward: 'Reputation +4 · political capital +15', pay: (s, c) => { c.reputation = clamp(c.reputation + 4, 0, 100); gainPC(s, 15); } },
    { goal: 'Have a third of the region as allies or clients', test: (s, c) => { const f = friendsInRegion(s, c); const t = Math.max(1, Math.ceil(f.of / 3)); return { value: clamp(f.n / t, 0, 1), text: `${f.n} / ${t}` }; }, monument: 'the Gate of the Region', reward: 'Stability +4 · treasury +1% of GDP', pay: (s, c) => { c.eco.stability = clamp(c.eco.stability + 4, 0, 100); cash(0.01)(s, c); } },
    { goal: 'Have two thirds of the region', test: (s, c) => { const f = friendsInRegion(s, c); const t = Math.max(1, Math.ceil((f.of * 2) / 3)); return { value: clamp(f.n / t, 0, 1), text: `${f.n} / ${t}` }; }, monument: 'the Seat of the Union', reward: 'Reputation +10 · political capital +40', pay: (s, c) => { c.reputation = clamp(c.reputation + 10, 0, 100); gainPC(s, 40); } },
  ] },
  { id: 'harmony', icon: '🕊', title: 'A Nation at Peace', pitch: 'Calm at home, no wars abroad: the rarest achievement of all.', stages: [
    { goal: 'Hold stability above 65 for two years', test: (s, c) => { const t = held(s, 'gr:calm1', c.eco.stability > 65); return { value: clamp(t / 104, 0, 1), text: `${(t / 52).toFixed(1)} of 2 years` }; }, monument: 'the Peace Garden', reward: 'Approval +3 · reputation +4', pay: (s, c) => { s.stats.apprBoost = (s.stats.apprBoost ?? 0) + 3; c.reputation = clamp(c.reputation + 4, 0, 100); } },
    { goal: 'Hold stability above 72 and no war for five years', test: (s, c) => { const t = held(s, 'gr:calm2', c.eco.stability > 72 && !s.wars.some((w) => w.attackers.includes(c.id) || w.defenders.includes(c.id))); return { value: clamp(t / 260, 0, 1), text: `${(t / 52).toFixed(1)} of 5 years` }; }, monument: 'the Monument to Peace', reward: 'Stability +5 · reputation +6', pay: (_s, c) => { c.eco.stability = clamp(c.eco.stability + 5, 0, 100); c.reputation = clamp(c.reputation + 6, 0, 100); } },
    { goal: 'Ten years of it', test: (s, c) => { const t = held(s, 'gr:calm3', c.eco.stability > 72 && !s.wars.some((w) => w.attackers.includes(c.id) || w.defenders.includes(c.id))); return { value: clamp(t / 520, 0, 1), text: `${(t / 52).toFixed(1)} of 10 years` }; }, monument: 'the Eternal Flame of Peace', reward: 'Reputation +12 · political capital +40', pay: (s, c) => { c.reputation = clamp(c.reputation + 12, 0, 100); gainPC(s, 40); } },
  ] },
];
export const greatById = (id: string) => GREAT.find((g) => g.id === id);
/** open once the first years are behind you, or after a great ambition is complete */
export const greatOpen = (s: GameState) => s.tick >= 104 && (!s.great || s.great.stage >= 3);

export function actChooseGreat(s: GameState, id: string) {
  const g = greatById(id);
  const c = s.countries[s.player];
  if (!g) return { ok: false, message: 'Unknown ambition' };
  if (!greatOpen(s)) return { ok: false, message: s.tick < 104 ? 'From your third year' : 'Finish the ambition you have first' };
  if (s.great?.done.includes(id)) return { ok: false, message: 'Already achieved' };
  const prev = s.great;
  s.great = { id, stage: 0, since: s.tick, base: { inc: income(c), rs: c.rs?.got ?? 0 }, done: prev?.done ?? [], monuments: prev?.monuments ?? [] };
  for (const k of ['gr:first', 'gr:calm1', 'gr:calm2', 'gr:calm3']) delete s.stats[k];
  logEvent(s, `🌟 A GREAT AMBITION: ${c.name} sets out to become ${g.title.toLowerCase().replace(/^a |^the /, (m) => m)}. "${g.pitch}"`, 'info', [s.player], true, { big: true, prov: c.capital });
  return { ok: true, message: `${g.title}: three stages, each a moment for the nation.` };
}

/** Monthly: has the nation reached the next stage? */
export function stepGreat(s: GameState) {
  const st = s.great, c = s.countries[s.player];
  if (!st || st.stage >= 3 || !c?.alive || s.tick % 4 !== 2) return;
  const g = greatById(st.id);
  if (!g) return;
  const stage = g.stages[st.stage];
  if (stage.test(s, c, st).value < 1) return;
  const by = s.legacy && s.settings.mode === 'legacy' ? s.legacy.leader : c.leader?.name ?? c.name;
  const name = `${stage.monument.replace(/^the /, 'The ')}`;
  stage.pay(s, c);
  st.monuments.push({ name: `${name}, raised by ${by}`, tick: s.tick, by });
  st.stage++;
  const L = s.legacy && s.settings.mode === 'legacy' ? s.legacy : null;
  if (L) { L.parts.great = (L.parts.great ?? 0) + 60 + 40 * st.stage; L.chronicle.push({ tick: s.tick, text: `🌟 ${g.title}, stage ${st.stage}: ${name} is raised.` }); }
  if (s.dynasty) s.dynasty.prestige += 8 * st.stage;
  if (st.stage >= 3) st.done.push(st.id);
  s.stats.greatMoment = s.tick; // the interface plays the moment
  logEvent(s, `🌟 ${st.stage >= 3 ? 'A GREAT AMBITION FULFILLED' : `GREAT AMBITION · STAGE ${st.stage} OF 3`}: ${g.title}. ${stage.goal}: done. ${name} is raised in the capital. ${stage.reward}.`, 'info', [s.player], true, { big: true, prov: c.capital });
}
