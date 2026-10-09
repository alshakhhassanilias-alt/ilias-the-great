import type { CountryId, GameState, LogKind } from './types';

export function logEvent(s: GameState, text: string, kind: LogKind, countries: CountryId[], important = false) {
  s.log.push({ seq: s.logSeq++, tick: s.tick, text, kind, countries, important });
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}
