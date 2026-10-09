/**
 * Province buildings. Built instantly, owned by the province: conquerors capture them (damaged) and
 * lose them if they lose the land. Levels 0-3.
 */
import type { Geo } from './geo';
import { clamp, fmtMoney } from './util';
import { fund } from './actions';
import type { Country, GameState, ProvId } from './types';

export type BType = 'fort' | 'airbase' | 'port' | 'factory' | 'barracks';
export const BTYPES: BType[] = ['fort', 'airbase', 'port', 'factory', 'barracks'];
export const BDEF: Record<BType, { label: string; icon: string; cost: number; desc: string }> = {
  fort: { label: 'Fortress', icon: '🏰', cost: 0.004, desc: '+14% defence per level in this region' },
  airbase: { label: 'Airbase', icon: '✈', cost: 0.005, desc: '+3% air superiority per level (nation-wide)' },
  port: { label: 'Naval port', icon: '⚓', cost: 0.004, desc: 'Longer naval reach (+8 per level) and +1% trade' },
  factory: { label: 'Factory complex', icon: '🏭', cost: 0.006, desc: 'Adds industrial capital (+0.5% of GDP per level)' },
  barracks: { label: 'Barracks', icon: '🪖', cost: 0.003, desc: 'Readiness +2% and +0.5% of the workforce as manpower per level' },
};
export const MAX_LEVEL = 3;
const key = (p: ProvId, t: BType) => `${p}:${t}`;
export const levelOf = (s: GameState, p: ProvId, t: BType) => s.bld[key(p, t)] ?? 0;

export function recount(s: GameState, ids?: number[]) {
  const targets = ids ?? s.countries.map((c) => c.id);
  for (const id of targets) s.countries[id].mil.bld = { fort: 0, airbase: 0, port: 0, factory: 0, barracks: 0 };
  for (const k of Object.keys(s.bld)) {
    const [p, t] = k.split(':');
    const owner = s.owner[Number(p)];
    if (owner === undefined || (ids && !ids.includes(owner))) continue;
    s.countries[owner].mil.bld[t as BType] += s.bld[k];
  }
}

export function canBuild(s: GameState, geo: Geo, c: Country, p: ProvId, t: BType): string | null {
  if (s.owner[p] !== c.id) return 'You do not own that region';
  if (levelOf(s, p, t) >= MAX_LEVEL) return 'Already at maximum level';
  if (t === 'port' && geo.provinces[p].coast < 0.15) return 'Ports need a coastline';
  return null;
}
export const costOfBuilding = (c: Country, level: number, t: BType) => BDEF[t].cost * (level + 1) * c.eco.gdp;

export function build(s: GameState, geo: Geo, cid: number, p: ProvId, t: BType): { ok: boolean; message: string } {
  const c = s.countries[cid];
  const why = canBuild(s, geo, c, p, t);
  if (why) return { ok: false, message: why };
  const lvl = levelOf(s, p, t);
  const cost = costOfBuilding(c, lvl, t);
  const f = fund(s, cid, cost);
  if (!f.ok) return f;
  s.bld[key(p, t)] = lvl + 1;
  if (t === 'factory') c.eco.capital += (0.005 * c.eco.realGdp);
  recount(s, [cid]);
  return { ok: true, message: `${BDEF[t].label} level ${lvl + 1} built in ${geo.provinces[p].name} for ${fmtMoney(cost)}. ${f.message}` };
}

/** Called when a province changes hands: buildings are captured damaged; factories carry their capital with them. */
export function transferBuildings(s: GameState, p: ProvId, from: number, to: number) {
  for (const t of BTYPES) {
    const lvl = levelOf(s, p, t);
    if (!lvl) continue;
    const next = Math.max(0, lvl - 1); // war damage
    s.bld[key(p, t)] = next;
    if (t === 'factory') {
      const A = s.countries[from], B = s.countries[to];
      const amt = Math.min(A.eco.capital * 0.5, 0.005 * A.eco.realGdp * lvl);
      A.eco.capital -= amt; B.eco.capital += amt * 0.7;
    }
  }
  recount(s, [from, to]);
}
export const fortBonus = (s: GameState, p: ProvId) => 1 + 0.14 * levelOf(s, p, 'fort');
void clamp;
