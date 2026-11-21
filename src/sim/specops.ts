/**
 * Special operations the player (and occasionally the AI) can order in a war:
 *   naval invasion   — land troops on an enemy coast within naval reach, opening a new front behind the lines
 *   airborne assault — drop paratroopers on an enemy region up to two regions behind the front
 *   partisans        — arm the resistance in your occupied homeland: the occupier's supply lines through it
 *                      cost far more, its troops bleed and the land cannot be integrated
 */
import type { Geo } from './geo';
import type { Country, CountryId, GameState, ProvId } from './types';
import { areAtWar, warsOf } from './relations';
import { fund } from './actions';
import { navalPower } from './military';
import { airSuperiority, navalSuperiority } from './war';
import { fmtMoney } from './util';
import { logEvent } from './log';

export type OpKindW = 'naval' | 'airborne';
export interface SpecOp { prov: ProvId; kind: OpKindW; until: number }

export const opsOf = (c: Country): SpecOp[] => (c.mil.ops ??= []);
export const activeOp = (s: GameState, c: Country, p: ProvId) => opsOf(c).find((o) => o.prov === p && o.until > s.tick);

function seaDistance(s: GameState, geo: Geo, c: Country, p: ProvId): number {
  let d = Infinity;
  for (const q of c.provinces) if (geo.provinces[q].coast > 0.15) d = Math.min(d, geo.dist(q, p));
  return d;
}
/** Regions within `hops` steps of land held by c. */
function nearFront(s: GameState, geo: Geo, c: Country, p: ProvId, hops: number): boolean {
  let frontier = [p]; const seen = new Set([p]);
  for (let h = 0; h < hops; h++) {
    const next: number[] = [];
    for (const x of frontier) for (const y of geo.adj[x]) {
      if (s.owner[y] === c.id) return true;
      if (!seen.has(y)) { seen.add(y); next.push(y); }
    }
    frontier = next;
  }
  return false;
}

export function canLaunch(s: GameState, geo: Geo, cid: CountryId, p: ProvId, kind: OpKindW): string | null {
  const c = s.countries[cid], o = s.owner[p];
  if (!areAtWar(s, cid, o)) return 'Only against a country you are at war with';
  if (activeOp(s, c, p)) return 'An operation is already under way there';
  if (opsOf(c).filter((x) => x.until > s.tick).length >= 3) return 'At most three special operations at once';
  if (kind === 'naval') {
    if (geo.provinces[p].coast < 0.15) return 'Needs a coastline to land on';
    const np = navalPower(c.mil);
    if (np < 5e8) return 'Your navy is too small';
    const reach = 25 + 80 * Math.min(1, Math.sqrt(np / 1e12)) + 8 * c.mil.bld.port;
    if (seaDistance(s, geo, c, p) > reach * 1.3) return 'Out of your navy’s reach';
    if (navalSuperiority(c, s.countries[o]) < -0.4) return 'Their navy rules those waters';
    return null;
  }
  if (c.mil.equipAir < 2e8) return 'You need an air force';
  if (airSuperiority(c, s.countries[o]) < -0.15) return 'They control the skies';
  if (!nearFront(s, geo, c, p, 3)) return 'Too far behind the front for paratroopers';
  return null;
}
export const opCost = (c: Country, kind: OpKindW) => (kind === 'naval' ? 0.002 : 0.0015) * c.eco.gdp;

export function actLaunchOp(s: GameState, geo: Geo, cid: CountryId, p: ProvId, kind: OpKindW) {
  const why = canLaunch(s, geo, cid, p, kind);
  if (why) return { ok: false, message: why };
  const c = s.countries[cid];
  const f = fund(s, cid, opCost(c, kind), 'Special operation');
  if (!f.ok) return f;
  const ops = opsOf(c);
  for (let i = ops.length - 1; i >= 0; i--) if (ops[i].until <= s.tick) ops.splice(i, 1);
  ops.push({ prov: p, kind, until: s.tick + (kind === 'naval' ? 26 : 12) });
  if (!c.mil.focus.includes(p)) c.mil.focus.push(p);
  const where = geo.provinces[p].name || s.countries[s.owner[p]].name;
  logEvent(s, kind === 'naval' ? `⚓ ${c.name} launches a naval invasion at ${where}!` : `🪂 ${c.name} drops paratroopers on ${where}!`, 'war', [cid, s.owner[p]], true, { prov: p });
  return { ok: true, message: `${kind === 'naval' ? 'Landing craft are on their way' : 'Paratroopers are in the air'} (${fmtMoney(opCost(c, kind))}).` };
}

// ---------------------------------------------------------------- partisans
const pKey = (cid: CountryId) => `partisans:${cid}`;
export const partisansActive = (s: GameState, core: CountryId) => (s.stats[pKey(core)] ?? -1) > s.tick;
/** your homeland under enemy occupation */
export const occupiedHomeland = (s: GameState, cid: CountryId) => {
  const out: ProvId[] = [];
  for (let p = 0; p < s.core.length; p++) if (s.core[p] === cid && s.owner[p] !== cid && areAtWar(s, cid, s.owner[p])) out.push(p);
  return out;
};
export function actPartisans(s: GameState, cid: CountryId) {
  const c = s.countries[cid];
  if (!warsOf(s, cid).length) return { ok: false, message: 'You are not at war' };
  const occ = occupiedHomeland(s, cid);
  if (!occ.length) return { ok: false, message: 'None of your land is occupied' };
  if (partisansActive(s, cid)) return { ok: false, message: 'The resistance is already armed' };
  const cost = 0.001 * c.eco.gdp;
  const f = fund(s, cid, cost, 'Arming the resistance');
  if (!f.ok) return f;
  s.stats[pKey(cid)] = s.tick + 26;
  logEvent(s, `🔥 Partisans rise up in occupied ${c.name}: rail lines are blown and convoys ambushed.`, 'war', [cid], true, { prov: occ[0] });
  return { ok: true, message: `The resistance in ${occ.length} occupied region${occ.length > 1 ? 's' : ''} is armed for six months (${fmtMoney(cost)}).` };
}
/** Weekly: partisans bleed the occupiers and stop integration. */
export function stepPartisans(s: GameState) {
  for (let p = 0; p < s.core.length; p++) {
    const core = s.core[p], o = s.owner[p];
    if (core === o || !partisansActive(s, core)) continue;
    s.integ[p] = Math.max(0, s.integ[p] - 0.004);
    const O = s.countries[o];
    if (O?.alive) { const loss = Math.min(O.mil.troops * 0.0008, 400); O.mil.troops -= loss; O.mil.casualties += loss; }
  }
}
