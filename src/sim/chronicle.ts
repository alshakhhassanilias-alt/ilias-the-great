/** The chronicle: the long story of the map (nations born, revived, united, fallen, renamed), kept for the whole game. */
import type { ChronicleEntry, CountryId, GameState } from './types';

export function chronicle(s: GameState, kind: ChronicleEntry['kind'], text: string, ids: CountryId[]) {
  (s.chronicle ??= []).push({ tick: s.tick, kind, text, ids });
  // a thousand years of history stays readable and the save stays small: keep the newest 600 entries
  if (s.chronicle.length > 600) s.chronicle.splice(0, s.chronicle.length - 600);
}
