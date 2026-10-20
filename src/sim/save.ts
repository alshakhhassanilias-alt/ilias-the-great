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
  migrate(s);
  return s;
}

/**
 * Saves from older versions load into the newer game: the world and your progress are kept, and the new systems
 * fill themselves in as the game runs (leaders' agendas, moods, plans, storylines, records). Only what is chosen
 * once at the start of a game needs a default here.
 */
function migrate(s: GameState) {
  if (s.legacy && !s.legacy.traits) s.legacy.traits = ['pragmatist', 'reformer'];
  // saves from before the fiscal rule existed get it switched on, like a new game (it can be turned off in the Economy tab)
  if (s.stats && s.stats.fiscalRule === undefined) s.stats.fiscalRule = 1;
}
