/** Save / load. The whole GameState is plain JSON (geometry is static and never saved). */
import type { GameState } from './types';
import { COUNTRY_BASE } from '../data/countryData';

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
  if (!s || s.countries?.length !== COUNTRY_BASE.length || s.owner?.length !== nProvinces)
    throw new Error('Save file does not match this version of the world map');
  return s;
}
