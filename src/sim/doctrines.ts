/**
 * National doctrines: three standing choices (economy, military, foreign policy) that give a country its
 * identity. Every option has an upside and a downside, shown in plain numbers. Changing one is a reform:
 * it costs money and cannot be repeated for a year.
 */
import { politicsEff, politicsKey } from './domestic';
import { clamp } from './util';
import type { Country, GameState } from './types';
import { fund } from './actions';
import { logEvent } from './log';
import { cabinetEff, cabinetKey } from './cabinet';

export interface Eff {
  tfp?: number;      // productivity growth, points per year (0.005 = +0.5%/yr)
  stab?: number;     // stability target
  cost?: number;     // multiplier on army running costs (1 = normal)
  manpower?: number; // multiplier on available manpower
  off?: number;      // multiplier on offensive power
  def?: number;      // multiplier on defensive power
  accept?: number;   // how readily others accept your treaty proposals (score points)
  deter?: number;    // multiplier on AI appetite for attacking you
  ops?: number;      // covert operation success chance (points)
  rep?: number;      // reputation drift per year
  infra?: number;    // infrastructure points per year
  milTech?: number;  // military tech points per year
}
export interface Doctrine { id: string; slot: 'eco' | 'mil' | 'dip'; icon: string; title: string; pros: string[]; cons: string[]; eff: Eff }

export const DOCTRINES: Doctrine[] = [
  { id: 'market', slot: 'eco', icon: '🏦', title: 'Free Market', pros: ['Productivity +0.6% a year'], cons: ['Stability −2 (inequality)'], eff: { tfp: 0.006, stab: -2 } },
  { id: 'state', slot: 'eco', icon: '🏭', title: 'State-Led Industry', pros: ['Infrastructure +2 a year', 'Productivity +0.2% a year'], cons: ['Reputation −1 a year (heavy-handed)'], eff: { infra: 2, tfp: 0.002, rep: -1 } },
  { id: 'welfare', slot: 'eco', icon: '🤲', title: 'Welfare State', pros: ['Stability +5'], cons: ['Productivity −0.4% a year'], eff: { stab: 5, tfp: -0.004 } },
  { id: 'export', slot: 'eco', icon: '🚢', title: 'Export Powerhouse', pros: ['Productivity +0.4% a year', 'Reputation +1 a year'], cons: ['Stability −1 (exposed to world shocks)'], eff: { tfp: 0.004, rep: 1, stab: -1 } },

  { id: 'professional', slot: 'mil', icon: '🎖', title: 'Professional Army', pros: ['Military tech +1 a year'], cons: ['Army costs +15%', 'Less manpower (−10%)'], eff: { milTech: 1, cost: 1.15, manpower: 0.9 } },
  { id: 'conscript', slot: 'mil', icon: '🪖', title: 'Mass Conscription', pros: ['Manpower +15%', 'Army costs −12%'], cons: ['Stability −2', 'Offensive power −5%'], eff: { manpower: 1.15, cost: 0.88, stab: -2, off: 0.95 } },
  { id: 'defensive', slot: 'mil', icon: '🛡', title: 'Territorial Defence', pros: ['Defensive power +12%', 'Enemies think twice (−12% attack appetite)'], cons: ['Offensive power −10%'], eff: { def: 1.12, off: 0.9, deter: 0.88 } },
  { id: 'expeditionary', slot: 'mil', icon: '⚔', title: 'Expeditionary Force', pros: ['Offensive power +10%', 'Military tech +0.5 a year'], cons: ['Army costs +10%', 'Reputation −1 a year'], eff: { off: 1.1, cost: 1.1, rep: -1, milTech: 0.5 } },

  { id: 'bloc', slot: 'dip', icon: '🤝', title: 'Alliance Builder', pros: ['Treaties accepted far more easily (+0.12)', 'Reputation +1 a year'], cons: ['Enemies of your friends dislike you (stability −1)'], eff: { accept: 0.12, rep: 1, stab: -1 } },
  { id: 'neutral', slot: 'dip', icon: '🕊', title: 'Non-Aligned', pros: ['Stability +2', 'Reputation +2 a year', 'AI attack appetite −8%'], cons: ['Treaties harder to get (−0.06)'], eff: { stab: 2, rep: 2, deter: 0.92, accept: -0.06 } },
  { id: 'isolation', slot: 'dip', icon: '🏰', title: 'Fortress State', pros: ['Stability +3', 'Defensive power +6%'], cons: ['Productivity −0.4% a year', 'Treaties harder (−0.1)'], eff: { stab: 3, def: 1.06, tfp: -0.004, accept: -0.1 } },
  { id: 'interventionist', slot: 'dip', icon: '🕵', title: 'Great-Power Games', pros: ['Covert operations +12% success', 'Offensive power +3%'], cons: ['Reputation −2 a year'], eff: { ops: 0.12, off: 1.03, rep: -2 } },
];
export const doctrineById = (id: string) => DOCTRINES.find((d) => d.id === id)!;
export const slotOptions = (slot: Doctrine['slot']) => DOCTRINES.filter((d) => d.slot === slot);
export const SLOT_LABEL: Record<Doctrine['slot'], string> = { eco: 'Economy', mil: 'Military', dip: 'Foreign policy' };
export const REFORM_COOLDOWN = 52;
export const REFORM_COST = 0.005;
export const REFORM_PC = 10;

/** Countries that never chose have no doctrine: their numbers are the calibrated baseline. */
export function doctrineOf(c: Country): { eco: string; mil: string; dip: string; changed: number } {
  return c.doctrine ?? { eco: '', mil: '', dip: '', changed: -9999 };
}

const cache = new WeakMap<object, { key: string; eff: Required<Eff> }>();
const ONE: Required<Eff> = { tfp: 0, stab: 0, cost: 1, manpower: 1, off: 1, def: 1, accept: 0, deter: 1, ops: 0, rep: 0, infra: 0, milTech: 0 };
/** Combined effect of a country's three doctrines. */
export function mods(c: Country): Required<Eff> {
  const d = doctorOf(c);
  const key = `${d.eco}|${d.mil}|${d.dip}|${c.cabinet ? cabinetKey(c) : ''}|${politicsKey(c)}`;
  const hit = cache.get(c);
  if (hit && hit.key === key) return hit.eff;
  const out = { ...ONE };
  for (const id of [d.eco, d.mil, d.dip]) {
    if (!id) continue;
    const e = doctrineById(id).eff;
    out.tfp += e.tfp ?? 0; out.stab += e.stab ?? 0; out.accept += e.accept ?? 0; out.ops += e.ops ?? 0; out.rep += e.rep ?? 0; out.infra += e.infra ?? 0; out.milTech += e.milTech ?? 0;
    out.cost *= e.cost ?? 1; out.manpower *= e.manpower ?? 1; out.off *= e.off ?? 1; out.def *= e.def ?? 1; out.deter *= e.deter ?? 1;
  }
  for (const e of c.politics ? [politicsEff(c)] : []) {
    out.tfp += e.tfp ?? 0; out.stab += e.stab ?? 0; out.accept += e.accept ?? 0; out.ops += e.ops ?? 0; out.rep += e.rep ?? 0; out.milTech += e.milTech ?? 0; out.infra += e.infra ?? 0;
    out.cost *= e.cost ?? 1; out.off *= e.off ?? 1; out.def *= e.def ?? 1; out.deter *= e.deter ?? 1; out.manpower *= e.manpower ?? 1;
  }
  if (c.cabinet?.length) {
    const e = cabinetEff(c);
    out.tfp += e.tfp ?? 0; out.stab += e.stab ?? 0; out.accept += e.accept ?? 0; out.ops += e.ops ?? 0; out.rep += e.rep ?? 0; out.milTech += e.milTech ?? 0;
    out.cost *= e.cost ?? 1; out.off *= e.off ?? 1; out.def *= e.def ?? 1; out.deter *= e.deter ?? 1;
  }
  cache.set(c, { key, eff: out });
  return out;
}
const doctorOf = doctrineOf;

export function setDoctrine(s: GameState, cid: number, slot: Doctrine['slot'], id: string): { ok: boolean; message: string } {
  const c = s.countries[cid];
  const d = id ? doctrineById(id) : null;
  if (id && (!d || d.slot !== slot)) return { ok: false, message: 'Unknown doctrine' };
  const cur = doctrineOf(c);
  if (cur[slot] === id) return { ok: false, message: 'Already your doctrine' };
  if (s.tick - cur.changed < REFORM_COOLDOWN && cur.changed > -9000) return { ok: false, message: `Reform fatigue: wait ${REFORM_COOLDOWN - (s.tick - cur.changed)} more weeks before changing doctrine again` };
  if (c.politics && c.politics.pc < REFORM_PC) return { ok: false, message: `A reform needs ${REFORM_PC} political capital (you have ${Math.floor(c.politics.pc)})` };
  const f = fund(s, cid, REFORM_COST * c.eco.gdp);
  if (!f.ok) return f;
  if (c.politics) c.politics.pc -= REFORM_PC;
  c.doctrine = { ...cur, [slot]: id, changed: s.tick };
  c.eco.stability = clamp(c.eco.stability - 1, 0, 100); // reforms are disruptive
  if (d && cid === s.player) logEvent(s, `${d.icon} New ${SLOT_LABEL[slot].toLowerCase()} doctrine: ${d.title}.`, 'econ', [cid]);
  return { ok: true, message: d ? `${d.title} adopted.` : 'Doctrine dropped.' };
}

/** Weekly drift effects: reputation, infrastructure, military technology. */
export function stepDoctrines(s: GameState) {
  for (const c of s.countries) {
    if (!c.alive) continue;
    const m = mods(c);
    if (m.rep) c.reputation = clamp(c.reputation + m.rep / 52, 0, 100);
    if (m.infra) c.eco.infra = clamp(c.eco.infra + m.infra / 52, 5, 100);
    if (m.milTech) c.mil.milTech = clamp(c.mil.milTech + m.milTech / 52, 0, 110);
  }
}
