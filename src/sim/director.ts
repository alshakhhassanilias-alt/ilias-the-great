/**
 * The director: something worth deciding, every few weeks, never the same game twice. It opens each game with a hook
 * that fits the country (in the first weeks, not after half a year), then starts a new situation (events13.ts) every
 * five to eleven weeks: sooner after a quiet spell, later while the desk is full. Situations are drawn by weight from
 * those that fit the country now, never one already told in this game until every other has been, so the order differs
 * with every seed. When every fitting situation has been told, they come back (about three years later, sooner if
 * nothing else fits), never in the same order.
 */
import type { GameState } from './types';
import type { Geo } from './geo';
import { nextRand } from './rng';
import { SITUATIONS } from './events13';
import { OPP_SITUATIONS } from './events14';

export interface Director { next: number; opened: boolean; told: string[]; last?: string; /** when each situation was last opened (a situation comes back only years later) */ when?: Record<string, number> }

/** how long before a situation can be told again: about three years, less if nothing else fits */
const AGAIN = [156, 104, 52];

function start(s: GameState, geo: Geo, opener: boolean, out: boolean): boolean {
  const c = s.countries[s.player];
  const D = s.dir!;
  const when = (D.when ??= {});
  for (const id of D.told) if (when[id] === undefined) when[id] = 0; // (saves from before: told once, at some point)
  const busy = new Set(s.inbox.map((x) => x.id.split('_')[1]).concat(s.scheduled.filter((x) => x.id.startsWith('sit_')).map((x) => x.id.split('_')[1])));
  const list = out ? OPP_SITUATIONS : SITUATIONS;
  // the place it happens: one of the country's own regions (not always the capital)
  const place = c.provinces.length > 1 ? c.provinces.filter((p) => p !== c.capital)[Math.floor(nextRand(s) * (c.provinces.length - 1))] ?? c.capital : c.capital;
  // the data each fitting situation needs, drawn now (a neighbour, a minister, a rich friend); never-told ones first,
  // then ones told long enough ago, so the director never runs dry however long the game
  let fit: { id: string; w: number; d: Record<string, number> }[] = [];
  for (const gap of AGAIN) {
    fit = [];
    for (const x of list) {
      if ((opener && !x.opener) || busy.has(x.id)) continue;
      const last = when[x.id];
      if (last !== undefined && s.tick - last < gap) continue;
      const d = x.pick(s, c, geo);
      if (d) fit.push({ id: x.id, w: x.weight * (last === undefined ? 3 : 1), d: { p: place, ...d } });
    }
    if (fit.length || opener) break;
  }
  if (!fit.length) return false;
  let r = nextRand(s) * fit.reduce((t, x) => t + x.w, 0);
  let pick = fit[0];
  for (const x of fit) { r -= x.w; if (r <= 0) { pick = x; break; } }
  if (!D.told.includes(pick.id)) D.told.push(pick.id);
  when[pick.id] = s.tick;
  D.last = pick.id;
  s.scheduled.push({ tick: s.tick, id: `sit_${pick.id}_0`, data: pick.d });
  return true;
}

/**
 * Weekly, before the ordinary events: the opening hook, then the next situation when its time comes. Out of power
 * (opposition or exile) the situations are your own fight to come back, a little less often.
 */
export function stepDirector(s: GameState, geo: Geo) {
  const c = s.countries[s.player];
  if (!c?.alive || s.victory || s.settings.randomEvents === false) return;
  const legacy = !!s.legacy && s.settings.mode === 'legacy';
  if (legacy && s.legacy!.status === 'ended') return;
  const out = legacy && s.legacy!.status === 'opposition';
  s.dir ??= { next: 2 + Math.floor(nextRand(s) * 4), opened: false, told: [], when: {} };
  const D = s.dir;
  if (s.tick < D.next) return;
  // a full desk waits; a quiet one does not
  if (s.inbox.length >= 3) { D.next = s.tick + 2; return; }
  const ok = start(s, geo, !D.opened && !out, out);
  if (!D.opened && !out) D.opened = ok || s.tick > 12;
  const quiet = s.tick - (s.lastEventTick ?? 0) > 8;
  D.next = s.tick + (out ? 6 : quiet ? 4 : 5) + Math.floor(nextRand(s) * 7);
}
