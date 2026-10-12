/**
 * Generals: named commanders who lead offensives and the home defence. Each has a trait and earns stars
 * (1-5) by fighting; victories make them famous, heavy fighting can kill them. Purely fictional names.
 *
 *   attack bonus  = +3% per star, +10% Blitz, +6% Artillery, +15% Encircler against a pocket
 *   defence bonus = +3% per star of the home-defence commander, +10% Fortress
 *   supply bonus  = Logistician: front supply ×1.12;  morale = Inspiring: +5% attack and defence
 */
import type { Country, GameState, General } from './types';
import { hash01, nextRand } from './rng';
import { personName } from './leaders';
import { logEvent } from './log';
import { warsOf } from './relations';
import { fund } from './actions';
import { fmtMoney } from './util';

export interface GTrait { id: string; title: string; icon: string; desc: string }
export const GTRAITS: GTrait[] = [
  { id: 'blitz', title: 'Blitz', icon: '⚡', desc: '+10% attack: fast, aggressive offensives' },
  { id: 'fortress', title: 'Fortress', icon: '🛡', desc: '+10% defence when commanding the home defence' },
  { id: 'logistics', title: 'Logistician', icon: '📦', desc: 'Supply on their front ×1.12' },
  { id: 'encircler', title: 'Encircler', icon: '⭕', desc: '+15% attack against encircled regions' },
  { id: 'artillery', title: 'Gunner', icon: '💥', desc: '+6% attack, heavier enemy losses' },
  { id: 'inspiring', title: 'Inspiring', icon: '🎖', desc: '+5% attack and defence (morale)' },
];
export const gtrait = (id: string) => GTRAITS.find((t) => t.id === id) ?? GTRAITS[0];
export const stars = (g: General) => Math.min(5, 1 + Math.floor(g.xp / 25));
export const starText = (g: General) => '★'.repeat(stars(g));

function newGeneral(s: GameState, c: Country, trait?: string): General {
  const id = (s.stats.genId = (s.stats.genId ?? 0) + 1);
  const tr = trait ?? GTRAITS[Math.floor(hash01('gt', c.id, id) * GTRAITS.length)].id;
  return { id, name: personName(c, 'gen', id), trait: tr, xp: Math.floor(hash01('gx', c.id, id) * 20), wins: 0, status: 'active', since: s.tick, front: -1 };
}
export const activeGenerals = (c: Country) => (c.generals ?? []).filter((g) => g.status === 'active');

/** Make sure a country at war has its commanders. */
export function ensureGenerals(s: GameState, c: Country) {
  const want = c.isPlayer ? 3 : Math.max(1, Math.min(3, 1 + Math.round(c.mil.troops / 150000)));
  c.generals ??= [];
  while (activeGenerals(c).length < want) c.generals.push(newGeneral(s, c));
  if (c.generals.length > 12) c.generals = c.generals.filter((g, i) => g.status === 'active' || i >= c.generals!.length - 8);
}

/** The commander of c's offensive on province p (if any). */
export function generalAt(c: Country, p: number): General | undefined {
  return c.generals?.find((g) => g.status === 'active' && g.front === p);
}
/** The commander of c's home defence: an unassigned general, Fortress first, then the most experienced. */
export function homeCommander(c: Country): General | undefined {
  const free = activeGenerals(c).filter((g) => g.front < 0);
  return free.sort((a, b) => Number(b.trait === 'fortress') - Number(a.trait === 'fortress') || b.xp - a.xp)[0];
}
export function attackBonus(g: General | undefined, pocket: boolean): number {
  if (!g) return 1;
  return 1 + 0.03 * stars(g) + (g.trait === 'blitz' ? 0.1 : 0) + (g.trait === 'artillery' ? 0.06 : 0) + (g.trait === 'inspiring' ? 0.05 : 0) + (g.trait === 'encircler' && pocket ? 0.15 : 0);
}
export function defenceBonus(g: General | undefined): number {
  if (!g) return 1;
  return 1 + 0.03 * stars(g) + (g.trait === 'fortress' ? 0.1 : 0) + (g.trait === 'inspiring' ? 0.05 : 0);
}
export const supplyBonus = (g: General | undefined) => (g?.trait === 'logistics' ? 1.12 : 1);

/** Hand out commands: each offensive gets a general (pinned ones stay put), the rest guard the homeland. */
export function assignGenerals(s: GameState, c: Country) {
  const gens = activeGenerals(c);
  if (!gens.length) return;
  const fronts = warsOf(s, c.id).flatMap((w) => w.fronts.filter((f) => f.by === c.id));
  const live = new Set(fronts.map((f) => f.prov));
  for (const g of gens) if (g.front >= 0 && !live.has(g.front)) { g.front = -1; g.pinned = false; }
  const taken = new Set(gens.filter((g) => g.front >= 0).map((g) => g.front));
  const order = fronts.filter((f) => !taken.has(f.prov)).sort((a, b) => Number(c.mil.focus.includes(b.prov)) - Number(c.mil.focus.includes(a.prov)) || (b.atk ?? 0) - (a.atk ?? 0));
  // keep one general home (the best defender) when there are spare ones
  const pool = gens.filter((g) => g.front < 0).sort((a, b) => Number(a.trait === 'fortress') - Number(b.trait === 'fortress') || b.xp - a.xp);
  const spare = Math.max(0, pool.length - (pool.length > 1 ? 1 : 0));
  for (let i = 0; i < Math.min(spare, order.length); i++) pool[i].front = order[i].prov;
}

/** After a week of fighting on front p: experience, promotions, and the risks of command. */
export function generalAfterBattle(s: GameState, c: Country, p: number, won: boolean, intensity: number, place: string) {
  const g = generalAt(c, p);
  if (!g) return;
  const before = stars(g);
  g.xp += won ? 6 : 0.35 + 0.4 * intensity;
  if (won) g.wins++;
  const mine = c.id === s.player;
  if (stars(g) > before && (mine || stars(g) >= 4)) logEvent(s, `🎖 General ${g.name} of ${c.name} is promoted to ${starText(g)} after the fighting at ${place}.`, 'war', [c.id], mine);
  // heavy fighting is dangerous, even for generals
  if (nextRand(s) < 0.0012 * intensity) {
    g.status = 'fallen'; g.front = -1;
    logEvent(s, `🪦 General ${g.name} (${starText(g)}) of ${c.name} was killed in action at ${place}.`, 'war', [c.id], mine, mine ? { big: true, prov: p } : undefined);
    if (mine) c.mil.warSupport = Math.max(0.02, (c.mil.warSupport ?? 0.6) - 0.03);
    ensureGenerals(s, c);
  }
}

// ---------------------------------------------------------------------------------------------
// Player orders
// ---------------------------------------------------------------------------------------------
export function actRecruitGeneral(s: GameState, cid: number, trait: string) {
  const c = s.countries[cid];
  if (activeGenerals(c).length >= 6) return { ok: false, message: 'Your general staff is full (6). Retire someone first.' };
  const cost = 0.0005 * c.eco.gdp;
  const f = fund(s, cid, cost);
  if (!f.ok) return f;
  c.generals ??= [];
  const g = newGeneral(s, c, trait);
  g.xp = 0;
  c.generals.push(g);
  return { ok: true, message: `General ${g.name} (${gtrait(trait).title}) joins the general staff for ${fmtMoney(cost)}.` };
}
export function actRetireGeneral(s: GameState, cid: number, id: number) {
  const g = s.countries[cid].generals?.find((x) => x.id === id && x.status === 'active');
  if (!g) return { ok: false, message: 'No such general' };
  g.status = 'retired'; g.front = -1;
  return { ok: true, message: `General ${g.name} has been retired.` };
}
/** Put a general in charge of a particular offensive (or bring them home with -1). */
export function actAssignGeneral(s: GameState, cid: number, id: number, prov: number) {
  const c = s.countries[cid];
  const g = c.generals?.find((x) => x.id === id && x.status === 'active');
  if (!g) return { ok: false, message: 'No such general' };
  if (prov >= 0) {
    const other = generalAt(c, prov);
    if (other && other !== g) { other.front = g.front; other.pinned = false; }
  }
  g.front = prov; g.pinned = prov >= 0;
  return { ok: true, message: prov >= 0 ? `General ${g.name} takes command of the offensive.` : `General ${g.name} now commands the home defence.` };
}
