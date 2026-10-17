/**
 * The world pushes back. Every war of aggression and every conquered region adds to a country's aggression
 * score (it fades over about a year and a half). When it gets high, the aggressor's neighbours and wary powers
 * band together in a coalition: they warm to each other, sign pacts, sanction the aggressor and join the war if
 * it attacks any member. This applies to the player too: conquer too much, too fast, and the world unites.
 *
 * Great powers also take sides in other people's wars: they ship arms to the side they like and sanction the
 * side they do not, renewed every few months while the war lasts.
 */
import { opinionOf } from './minds';
import type { Geo } from './geo';
import { clamp } from './util';
import { nextRand } from './rng';
import { logEvent } from './log';
import { addRelation, alliesOf, areAtWar, getRelation, hasAlliance, sanctionLevel, warSideOf } from './relations';
import { applyTreaty, imposeSanction, neighborsOf } from './diplomacy';
import { strength } from './military';
import { isMajor } from './drama';
import { cable } from './cables';
import type { CountryId, GameState, War } from './types';

export const aggOf = (s: GameState, id: CountryId) => s.stats[`agg:${id}`] ?? 0;
export function addAggression(s: GameState, id: CountryId, v: number) { s.stats[`agg:${id}`] = clamp(aggOf(s, id) + v, 0, 150); }

export const coalitionAgainst = (s: GameState, target: CountryId) => s.coalitions?.find((k) => k.target === target);
export const inCoalitionAgainst = (s: GameState, x: CountryId, target: CountryId) => !!coalitionAgainst(s, target)?.members.includes(x);

const FORM = 35, DISSOLVE = 12;

export function stepCoalitions(s: GameState, geo: Geo) {
  // aggression fades
  if (s.tick % 4 === 0) for (const k of Object.keys(s.stats)) if (k.startsWith('agg:')) { s.stats[k] *= 0.975; if (s.stats[k] < 1) delete s.stats[k]; }
  if (s.tick % 8 !== 3) return;
  s.coalitions ??= [];
  // dissolve coalitions whose target has calmed down (or died)
  for (const k of [...s.coalitions]) {
    const T = s.countries[k.target];
    k.members = k.members.filter((m) => s.countries[m]?.alive && !hasAlliance(s, m, k.target));
    if (!T?.alive || aggOf(s, k.target) < DISSOLVE || k.members.length < 2) {
      s.coalitions = s.coalitions.filter((x) => x !== k);
      if (T?.alive) logEvent(s, `🤝 The coalition against ${T.name} has broken up: the threat has receded.`, 'diplo', [k.target, ...k.members], k.target === s.player || k.members.includes(s.player));
    }
  }
  // form new ones
  for (const T of s.countries) {
    if (!T.alive || aggOf(s, T.id) < FORM || coalitionAgainst(s, T.id)) continue;
    const near = new Set(neighborsOf(s, geo, T.id));
    const tStr = strength(T);
    const members: CountryId[] = [];
    for (const X of s.countries) {
      if (!X.alive || X.id === T.id || X.id === s.player || hasAlliance(s, X.id, T.id)) continue;
      const rel = getRelation(s, X.id, T.id);
      // leaders judge the aggressor's whole record through their own agenda, not only today's relations
      const r = rel + opinionOf(s, X.id, T.id).v * 0.5;
      const worried = (near.has(X.id) && r < 10) || (isMajor(s, X.id) && r < -10) || (r < -35 && strength(X) > tStr * 0.15);
      if (worried && nextRand(s) < 0.75) members.push(X.id);
    }
    if (members.length < 3) continue;
    members.sort((a, b) => strength(s.countries[b]) - strength(s.countries[a]));
    const list = members.slice(0, 10);
    s.coalitions.push({ target: T.id, members: list, since: s.tick });
    // they close ranks
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      addRelation(s, a, b, 10);
      if (!areAtWar(s, a, b) && getRelation(s, a, b) > 25 && !hasAlliance(s, a, b) && nextRand(s) < 0.3) applyTreaty(s, a, b, 'coop', true);
    }
    for (const m of list) { addRelation(s, m, T.id, -10); if (sanctionLevel(s, m, T.id) === 0 && nextRand(s) < 0.5) imposeSanction(s, m, T.id, 1); }
    const lead = s.countries[list[0]];
    const mine = T.id === s.player;
    logEvent(s, `⚠ COALITION: ${list.length} countries led by ${lead.name} unite against ${T.name}'s aggression${mine ? '. Attack any of them and they will all fight you.' : '.'}`, 'danger', [T.id, ...list], true, { big: mine || isMajor(s, T.id), prov: T.capital });
    if (mine) cable(s, lead.id, 'sanctions_you');
  }
  // great powers take sides in wars
  if (s.tick % 16 === 3) for (const w of s.wars) backSides(s, w);
}

function backSides(s: GameState, w: War) {
  const A = w.attackers[0], D = w.defenders[0];
  if (A === undefined || D === undefined) return;
  for (const G of s.countries) {
    if (!G.alive || !isMajor(s, G.id) || warSideOf(w, G.id) >= 0 || G.id === s.player) continue;
    const ra = getRelation(s, G.id, A), rd = getRelation(s, G.id, D);
    const side = rd > 30 && ra < 0 ? D : ra > 30 && rd < 0 ? A : -1;
    if (side < 0 || nextRand(s) > 0.5) continue;
    const other = side === A ? D : A;
    const S = s.countries[side];
    const aid = Math.min(0.0015 * G.eco.gdp, 0.02 * S.eco.gdp);
    S.mil.equipArmy += aid * 0.7; S.mil.equipAir += aid * 0.3;
    addRelation(s, G.id, side, 4); addRelation(s, G.id, other, -6);
    if (side === D && sanctionLevel(s, G.id, other) === 0 && nextRand(s) < 0.4) imposeSanction(s, G.id, other, 1);
    const key = `back:${w.id}:${G.id}`;
    if (!s.stats[key]) {
      s.stats[key] = 1;
      const mine = side === s.player || other === s.player;
      logEvent(s, `📦 ${G.name} is sending weapons to ${S.name} in the ${w.name}.`, 'war', [G.id, side, other], mine || isMajor(s, side) || isMajor(s, other));
      if (side === s.player) cable(s, G.id, 'warm');
      if (other === s.player) cable(s, G.id, 'sanctions_you');
    }
  }
  void alliesOf;
}
