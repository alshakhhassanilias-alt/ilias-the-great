/**
 * Leaders, long-term goals and long memories: what makes one country behave differently from another.
 * Leaders are fictional (generated names); their traits shift the country's AI personality while they rule.
 */
import type { Geo } from './geo';
import { clamp } from './util';
import { hash01, nextRand } from './rng';
import { logEvent } from './log';
import { claimStrength } from './war';
import { alliesOf, getRelation, isAtWar } from './relations';
import { neighborsOf } from './diplomacy';
import { strength } from './military';
import { isMajor } from './drama';
import type { Country, Grudge, GameState, Leader, NatGoal } from './types';

type Dl = Leader['applied'];
export interface Trait { id: string; title: string; icon: string; desc: string; d: Dl }
export const TRAITS: Trait[] = [
  { id: 'hawk', title: 'Hawk', icon: '🦅', desc: 'Quick to threaten and to fight.', d: { aggression: 0.25, expansion: 0.1, caution: -0.15 } },
  { id: 'dove', title: 'Dove', icon: '🕊', desc: 'Prefers talks to tanks.', d: { aggression: -0.2, caution: 0.15 } },
  { id: 'pragmatist', title: 'Pragmatist', icon: '🧮', desc: 'Does deals with anyone who pays.', d: { trade: 0.1, ideology: -0.15 } },
  { id: 'nationalist', title: 'Nationalist', icon: '🚩', desc: 'Obsessed with lost land and national pride.', d: { expansion: 0.2, ideology: 0.1, trade: -0.1 } },
  { id: 'mercantilist', title: 'Mercantilist', icon: '💱', desc: 'Wants trade deals, not wars.', d: { trade: 0.25, aggression: -0.05 } },
  { id: 'ideologue', title: 'Ideologue', icon: '📜', desc: 'Judges every country by its political system.', d: { ideology: 0.3 } },
  { id: 'paranoid', title: 'Paranoid', icon: '👁', desc: 'Sees plots everywhere and arms accordingly.', d: { caution: 0.2, aggression: 0.1, trade: -0.1 } },
  { id: 'reformer', title: 'Reformer', icon: '🛠', desc: 'Focused on the economy at home.', d: { trade: 0.1, caution: 0.05, aggression: -0.05 } },
  { id: 'strongman', title: 'Strongman', icon: '🥊', desc: 'Rules by force and projects power abroad.', d: { aggression: 0.1, expansion: 0.1 } },
];
export const traitById = (id: string) => TRAITS.find((t) => t.id === id)!;

const FIRST: Record<string, string[]> = {
  NA: ['James', 'Robert', 'Michael', 'David', 'Sarah', 'Linda', 'Daniel', 'Karen', 'Thomas', 'Susan', 'Paul', 'Laura'],
  LA: ['Carlos', 'Miguel', 'Lucia', 'Andrés', 'Sofía', 'Rafael', 'Camila', 'Diego', 'Elena', 'Javier', 'Mateo', 'Paula'],
  EU: ['Jan', 'Pierre', 'Anna', 'Lukas', 'Marta', 'Henrik', 'Sofia', 'Marco', 'Elena', 'Viktor', 'Katarina', 'Stefan'],
  RU: ['Dmitri', 'Sergei', 'Irina', 'Nikolai', 'Olga', 'Andrei', 'Tatiana', 'Boris', 'Vera', 'Pavel', 'Anton', 'Mikhail'],
  ME: ['Omar', 'Khalid', 'Layla', 'Hassan', 'Yusuf', 'Fatima', 'Tariq', 'Samira', 'Ali', 'Nadia', 'Rashid', 'Zaid'],
  AF: ['Kwame', 'Amara', 'Tunde', 'Zuri', 'Samuel', 'Nia', 'Joseph', 'Chidi', 'Fatou', 'Moses', 'Abena', 'Idris'],
  SA: ['Arjun', 'Priya', 'Rahul', 'Anita', 'Imran', 'Sunita', 'Vikram', 'Farah', 'Rohan', 'Meera', 'Sanjay', 'Nisha'],
  EA: ['Wei', 'Hiroshi', 'Min-jun', 'Mei', 'Kenji', 'Ji-woo', 'Lin', 'Takeshi', 'Yuki', 'Hao', 'Soo-ah', 'Jun'],
  SEA: ['Somchai', 'Nguyen', 'Putri', 'Arif', 'Lan', 'Budi', 'Siti', 'Minh', 'Rizal', 'Ananda', 'Kim', 'Sokha'],
  OC: ['Jack', 'Olivia', 'Tane', 'Matthew', 'Aroha', 'Liam', 'Grace', 'Sione', 'Ben', 'Lily', 'Ethan', 'Kiri'],
};
const LAST: Record<string, string[]> = {
  NA: ['Walker', 'Brooks', 'Carter', 'Hughes', 'Foster', 'Reed', 'Morgan', 'Bennett', 'Cole', 'Hayes'],
  LA: ['Vargas', 'Herrera', 'Castillo', 'Mendoza', 'Rojas', 'Silva', 'Ortega', 'Navarro', 'Cruz', 'Salazar'],
  EU: ['Novak', 'Lefèvre', 'Johansson', 'Rossi', 'Kowalski', 'Weber', 'Costa', 'Petrov', 'Hoffmann', 'Larsen'],
  RU: ['Volkov', 'Sokolov', 'Orlov', 'Kuznetsov', 'Morozov', 'Lebedev', 'Pavlov', 'Zaytsev', 'Fedorov', 'Belov'],
  ME: ['al-Rashid', 'Haddad', 'Karimi', 'Nasser', 'Farouk', 'Mansour', 'Qureshi', 'Saleh', 'Aziz', 'Bakr'],
  AF: ['Mensah', 'Okafor', 'Diallo', 'Kamara', 'Nkosi', 'Abara', 'Traoré', 'Banda', 'Osei', 'Mwangi'],
  SA: ['Sharma', 'Khan', 'Reddy', 'Banerjee', 'Gupta', 'Hussain', 'Patel', 'Nair', 'Verma', 'Chaudhry'],
  EA: ['Zhang', 'Tanaka', 'Park', 'Liu', 'Sato', 'Kim', 'Chen', 'Watanabe', 'Choi', 'Huang'],
  SEA: ['Tran', 'Santos', 'Wijaya', 'Chaiyasit', 'Lim', 'Pham', 'Rahman', 'Dela Cruz', 'Phan', 'Sok'],
  OC: ['Smith', 'Walker', 'Parata', 'Taylor', 'Hohepa', 'Wilson', 'Tui', 'Murray', 'Ngata', 'Brown'],
};
const leaderName = (c: Country, gen: number) => {
  const f = FIRST[c.region] ?? FIRST.EU, l = LAST[c.region] ?? LAST.EU;
  return `${f[Math.floor(hash01('lf', c.id, gen) * f.length)]} ${l[Math.floor(hash01('ll', c.id, gen) * l.length)]}`;
};
const traitWeights = (gov: string): number[] => TRAITS.map((t) => {
  const base = 1;
  if (gov === 'D') return base * ({ dove: 1.6, pragmatist: 1.5, reformer: 1.6, mercantilist: 1.3, hawk: 0.6, strongman: 0.2, paranoid: 0.5 } as Record<string, number>)[t.id]! || base;
  if (gov === 'A' || gov === 'C') return base * ({ strongman: 2, paranoid: 1.6, nationalist: 1.4, hawk: 1.3, ideologue: 1.4, dove: 0.4, reformer: 0.5 } as Record<string, number>)[t.id]! || base;
  return base;
});
function pickTraits(c: Country, gen: number): [string, string] {
  const w = traitWeights(c.gov);
  const pick = (skip: string) => {
    const ws = TRAITS.map((t, i) => (t.id === skip ? 0 : w[i]));
    let r = hash01('lt', c.id, gen * 3 + (skip ? 1 : 0)) * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ws.length; i++) { r -= ws[i]; if (r <= 0) return TRAITS[i].id; }
    return TRAITS[0].id;
  };
  const a = pick('');
  return [a, pick(a)];
}
function applyTraits(c: Country, ids: [string, string]): Dl {
  const sum: Dl = {};
  for (const id of ids) for (const [k, v] of Object.entries(traitById(id).d)) (sum as Record<string, number>)[k] = ((sum as Record<string, number>)[k] ?? 0) + (v as number);
  for (const [k, v] of Object.entries(sum)) { const kk = k as keyof Country['ai']; c.ai[kk] = clamp(c.ai[kk] + (v as number), kk === 'aggression' ? 0.02 : 0, kk === 'aggression' ? 1.4 : 1); }
  return sum;
}
function removeTraits(c: Country) {
  const old = c.leader?.applied;
  if (!old) return;
  for (const [k, v] of Object.entries(old)) { const kk = k as keyof Country['ai']; c.ai[kk] = clamp(c.ai[kk] - (v as number), kk === 'aggression' ? 0.02 : 0, kk === 'aggression' ? 1.4 : 1); }
}
export function crownLeader(s: GameState, c: Country, gen: number) {
  removeTraits(c);
  const traits = pickTraits(c, gen);
  c.leader = { name: leaderName(c, gen), traits, since: s.tick, applied: applyTraits(c, traits) };
}
export const traitsText = (l: Leader) => l.traits.map((t) => traitById(t).title).join(' & ');

// ------------------------------------------------------------------ grudges
export function addGrudge(s: GameState, victim: number, offender: number, why: string, w: number) {
  if (victim === offender) return;
  s.grudges ??= {};
  const k = `${victim}>${offender}`;
  const list = (s.grudges[k] ??= []);
  const same = list.find((g) => g.why === why && s.tick - g.tick < 52);
  if (same) { same.w = Math.min(60, same.w + w * 0.5); return; }
  list.push({ tick: s.tick, why, w });
  if (list.length > 8) list.sort((a, b) => b.w - a.w).length = 8;
}
export const grudgesOf = (s: GameState, victim: number, offender: number): Grudge[] => (s.grudges?.[`${victim}>${offender}`] ?? []);
export const grudgeScore = (s: GameState, victim: number, offender: number) => grudgesOf(s, victim, offender).reduce((t, g) => t + g.w, 0);
function decayGrudges(s: GameState) {
  if (!s.grudges) return;
  for (const k of Object.keys(s.grudges)) {
    const list = s.grudges[k];
    for (const g of list) g.w *= 0.9985; // half-life about nine years
    s.grudges[k] = list.filter((g) => g.w > 1.5);
    if (!s.grudges[k].length) delete s.grudges[k];
  }
}

// ------------------------------------------------------------------ goals
function chooseGoal(s: GameState, geo: Geo, c: Country): NatGoal {
  const mk = (kind: string, target: number, text: string): NatGoal => ({ kind, target, text, since: s.tick });
  const e = c.eco;
  if (e.debt / e.gdp > 1.6 || e.stability < 30) return mk('recover', -1, e.stability < 30 ? 'Restore order at home' : 'Get its debt under control');
  if (e.sanctionShare > 0.15) return mk('sanctions', -1, 'Break out of sanctions');
  // lost land: provinces whose historical owner is c but are held by someone else
  const lost = new Map<number, number>();
  for (let p = 0; p < s.owner.length; p++) if (s.core[p] === c.id && s.owner[p] !== c.id && s.countries[s.owner[p]]?.alive) lost.set(s.owner[p], (lost.get(s.owner[p]) ?? 0) + 1);
  if (lost.size && c.ai.expansion > 0.25) { const [who, n] = [...lost.entries()].sort((a, b) => b[1] - a[1])[0]; return mk('revanche', who, `Win back ${n} lost region${n > 1 ? 's' : ''} from ${s.countries[who].name}`); }
  let claim = -1, cv = 0.3;
  for (const o of s.countries) if (o.alive && o.id !== c.id) { const v = claimStrength(c.id, o.id); if (v > cv) { cv = v; claim = o.id; } }
  if (claim >= 0 && c.ai.expansion > 0.2) return mk('claims', claim, `Press its claims on ${s.countries[claim].name}`);
  const nb = neighborsOf(s, geo, c.id);
  const strongest = nb.map((x) => s.countries[x]).sort((a, b) => strength(b) - strength(a))[0];
  if (strongest && strength(strongest) > strength(c) * 1.4 && getRelation(s, c.id, strongest.id) < 20) return mk('security', strongest.id, `Deter ${strongest.name}`);
  const rank = s.countries.filter((x) => x.alive && x.eco.gdp > e.gdp).length + 1;
  if (c.ai.aggression > 0.7 && c.ai.expansion > 0.4) return mk('dominance', -1, 'Become the dominant power in its region');
  if (c.ai.ideology > 0.7 && alliesOf(s, c.id).length >= 2) return mk('bloc', -1, 'Lead its own bloc');
  if (rank > 3) return mk('growth', -1, `Climb from #${rank} to #${Math.max(1, rank - 3)} in the world economy`);
  return mk('growth', -1, 'Stay the world’s leading economy');
}

/** Give every AI country its first leader and aim (done when the game is created, so the first week has no spike). */
export function initLeaders(s: GameState, geo: Geo) {
  for (const c of s.countries) if (c.alive && c.id !== s.player && !c.leader) { crownLeader(s, c, 0); c.goal = chooseGoal(s, geo, c); }
}

// ------------------------------------------------------------------ the weekly step
export function stepLeaders(s: GameState, geo: Geo) {
  if (s.tick % 4 === 3) decayGrudges(s);
  for (const c of s.countries) {
    if (!c.alive || c.id === s.player) continue;
    if (!c.leader) { crownLeader(s, c, 0); c.goal = chooseGoal(s, geo, c); }
    if ((s.tick + c.id) % 26 === 5 && (!c.goal || s.tick - c.goal.since > 52 || (c.goal.target >= 0 && !s.countries[c.goal.target]?.alive))) c.goal = chooseGoal(s, geo, c);
    // succession, once a year per country
    if ((s.tick + c.id * 7) % 52 !== 11) continue;
    const years = (s.tick - c.leader!.since) / 52;
    const free = c.gov === 'D' || c.gov === 'F';
    const turmoil = c.eco.stability < 18;
    const p = turmoil ? 0.55 : free ? (years < 4 ? 0 : Math.min(0.6, 0.12 * (years - 3))) : (years < 8 ? 0.01 : Math.min(0.3, 0.04 * (years - 7)));
    if (nextRand(s) >= p) continue;
    const old = c.leader;
    const gen = Math.round(hash01('gen', c.id, s.tick) * 1e6);
    crownLeader(s, c, gen);
    // a new face is a chance for a fresh start: grudges soften, hostility cools a little
    for (const k of Object.keys(s.grudges ?? {})) if (k.startsWith(`${c.id}>`)) for (const g of s.grudges[k]) g.w *= 0.6;
    c.goal = chooseGoal(s, geo, c);
    const how = turmoil ? 'after a collapse of the government' : free ? 'after an election' : old && years > 15 ? 'after the old ruler’s death' : 'in a palace shake-up';
    logEvent(s, `🆕 ${c.name}: ${c.leader!.name} (${traitsText(c.leader!)}) takes over ${how}.`, 'diplo', [c.id], isMajor(s, c.id) || isAtWar(s, c.id));
  }
}
