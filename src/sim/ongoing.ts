/**
 * The wars already being fought on 1 January 2024 (a 2024 start with "the world as it is"): Russia's invasion of
 * Ukraine and the war in Gaza. They begin as they were, mid-war, with no declaration and no fresh diplomatic fallout
 * (that happened in 2022 and 2023); the fronts form in the first weeks.
 */
import { NAME_TO_ID, addRelation, getRelation } from './relations';
import { onEnterWar } from './warsupport';
import { logEvent } from './log';
import type { GameState, War } from './types';

const ONGOING: { a: string; d: string; name: string; since: number; goal: [1 | 2 | 3, 1 | 2 | 3]; resolve: [number, number]; sponsors?: string[] }[] = [
  { a: 'Russia', d: 'Ukraine', name: 'Russo-Ukrainian War', since: -100, goal: [2, 3], resolve: [0.3, 0.55], sponsors: ['United States of America', 'United Kingdom', 'Germany', 'France', 'Poland', 'Canada', 'Netherlands', 'Sweden', 'Denmark', 'Norway', 'Finland', 'Italy'] },
  { a: 'Israel', d: 'Palestine', name: 'Gaza War', since: -12, goal: [2, 3], resolve: [0.2, 0.35] },
];

export function seedOngoingWars(s: GameState) {
  for (const o of ONGOING) {
    const a = NAME_TO_ID[o.a], d = NAME_TO_ID[o.d];
    if (a === undefined || d === undefined || !s.countries[a]?.alive || !s.countries[d]?.alive) continue;
    if (s.wars.some((w) => (w.attackers.includes(a) && w.defenders.includes(d)) || (w.attackers.includes(d) && w.defenders.includes(a)))) continue;
    const A = s.countries[a], D = s.countries[d];
    const war: War = { id: s.nextWarId++, name: o.name, attackers: [a], defenders: [d], start: o.since, fronts: [], casualties: {}, gained: {}, lost: {}, startProvs: { [a]: A.provinces.length, [d]: D.provinces.length }, resolve: { [a]: o.resolve[0], [d]: o.resolve[1] }, sponsor: o.sponsors ? { to: d, by: o.sponsors.map((n) => NAME_TO_ID[n]).filter((x) => x !== undefined) } : undefined };
    s.wars.push(war);
    onEnterWar(s, A, 'aggressor');
    onEnterWar(s, D, 'defender');
    // both are mobilised, and the defender has spent two years digging in (mobdata.ts)
    if (o.sponsors) { A.mob = 2; D.mob = 2; D.strat = 'depth'; }
    addRelation(s, a, d, -60);
    if (a === s.player || d === s.player) s.stats[`wgoal:${war.id}`] = a === s.player ? o.goal[0] : o.goal[1];
    logEvent(s, `⚔ The ${o.name} goes on: ${A.name} against ${D.name}.`, 'war', [a, d], a === s.player || d === s.player);
  }
}

/**
 * Weekly: the sponsors of a war arm their side (equipment, and the strain of the war eased) for as long as they stay
 * out of it themselves, keep friendly with the side they arm and are hostile to its enemy. The player, if a sponsor,
 * pays a share of it from the treasury.
 */
export function stepOngoing(s: GameState) {
  for (const w of s.wars) {
    const sp = w.sponsor;
    if (!sp) continue;
    const T = s.countries[sp.to];
    if (!T?.alive) continue;
    const enemies = w.attackers.includes(sp.to) ? w.defenders : w.attackers;
    let gdp = 0;
    for (const id of sp.by) {
      const X = s.countries[id];
      if (!X?.alive || w.attackers.includes(id) || w.defenders.includes(id)) continue;
      if (enemies.some((e) => getRelation(s, id, e) > 10) || getRelation(s, id, sp.to) < 0) continue;
      gdp += X.eco.gdp;
      if (id === s.player) X.eco.cash -= 0.0015 * X.eco.gdp / 52;
    }
    if (gdp <= 0) continue;
    const aid = 0.0015 * gdp / 52; // about 0.15% of the sponsors' GDP a year
    T.mil.equipArmy += aid * 0.7; T.mil.equipAir += aid * 0.3;
    T.mil.exhaustion = Math.max(0, T.mil.exhaustion - (0.25 / 52) * Math.min(1, gdp / 2e13));
    if (s.tick % 52 === 26) logEvent(s, `📦 ${T.name}'s partners deliver another year of weapons and ammunition (about $${((aid * 52) / 1e9).toFixed(0)}B).`, 'war', [sp.to], sp.to === s.player || sp.by.includes(s.player));
  }
}
