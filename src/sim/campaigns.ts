/**
 * War campaigns: big decisions about how a war is fought, ordered for weeks at a time.
 *
 *   Strategic bombing   — hit their factories, their power grid or their cities. Works as well as your air
 *                         superiority; without it you lose aircraft. Bombing cities breaks morale but kills
 *                         civilians, and the world remembers.
 *   Naval blockade      — close their ports: trade, fuel and food stop arriving. Their trading partners resent it.
 *   General offensive   — everything forward for eight weeks: +25% attack, +40% losses. Taking ground makes
 *                         the public proud; a failed offensive costs war support.
 *   Defence in depth    — dig in for sixteen weeks: +25% defence, −40% attack.
 *
 * AI countries order them too (bombing when they rule the skies, blockades when they rule the sea, an offensive
 * when the war goes well, digging in when it does not).
 */
import type { Geo } from './geo';
import type { Country, CountryId, GameState } from './types';
import { addRelation, areAtWar, getRelation, warBetween, warsOf, enemiesOf } from './relations';
import { airSuperiority, isCoastalCountry, navalSuperiority, warScore } from './war';
import { airPower, navalPower, strength } from './military';
import { bumpSupport, warSupport } from './warsupport';
import { addRec } from './minds';
import { addGrudge } from './leaders';
import { fund } from './actions';
import { logEvent } from './log';
import { hash01 } from './rng';
import { clamp, fmtMoney } from './util';

export type CampKind = 'bombing' | 'blockade' | 'offensive' | 'dig_in';
export type BombAim = 'industry' | 'energy' | 'cities';
export interface Campaign { kind: CampKind; target: CountryId; aim?: BombAim; start: number; until: number; taken0?: number }

export const CAMPAIGNS: Record<CampKind, { icon: string; label: string; weeks: number; cooldown: number; desc: string; effects: string[] }> = {
  bombing: { icon: '✈', label: 'Strategic bombing', weeks: 12, cooldown: 8, desc: 'Twelve weeks of raids deep behind their lines.', effects: ['Works as well as your air superiority', 'Costs 0.05% of GDP a week', 'You lose aircraft, many more if they rule the skies'] },
  blockade: { icon: '⚓', label: 'Naval blockade', weeks: 0, cooldown: 4, desc: 'Close their ports until you lift it.', effects: ['Their trade, fuel and food imports dry up', 'Costs 0.02% of GDP a week and wears out ships', 'Their trading partners resent it'] },
  offensive: { icon: '⚔', label: 'General offensive', weeks: 8, cooldown: 20, desc: 'Every division forward for eight weeks.', effects: ['Attack +25%', 'Your losses +40%', 'Costs 0.15% of GDP for munitions', 'Gaining ground lifts war support; failing costs it'] },
  dig_in: { icon: '🛡', label: 'Defence in depth', weeks: 16, cooldown: 8, desc: 'Trenches, minefields and fallback lines for sixteen weeks.', effects: ['Defence +25%', 'Attack −40%', 'No cost'] },
};
export const BOMB_AIMS: Record<BombAim, { label: string; desc: string }> = {
  industry: { label: 'Factories', desc: 'Their arms output and economy suffer.' },
  energy: { label: 'Power grid', desc: 'Their energy supply and infrastructure suffer.' },
  cities: { label: 'Cities', desc: 'War support collapses faster, but civilians die and the world turns on you.' },
};

export const campsOf = (c: Country): Campaign[] => c.mil.camps ?? [];
export const activeCamp = (s: GameState, c: Country, kind: CampKind, target?: CountryId) =>
  campsOf(c).find((x) => x.kind === kind && (target === undefined || x.target === target) && (x.until === 0 || x.until > s.tick));
const coolKey = (cid: CountryId, k: CampKind) => `camp:${cid}:${k}`;
export const campCooldown = (s: GameState, cid: CountryId, k: CampKind) => Math.max(0, (s.stats[coolKey(cid, k)] ?? -999) - s.tick);

/** Why a campaign cannot be launched now, or null. */
export function campBlocked(s: GameState, geo: Geo, cid: CountryId, k: CampKind, target: CountryId): string | null {
  const c = s.countries[cid], T = s.countries[target];
  if (!T?.alive || !areAtWar(s, cid, target)) return 'You are not at war with them';
  if (activeCamp(s, c, k, target)) return 'Already under way';
  const cd = campCooldown(s, cid, k);
  if (cd > 0) return `Ready again in ${cd} week${cd > 1 ? 's' : ''}`;
  if (k === 'bombing' && airPower(c.mil) < 2e9) return 'You have too few combat aircraft';
  if (k === 'blockade') {
    if (navalPower(c.mil) < 2e9) return 'Your navy is too small';
    if (!isCoastalCountry(s, geo, T)) return 'They have no coast';
    if (!isCoastalCountry(s, geo, c)) return 'You have no coast';
  }
  if (k === 'offensive' && activeCamp(s, c, 'dig_in')) return 'Your army is digging in: cancel that first';
  if (k === 'dig_in' && activeCamp(s, c, 'offensive')) return 'An offensive is under way';
  return null;
}

/** How well a bombing campaign would work (0..1.3), for the interface and the effects. */
export const bombEffect = (c: Country, T: Country) => clamp(0.35 + airSuperiority(c, T), 0.05, 1.3);
export const blockadeEffect = (c: Country, T: Country) => clamp(0.55 + 0.6 * navalSuperiority(c, T), 0.1, 1.1);

export function launchCampaign(s: GameState, geo: Geo, cid: CountryId, k: CampKind, target: CountryId, aim: BombAim = 'industry'): { ok: boolean; message: string } {
  const why = campBlocked(s, geo, cid, k, target);
  if (why) return { ok: false, message: why };
  const c = s.countries[cid], T = s.countries[target];
  if (k === 'offensive') { const f = fund(s, cid, 0.0015 * c.eco.gdp, 'General offensive'); if (!f.ok) return f; }
  const w = warBetween(s, cid, target);
  const camp: Campaign = { kind: k, target, start: s.tick, until: CAMPAIGNS[k].weeks ? s.tick + CAMPAIGNS[k].weeks : 0 };
  if (k === 'bombing') camp.aim = aim;
  if (k === 'offensive') camp.taken0 = w?.taken?.[cid] ?? 0;
  (c.mil.camps ??= []).push(camp);
  const mine = cid === s.player || target === s.player;
  const text = k === 'bombing' ? `${CAMPAIGNS.bombing.icon} ${c.name} launches a strategic bombing campaign against ${T.name}'s ${BOMB_AIMS[aim].label.toLowerCase()}.`
    : k === 'blockade' ? `⚓ ${c.name}'s navy blockades ${T.name}'s ports.`
    : k === 'offensive' ? `⚔ ${c.name} throws its army into a general offensive against ${T.name}.`
    : `🛡 ${c.name}'s army digs in for a long defence against ${T.name}.`;
  logEvent(s, text, 'war', [cid, target], mine, mine && k !== 'dig_in' ? { prov: T.capital } : undefined);
  if (k === 'bombing' && aim === 'cities') { addRec(s, cid, 'aggr', 0.4); addGrudge(s, target, cid, 'bombed its cities', 12); }
  const cost = k === 'bombing' ? ` It costs about ${fmtMoney(0.0005 * c.eco.gdp)} a week.` : k === 'blockade' ? ` It costs about ${fmtMoney(0.0002 * c.eco.gdp)} a week.` : '';
  return { ok: true, message: `${CAMPAIGNS[k].label} ordered.${cost}` };
}

export function cancelCampaign(s: GameState, cid: CountryId, k: CampKind, target: CountryId) {
  const c = s.countries[cid];
  const camp = activeCamp(s, c, k, target);
  if (!camp) return { ok: false, message: 'Nothing to cancel' };
  endCampaign(s, c, camp, true);
  return { ok: true, message: `${CAMPAIGNS[k].label} called off.` };
}

function endCampaign(s: GameState, c: Country, camp: Campaign, cancelled = false) {
  c.mil.camps = campsOf(c).filter((x) => x !== camp);
  s.stats[coolKey(c.id, camp.kind)] = s.tick + CAMPAIGNS[camp.kind].cooldown;
  if (camp.kind === 'offensive' && !cancelled) {
    const w = warBetween(s, c.id, camp.target);
    const gained = (w?.taken?.[c.id] ?? 0) - (camp.taken0 ?? 0);
    const T = s.countries[camp.target];
    if (gained >= 1) { bumpSupport(c, 0.05); logEvent(s, `⚔ ${c.name}'s offensive ends: ${gained} region${gained > 1 ? 's' : ''} taken from ${T.name}.`, 'war', [c.id, T.id], c.isPlayer || T.isPlayer); }
    else { bumpSupport(c, -0.06); logEvent(s, `⚔ ${c.name}'s offensive against ${T.name} has stalled with nothing to show for it.`, 'war', [c.id, T.id], c.isPlayer || T.isPlayer); }
  }
}

/** Multiplier on c's attack against `target` from its campaigns. */
export function campOff(s: GameState, c: Country, target: CountryId): number {
  if (!c.mil.camps?.length) return 1;
  let m = 1;
  if (activeCamp(s, c, 'offensive', target)) m *= 1.25;
  if (activeCamp(s, c, 'dig_in')) m *= 0.6;
  return m;
}
export const campDef = (s: GameState, c: Country) => (c.mil.camps?.length && activeCamp(s, c, 'dig_in') ? 1.25 : 1);
/** Multiplier on c's losses when attacking `target`. */
export const campLoss = (s: GameState, c: Country, target: CountryId) => (c.mil.camps?.length && activeCamp(s, c, 'offensive', target) ? 1.4 : 1);

function pay(c: Country, amount: number) {
  c.eco.cash -= amount;
  if (c.eco.cash < 0) { c.eco.debt -= c.eco.cash; c.eco.cash = 0; }
}

/** Weekly, right after the battles. */
export function stepCampaigns(s: GameState, geo: Geo) {
  for (const c of s.countries) {
    if (!c.alive) continue;
    if (!c.isPlayer && !c.mil.camps?.length && warsOf(s, c.id).length && (s.tick + c.id) % 8 === 3) aiCampaigns(s, geo, c);
    if (!c.mil.camps?.length) continue;
    for (const camp of [...c.mil.camps]) {
      const T = s.countries[camp.target];
      if (!T?.alive || !areAtWar(s, c.id, camp.target)) { c.mil.camps = c.mil.camps.filter((x) => x !== camp); continue; }
      if (camp.until && camp.until <= s.tick) { endCampaign(s, c, camp); continue; }
      if (camp.kind === 'bombing') bombWeek(s, c, T, camp);
      else if (camp.kind === 'blockade') blockadeWeek(s, geo, c, T);
    }
  }
}

function bombWeek(s: GameState, c: Country, T: Country, camp: Campaign) {
  const eff = bombEffect(c, T);
  pay(c, 0.0005 * c.eco.gdp);
  // aircraft lost: few when you rule the skies, many when they do
  c.mil.equipAir *= 1 - 0.003 * clamp(1.25 - airSuperiority(c, T), 0.15, 2);
  const e = T.eco;
  const w = warBetween(s, c.id, T.id);
  if (camp.aim === 'industry') {
    e.damage = Math.min(1, e.damage + 0.003 * eff);
    e.capital *= 1 - 0.0015 * eff;
    T.mil.equipArmy *= 1 - 0.0012 * eff;
  } else if (camp.aim === 'energy') {
    e.energyCap *= 1 - 0.004 * eff;
    e.infra = Math.max(5, e.infra - 0.2 * eff);
    e.damage = Math.min(1, e.damage + 0.0015 * eff);
  } else {
    bumpSupport(T, -0.006 * eff, 'economy');
    e.damage = Math.min(1, e.damage + 0.001 * eff);
    const dead = Math.min(4000, 150 + T.eco.pop * 2e-6 * eff);
    if (w) (w.civ ??= {})[T.id] = (w.civ[T.id] ?? 0) + dead;
    T.eco.pop = Math.max(1, T.eco.pop - dead);
    c.reputation = Math.max(0, c.reputation - 0.25);
    if (s.tick % 4 === camp.start % 4) for (const x of s.countries) if (x.alive && x.id !== c.id && x.id !== T.id && getRelation(s, x.id, T.id) > 20) addRelation(s, x.id, c.id, -1);
  }
}

function blockadeWeek(s: GameState, geo: Geo, c: Country, T: Country) {
  pay(c, 0.0002 * c.eco.gdp);
  c.mil.equipNavy *= 0.9993;
  T.eco.blockade = Math.min(0.85, T.eco.blockade + 0.3 * blockadeEffect(c, T));
  // the trade lost hurts their partners, who blame the blockader
  if (s.tick % 6 === 0) {
    const big = s.countries.filter((x) => x.alive && x.id !== c.id && x.id !== T.id && !areAtWar(s, x.id, T.id) && x.eco.gdp > 2e11 && getRelation(s, x.id, T.id) > 10);
    for (const x of big.slice(0, 8)) addRelation(s, x.id, c.id, -0.6);
  }
  void geo;
}

/** AI: order a campaign that fits how its war is going. */
function aiCampaigns(s: GameState, geo: Geo, c: Country) {
  const foes = enemiesOf(s, c.id);
  if (!foes.length) return;
  const T = s.countries[foes.reduce((a, b) => (s.countries[a].eco.gdp > s.countries[b].eco.gdp ? a : b))];
  const w = warBetween(s, c.id, T.id);
  if (!w) return;
  const score = warScore(s, w, c.id);
  const r = hash01('aicamp', c.id, s.tick);
  if (score < -0.25 && !campBlocked(s, geo, c.id, 'dig_in', T.id) && r < 0.5) { launchCampaign(s, geo, c.id, 'dig_in', T.id); return; }
  if (airSuperiority(c, T) > 0.35 && c.ai.aggression > 0.45 && !campBlocked(s, geo, c.id, 'bombing', T.id) && r < 0.6) {
    const aim: BombAim = (c.gov === 'A' || c.gov === 'C') && c.ai.aggression > 0.9 ? 'cities' : r < 0.3 ? 'energy' : 'industry';
    launchCampaign(s, geo, c.id, 'bombing', T.id, aim); return;
  }
  if (navalSuperiority(c, T) > 0.3 && !campBlocked(s, geo, c.id, 'blockade', T.id) && r < 0.7) { launchCampaign(s, geo, c.id, 'blockade', T.id); return; }
  if (score > 0.1 && warSupport(c) > 0.5 && strength(c) > 0.7 * strength(T) && !campBlocked(s, geo, c.id, 'offensive', T.id) && r < 0.35) launchCampaign(s, geo, c.id, 'offensive', T.id);
}
