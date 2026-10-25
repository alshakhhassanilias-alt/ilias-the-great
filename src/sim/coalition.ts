/**
 * Governing is a coalition. In a democracy your government rests on a majority in parliament: the factions in it each
 * hold you to a concrete demand with a deadline (a law, a budget line, a number to hit). Deliver and they stay loyal and
 * pay you in political capital; fail and their patience runs out, and a partner who walks out can cost you your
 * majority. A minority government struggles to pass laws, earns less capital, loses approval and faces confidence
 * votes: lose one and the government falls (in Legacy, early elections; otherwise a damaging crisis and a new coalition).
 *
 * Outside a democracy the same contest is fought inside the regime: the power base is the two or three factions that
 * really matter (the army, the money, the nationalists...). Let them down and they turn; lose two pillars and the
 * regime itself is in danger.
 */
import { clamp } from './util';
import { nextRand } from './rng';
import { logEvent } from './log';
import { FACTIONS, clout, factionMeta, free, hasLaw, lawById } from './domestic';
import { isAtWar } from './relations';
import type { Country, FactionId, GameState } from './types';

export interface Demand { f: FactionId; id: string; due: number; since: number; base: number; target: number }
export interface Coalition { partners: FactionId[]; demands: Demand[]; formed: number; patience: Partial<Record<FactionId, number>>; nextVote?: number; kept?: number; broken?: number }

interface DemandDef {
  id: string; f: FactionId;
  /** null if it does not apply now; otherwise the starting value and target */
  make: (s: GameState, c: Country) => { base: number; target: number } | null;
  value: (s: GameState, c: Country) => number;
  text: (d: Demand, c: Country) => string;
  /** where in the game you deliver it */
  where: string;
  /** true when the value must stay at or below the target */
  below?: boolean;
}
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const lawDemand = (id: string, f: FactionId): DemandDef => ({
  id: `law:${id}`, f, where: 'Politics → Laws',
  make: (_s, c) => (hasLaw(c, id) || (lawById(id)?.excl && hasLaw(c, lawById(id)!.excl!)) || lawById(id)?.req?.(c) ? null : { base: 0, target: 1 }),
  value: (_s, c) => (hasLaw(c, id) ? 1 : 0),
  text: () => `Pass the ${lawById(id)?.title ?? id}`,
});
export const DEMANDS: DemandDef[] = [
  // unions
  { id: 'social', f: 'labour', where: 'Economy → budget', make: (_s, c) => ({ base: c.budget.social, target: c.budget.social + 0.008 }), value: (_s, c) => c.budget.social, text: (d) => `Raise public services to ${pct(d.target)} of GDP` },
  { id: 'jobs', f: 'labour', where: 'the economy itself', below: true, make: (_s, c) => ({ base: c.eco.unemployment, target: Math.max(0.025, Math.min(c.eco.unemployment, c.eco.uNat + 0.01)) }), value: (_s, c) => c.eco.unemployment, text: (d) => `Keep unemployment at or below ${pct(d.target)}` },
  lawDemand('min_wage', 'labour'), lawDemand('healthcare', 'labour'),
  // business
  { id: 'corp_tax', f: 'business', where: 'Economy → budget', below: true, make: (_s, c) => (c.budget.taxCorporate > 0.12 ? { base: c.budget.taxCorporate, target: c.budget.taxCorporate - 0.02 } : null), value: (_s, c) => c.budget.taxCorporate, text: (d) => `Cut corporate tax to ${pct(d.target, 0)}` },
  { id: 'inflation', f: 'business', where: 'the economy itself', below: true, make: () => ({ base: 0, target: 0.04 }), value: (_s, c) => c.eco.inflation, text: () => 'Keep inflation under 4%' },
  { id: 'industry', f: 'business', where: 'Economy → Industries', make: (_s, c) => ({ base: indTotal(c), target: indTotal(c) + 1 }), value: (_s, c) => indTotal(c), text: () => 'Expand one of the country’s industries' },
  lawDemand('free_trade', 'business'), lawDemand('central_bank', 'business'),
  // the military
  { id: 'defence', f: 'military', where: 'Military → budget', make: (_s, c) => ({ base: c.budget.military, target: Math.max(c.budget.military + 0.004, 0.02) }), value: (_s, c) => c.budget.military, text: (d) => `Raise defence spending to ${pct(d.target)} of GDP` },
  { id: 'defres', f: 'military', where: 'Research → Defence', make: (_s, c) => (c.rs ? { base: c.rs.lv[4], target: c.rs.lv[4] + 1 } : null), value: (_s, c) => c.rs?.lv[4] ?? 0, text: () => 'Master the next defence technology' },
  lawDemand('conscription', 'military'),
  // nationalists
  { id: 'army', f: 'nationalists', where: 'Military → recruit', make: (_s, c) => ({ base: c.mil.troops, target: c.mil.troops * 1.1 }), value: (_s, c) => c.mil.troops, text: (d) => `Grow the army to ${Math.round(d.target / 1000)}K troops` },
  lawDemand('border_wall', 'nationalists'), lawDemand('war_powers', 'nationalists'),
  // liberals
  { id: 'rep', f: 'liberals', where: 'Diplomacy (aid, treaties, peace)', make: (_s, c) => ({ base: c.reputation, target: Math.min(95, c.reputation + 5) }), value: (_s, c) => c.reputation, text: (d) => `Raise your reputation abroad to ${d.target.toFixed(0)}` },
  { id: 'peace', f: 'liberals', where: 'stay out of new wars', below: true, make: (s, c) => (isAtWar(s, c.id) ? null : { base: 0, target: 0 }), value: (s, c) => (isAtWar(s, c.id) ? 1 : 0), text: () => 'Start no war' },
  lawDemand('anti_graft', 'liberals'), lawDemand('green_deal', 'liberals'),
  // regions
  { id: 'infra', f: 'regions', where: 'Economy → budget', make: (_s, c) => ({ base: c.budget.infra, target: c.budget.infra + 0.005 }), value: (_s, c) => c.budget.infra, text: (d) => `Raise infrastructure spending to ${pct(d.target)} of GDP` },
  { id: 'energy', f: 'regions', where: 'Economy → Industries (energy) or Research (energy)', make: (_s, c) => (c.eco.energyCap < c.eco.energyDemand * 0.95 ? { base: c.eco.energyCap / c.eco.energyDemand, target: Math.min(1, c.eco.energyCap / c.eco.energyDemand + 0.08) } : null), value: (_s, c) => c.eco.energyCap / Math.max(1, c.eco.energyDemand), text: (d) => `Produce ${pct(d.target, 0)} of the energy the country uses` },
  lawDemand('farm_aid', 'regions'), lawDemand('autonomy', 'regions'),
];
const indTotal = (c: Country) => (c.ind ? Object.values(c.ind.lv).reduce((t, v) => t + v, 0) : 0);
export const demandDef = (id: string) => DEMANDS.find((d) => d.id === id);

/** How far a demand is met (0..1). */
export function demandProgress(s: GameState, c: Country, d: Demand): number {
  const def = demandDef(d.id);
  if (!def) return 0;
  const v = def.value(s, c);
  if (def.below) return v <= d.target + 1e-9 ? 1 : clamp(1 - (v - d.target) / Math.max(1e-6, Math.abs(d.base - d.target) || Math.abs(d.target) || 1), 0, 0.99);
  if (d.target === d.base) return v >= d.target ? 1 : 0;
  return clamp((v - d.base) / (d.target - d.base), 0, 1);
}

// ------------------------------------------------------------------ forming a government
export const seatsOf = (c: Country, ids: FactionId[]) => (c.politics?.factions ?? []).filter((f) => ids.includes(f.id)).reduce((t, f) => t + f.support, 0);
export const isDemocracy = (c: Country) => free(c);
/** Who would form a government now: the happiest factions until they hold a majority (or, in a regime, the pillars). */
function natural(c: Country): FactionId[] {
  const P = c.politics!;
  if (!isDemocracy(c)) return [...P.factions].sort((a, b) => b.support * clout(c, b.id) - a.support * clout(c, a.id)).slice(0, 3).map((f) => f.id);
  const out: FactionId[] = [];
  for (const f of [...P.factions].sort((a, b) => b.mood - a.mood)) { out.push(f.id); if (seatsOf(c, out) >= 52) break; }
  return out;
}
export function ensureCoalition(s: GameState, c: Country): Coalition | null {
  const P = c.politics;
  if (!P) return null;
  if (!P.gov) {
    P.gov = { partners: natural(c), demands: [], formed: s.tick, patience: {}, nextVote: s.tick + 52 };
    for (const f of P.gov.partners) P.gov.patience[f] = 2;
  }
  return P.gov;
}
export const hasMajority = (c: Country) => !c.politics?.gov || !isDemocracy(c) || seatsOf(c, c.politics.gov.partners) >= 50;
/** Pillars still with you (regimes) */
export const pillarsLost = (c: Country) => (c.politics?.gov && !isDemocracy(c) ? 3 - c.politics.gov.partners.length : 0);
export const minority = (c: Country) => isDemocracy(c) && !!c.politics?.gov && seatsOf(c, c.politics.gov.partners) < 50;

function newDemand(s: GameState, c: Country, f: FactionId): Demand | null {
  const G = c.politics!.gov!;
  const pool = DEMANDS.filter((d) => d.f === f && !G.demands.some((x) => x.id === d.id) && s.tick - (s.stats[`dem:${d.id}`] ?? -999) > 156);
  const opts = pool.map((d) => ({ d, m: d.make(s, c) })).filter((x) => x.m && !(demandProgressRaw(s, c, x.d, x.m) >= 1));
  if (!opts.length) return null;
  const pick = opts[Math.floor(nextRand(s) * opts.length)];
  s.stats[`dem:${pick.d.id}`] = s.tick;
  return { f, id: pick.d.id, due: s.tick + 60 + Math.floor(nextRand(s) * 26), since: s.tick, base: pick.m!.base, target: pick.m!.target };
}
function demandProgressRaw(s: GameState, c: Country, def: DemandDef, m: { base: number; target: number }) {
  return demandProgress(s, c, { f: def.f, id: def.id, due: 0, since: 0, base: m.base, target: m.target });
}

// ------------------------------------------------------------------ the weekly step
const fname = (f: FactionId) => factionMeta(f).name;
export function stepCoalition(s: GameState, onFall: (why: string) => void) {
  const c = s.countries[s.player];
  const G = ensureCoalition(s, c);
  if (!G || !c.politics) return;
  const P = c.politics, demo = isDemocracy(c);
  // every partner holds you to one demand at a time
  for (const f of G.partners) {
    if (!G.demands.some((d) => d.f === f) && s.tick - G.formed > 8 && s.tick - (s.stats[`demDone:${f}`] ?? -999) > 20) {
      const d = newDemand(s, c, f);
      if (d) { G.demands.push(d); logEvent(s, `🤝 ${fname(f)} (${demo ? 'in your coalition' : 'a pillar of the regime'}) demands: ${demandDef(d.id)!.text(d, c)}, within ${Math.round((d.due - s.tick) / 4.33)} months.`, 'info', [c.id], true); }
    }
  }
  for (const d of [...G.demands]) {
    const def = demandDef(d.id);
    if (!def || !G.partners.includes(d.f)) { G.demands = G.demands.filter((x) => x !== d); continue; }
    const p = demandProgress(s, c, d);
    const fac = P.factions.find((x) => x.id === d.f)!;
    if (p >= 1 && !def.below) {
      G.demands = G.demands.filter((x) => x !== d);
      fac.mood = clamp(fac.mood + 12, 0, 100);
      P.pc = clamp(P.pc + 8, 0, 100);
      G.patience[d.f] = Math.min(3, (G.patience[d.f] ?? 2) + 1);
      G.kept = (G.kept ?? 0) + 1;
      s.stats[`demDone:${d.f}`] = s.tick;
      logEvent(s, `✅ Demand met: ${def.text(d, c)}. ${fname(d.f)} are pleased (mood +12, political capital +8).`, 'info', [c.id], true);
    } else if (s.tick >= d.due) {
      G.demands = G.demands.filter((x) => x !== d);
      s.stats[`demDone:${d.f}`] = s.tick;
      if (p >= 1) { // a "keep it below" demand held to the end
        fac.mood = clamp(fac.mood + 10, 0, 100); P.pc = clamp(P.pc + 6, 0, 100); G.kept = (G.kept ?? 0) + 1;
        logEvent(s, `✅ Demand met: ${def.text(d, c)}. ${fname(d.f)} are satisfied (mood +10, political capital +6).`, 'info', [c.id], true);
        continue;
      }
      fac.mood = clamp(fac.mood - 15, 0, 100);
      G.patience[d.f] = (G.patience[d.f] ?? 2) - 1;
      G.broken = (G.broken ?? 0) + 1;
      if ((G.patience[d.f] ?? 0) <= 0 || fac.mood < 28) leave(s, c, d.f, `after you failed to ${def.text(d, c).replace(/^./, (x) => x.toLowerCase())}`);
      else logEvent(s, `⚠ Demand missed: ${def.text(d, c)}. ${fname(d.f)} are angry (mood −15) and their patience is wearing thin.`, 'danger', [c.id], true);
    }
  }
  // a partner whose mood collapses walks out regardless
  for (const f of [...G.partners]) { const fac = P.factions.find((x) => x.id === f)!; if (fac.mood < 20) leave(s, c, f, 'in disgust at the government'); }
  // a minority government faces confidence votes; a regime that loses two pillars totters
  if (demo && minority(c)) {
    if (s.tick >= (G.nextVote ?? 0)) {
      G.nextVote = s.tick + 26;
      const opp = P.factions.filter((f) => !G.partners.includes(f.id));
      const anger = opp.reduce((t, f) => t + f.support * (f.mood < 45 ? 1 : 0.3), 0) / 100;
      const fallP = clamp(0.15 + 0.7 * anger - (P.pc > 60 ? 0.1 : 0), 0.1, 0.85);
      if (nextRand(s) < fallP) { onFall('The government lost a vote of confidence.'); reform(s, c); }
      else logEvent(s, '🗳 Your minority government survives a vote of confidence, for now.', 'info', [c.id], true);
    }
  } else if (!demo && G.partners.length <= 1 && nextRand(s) < 0.02) {
    onFall('The pillars of the regime turned against the leader.');
    reform(s, c);
  }
}
function leave(s: GameState, c: Country, f: FactionId, why: string) {
  const G = c.politics!.gov!;
  G.partners = G.partners.filter((x) => x !== f);
  G.demands = G.demands.filter((d) => d.f !== f);
  const demo = isDemocracy(c);
  const left = demo ? (seatsOf(c, G.partners) < 50 ? ' You have lost your majority: laws are harder to pass and a vote of confidence looms.' : ' Your majority holds without them.') : ' The regime has lost a pillar.';
  logEvent(s, `💥 ${fname(f)} ${demo ? 'leave your coalition' : 'turn against the regime'} ${why}.${left}`, 'danger', [c.id], true, { big: true, prov: c.capital });
  if (demo && seatsOf(c, G.partners) < 50) G.nextVote = Math.min(G.nextVote ?? 9e9, s.tick + 13);
}
/** After a fall: a new government forms from whoever is willing (fresh demands, patience reset). */
function reform(s: GameState, c: Country) {
  const P = c.politics!;
  P.gov = undefined;
  ensureCoalition(s, c);
  c.eco.stability = clamp(c.eco.stability - 6, 0, 100);
  P.pc = Math.max(0, P.pc - 15);
}

// ------------------------------------------------------------------ player actions
export const INVITE_PC = 15;
export function actInvite(s: GameState, f: FactionId) {
  const c = s.countries[s.player];
  const G = ensureCoalition(s, c);
  if (!G || !c.politics) return { ok: false, message: 'No government to join' };
  if (G.partners.includes(f)) return { ok: false, message: 'Already in government' };
  const fac = c.politics.factions.find((x) => x.id === f)!;
  if (fac.mood < 35) return { ok: false, message: `${fname(f)} will not join a government they despise (mood below 35)` };
  if (c.politics.pc < INVITE_PC) return { ok: false, message: `Needs ${INVITE_PC} political capital` };
  c.politics.pc -= INVITE_PC;
  G.partners.push(f); G.patience[f] = 2;
  const d = newDemand(s, c, f);
  if (d) G.demands.push(d);
  logEvent(s, `🤝 ${fname(f)} join the government${d ? `. Their price: ${demandDef(d.id)!.text(d, c).replace(/^./, (x) => x.toLowerCase())}` : ''}.`, 'info', [c.id], true);
  return { ok: true, message: `${fname(f)} are in.` };
}
export function actDropPartner(s: GameState, f: FactionId) {
  const c = s.countries[s.player];
  const G = ensureCoalition(s, c);
  if (!G?.partners.includes(f) || !c.politics) return { ok: false, message: 'Not in government' };
  if (c.politics.pc < 5) return { ok: false, message: 'Needs 5 political capital' };
  c.politics.pc -= 5;
  const fac = c.politics.factions.find((x) => x.id === f)!;
  fac.mood = clamp(fac.mood - 20, 0, 100);
  leave(s, c, f, 'after you showed them the door');
  return { ok: true, message: `${fname(f)} are out.` };
}
export { FACTIONS };
