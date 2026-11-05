/**
 * Crisis arcs: stories that unfold over months in several stages. Each stage is a decision in your inbox; what
 * you choose decides what happens next (and when). Mishandle a bank wobble and it becomes a bank run; ignore
 * troops on your border and they test you with an incident, then an ultimatum. Only one arc runs at a time;
 * a new one can start roughly once a year, triggered by the state of the country (debt, an angry army, a hostile
 * neighbour, restless regions).
 */
import type { Geo } from './geo';
import { nextRand } from './rng';
import { logEvent } from './log';
import { getRelation, isAtWar } from './relations';
import { neighborsOf } from './diplomacy';
import { strength } from './military';
import type { Country, GameState, InboxItem } from './types';

export interface ArcDef { id: string; title: string; icon: string; stages: number; trigger: (s: GameState, c: Country, geo: Geo) => Record<string, number> | null; weight: (s: GameState, c: Country) => number }

const biggestProv = (c: Country, geo: Geo) => [...c.provinces].sort((a, b) => geo.provinces[b].w - geo.provinces[a].w)[0];

export const ARCS: ArcDef[] = [
  {
    id: 'bank', title: 'Banking Crisis', icon: '🏦', stages: 3,
    weight: (_s, c) => 0.3 + 0.6 * Math.min(2, c.eco.debt / c.eco.gdp) + (c.eco.growth < 0 ? 1 : 0),
    trigger: (_s, c, geo) => (c.provinces.length ? { p: biggestProv(c, geo), size: 2 + Math.floor(nextRand(_s) * 4) } : null),
  },
  {
    id: 'standoff', title: 'Border Standoff', icon: '🪖', stages: 3,
    weight: () => 1.4,
    trigger: (s, c, geo) => {
      const nb = neighborsOf(s, geo, c.id).filter((n) => !isAtWar(s, n) && getRelation(s, c.id, n) < -35 && strength(s.countries[n]) > strength(c) * 0.6);
      if (!nb.length) return null;
      const n = nb.sort((a, b) => getRelation(s, c.id, a) - getRelation(s, c.id, b))[0];
      const border = c.provinces.filter((p) => geo.adj[p].some((q) => s.owner[q] === n));
      if (!border.length) return null;
      return { n, p: border[Math.floor(nextRand(s) * border.length)] };
    },
  },
  {
    id: 'coup', title: 'Coup Plot', icon: '🗡', stages: 2,
    weight: (_s, c) => (c.gov === 'D' ? 0.6 : 1.5),
    trigger: (_s, c) => {
      const m = c.politics?.factions.find((f) => f.id === 'military');
      return m && (m.mood < 34 || c.eco.stability < 22) ? { corps: 1 + Math.floor(nextRand(_s) * 9) } : null;
    },
  },
  {
    id: 'separatists', title: 'Separatist Movement', icon: '🏴', stages: 3,
    weight: () => 1,
    trigger: (s, c, geo) => {
      if (c.provinces.length < 11) return null;
      const r = c.politics?.factions.find((f) => f.id === 'regions');
      if (!r || (r.mood > 42 && c.eco.occupation < 0.08)) return null;
      const cap = c.capital;
      const far = c.provinces.filter((p) => p !== cap && geo.dist(p, cap) > 0).sort((a, b) => geo.dist(b, cap) - geo.dist(a, cap));
      const p = (s.integ ? far.find((x) => (s.integ[x] ?? 1) < 0.9) : undefined) ?? far[Math.floor(nextRand(s) * Math.min(4, far.length))];
      return p === undefined ? null : { p };
    },
  },
  {
    id: 'epidemic', title: 'Outbreak', icon: '🦠', stages: 3,
    weight: (s, c) => 0.8 + (c.eco.tech < 50 ? 0.4 : 0) + (s.crisis?.id === 'pandemic' ? 2 : 0),
    trigger: (_s, c, geo) => (c.provinces.length ? { p: biggestProv(c, geo) } : null),
  },
  {
    id: 'blackout', title: 'The Great Blackout', icon: '🔌', stages: 3,
    weight: (_s, c) => 0.5 + (c.eco.energyUnmet > 0.02 ? 2 : 0) + (c.eco.infra < 50 ? 0.6 : 0),
    trigger: (_s, c, geo) => (c.provinces.length ? { p: biggestProv(c, geo) } : null),
  },
  {
    id: 'leaks', title: 'The Leaked Files', icon: '🗂', stages: 3,
    weight: (_s, c) => 0.7 + (c.reputation < 45 ? 0.5 : 0),
    trigger: (s, c) => (c.cabinet?.length ? { m: c.cabinet[Math.floor(nextRand(s) * c.cabinet.length)].id, n: 1 + Math.floor(nextRand(s) * 9) } : null),
  },
];
export const arcById = (id: string) => ARCS.find((a) => a.id === id);

function push(s: GameState, ev: string, data: Record<string, number>, ttl: number, urgent: boolean) {
  const it: InboxItem = { uid: s.nextInbox++, id: ev, tick: s.tick, expires: s.tick + ttl, urgent, data };
  s.inbox.push(it);
  s.lastEventTick = s.tick;
}

/** Schedule the next stage of the running arc. */
export function arcNext(s: GameState, ev: string, weeks: number, data: Record<string, number>, stage: number) {
  const P = s.countries[s.player].politics;
  if (!P?.arc) return;
  P.arc.stage = stage;
  P.arc.next = { ev, at: s.tick + weeks, data };
}
/** Close the running arc. */
export function arcEnd(s: GameState, text: string) {
  const P = s.countries[s.player].politics;
  if (!P?.arc) return;
  const a = arcById(P.arc.id);
  logEvent(s, `${a?.icon ?? '📕'} ${a?.title ?? 'The crisis'} is over: ${text}`, 'info', [s.player], true);
  P.arc = undefined;
  P.lastArc = s.tick;
}

export function stepArcs(s: GameState, geo: Geo) {
  const c = s.countries[s.player];
  const P = c?.politics;
  if (!P || !c.alive || (s.legacy && s.legacy.status !== 'office')) return;
  if (P.arc) {
    const n = P.arc.next;
    if (n && s.tick >= n.at && s.inbox.length < 5) {
      P.arc.next = undefined;
      push(s, n.ev, n.data, n.ev.endsWith('_coup2') || n.ev.includes('standoff') ? 10 : 16, true);
    }
    // a stuck arc (its decision lapsed with no follow-up) closes itself
    if (!P.arc.next && !s.inbox.some((x) => x.id.startsWith('arc_')) && s.tick - P.arc.started > 6) { P.arc = undefined; P.lastArc = s.tick; }
    return;
  }
  if (s.tick < 52 || s.tick - P.lastArc < 130 || s.settings.randomEvents === false) return;
  if ((s.tick + c.id) % 3 !== 0 || nextRand(s) > 0.1) return;
  // the same story does not come back for five years, and never more than twice
  const fresh = (max: number) => ARCS.filter((a) => (s.stats[`arc:${a.id}`] ?? 0) < max && s.tick - (s.stats[`arcAt:${a.id}`] ?? -999) > 260).map((a) => ({ a, d: a.trigger(s, c, geo) })).filter((x) => x.d);
  // a story you have not seen comes first; one you have seen can return only when nothing new fits
  let opts = fresh(1);
  if (!opts.length) opts = fresh(2);
  if (!opts.length) return;
  // a story that has already been told is less likely to repeat
  const w = (x: (typeof opts)[number]) => x.a.weight(s, c) / (1 + 3 * (s.stats[`arc:${x.a.id}`] ?? 0));
  let r = nextRand(s) * opts.reduce((t, x) => t + w(x), 0);
  let pick = opts[0];
  for (const x of opts) { r -= w(x); if (r <= 0) { pick = x; break; } }
  s.stats[`arc:${pick.a.id}`] = (s.stats[`arc:${pick.a.id}`] ?? 0) + 1;
  s.stats[`arcAt:${pick.a.id}`] = s.tick;
  P.arc = { id: pick.a.id, stage: 1, started: s.tick };
  push(s, `arc_${pick.a.id}_1`, pick.d!, 14, true);
}
