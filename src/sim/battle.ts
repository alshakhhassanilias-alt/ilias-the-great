/** Battle report: everything that decides one offensive, in plain numbers, for the clickable battle card. */
import type { Geo } from './geo';
import type { GameState } from './types';
import { airSuperiority, navalSuperiority } from './war';
import { quality, techMult } from './military';
import { fortBonus, levelOf } from './buildings';
import { mods } from './doctrines';
import { morale, warSupport } from './warsupport';

export interface BattleMod { label: string; pct: number; favours: 'attacker' | 'defender' }
export interface BattleReport {
  name: string; war: number; prov: number;
  attacker: number; defender: number;
  atkTroops: number; defTroops: number; odds: number;
  progress: number; etaWeeks: number | null; trend: 'advancing' | 'stalled' | 'pushed back';
  lossesAtk: number; lossesDef: number;
  mods: BattleMod[];
  role: 'attacker' | 'defender' | 'observer';
  /** attacker's supply on this front 0..1, whether the defenders are encircled, and both sides' war support */
  supply: number; pocket: boolean; wsA: number; wsD: number;
}

export function battleReport(s: GameState, geo: Geo, warId: number, prov: number, by: number): BattleReport | null {
  const w = s.wars.find((x) => x.id === warId);
  const fr = w?.fronts.find((f) => f.prov === prov && f.by === by);
  if (!w || !fr) return null;
  const A = s.countries[by], defId = s.owner[prov], D = s.countries[defId];
  const gp = geo.provinces[prov];
  const mods_: BattleMod[] = [];
  const add = (label: string, mult: number, favours: 'attacker' | 'defender') => { const pct = Math.round((mult - 1) * 100); if (Math.abs(pct) >= 2) mods_.push({ label, pct, favours }); };
  add(gp.terrain > 0.6 ? 'Mountains & rough ground' : gp.terrain > 0.35 ? 'Hills & forests' : 'Open plains', 1 + 0.9 * gp.terrain, 'defender');
  const fl = levelOf(s, prov, 'fort');
  if (fl) add(`Fortress level ${fl}`, fortBonus(s, prov), 'defender');
  if (prov === D.capital) add('Capital city', 1.25 / 1.0, 'defender');
  add('Fortifications & infrastructure', 1.15 + 0.2 * (D.eco.infra / 100), 'defender');
  const air = airSuperiority(A, D);
  if (Math.abs(air) > 0.05) mods_.push({ label: air > 0 ? `${A.name} rules the skies` : `${D.name} rules the skies`, pct: Math.round(Math.abs(0.18 * air) * 100), favours: air > 0 ? 'attacker' : 'defender' });
  const intel = 0.2 * (A.mil.intel - D.mil.intel);
  if (Math.abs(intel) > 0.02) mods_.push({ label: 'Intelligence', pct: Math.round(Math.abs(intel) * 100), favours: intel > 0 ? 'attacker' : 'defender' });
  if (fr.amphibious) mods_.push({ label: 'Landing from the sea', pct: Math.round((1 - (0.55 + 0.3 * Math.max(0, navalSuperiority(A, D)))) * 100), favours: 'defender' });
  const qa = quality(A.mil) * techMult(A.mil), qd = quality(D.mil) * techMult(D.mil);
  if (Math.abs(qa / qd - 1) > 0.04) mods_.push({ label: 'Equipment & technology', pct: Math.round(Math.abs(qa / qd - 1) * 100), favours: qa > qd ? 'attacker' : 'defender' });
  if (D.mil.nuclear && !A.mil.nuclear) mods_.push({ label: 'Fear of nuclear escalation', pct: 55, favours: 'defender' });
  const ma = mods(A).off, md = mods(D).def;
  if (Math.abs(ma - 1) > 0.01) add('Attacker doctrine', ma, ma > 1 ? 'attacker' : 'defender');
  if (Math.abs(md - 1) > 0.01) add('Defender doctrine', md, md > 1 ? 'defender' : 'attacker');
  const sup = fr.sup ?? 1;
  if (sup < 0.97) mods_.push({ label: `${fr.amphibious ? 'Supplied by sea' : 'Supply lines'}: ${Math.round(sup * 100)}%`, pct: Math.round((1 / Math.max(0.2, sup) - 1) * 100), favours: 'defender' });
  if (fr.pocket) mods_.push({ label: 'Defenders encircled: no supplies', pct: 82, favours: 'attacker' });
  const mr = morale(A) / morale(D);
  if (Math.abs(mr - 1) > 0.02) mods_.push({ label: `War support ${Math.round(warSupport(A) * 100)}% vs ${Math.round(warSupport(D) * 100)}%`, pct: Math.round(Math.abs(mr > 1 ? mr - 1 : 1 / mr - 1) * 100), favours: mr > 1 ? 'attacker' : 'defender' });
  const rate = fr.rate ?? 0;
  const mySide = w.attackers.includes(s.player) ? w.attackers : w.defenders.includes(s.player) ? w.defenders : null;
  const progress = Math.max(0, Math.min(1, fr.progress));
  return {
    name: `Battle of ${gp.name || D.name}`, war: warId, prov,
    attacker: by, defender: defId,
    atkTroops: fr.atk ?? 0, defTroops: fr.def ?? 0, odds: (fr.atk ?? 0) / Math.max(1, fr.def ?? 0),
    progress, etaWeeks: rate > 0.0005 ? Math.ceil((1 - progress) / rate) : null,
    trend: rate > 0.0005 ? 'advancing' : rate < -0.0005 ? 'pushed back' : 'stalled',
    lossesAtk: fr.la ?? 0, lossesDef: fr.ld ?? 0,
    mods: mods_,
    supply: sup, pocket: !!fr.pocket, wsA: warSupport(A), wsD: warSupport(D),
    role: mySide === null ? 'observer' : mySide.includes(by) ? 'attacker' : mySide.includes(defId) ? 'defender' : 'observer',
  };
}
