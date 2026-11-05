/**
 * The director: something worth deciding, every few weeks, never the same game twice. It opens each game with a hook
 * that fits the country (in the first weeks, not after half a year), then starts a new situation (events13.ts) every
 * five to eleven weeks: sooner after a quiet spell, later while the desk is full. Situations are drawn by weight from
 * those that fit the country now, never one already told in this game until every other has been, so the order differs
 * with every seed.
 */
import type { GameState } from './types';
import type { Geo } from './geo';
import { nextRand } from './rng';
import { SITUATIONS } from './events13';

export interface Director { next: number; opened: boolean; told: string[]; last?: string }

function start(s: GameState, geo: Geo, opener: boolean): boolean {
  const c = s.countries[s.player];
  const D = s.dir!;
  const busy = new Set(s.inbox.map((x) => x.id.split('_')[1]).concat(s.scheduled.filter((x) => x.id.startsWith('sit_')).map((x) => x.id.split('_')[1])));
  let pool = SITUATIONS.filter((x) => (!opener || x.opener) && !D.told.includes(x.id) && !busy.has(x.id));
  if (!pool.length && D.told.length) { D.told = D.told.slice(-3); pool = SITUATIONS.filter((x) => !D.told.includes(x.id) && !busy.has(x.id)); }
  // the data each fitting situation needs, drawn now (a neighbour, a minister, a rich friend)
  const fit: { id: string; w: number; d: Record<string, number> }[] = [];
  // the place it happens: one of the country's own regions (not always the capital)
  const place = c.provinces.length > 1 ? c.provinces.filter((p) => p !== c.capital)[Math.floor(nextRand(s) * (c.provinces.length - 1))] ?? c.capital : c.capital;
  for (const x of pool) { const d = x.pick(s, c, geo); if (d) fit.push({ id: x.id, w: x.weight, d: { p: place, ...d } }); }
  if (!fit.length) return false;
  let r = nextRand(s) * fit.reduce((t, x) => t + x.w, 0);
  let pick = fit[0];
  for (const x of fit) { r -= x.w; if (r <= 0) { pick = x; break; } }
  D.told.push(pick.id);
  D.last = pick.id;
  s.scheduled.push({ tick: s.tick, id: `sit_${pick.id}_0`, data: pick.d });
  return true;
}

/** Weekly, before the ordinary events: the opening hook, then the next situation when its time comes. */
export function stepDirector(s: GameState, geo: Geo) {
  const c = s.countries[s.player];
  if (!c?.alive || s.victory || s.settings.randomEvents === false) return;
  if (s.legacy && s.settings.mode === 'legacy' && s.legacy.status !== 'office') return; // in opposition the government decides
  s.dir ??= { next: 2 + Math.floor(nextRand(s) * 4), opened: false, told: [] };
  const D = s.dir;
  if (s.tick < D.next) return;
  // a full desk waits; a quiet one does not
  if (s.inbox.length >= 3) { D.next = s.tick + 2; return; }
  const ok = start(s, geo, !D.opened);
  if (!D.opened) D.opened = ok || s.tick > 12;
  const quiet = s.tick - (s.lastEventTick ?? 0) > 8;
  D.next = s.tick + (quiet ? 4 : 5) + Math.floor(nextRand(s) * 7);
}
