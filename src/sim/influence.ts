/**
 * Influence and spheres: the quiet contest for other countries.
 *
 * In every country foreign powers hold influence: through trade, alliances, money, weapons, culture and friends in its
 * politics. Some of it comes on its own (a big trading partner, an ally, a neighbour, a shared organisation); the rest
 * is bought, and it fades unless kept up. The great powers spend on it every month.
 *
 * Hold the most influence in a country, clearly ahead of anyone else, and it enters your sphere: it votes with you in
 * the World Assembly, says yes to your treaties, drifts toward your camp, pays you a dividend in contracts and
 * concessions, and adds to your world power. Lose your lead and a rival takes it, and the world notices.
 */
import { clamp, fmtMoney } from './util';
import { hash01, nextRand } from './rng';
import { logEvent } from './log';
import { addRelation, alliesOf, areAtWar, getRelation, getTreaty, orgsOf } from './relations';
import { fund } from './actions';
import { ensureIndustry } from './industry';
import type { Country, CountryId, GameState } from './types';

/** influence points of each power in each country: inf[target][power] */
export type InfMap = Record<number, Record<number, number>>;
export const infOf = (s: GameState): InfMap => (s.inf ??= {});

/** the powers that compete for influence this month: the player, the 14 largest economies and each region's largest */
function powersOf(s: GameState): Country[] {
  const list = s.countries.filter((c) => c.alive).sort((a, b) => b.eco.gdp - a.eco.gdp);
  const rank = new Map(list.map((c, i) => [c.id, i + 1]));
  return list.filter((c) => c.id === s.player || (rank.get(c.id) ?? 999) <= 14 || regionalPower(s, c));
}
/** the largest economy of its region counts as a power there */
function regionalPower(s: GameState, c: Country) {
  return !s.countries.some((x) => x.alive && x.id !== c.id && x.region === c.region && x.eco.gdp > c.eco.gdp);
}

/** the world's largest economy (influence weights are relative to it) */
const maxGdp = (s: GameState) => Math.max(1, ...s.countries.filter((c) => c.alive).map((c) => c.eco.gdp));
/**
 * Influence a power holds in a target without trying: its weight in the world (a superpower's ties count for more than
 * a middle power's), times the ties themselves: trade, an alliance, military cooperation, shared organisations, being
 * in the same region, and the sheer imbalance of size between them. Goodwill multiplies it; enmity wipes it out.
 */
export function naturalInfluence(s: GameState, p: Country, t: Country, top = maxGdp(s)): number {
  if (p.id === t.id || areAtWar(s, p.id, t.id)) return 0;
  const tr = getTreaty(s, p.id, t.id);
  const size = clamp(p.eco.gdp / Math.max(1, p.eco.gdp + t.eco.gdp), 0, 1); // a giant next to a dwarf
  const rel = getRelation(s, p.id, t.id);
  const weight = Math.sqrt(p.eco.gdp / top);
  let v = 16 * size * size;
  if (tr?.trade) v += 8;
  if (tr?.alliance) v += 12;
  if (tr?.coop) v += 5;
  const shared = orgsOf(s, p.id).filter((o) => o.members.includes(t.id)).length;
  v += 2 * Math.min(3, shared);
  if (p.region === t.region) v += 6;
  if (t.region === 'LA' && p.region === 'NA') v += 6; // the old backyard
  v *= weight * clamp(0.7 + rel / 100, 0.15, 1.5);
  return Math.max(0, v * 1.6);
}

export interface Sphere { patron: CountryId; share: number }
/** Who holds a country in their sphere, if anyone: the most influence, at least 30 points, 40% of the total, 1.4× the next. */
export function patronOf(s: GameState, t: CountryId): Sphere | null {
  const m = infOf(s)[t];
  if (!m) return null;
  let tot = 0, best = -1, bv = 0, second = 0;
  for (const [k, v] of Object.entries(m)) {
    tot += v;
    if (v > bv) { second = bv; bv = v; best = Number(k); } else if (v > second) second = v;
  }
  if (best < 0 || bv < 30 || bv < 0.4 * tot || bv < 1.4 * second || !s.countries[best]?.alive) return null;
  return { patron: best, share: bv / Math.max(1, tot) };
}
/** Everyone's patron as of the last monthly update (kept in the game state: s.sph[target] = patron). patronOf is exact. */
export function clientsOf(s: GameState, p: CountryId): number[] {
  const out: number[] = [];
  for (const [t, pp] of Object.entries(s.sph ?? {})) if (pp === p && s.countries[Number(t)]?.alive) out.push(Number(t));
  return out;
}
export const patronCached = (s: GameState, t: CountryId): number | undefined => s.sph?.[t];
/** Top influencers in a country, biggest first, with their share. */
export function standings(s: GameState, t: CountryId): { id: number; v: number; share: number }[] {
  const m = infOf(s)[t] ?? {};
  const tot = Object.values(m).reduce((a, b) => a + b, 0);
  return Object.entries(m).map(([k, v]) => ({ id: Number(k), v, share: v / Math.max(1, tot) })).filter((x) => x.v >= 1 && s.countries[x.id]?.alive).sort((a, b) => b.v - a.v);
}

// ------------------------------------------------------------------ actions
export type InfAction = 'invest' | 'aid' | 'arms' | 'culture' | 'party';
export const INF_ACTIONS: { id: InfAction; icon: string; label: string; gain: number; desc: string }[] = [
  { id: 'invest', icon: '🏗', label: 'Investment and loans', gain: 14, desc: 'Ports, railways and credit on easy terms. Influence +14.' },
  { id: 'aid', icon: '🤲', label: 'Development aid', gain: 9, desc: 'Schools, clinics and wells with your flag on them. Influence +9, relations +5, reputation +1.' },
  { id: 'arms', icon: '🛡', label: 'An arms deal', gain: 16, desc: 'Sell them weapons (it pays, and they will need your spare parts). Influence +16, relations +6; their rivals are not pleased.' },
  { id: 'culture', icon: '🎭', label: 'Culture and media', gain: 6, desc: 'Scholarships, broadcasters and film festivals. Influence +6, slowly and cheaply.' },
  { id: 'party', icon: '🕴', label: 'Back a friendly party', gain: 22, desc: 'Fund the politicians who like you. Influence +22 if it works; if exposed, a scandal.' },
];
export const INF_COOLDOWN = 13;
export interface InfQuote { cost: number; pc: number; why: string | null; p?: number }
export function quoteAction(s: GameState, p: Country, t: Country, a: InfAction): InfQuote {
  const tg = t.eco.gdp;
  const key = `inf:${t.id}:${a}`;
  const wait = INF_COOLDOWN - (s.tick - (s.stats[key] ?? -999));
  const q: InfQuote = { cost: 0, pc: 0, why: null };
  switch (a) {
    case 'invest': q.cost = Math.max(0.004 * tg, 0.0002 * p.eco.gdp); break;
    case 'aid': q.cost = Math.max(0.0025 * tg, 0.0001 * p.eco.gdp); break;
    case 'arms': q.cost = 0; break;
    case 'culture': q.pc = 4; break;
    case 'party': q.pc = 10; q.p = clamp(0.4 + 0.5 * (p.mil.intel - t.mil.intel), 0.2, 0.8); break;
  }
  if (p.id === t.id) q.why = 'Not in your own country';
  else if (areAtWar(s, p.id, t.id)) q.why = 'You are at war';
  else if (wait > 0) q.why = `Again in ${wait} weeks`;
  else if (a === 'arms' && ensureIndustry(p).lv.arms < 2.5) q.why = 'Needs a defence industry of level 2.5 (Economy tab)';
  else if (a === 'arms' && getRelation(s, p.id, t.id) < 0) q.why = 'They will not buy weapons from you (relations below 0)';
  else if (a === 'party' && !(t.gov === 'D' || t.gov === 'F')) q.why = 'Only where there are real parties';
  else if (q.pc && (p.politics?.pc ?? 99) < q.pc) q.why = `Needs ${q.pc} political capital`;
  return q;
}
function gainFor(s: GameState, p: Country, t: Country, base: number) {
  // influence is easier to win in a small country, harder in a big one, and harder far from home without an alliance
  const far = p.region !== t.region && !(t.region === 'LA' && p.region === 'NA') && !getTreaty(s, p.id, t.id)?.alliance;
  return base * clamp(Math.pow(p.eco.gdp / Math.max(1, t.eco.gdp), 0.15), 0.6, 1.6) * (far ? 0.6 : 1);
}
export function addInfluence(s: GameState, t: CountryId, p: CountryId, v: number) {
  const m = (infOf(s)[t] ??= {});
  m[p] = clamp((m[p] ?? 0) + v, 0, 200);
}
/** Spend on influence in country t (the player, or an AI power). roll: 0..1 for the risky party funding. */
export function doInfluence(s: GameState, pid: number, tid: number, a: InfAction, roll: number) {
  const p = s.countries[pid], t = s.countries[tid];
  const q = quoteAction(s, p, t, a);
  if (q.why) return { ok: false, message: q.why };
  if (q.cost) { const f = fund(s, pid, q.cost, `Influence in ${t.name}`); if (!f.ok) return f; }
  if (q.pc && p.politics) p.politics.pc -= q.pc;
  s.stats[`inf:${tid}:${a}`] = s.tick;
  const def = INF_ACTIONS.find((x) => x.id === a)!;
  let msg = '';
  if (a === 'party' && roll >= (q.p ?? 0.5)) {
    addRelation(s, pid, tid, -20);
    p.reputation = clamp(p.reputation - 3, 0, 100);
    addInfluence(s, tid, pid, -8);
    if (pid === s.player) logEvent(s, `🕴 Exposed: ${t.name}'s press reveals your money behind a party there. Relations −20, reputation −3.`, 'danger', [pid, tid], true);
    return { ok: false, message: `Exposed in ${t.name}: a scandal.` };
  }
  const g = gainFor(s, p, t, def.gain);
  addInfluence(s, tid, pid, g);
  if (a === 'aid') { addRelation(s, pid, tid, 5); p.reputation = clamp(p.reputation + 1, 0, 100); }
  if (a === 'arms') {
    addRelation(s, pid, tid, 6);
    p.eco.cash += 0.002 * t.eco.gdp; // the sale itself pays
    for (const x of s.countries) if (x.alive && x.id !== pid && x.id !== tid && getRelation(s, x.id, tid) < -40) addRelation(s, pid, x.id, -3);
    msg = ` The sale brings in ${fmtMoney(0.002 * t.eco.gdp)}.`;
  }
  return { ok: true, message: `${def.icon} Influence in ${t.name} +${g.toFixed(0)}.${msg}` };
}

// ------------------------------------------------------------------ the AI powers
/** Monthly: each AI power picks a country to court: one it nearly holds, or one a rival is taking. */
function aiCourt(s: GameState, p: Country) {
  if (nextRand(s) > 0.5) return;
  const cands = s.countries.filter((t) => t.alive && t.id !== p.id && !areAtWar(s, p.id, t.id) && t.eco.gdp < p.eco.gdp * 0.8 && (t.region === p.region || getRelation(s, p.id, t.id) > 20 || p.eco.gdp > 5e12));
  let best: Country | null = null, bv = 0;
  for (const t of cands) {
    const st = standings(s, t.id);
    const mine = infOf(s)[t.id]?.[p.id] ?? 0;
    const lead = st[0], second = st[1];
    const home = t.region === p.region || (t.region === 'LA' && p.region === 'NA');
    let v: number;
    if (lead?.id === p.id) v = second && lead.v - second.v < 18 ? 30 : 4; // defend a client under threat first
    else v = lead ? Math.max(0, 25 - (lead.v - mine)) : 12;
    v *= (home ? 2 : 0.6) * (0.5 + hash01('court', p.id, t.id, Math.floor(s.tick / 52)));
    if (v > bv) { bv = v; best = t; }
  }
  if (!best) return;
  const acts: InfAction[] = ['invest', 'aid', 'culture', ...(ensureIndustry(p).lv.arms >= 2.5 ? ['arms' as InfAction] : [])];
  const a = acts[Math.floor(nextRand(s) * acts.length)];
  const q = quoteAction(s, p, best, a);
  if (q.why || q.cost > 0.15 * Math.max(0, p.eco.cash)) return;
  doInfluence(s, p.id, best.id, a, 0);
}

// ------------------------------------------------------------------ the monthly step
export function stepInfluence(s: GameState) {
  if (s.tick % 4 !== 2) return;
  const inf = infOf(s);
  const powers = powersOf(s);
  const top = maxGdp(s);
  const before = new Map<number, number | undefined>();
  for (const t of s.countries) if (t.alive) before.set(t.id, patronOf(s, t.id)?.patron);
  // natural influence: each power's holding drifts toward what trade, alliances and size give it; bought influence fades
  for (const t of s.countries) {
    if (!t.alive) continue;
    const m = (inf[t.id] ??= {});
    for (const p of powers) {
      if (p.id === t.id) continue;
      const nat = naturalInfluence(s, p, t, top);
      const cur = m[p.id] ?? 0;
      const next = cur > nat ? cur - (cur - nat) * 0.06 : cur + (nat - cur) * 0.1;
      if (next < 0.5) delete m[p.id]; else m[p.id] = next;
    }
    for (const k of Object.keys(m)) if (!s.countries[Number(k)]?.alive) delete m[Number(k)];
  }
  for (const p of powers) if (p.id !== s.player) aiCourt(s, p);
  // the effects of a sphere, and the news when one changes hands
  for (const t of s.countries) {
    if (!t.alive) continue;
    const ph = patronOf(s, t.id);
    if (ph) {
      const P = s.countries[ph.patron];
      t.orient = clamp((t.orient ?? 0) + ((P.orient ?? 0) - (t.orient ?? 0)) * 0.01, -1, 1);
      addRelation(s, t.id, P.id, 0.4);
    }
    const was = before.get(t.id), now = ph?.patron;
    if (was === now) continue;
    if (now === s.player) logEvent(s, `🌐 ${t.name} enters your sphere of influence: it will vote with you, favour your deals and pay you in contracts.`, 'diplo', [s.player, t.id], true, { big: t.eco.gdp > 1e11, prov: t.capital });
    else if (was === s.player) logEvent(s, `🌐 ${now !== undefined ? `${s.countries[now].name} has pulled ${t.name} out of your sphere of influence.` : `${t.name} slips out of your sphere of influence.`}`, 'danger', [s.player, t.id], true);
    else if (now !== undefined && t.eco.gdp > 4e11) logEvent(s, `🌐 ${t.name} falls into ${s.countries[now].name}'s sphere of influence.`, 'diplo', [now, t.id], false);
  }
  // the spheres as the world now sees them, and what they pay their patrons (booked as revenue: economy.ts)
  const sph: Record<number, number> = {};
  for (const t of s.countries) { if (!t.alive) continue; const ph = patronOf(s, t.id); if (ph) sph[t.id] = ph.patron; }
  s.sph = sph;
  for (const c of s.countries) if (c.alive) c.eco.prev.sphereInc = sphereDividend(s, c.id);
}

/** Influence in the power race: the weight of a power's clients. */
export function sphereWeight(s: GameState, p: CountryId): number {
  let w = 0;
  for (const id of clientsOf(s, p)) w += Math.sqrt(s.countries[id].eco.gdp);
  return w;
}
/** Treasury income a year from a power's sphere. */
export const sphereDividend = (s: GameState, p: CountryId) => clientsOf(s, p).reduce((t, id) => t + 0.0015 * s.countries[id].eco.gdp, 0);
export { alliesOf };
