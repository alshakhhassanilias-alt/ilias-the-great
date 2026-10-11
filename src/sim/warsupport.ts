/**
 * War support: how much the public backs the war effort (0..1, 0.6 = normal).
 *
 * Falls with casualties (democracies feel them most), long wars, inflation, blockades and bomb damage.
 * Rises with victories, when the homeland is invaded (rally round the flag) and through propaganda.
 * Effects: army morale (×0.85 at 0% … ×1.10 at 100%), war exhaustion, stability, and how readily the
 * government accepts peace. The player can run propaganda, sell war bonds or censor the press.
 */
import type { Geo } from './geo';
import type { Country, CountryId, GameState } from './types';
import { warsOf, warSideOf } from './relations';
import { clamp, fmtMoney } from './util';
import { logEvent } from './log';

export const warSupport = (c: Country) => c.mil.warSupport ?? 0.6;
/** combat morale multiplier from war support (1.0 at the normal 60%) */
export const morale = (c: Country) => 0.85 + 0.25 * warSupport(c);

/** casualty sensitivity by government type */
const CAS_TOL: Record<string, number> = { D: 1.4, F: 1.1, A: 0.7, C: 0.6, M: 0.8 };

export const WS_LABEL: Record<string, string> = {
  casualties: 'Casualties',
  fatigue: 'A long war',
  homeland: 'Homeland invaded (rally)',
  momentum: 'Winning / losing',
  economy: 'Prices, blockade & bombing',
  unrest: 'Domestic unrest',
  stateMedia: 'State media',
  recovery: 'Back to normal',
  victories: 'Battles won / lost',
  propaganda: 'Propaganda',
  bonds: 'War bonds',
  censor: 'Censorship',
};
const PULSES = new Set(['victories', 'propaganda', 'bonds', 'censor']);

export function bumpSupport(c: Country, d: number, part = 'victories') {
  // a catastrophic week can cost at most 12 points from lost battles (and win at most 12)
  if (part === 'victories') { const pend = c.mil.wsParts?.['+victories'] ?? 0; d = clamp(d, -0.12 - pend, 0.12 - pend); }
  c.mil.warSupport = clamp(warSupport(c) + d, 0.02, 1);
  // pending one-off changes are shown in next week's breakdown
  const parts = c.mil.wsParts ?? (c.mil.wsParts = {});
  parts[`+${part}`] = (parts[`+${part}`] ?? 0) + d;
}

/** Starting support when a country enters a war. */
export function onEnterWar(s: GameState, c: Country, role: 'aggressor' | 'defender' | 'ally', justified = false) {
  const atWarAlready = warsOf(s, c.id).length > 1;
  let base: number;
  if (role === 'defender') base = Math.max(warSupport(c), 0.8); // rally round the flag
  else if (role === 'aggressor') base = 0.46 + (justified ? 0.16 : 0) + (c.gov === 'A' || c.gov === 'C' ? 0.1 : c.gov === 'D' ? -0.04 : 0);
  else base = 0.55;
  c.mil.warSupport = clamp(atWarAlready ? (warSupport(c) + base) / 2 : base, 0.05, 1);
  c.mil.lastCas = c.mil.casualties;
}

export function stepWarSupport(s: GameState, geo: Geo) {
  void geo;
  for (const c of s.countries) {
    if (!c.alive) continue;
    const wars = warsOf(s, c.id);
    const ws = warSupport(c);
    const weekly = Math.max(0, c.mil.casualties - (c.mil.lastCas ?? c.mil.casualties));
    c.mil.lastCas = c.mil.casualties;
    if (!wars.length) {
      if (Math.abs(ws - 0.6) > 0.001) c.mil.warSupport = ws + (0.6 - ws) * 0.03;
      if (c.mil.wsParts) c.mil.wsParts = undefined;
      continue;
    }
    const parts: Record<string, number> = {};
    // one-off changes since last week (battles, propaganda) were applied already: show them, don't add them again
    for (const [k, v] of Object.entries(c.mil.wsParts ?? {})) if (k.startsWith('+')) parts[k.slice(1)] = v;
    const aggressor = wars.some((w) => warSideOf(w, c.id) === 0 && w.attackers[0] === c.id);
    // people forgive losses far more readily when they are defending their own country
    parts.casualties = -Math.min(0.012, 25 * (weekly / Math.max(1e5, c.eco.pop)) * (CAS_TOL[c.gov] ?? 1) * (aggressor ? 1 : 0.5));
    const years = Math.max(...wars.map((w) => (s.tick - w.start) / 52));
    parts.fatigue = -(aggressor ? 0.0012 : 0.0005) * (years > 2 ? 1.5 : 1);
    let occupied = 0, cores = 0;
    for (let p = 0; p < s.core.length; p++) if (s.core[p] === c.id) { cores++; if (s.owner[p] !== c.id && wars.some((w) => warSideOf(w, s.owner[p]) >= 0 && warSideOf(w, s.owner[p]) !== warSideOf(w, c.id))) occupied++; }
    if (occupied) parts.homeland = 0.004 * Math.min(1, (occupied / Math.max(1, cores)) * 5);
    let score = 0;
    for (const w of wars) {
      const side = warSideOf(w, c.id);
      const enemies = side === 0 ? w.defenders : w.attackers, own = side === 0 ? w.attackers : w.defenders;
      const el = enemies.reduce((t, e) => t + (w.lost[e] ?? 0), 0), ol = own.reduce((t, e) => t + (w.lost[e] ?? 0), 0);
      score += clamp(2 * (el - ol), -1, 1);
    }
    parts.momentum = 0.0015 * clamp(score, -1, 1);
    parts.economy = -(0.003 * Math.max(0, c.eco.inflation - 0.08) / 0.1 + 0.002 * c.eco.blockade + 0.003 * c.eco.damage);
    if (c.eco.stability < 35) parts.unrest = -0.001;
    if (c.gov === 'A' || c.gov === 'C') parts.stateMedia = Math.max(0, (0.55 - ws) * 0.02);
    if (!c.isPlayer && ws < 0.4) parts.stateMedia = (parts.stateMedia ?? 0) + 0.004; // AI governments campaign for their wars
    let sum = 0;
    for (const k of Object.keys(parts)) if (!PULSES.has(k)) sum += parts[k];
    const next = clamp(ws + sum, 0.02, 1);
    c.mil.warSupport = next;
    for (const k of Object.keys(parts)) if (Math.abs(parts[k]) < 1e-5) delete parts[k];
    c.mil.wsParts = parts;
    // effects
    if (next < 0.4) c.mil.exhaustion = clamp(c.mil.exhaustion + (0.4 - next) * 0.004, 0, 1);
    if (next < 0.35) c.eco.stability = Math.max(0, c.eco.stability - (0.35 - next) * 0.4);
    else if (next > 0.72) c.eco.stability = Math.min(100, c.eco.stability + 0.02);
    // the street reacts (hysteresis so it is reported once per slide)
    const key = `wsLow:${c.id}`;
    const level = s.stats[key] ?? 0;
    const mine = c.id === s.player;
    if (next < 0.15 && level < 2) {
      s.stats[key] = 2;
      logEvent(s, `📉 Mass anti-war movement in ${c.name}: crowds fill the streets demanding an end to the war (war support ${(next * 100).toFixed(0)}%).`, 'danger', [c.id], mine, mine ? { big: true, prov: c.capital } : undefined);
    } else if (next < 0.3 && level < 1) {
      s.stats[key] = 1;
      logEvent(s, `📉 Anti-war protests in ${c.name}: support for the war has fallen to ${(next * 100).toFixed(0)}%.`, 'danger', [c.id], mine);
    } else if (next > 0.42 && level > 0) s.stats[key] = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Player levers
// ---------------------------------------------------------------------------------------------
export interface WsAction { id: 'propaganda' | 'bonds' | 'censor'; label: string; icon: string; desc: string; cooldown: number }
export const WS_ACTIONS: WsAction[] = [
  { id: 'propaganda', label: 'Propaganda campaign', icon: '📣', desc: 'Costs 0.12% of GDP · war support +8% (+6% in a democracy)', cooldown: 6 },
  { id: 'bonds', label: 'Sell war bonds', icon: '💵', desc: 'Raises 0.5% of GDP · war support −6% (needs 35%+)', cooldown: 13 },
  { id: 'censor', label: 'Censor the press', icon: '🗞', desc: 'War support +12% · stability −3 (a democracy: −6 and reputation −4)', cooldown: 26 },
];

export function wsCooldownLeft(s: GameState, cid: CountryId, id: WsAction['id']): number {
  const a = WS_ACTIONS.find((x) => x.id === id)!;
  return Math.max(0, (s.opCooldown[`ws:${id}:${cid}`] ?? -999) + a.cooldown - s.tick);
}

export function actWarSupport(s: GameState, cid: CountryId, id: WsAction['id']): { ok: boolean; message: string } {
  const c = s.countries[cid];
  if (!warsOf(s, cid).length) return { ok: false, message: 'You are not at war' };
  const left = wsCooldownLeft(s, cid, id);
  if (left > 0) return { ok: false, message: `Available again in ${left} week${left > 1 ? 's' : ''}` };
  const dem = c.gov === 'D';
  if (id === 'propaganda') {
    const cost = 0.0012 * c.eco.gdp;
    if (c.eco.cash < cost && c.eco.debt + cost > 3 * c.eco.gdp) return { ok: false, message: 'Not enough money' };
    c.eco.cash -= cost;
    bumpSupport(c, dem ? 0.06 : 0.08, 'propaganda');
    s.opCooldown[`ws:${id}:${cid}`] = s.tick;
    return { ok: true, message: `Posters, films and rallies: war support rises to ${(warSupport(c) * 100).toFixed(0)}% (cost ${fmtMoney(cost)}).` };
  }
  if (id === 'bonds') {
    if (warSupport(c) < 0.35) return { ok: false, message: 'Too few people believe in the war to buy bonds' };
    const raised = 0.005 * c.eco.gdp;
    c.eco.cash += raised;
    c.eco.debt += raised * 0.6; // bonds are debt, but cheap patriotic debt
    bumpSupport(c, -0.06, 'bonds');
    s.opCooldown[`ws:${id}:${cid}`] = s.tick;
    return { ok: true, message: `War bonds raised ${fmtMoney(raised)}. Some citizens grumble (war support ${(warSupport(c) * 100).toFixed(0)}%).` };
  }
  bumpSupport(c, 0.12, 'censor');
  c.eco.stability = Math.max(0, c.eco.stability - (dem ? 6 : 3));
  if (dem) c.reputation = Math.max(0, c.reputation - 4);
  s.opCooldown[`ws:${id}:${cid}`] = s.tick;
  return { ok: true, message: `Critical newspapers were shut down. War support ${(warSupport(c) * 100).toFixed(0)}%, but trust in government suffers.` };
}
