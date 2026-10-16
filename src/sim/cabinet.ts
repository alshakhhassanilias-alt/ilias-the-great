/**
 * The cabinet: four named ministers who run the departments for you (Finance, Foreign Affairs, Defence,
 * Interior). Each has a trait and a skill (1-5) that change the country's numbers, and a loyalty that rises and
 * falls with your popularity and how you treat them. Corrupt ministers cause scandals, ambitious ones plot,
 * rivals inside the cabinet clash over money, and a minister who is pushed too far resigns in public.
 * You can reshuffle (pick from three candidates) or buy goodwill. Only the player has a cabinet.
 */
import { clamp } from './util';
import { fiscalNow } from './economy';
import { hash01, nextRand } from './rng';
import { personName } from './leaders';
import { logEvent } from './log';
import { approval } from './approval';
import { fund } from './actions';
import type { Eff } from './doctrines';
import type { Country, GameState, InboxItem, Minister, MinRole } from './types';

export const ROLES: MinRole[] = ['finance', 'foreign', 'defence', 'interior'];
export const ROLE_META: Record<MinRole, { title: string; short: string; icon: string; dept: string }> = {
  finance: { title: 'Finance Minister', short: 'Finance', icon: '💰', dept: 'the Treasury' },
  foreign: { title: 'Foreign Minister', short: 'Foreign Affairs', icon: '🌐', dept: 'the Foreign Ministry' },
  defence: { title: 'Defence Minister', short: 'Defence', icon: '🎖', dept: 'the Defence Ministry' },
  interior: { title: 'Interior Minister', short: 'Interior', icon: '🏛', dept: 'the Interior Ministry' },
};

export interface MinTrait {
  id: string; title: string; icon: string; desc: string;
  /** loyalty they settle at, relative to everyone else */
  bias: number;
  /** weekly chance of a scandal */
  scandal: number;
  /** skill adjustment when generated */
  skill: number;
  /** how they judge options in a decision: what they look for */
  view: 'prudent' | 'popular' | 'tough' | 'bold' | 'cheap';
  eff: (role: MinRole) => Eff;
}
export const MTRAITS: MinTrait[] = [
  { id: 'technocrat', title: 'Technocrat', icon: '📐', desc: 'Competent and dull. Runs the numbers, never the headlines.', bias: 0, scandal: 0.0004, skill: 1, view: 'prudent', eff: () => ({}) },
  { id: 'populist', title: 'Populist', icon: '📣', desc: 'Loved by the crowds; spends to stay that way.', bias: 4, scandal: 0.0012, skill: -1, view: 'popular', eff: () => ({ stab: 2 }) },
  { id: 'hardliner', title: 'Hardliner', icon: '✊', desc: 'Never gives an inch, at home or abroad.', bias: 0, scandal: 0.0008, skill: 0, view: 'tough',
    eff: (r) => (r === 'defence' ? { off: 1.04, def: 1.04 } : r === 'interior' ? { stab: 1, rep: -1 } : r === 'foreign' ? { accept: -0.04, deter: 0.95 } : { tfp: 0.001, stab: -1 }) },
  { id: 'reformer', title: 'Reformer', icon: '🛠', desc: 'Full of plans to modernise the department.', bias: -2, scandal: 0.0006, skill: 0, view: 'bold',
    eff: (r) => (r === 'finance' ? { tfp: 0.002 } : r === 'interior' ? { tfp: 0.001, stab: -1 } : r === 'foreign' ? { accept: 0.03 } : { milTech: 0.4 }) },
  { id: 'loyalist', title: 'Loyalist', icon: '🤝', desc: 'Owes you everything and knows it. Not the sharpest.', bias: 25, scandal: 0.0008, skill: -1, view: 'prudent', eff: () => ({}) },
  { id: 'ambitious', title: 'Ambitious', icon: '👑', desc: 'Brilliant, and wants your job.', bias: -18, scandal: 0.0008, skill: 1, view: 'bold', eff: () => ({}) },
  { id: 'fixer', title: 'Fixer', icon: '🧳', desc: 'Gets deals done. Do not ask how.', bias: 6, scandal: 0.007, skill: 0, view: 'cheap',
    eff: (r) => (r === 'foreign' ? { accept: 0.05 } : r === 'finance' ? { tfp: 0.001 } : r === 'defence' ? { cost: 0.96 } : { ops: 0.05 }) },
  { id: 'veteran', title: 'Old Soldier', icon: '🎖', desc: 'Served in uniform for thirty years.', bias: 6, scandal: 0.0005, skill: 0, view: 'tough',
    eff: (r) => (r === 'defence' ? { off: 1.03, def: 1.05 } : { stab: 1 }) },
  { id: 'charismatic', title: 'Charismatic', icon: '✨', desc: 'Lights up a room and every talk show.', bias: 2, scandal: 0.0015, skill: 0, view: 'popular',
    eff: (r) => (r === 'foreign' ? { accept: 0.05, rep: 1 } : { stab: 1, rep: 1 }) },
];
export const mtraitById = (id: string) => MTRAITS.find((t) => t.id === id) ?? MTRAITS[0];

export const roleTitle = (r: MinRole) => ROLE_META[r].title;
export const ministerOf = (c: Country, r: MinRole) => c.cabinet?.find((m) => m.role === r);
export const ministerById = (c: Country, id: number) => c.cabinet?.find((m) => m.id === id);

/** What a minister adds to the country's numbers: skill in their own field plus their trait. */
export function cabinetEff(c: Country): Eff {
  const out: Required<Pick<Eff, 'tfp' | 'stab' | 'accept' | 'ops' | 'rep' | 'milTech'>> & { off: number; def: number; cost: number; deter: number } = { tfp: 0, stab: 0, accept: 0, ops: 0, rep: 0, milTech: 0, off: 1, def: 1, cost: 1, deter: 1 };
  for (const m of c.cabinet ?? []) {
    const k = m.skill - 3;
    if (m.role === 'finance') out.tfp += 0.0012 * k;
    if (m.role === 'foreign') out.accept += 0.03 * k;
    if (m.role === 'defence') { out.off *= 1 + 0.025 * k; out.def *= 1 + 0.025 * k; out.cost *= 1 - 0.03 * k; }
    if (m.role === 'interior') { out.stab += 1.5 * k; out.ops += 0.03 * k; }
    const e = mtraitById(m.trait).eff(m.role);
    out.tfp += e.tfp ?? 0; out.stab += e.stab ?? 0; out.accept += e.accept ?? 0; out.ops += e.ops ?? 0; out.rep += e.rep ?? 0; out.milTech += e.milTech ?? 0;
    out.off *= e.off ?? 1; out.def *= e.def ?? 1; out.cost *= e.cost ?? 1; out.deter *= e.deter ?? 1;
  }
  // a cabinet at war with itself governs badly
  const avg = avgLoyalty(c);
  if (c.cabinet?.length && avg < 35) out.stab -= (35 - avg) * 0.12;
  return out;
}
export const cabinetKey = (c: Country) => (c.cabinet ?? []).map((m) => `${m.id}:${m.skill}:${m.trait}:${m.loyalty < 35 ? Math.round(m.loyalty / 5) : 'ok'}`).join(',');
export const avgLoyalty = (c: Country) => { const l = c.cabinet ?? []; return l.length ? l.reduce((t, m) => t + m.loyalty, 0) / l.length : 60; };

/** A plain-language list of what one minister does to your numbers. */
export function ministerEffects(m: Minister): string[] {
  const k = m.skill - 3, out: string[] = [];
  const sg = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`;
  if (k !== 0) {
    if (m.role === 'finance') out.push(`Productivity ${sg(0.12 * k, 2)}%/yr`);
    if (m.role === 'foreign') out.push(`Treaty acceptance ${sg(3 * k, 0)} pts`);
    if (m.role === 'defence') out.push(`Combat power ${sg(2.5 * k)}% · army costs ${sg(-3 * k, 0)}%`);
    if (m.role === 'interior') out.push(`Stability ${sg(1.5 * k)} · covert ops ${sg(3 * k, 0)}%`);
  }
  const e = mtraitById(m.trait).eff(m.role);
  if (e.tfp) out.push(`Productivity ${sg(e.tfp * 100, 1)}%/yr`);
  if (e.stab) out.push(`Stability ${sg(e.stab, 0)}`);
  if (e.accept) out.push(`Treaty acceptance ${sg(e.accept * 100, 0)} pts`);
  if (e.rep) out.push(`Reputation ${sg(e.rep, 0)}/yr`);
  if (e.off && e.off !== 1) out.push(`Attack ${sg((e.off - 1) * 100, 0)}%`);
  if (e.def && e.def !== 1) out.push(`Defence ${sg((e.def - 1) * 100, 0)}%`);
  if (e.cost && e.cost !== 1) out.push(`Army costs ${sg((e.cost - 1) * 100, 0)}%`);
  if (e.deter && e.deter !== 1) out.push(`Enemies' appetite ${sg((e.deter - 1) * 100, 0)}%`);
  if (e.ops) out.push(`Covert ops ${sg(e.ops * 100, 0)}%`);
  if (e.milTech) out.push(`Military tech ${sg(e.milTech, 1)}/yr`);
  if (!out.length) out.push('No effect either way');
  return out;
}

function makeMinister(s: GameState, c: Country, role: MinRole, salt: number): Minister {
  const r = (i: number) => hash01('min', c.id, role, salt, i);
  // trait weights fit the regime: autocracies breed loyalists and hardliners
  const free = c.gov === 'D' || c.gov === 'F';
  const w = MTRAITS.map((t) => (t.id === 'loyalist' ? (free ? 0.6 : 1.8) : t.id === 'hardliner' ? (free ? 0.7 : 1.6) : t.id === 'veteran' ? (role === 'defence' ? 2.2 : 0.4) : t.id === 'fixer' ? (free ? 0.7 : 1.2) : t.id === 'technocrat' ? (role === 'finance' ? 1.8 : 1) : 1));
  let x = r(1) * w.reduce((a, b) => a + b, 0), ti = 0;
  for (; ti < w.length - 1; ti++) { x -= w[ti]; if (x <= 0) break; }
  const t = MTRAITS[ti];
  const skill = clamp(Math.round(1.6 + r(2) * 3.2) + t.skill, 1, 5);
  s.stats.minId = (s.stats.minId ?? 0) + 1;
  const taken = new Set([...(c.cabinet ?? []).map((m) => m.name), s.legacy?.leader ?? '', s.settings.leaderName ?? '']);
  let name = personName(c, `min-${role}`, salt);
  for (let k = 1; taken.has(name) && k < 12; k++) name = personName(c, `min-${role}`, salt + k * 97);
  return { id: s.stats.minId, role, name, trait: t.id, skill, loyalty: clamp(52 + t.bias + r(3) * 16, 5, 95), since: s.tick };
}

/** The player's first cabinet (also creates one for saves made before cabinets existed). */
export function ensureCabinet(s: GameState, gen = 0) {
  const c = s.countries[s.player];
  if (!c || c.cabinet?.length) return;
  c.cabinet = [];
  for (const [i, r] of ROLES.entries()) c.cabinet.push(makeMinister(s, c, r, 1 + i * 7 + gen * 31));
}

/** Three people who would take the job right now (they change every eight weeks). */
export function candidates(s: GameState, role: MinRole): Minister[] {
  const c = s.countries[s.player];
  const window = Math.floor(s.tick / 8);
  const keep = s.stats.minId;
  const out = [0, 1, 2].map((i) => makeMinister(s, c, role, 1000 + window * 13 + i * 101 + ROLES.indexOf(role) * 7));
  s.stats.minId = keep; // previews only
  return out;
}

const FIRE_CD = 8;
export function canReshuffle(s: GameState, role: MinRole) {
  const last = s.stats[`minFire:${role}`] ?? -999;
  return s.tick - last >= FIRE_CD ? 0 : FIRE_CD - (s.tick - last);
}

/** Replace a minister with one of the candidates. */
export function actAppoint(s: GameState, role: MinRole, idx: number) {
  const c = s.countries[s.player];
  ensureCabinet(s);
  const wait = canReshuffle(s, role);
  if (wait) return { ok: false, message: `The last reshuffle was too recent: wait ${wait} weeks` };
  const pick = candidates(s, role)[idx];
  if (!pick) return { ok: false, message: 'No such candidate' };
  const old = ministerOf(c, role)!;
  pick.id = s.stats.minId = (s.stats.minId ?? 0) + 1;
  pick.since = s.tick;
  c.cabinet = c.cabinet!.map((m) => (m.role === role ? pick : m));
  s.stats[`minFire:${role}`] = s.tick;
  const disgraced = old.scandal !== undefined && s.tick - old.scandal < 26;
  // sacking someone popular shakes the rest of the cabinet; sacking a disgraced one reassures the public
  if (!disgraced) for (const m of c.cabinet) if (m.id !== pick.id) m.loyalty = clamp(m.loyalty - 4, 0, 100);
  if (!disgraced && old.loyalty > 50) c.eco.stability = clamp(c.eco.stability - 1, 0, 100);
  if (disgraced) c.eco.stability = clamp(c.eco.stability + 1, 0, 100);
  if (old.trait === 'ambitious' && old.loyalty < 35 && s.legacy) s.stats.campaign = (s.stats.campaign ?? 0) - 2; // a dangerous enemy outside the tent
  logEvent(s, `🏛 Reshuffle: ${pick.name} (${mtraitById(pick.trait).title}) replaces ${old.name} as ${roleTitle(role)}.`, 'info', [c.id], true);
  return { ok: true, message: `${pick.name} is the new ${roleTitle(role)}.` };
}

/** A dinner, a medal, a pet project funded: loyalty +15 for a small price. */
export function actCourt(s: GameState, id: number) {
  const c = s.countries[s.player];
  const m = ministerById(c, id);
  if (!m) return { ok: false, message: 'No such minister' };
  const key = `minCourt:${id}`;
  if (s.tick - (s.stats[key] ?? -999) < 26) return { ok: false, message: `You did that recently (again in ${26 - (s.tick - (s.stats[key] ?? 0))} weeks)` };
  const f = fund(s, c.id, 0.0004 * c.eco.gdp, `Courting ${m.name}`);
  if (!f.ok) return f;
  s.stats[key] = s.tick;
  m.loyalty = clamp(m.loyalty + (m.trait === 'ambitious' ? 8 : 15), 0, 100);
  return { ok: true, message: `${m.name} appreciates the gesture (loyalty ${m.loyalty.toFixed(0)}).` };
}

/** Replace a minister without a choice (after a resignation or a sacking forced by events). */
export function replaceMinister(s: GameState, id: number, why: string) {
  const c = s.countries[s.player];
  const old = ministerById(c, id);
  if (!old) return null;
  const pool = candidates(s, old.role).sort((a, b) => b.skill - a.skill);
  const pick = pool[0];
  pick.id = s.stats.minId = (s.stats.minId ?? 0) + 1;
  pick.since = s.tick;
  c.cabinet = c.cabinet!.map((m) => (m.id === id ? pick : m));
  logEvent(s, `🏛 ${old.name} ${why}. ${pick.name} (${mtraitById(pick.trait).title}) becomes ${roleTitle(old.role)}.`, 'danger', [c.id], true);
  return pick;
}

const MIN_EVENT_GAP = 14;
function queue(s: GameState, id: string, data: Record<string, number>, ttl: number, urgent = false) {
  if (s.inbox.some((x) => x.id.startsWith('min_')) || s.inbox.length >= 4) return;
  if (s.tick - (s.stats.minEvt ?? -999) < MIN_EVENT_GAP) return;
  s.stats.minEvt = s.tick;
  const it: InboxItem = { uid: s.nextInbox++, id, tick: s.tick, expires: s.tick + ttl, urgent, data };
  s.inbox.push(it);
  s.lastEventTick = s.tick;
}

/** Weekly: loyalty drifts with your popularity; scandals, plots, clashes and resignations. */
export function stepCabinet(s: GameState) {
  const c = s.countries[s.player];
  if (!c?.alive || s.legacy?.status === 'opposition' || s.legacy?.status === 'ended') return;
  ensureCabinet(s);
  const appr = approval(s, c);
  for (const m of [...c.cabinet!]) {
    const t = mtraitById(m.trait);
    const target = clamp(48 + (appr - 50) * 0.55 + t.bias + (c.eco.stability < 30 ? -10 : 0), 0, 100);
    m.loyalty = clamp(m.loyalty + (target - m.loyalty) * 0.015, 0, 100);
    if (m.loyalty < 10 && nextRand(s) < 0.04) {
      c.eco.stability = clamp(c.eco.stability - 2, 0, 100);
      if (s.legacy) s.stats.campaign = (s.stats.campaign ?? 0) - 1.5;
      replaceMinister(s, m.id, `resigns in fury, accusing you of ${pick(s, ['wrecking the country', 'lying to the cabinet', 'surrounding yourself with flatterers', 'betraying the voters'])}`);
      continue;
    }
    if (s.settings.randomEvents === false) continue;
    if (nextRand(s) < t.scandal * (m.skill <= 2 ? 1.5 : 1) * (s.tick < 20 ? 0 : 1) * (c.politics?.laws.some((l) => l.id === 'anti_graft') ? 0.4 : 1)) queue(s, 'min_scandal', { m: m.id, k: Math.floor(nextRand(s) * 6), amt: nextRand(s) }, 20, true);
    else if (t.id === 'ambitious' && m.loyalty < 32 && nextRand(s) < 0.015) queue(s, 'min_revolt', { m: m.id }, 14, true);
  }
  // the classic fight over money: the Treasury against Defence
  const fin = ministerOf(c, 'finance'), def = ministerOf(c, 'defence');
  if (fin && def && s.settings.randomEvents !== false && s.tick > 30 && s.tick - (s.stats.minClash ?? -999) > 90 && (s.tick + c.id) % 13 === 4 && nextRand(s) < 0.12) {
    const deficit = -fiscalNow(c, s).balance / Math.max(1, c.eco.gdp);
    if (deficit > 0.015 || c.budget.military > 0.03) { const n = s.inbox.length; queue(s, 'min_clash', { f: fin.id, d: def.id }, 18); if (s.inbox.length > n) s.stats.minClash = s.tick; }
  }
}

const pick = <T>(s: GameState, a: T[]): T => a[Math.floor(nextRand(s) * a.length)];

/** Whose desk an event lands on. */
const PRESENTER: Record<string, MinRole> = {};
for (const id of ['oil_spike', 'investment', 'rates', 'tax_demand', 'deposit', 'boom', 'energy_deal', 'pipeline', 'pipeline_cutoff', 'pipeline_bonus', 'trade_war', 'bank_run', 'pension', 'housing', 'green_transition', 'tech_giant', 'free_zone', 'oil_province', 'treasury_plan', 'crisis_response', 'boom_response', 'harvest', 'famine', 'tech', 'brain_drain', 'skilled_migration', 'tech_licence', 'min_clash']) PRESENTER[id] = 'finance';
for (const id of ['trade_offer', 'ally_aid', 'summit', 'ally_attacked', 'ultimatum', 'peace_conference', 'sanction_pressure', 'summit_invite', 'coup_in_ally', 'proxy_support', 'humanitarian', 'assembly', 'rival_courts_ally', 'rival_summit', 'neighbor_collapse', 'neighbor_hunger', 'hostage_crisis', 'rival_prestige']) PRESENTER[id] = 'foreign';
for (const id of ['border_incident', 'arms_deal', 'arms_race', 'nuclear_scare', 'rival_buildup', 'airspace_incident', 'naval_standoff', 'generals_hawks', 'mutiny', 'mercenaries', 'allied_exercise', 'cyberattack', 'cyber_blackout', 'rival_sabotage', 'defector', 'incident']) PRESENTER[id] = 'defence';
for (const id of ['arc_bank_1', 'arc_bank_2a', 'arc_bank_2b']) PRESENTER[id] = 'finance';
for (const id of ['arc_standoff_1', 'arc_standoff_2', 'arc_standoff_3']) PRESENTER[id] = 'defence';
export function presenterOf(s: GameState, eventId: string, data?: Record<string, number>): Minister | undefined {
  const c = s.countries[s.player];
  if (!c?.cabinet) return undefined;
  if ((eventId === 'min_scandal' || eventId === 'min_revolt') && data) return ministerById(c, data.m);
  return ministerOf(c, PRESENTER[eventId] ?? 'interior');
}

/** Which option a minister would pick, and why (read from the option's own hint). */
export function adviceOf(m: Minister, options: { label: string; hint: string }[], enabled: boolean[]): { idx: number; why: string } | null {
  const view = mtraitById(m.trait).view;
  let best = -1, bv = -Infinity, why = '';
  options.forEach((o, i) => {
    if (!enabled[i]) return;
    const t = `${o.label} ${o.hint}`.toLowerCase();
    const num = (re: RegExp) => { const x = re.exec(t); return x ? parseFloat(x[1].replace('−', '-')) * (x[0].includes('−') ? -1 : 1) : 0; };
    const cost = num(/costs? ([\d.]+)%/);
    const stabv = num(/stability ([+−-]?[\d.]+)/);
    const repv = num(/reputation ([+−-]?[\d.]+)/);
    const tough = /(refuse|reject|force|crack|army|troops|war|retaliat|strike back|stand firm|expel|arrest|deploy|military|defy|seize)/.test(t) ? 1 : 0;
    const bold = /(invest|reform|build|launch|new|modern|research|open)/.test(t) ? 1 : 0;
    let v = 0;
    if (view === 'prudent') v = -cost * 3 + stabv * 0.5 + repv * 0.3 - tough * 0.5;
    if (view === 'popular') v = stabv * 1.2 + repv * 0.4 - cost * 0.5;
    if (view === 'tough') v = tough * 3 + stabv * 0.2 - repv * 0.1;
    if (view === 'bold') v = bold * 2 + repv * 0.4 + stabv * 0.3 - cost * 0.3;
    if (view === 'cheap') v = -cost * 4 + (t.includes('deal') ? 1 : 0);
    v += (i === 0 ? 0.05 : 0);
    if (v > bv) {
      bv = v; best = i;
      why = view === 'prudent' ? 'the safest and cheapest course' : view === 'popular' ? 'what the public wants to see' : view === 'tough' ? 'it shows strength' : view === 'bold' ? 'it moves the country forward' : 'it costs us least';
    }
  });
  return best >= 0 ? { idx: best, why } : null;
}

/** Loyalty in words. */
export const loyaltyLabel = (l: number) => (l >= 75 ? 'Devoted' : l >= 55 ? 'Loyal' : l >= 40 ? 'Wavering' : l >= 25 ? 'Disgruntled' : 'Plotting');
