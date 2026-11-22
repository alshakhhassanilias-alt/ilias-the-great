/** Every player gets a named rival: the nation you are measured against, and who keeps stirring trouble. */
import type { Geo } from './geo';
import { logEvent } from './log';
import { getRelation, alliesOf } from './relations';
import { neighborsOf } from './diplomacy';
import { strengthIndex } from './military';
import type { Country, GameState } from './types';

export function rivalScore(s: GameState, geo: Geo, me: Country, o: Country, nb: Set<number>): number {
  if (!o.alive || o.id === me.id) return -1e9;
  const rel = getRelation(s, me.id, o.id);
  const sizeRatio = Math.log(Math.max(0.05, o.eco.gdp / me.eco.gdp));
  const milRatio = Math.log(Math.max(0.05, strengthIndex(o) / Math.max(1, strengthIndex(me))));
  // similar in weight, nearby, not a friend
  return (nb.has(o.id) ? 2.2 : 0) - Math.abs(sizeRatio) * 0.9 - Math.abs(milRatio) * 0.5 + (-rel / 60) + (me.region === o.region ? 0.6 : 0) + (alliesOf(s, me.id).includes(o.id) ? -3 : 0) + (o.eco.gdp < me.eco.gdp * 0.05 ? -2 : 0);
}

export function pickRival(s: GameState, geo: Geo): number {
  const me = s.countries[s.player];
  const nb = new Set(neighborsOf(s, geo, s.player));
  let best = -1, bs = -1e9;
  for (const o of s.countries) {
    const sc = rivalScore(s, geo, me, o, nb);
    if (sc > bs) { bs = sc; best = o.id; }
  }
  return best;
}

export function stepRival(s: GameState, geo: Geo) {
  const r = s.rival;
  const bad = r < 0 || !s.countries[r]?.alive || alliesOf(s, s.player).includes(r) || getRelation(s, s.player, r) > 55;
  if (!bad && s.tick % 52 !== 7) return;
  if (!bad && s.tick % 52 === 7) { // re-evaluate once a year, but only switch for a clearly better target
    const me = s.countries[s.player], nb = new Set(neighborsOf(s, geo, s.player));
    const cur = rivalScore(s, geo, me, s.countries[r], nb);
    const nw = pickRival(s, geo);
    if (nw < 0 || nw === r || rivalScore(s, geo, me, s.countries[nw], nb) < cur + 1.2) return;
    s.rival = nw;
  } else s.rival = pickRival(s, geo);
  if (s.rival !== r && s.rival >= 0) logEvent(s, `🎯 ${s.countries[s.rival].name} is now your main rival. Keep an eye on them.`, 'diplo', [s.player, s.rival], true);
}
