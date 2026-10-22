/** Save / load. The whole GameState is plain JSON (geometry is static and never saved). */
import { setStartYear, type GameState } from './types';
import { setPriceLevel } from './util';
import { COUNTRY_BASE } from '../data/countryData';
import OLD_MAP from '../data/generated/oldmap.json';

export const SAVE_VERSION = 1;
export interface SaveFile { format: 'world-order-save'; version: number; savedAt: string; player: string; tick: number; state: GameState }

export function serialize(state: GameState): string {
  const f: SaveFile = {
    format: 'world-order-save', version: SAVE_VERSION, savedAt: new Date().toISOString(),
    player: state.countries[state.player].name, tick: state.tick, state,
  };
  return JSON.stringify(f);
}

export function deserialize(text: string, nProvinces: number): GameState {
  const f = JSON.parse(text) as SaveFile;
  if (f.format !== 'world-order-save') throw new Error('Not a World Order save file');
  if (f.version !== SAVE_VERSION) throw new Error(`Unsupported save version ${f.version}`);
  const s = f.state;
  // a save from before the detailed map (1,224 regions): every region is re-laid onto the new ones on the same ground
  if (s && s.owner?.length === OLD_MAP.n && nProvinces === OLD_MAP.newToOld.length) remapProvinces(s);
  if (!s || (s.countries?.length ?? 0) < COUNTRY_BASE.length || s.owner?.length !== nProvinces)
    throw new Error('Save file does not match this version of the world map');
  migrate(s);
  return s;
}

/**
 * Saves from older versions load into the newer game: the world and your progress are kept, and the new systems
 * fill themselves in as the game runs (leaders' agendas, moods, plans, storylines, records). Only what is chosen
 * once at the start of a game needs a default here.
 */
function migrate(s: GameState) {
  setStartYear(s.settings.startYear ?? 2024);
  setPriceLevel(s.stats?.wpi && s.stats.wpi0 ? s.stats.wpi / s.stats.wpi0 : 1);
  if (s.legacy && !s.legacy.traits) s.legacy.traits = ['pragmatist', 'reformer'];
  // saves from before the fiscal rule existed get it switched on, like a new game (it can be turned off in the Economy tab)
  if (s.stats && s.stats.fiscalRule === undefined) s.stats.fiscalRule = 1;
}

/**
 * Lay a save from the old map (1,224 regions) onto the detailed one: each new region takes the owner, nation and
 * integration of the old region it lies in; buildings, resistance and capitals follow the ground; fronts and army
 * orders are cleared (they re-form within a week); counts of regions are rescaled.
 */
function remapProvinces(s: GameState) {
  const { newToOld, oldToNew, cap: caps } = OLD_MAP as { n: number; newToOld: number[]; oldToNew: number[]; cap: number[] };
  const oldCount = new Map<number, number>();
  for (const c of s.countries) oldCount.set(c.id, c.provinces.length);
  const pick = <T,>(arr: T[]) => newToOld.map((o) => arr[o]);
  s.owner = pick(s.owner); s.core = pick(s.core); s.integ = pick(s.integ);
  for (const c of s.countries) c.provinces = [];
  s.owner.forEach((o, p) => { if (o >= 0 && s.countries[o]) s.countries[o].provinces.push(p); });
  const ratio = (id: number) => { const o = oldCount.get(id) ?? 0; const n = s.countries[id]?.provinces.length ?? 0; return o > 0 ? n / o : 2.3; };
  for (const c of s.countries) {
    // the real capital city if the country still holds it, else the region its old capital lay in
    const home = c.id < caps.length && caps[c.id] >= 0 && s.owner[caps[c.id]] === c.id && oldToNew[c.capital] !== undefined && newToOld[caps[c.id]] === c.capital ? caps[c.id] : -1;
    const cap = oldToNew[c.capital];
    c.capital = home >= 0 ? home : cap !== undefined && s.owner[cap] === c.id ? cap : c.provinces[0] ?? cap ?? 0;
    c.mil.focus = [];
    for (const g of c.generals ?? []) g.front = -1;
    c.baseline.provinces = Math.round(c.baseline.provinces * ratio(c.id));
    if (c.politics?.base) c.politics.base.provinces = Math.round(c.politics.base.provinces * ratio(c.id));
  }
  const remapKeys = <T,>(rec: Record<string, T> | undefined, key: (k: string) => string | null): Record<string, T> | undefined => {
    if (!rec) return rec;
    const out: Record<string, T> = {};
    for (const [k, v] of Object.entries(rec)) { const nk = key(k); if (nk !== null) out[nk] = v; }
    return out;
  };
  s.bld = remapKeys(s.bld, (k) => { const [p, t] = k.split(':'); const np = oldToNew[Number(p)]; return np === undefined ? null : `${np}:${t}`; }) ?? {};
  const byNew = (rec?: Record<number, number>) => { if (!rec) return rec; const out: Record<number, number> = {}; newToOld.forEach((o, p) => { if (rec[o] !== undefined) out[p] = rec[o]; }); return out; };
  s.resist = byNew(s.resist); s.resent = byNew(s.resent);
  for (const k of Object.keys(s.stats)) if (/^(held|flips):\d+$/.test(k)) delete s.stats[k];
  for (const w of s.wars) { w.fronts = []; for (const id of Object.keys(w.startProvs)) w.startProvs[+id] = Math.round(w.startProvs[+id] * ratio(+id)); }
  for (const a of s.armies ?? []) a.target = -1;
  for (const it of s.inbox) for (const k of ['p', 'p0', 'prov'] as const) if (typeof it.data[k] === 'number' && oldToNew[it.data[k]] !== undefined) it.data[k] = oldToNew[it.data[k]];
  for (const e of s.log) if (e.prov !== undefined) e.prov = oldToNew[e.prov];
  if (s.legacy?.start) s.legacy.start.provinces = Math.round(s.legacy.start.provinces * ratio(s.player));
}
