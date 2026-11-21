/**
 * What the game should FEEL like at a given moment. Nothing here changes the simulation: it reads the log and the
 * state and says "this is a blow", "this is a triumph", "this deserves the whole screen", "your pulse should be up".
 * The screen (ui/Thrill.tsx) and the speakers (audio.ts) do the rest.
 */
import type { GameState, LogEntry } from './sim/types';
import { warScore } from './sim/war';
import { isFree, voteShare } from './sim/legacy';
import { warSideOf } from './sim/relations';

/** a physical reaction of the screen: `hit` (you were struck), `boom` (an explosion), `glory` (you won something), `alarm` */
export interface Jolt { kind: 'hit' | 'boom' | 'glory' | 'alarm'; power: number }
/** a moment that takes the whole screen for three seconds */
export interface Cine { kicker: string; title: string; sub?: string; tone: 'red' | 'gold' | 'steel' }
export interface Thrill { jolt?: Jolt; cine?: Cine; strike?: number }

const clean = (t: string) => t.replace(/^[^A-Za-z0-9"“]+/, '').trim();
const after = (t: string, mark: string) => clean(t.slice(t.indexOf(mark) + mark.length).replace(/^[:\s]+/, ''));

/** how a line in the log should land. `me` is the player's id; `near` says the event touches a neighbour, ally or enemy. */
export function thrillOf(e: Pick<LogEntry, 'text' | 'kind' | 'countries' | 'big' | 'prov'>, me: number, near = false): Thrill {
  const t = e.text;
  const mine = e.countries.includes(me);
  const first = e.countries[0] === me;
  // --- the world shakes for everyone
  if (/WORLD CRISIS/.test(t)) return { jolt: { kind: 'alarm', power: 0.8 }, cine: { kicker: 'The world holds its breath', title: 'WORLD CRISIS', sub: after(t, 'WORLD CRISIS'), tone: 'steel' } };
  if (/WORLD BOOM/.test(t)) return { jolt: { kind: 'glory', power: 0.5 }, cine: { kicker: 'Good times', title: 'WORLD BOOM', sub: after(t, 'WORLD BOOM'), tone: 'gold' } };
  if (/nuclear (strike|weapon is used|detonat|attack)|NUCLEAR (STRIKE|WAR)/i.test(t) && !/secretly building|warns|threat/i.test(t)) return { jolt: { kind: 'boom', power: 1.6 }, cine: { kicker: 'The unthinkable', title: 'NUCLEAR FIRE', sub: clean(t), tone: 'red' }, ...(e.prov !== undefined ? { strike: e.prov } : {}) };
  if (!mine && !near) return {};
  // --- war
  if (/CAPITAL FALLS/.test(t)) {
    if (first) return { jolt: { kind: 'glory', power: 1.1 }, cine: { kicker: 'Your flag flies over it', title: 'THE CAPITAL FALLS', sub: after(t, 'CAPITAL FALLS'), tone: 'gold' }, ...(e.prov !== undefined ? { strike: e.prov } : {}) };
    if (mine) return { jolt: { kind: 'hit', power: 1.4 }, cine: { kicker: 'A black day', title: 'YOUR CAPITAL HAS FALLEN', sub: after(t, 'CAPITAL FALLS'), tone: 'red' }, ...(e.prov !== undefined ? { strike: e.prov } : {}) };
    return { jolt: { kind: 'boom', power: 0.6 } };
  }
  if (/wiped off the map/.test(t)) return mine ? { jolt: { kind: first ? 'hit' : 'glory', power: 1.2 }, cine: { kicker: first ? 'The end' : 'Total victory', title: first ? 'ANNEXED' : 'CONQUERED', sub: clean(t), tone: first ? 'red' : 'gold' } } : {};
  if (/INTERVENTION/.test(t)) return { jolt: { kind: 'alarm', power: 1 }, cine: { kicker: mine ? 'The war just changed' : 'A great power moves', title: 'INTERVENTION', sub: after(t, 'INTERVENTION'), tone: 'red' } };
  if (/RED LINE/.test(t)) return mine ? { jolt: { kind: 'alarm', power: 0.9 }, cine: { kicker: 'A warning, in public', title: 'RED LINE', sub: after(t, 'RED LINE'), tone: 'red' } } : {};
  if (/ENCIRCLED/.test(t)) return mine ? { jolt: { kind: first ? 'hit' : 'glory', power: 0.9 } } : {};
  if (/Missile strike|bombing campaign|air raid/i.test(t)) return mine ? { jolt: { kind: first ? 'boom' : 'hit', power: first ? 0.6 : 1 }, ...(e.prov !== undefined ? { strike: e.prov } : {}) } : {};
  if (mine && e.kind === 'war' && /declared war on/.test(t)) return { jolt: { kind: first ? 'boom' : 'hit', power: first ? 0.8 : 1.3 } };
  if (mine && /captured it from/.test(t)) return first ? { jolt: { kind: 'glory', power: 0.45 } } : { jolt: { kind: 'hit', power: 0.7 } };
  if (!mine) return {};
  // --- home
  if (/^🚨 COUP|COUP:/.test(t)) return { jolt: { kind: 'hit', power: 1.3 }, cine: { kicker: 'Tanks in the capital', title: 'COUP', sub: after(t, 'COUP'), tone: 'red' } };
  if (/UPRISING/.test(t)) return { jolt: { kind: first ? 'hit' : 'glory', power: 0.8 } };
  if (/defaulted on its sovereign debt/.test(t)) return { jolt: { kind: 'hit', power: 1 }, cine: { kicker: 'The money has run out', title: 'DEFAULT', sub: clean(t), tone: 'red' } };
  if (/No-confidence vote passes|Early elections/.test(t)) return { jolt: { kind: 'alarm', power: 0.9 }, cine: { kicker: 'The government falls', title: 'SNAP ELECTION', sub: clean(t), tone: 'steel' } };
  if (/HARDLINERS STRIKE BACK/.test(t)) return { jolt: { kind: 'hit', power: 0.9 } };
  if (/GREAT AMBITION|AMBITION ACHIEVED|STAGE COMPLETE/i.test(t)) return { jolt: { kind: 'glory', power: 1 }, cine: { kicker: 'They said it could not be done', title: 'A GREAT AMBITION', sub: clean(t), tone: 'gold' } };
  if (/OPERATION .* SUCCEEDS/.test(t)) return { jolt: { kind: 'glory', power: 1 }, cine: { kicker: 'Victory', title: (t.match(/OPERATION [A-Z' ]+?(?= SUCCEEDS)/)?.[0] ?? 'THE OPERATION'), sub: after(t, 'SUCCEEDS'), tone: 'gold' } };
  if (/OPERATION .* FAILS/.test(t)) return { jolt: { kind: 'hit', power: 1.1 }, cine: { kicker: 'Defeat', title: (t.match(/OPERATION [A-Z' ]+?(?= FAILS)/)?.[0] ?? 'THE OPERATION'), sub: after(t, 'FAILS'), tone: 'red' } };
  if (/OPERATION .* BEGINS/.test(t)) return { jolt: { kind: 'boom', power: 0.8 }, ...(e.prov !== undefined ? { strike: e.prov } : {}) };
  if (/THE CAMPAIGN BEGINS/.test(t)) return { jolt: { kind: 'alarm', power: 0.5 }, cine: { kicker: 'Twelve weeks to decide everything', title: 'THE CAMPAIGN', sub: after(t, 'THE CAMPAIGN BEGINS'), tone: 'steel' } };
  if (/RECORD YEAR/.test(t)) return { jolt: { kind: 'glory', power: 0.9 }, cine: { kicker: 'For the history books', title: 'A RECORD YEAR', sub: after(t, 'RECORD YEAR'), tone: 'gold' } };
  if (/GOOD YEARS IN A ROW/.test(t)) return { jolt: { kind: 'glory', power: 0.6 } };
  if (/PROMISE KEPT|STAR WON|TROPHY/.test(t)) return { jolt: { kind: 'glory', power: 0.5 } };
  if (/PROMISE BROKEN/.test(t)) return { jolt: { kind: 'hit', power: 0.4 } };
  if (/^📈/.test(t)) return { jolt: { kind: 'glory', power: 0.35 } };
  if (e.big && e.kind === 'danger') return { jolt: { kind: 'hit', power: 0.5 } };
  return {};
}

export interface Danger { level: number; why: string }
/**
 * How much trouble the player is in right now, 0..1, and the one-line reason. Above about 0.35 the edge of the screen
 * starts to glow; above 0.6 you hear your own heartbeat.
 */
export function dangerOf(s: GameState): Danger {
  const c = s.countries[s.player];
  if (!c || !c.alive) return { level: 0, why: '' };
  let level = 0, why = '';
  const up = (v: number, w: string) => { if (v > level) { level = v; why = w; } };
  // a war going badly, and above all enemy boots on your own soil
  for (const w of s.wars) {
    if (warSideOf(w, c.id) < 0) continue;
    const sc = warScore(s, w, c.id);
    if (sc < -0.05) up(0.3 + Math.min(0.55, -sc * 1.4), 'The war is going against you');
    const lost = w.lost[c.id] ?? 0;
    if (lost > 0.04) up(0.4 + Math.min(0.5, lost * 2.2), 'The enemy is on your soil');
    if (s.owner[c.capital] !== c.id) up(0.95, 'Your capital is in enemy hands');
  }
  // the street
  const st = c.eco.stability;
  if (st < 34) up(0.3 + (34 - st) / 34 * 0.6, st < 18 ? 'The country is coming apart' : 'The streets are restless');
  // a decision about to lapse
  for (const it of s.inbox) {
    if (!it.urgent) continue;
    const left = it.expires - s.tick;
    if (left <= 3) up(left <= 1 ? 0.7 : 0.5, 'A decision cannot wait');
  }
  // election week with the polls against you
  const L = s.legacy;
  if (L && L.status === 'office' && s.settings.mode === 'legacy') {
    const left = L.nextVote - s.tick;
    if (left >= 0 && left <= 10) {
      const v = voteShare(s);
      if (v < 54) up(0.35 + Math.min(0.4, (54 - v) / 14) + (10 - left) * 0.015, isFree(c.gov) ? 'Election day, and it is close' : 'The party is counting heads');
    }
  }
  return { level: Math.min(1, level), why };
}

/**
 * The count on election night: what the screen shows when `p` (0..1) of the vote is in. It starts wide of the truth
 * and swings, then closes on the real result; the same seed always gives the same night.
 */
export function countAt(final: number, p: number, seed: number): number {
  const q = Math.min(1, Math.max(0, p));
  const a = ((seed % 628) / 100), b = ((seed >>> 4) % 628) / 100;
  const lean = ((seed >>> 9) % 2 ? 1 : -1) * (3 + ((seed >>> 3) % 5)); // the first boxes come from the wrong part of the country
  const swing = Math.pow(1 - q, 1.25) * (lean + 5 * Math.sin(q * 9 + a) + 2.5 * Math.sin(q * 23 + b));
  return Math.min(99, Math.max(1, final + swing));
}
