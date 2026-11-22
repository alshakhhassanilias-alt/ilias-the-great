/**
 * A 2021 start: the world before the wars of 2022–2024. The game's data describe 2024; this rewinds it three years:
 *
 * - economies in the dollars of 2021 (the yen and the lira were stronger, the boom years in India and the US had not
 *   happened yet), the debts that went with them
 * - armies before the mobilisations: Ukraine at peacetime strength, Russia, Poland and Israel smaller
 * - Finland and Sweden outside NATO; BRICS still the original five
 * - Russia and Belarus treated by the West as rivals, not yet as enemies
 * - the tail of the pandemic still on
 */
import type { GameState } from './types';
import { NAME_TO_ID } from './relations';
import { touchTreaties } from './relations';

/** 2021 nominal GDP as a share of 2024's (IMF World Economic Outlook, rounded). Countries not listed: 0.88. */
const GDP_2021: Record<string, number> = {
  'United States of America': 0.81, China: 0.95, Japan: 1.25, Germany: 0.92, India: 0.81, 'United Kingdom': 0.86, France: 0.94,
  Italy: 0.92, Canada: 0.89, Brazil: 0.77, Russia: 0.85, 'South Korea': 0.97, Australia: 0.92, Mexico: 0.71, Spain: 0.84,
  Indonesia: 0.85, Netherlands: 0.84, 'Saudi Arabia': 0.79, Turkey: 0.62, Switzerland: 0.85, Poland: 0.75, Taiwan: 0.96,
  Argentina: 0.78, Sweden: 1.05, Belgium: 0.91, Ireland: 0.88, Israel: 0.91, Thailand: 0.96, Norway: 1.02,
  'United Arab Emirates': 0.78, Nigeria: 1.6, Egypt: 1.08, Ukraine: 1.05, Vietnam: 0.79, Philippines: 0.85, Malaysia: 0.88,
  'South Africa': 1.05, Colombia: 0.76, Chile: 0.97, Kazakhstan: 0.69, Pakistan: 0.95, Bangladesh: 0.92, Iran: 0.9,
  Qatar: 0.81, Denmark: 0.9, Singapore: 0.8, Austria: 0.9, 'New Zealand': 0.9, Peru: 0.8, Ethiopia: 0.7, Kenya: 0.9,
};
/** 2021 armies as a share of 2024's */
const TROOPS_2021: Record<string, number> = { Ukraine: 0.3, Russia: 0.75, Poland: 0.75, Israel: 0.85, Belarus: 0.9, Finland: 0.9 };
const LEFT_NATO = ['Finland', 'Sweden'];
const LEFT_BRICS = ['Iran', 'Egypt', 'Ethiopia', 'United Arab Emirates'];

export function rewindTo2021(s: GameState) {
  for (const c of s.countries) {
    if (!c.alive) continue;
    const r = GDP_2021[c.name] ?? 0.88;
    const e = c.eco;
    // the economy is the same size in real terms; it is worth less (or more) in the dollars of the day
    e.price *= r; e.gdp *= r; e.potential *= 1; e.debt *= r; e.cash *= r; e.reserves *= r; e.revenue *= r; e.spending *= r; e.interest *= r;
    c.baseline.gdp = e.gdp;
    const t = TROOPS_2021[c.name];
    if (t) { c.mil.troops *= t; c.mil.equipArmy *= 0.5 + 0.5 * t; }
  }
  // alliances as they stood
  const nato = s.orgs?.find((o) => o.key === 'nato');
  const left = LEFT_NATO.map((n) => NAME_TO_ID[n]).filter((x) => x !== undefined);
  if (nato) {
    nato.members = nato.members.filter((m) => !left.includes(m));
    for (const x of left) for (const m of nato.members) { const k = x < m ? `${x}-${m}` : `${m}-${x}`; if (s.treaties[k]) s.treaties[k].alliance = false; }
  }
  const brics = s.orgs?.find((o) => o.key === 'brics');
  if (brics) brics.members = brics.members.filter((m) => !LEFT_BRICS.map((n) => NAME_TO_ID[n]).includes(m));
  s.orgVer = (s.orgVer ?? 0) + 1;
  touchTreaties(s);
  // before the invasion of Ukraine, the West's rivals were not yet its declared adversaries
  for (const n of ['Russia', 'Belarus']) { const c = s.countries[NAME_TO_ID[n]]; if (c) c.hostile = (c.hostile ?? 0) * 0.55; }
  // the pandemic's last wave
  s.crisis = { id: 'pandemic', start: 0, end: 30 };
}
