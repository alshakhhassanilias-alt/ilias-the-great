import type { CountryId, GameState, LogKind } from './types';

export function logEvent(s: GameState, text: string, kind: LogKind, countries: CountryId[], important = false, extra?: { big?: boolean; prov?: number }) {
  s.log.push({ seq: s.logSeq++, tick: s.tick, text, kind, countries, important: important || !!extra?.big, ...(extra?.big ? { big: true } : {}), ...(extra?.prov !== undefined ? { prov: extra.prov } : {}) });
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}
