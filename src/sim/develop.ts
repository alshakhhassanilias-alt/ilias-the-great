/**
 * National development: what used to be five "quick investment" buttons that added a number until it stopped at 100.
 *
 *   - Four ladders of named projects (infrastructure, science, farms & water, industry). Each rung takes months to build,
 *     costs more than the last, and does something of its own beyond a bigger number: a port opens trade, fibre makes
 *     chips cheaper to expand, national laboratories speed up research, automation raises output but costs jobs.
 *     Some rungs need a rung of another ladder.
 *   - The energy mix: power stations of a chosen kind, as many as you like. Coal is cheap and quick and dirty; gas is
 *     cheap to build and costs fuel every week at the world price; nuclear is slow and dear, then nearly free (and very
 *     rarely, frightening); renewables are clean and need a smart grid to give their all; fusion comes at the end of
 *     the science ladder.
 *   - Building capacity is limited (two projects at a time, more with freight rail and industrial parks), so the order
 *     matters.
 * The old instant top-ups stay, and at the frontier (technology or infrastructure past 95) they turn into research
 * progress and productivity instead of nothing.
 */
import { clamp } from './util';
import { logEvent } from './log';
import { fund } from './actions';
import { hash01 } from './rng';
import { sway } from './domestic';
import { ensureIndustry } from './industry';
import type { Country, GameState } from './types';

export type TrackId = 'inf' | 'sci' | 'agr' | 'ind';
export type Source = 'coal' | 'gas' | 'nuclear' | 'renew' | 'fusion';
export interface DevProg { id: string; start: number; until: number; cost: number }
export interface Dev { done: string[]; prog: DevProg[]; /** power capacity you added, by kind */ mix: Partial<Record<Source, number>>; /** gas capacity: burns fuel every week */ fuel?: number;
  /** lasting multipliers on numbers the economy recomputes every week (trade, energy demand, labour force): economy.ts applies them */
  k?: { trade?: number; energy?: number; labour?: number } }

export interface Rung { id: string; track: TrackId; tier: number; icon: string; name: string; effect: string; needs?: string[]; apply: (s: GameState, c: Country) => void }

const chal = (c: Country, id: string, d: number) => { const x = c.chal?.[id]; if (x) x.sev = clamp(x.sev + d, 0, 100); };
const mul = (c: Country, k: 'capital' | 'foodCap' | 'tfp' | 'energyDemand' | 'tradeIndex' | 'laborForce', f: number) => {
  c.eco[k] *= f;
  // trade, energy demand and the labour force are recomputed by the economy every week: the effect has to be remembered
  // and applied there, or it lasts a week (economy.ts)
  const lasting = { tradeIndex: 'trade', energyDemand: 'energy', laborForce: 'labour' } as const;
  if (k in lasting) { const K = (ensureDev(c).k ??= {}); const f2 = lasting[k as keyof typeof lasting]; K[f2] = (K[f2] ?? 1) * f; }
};
const boost = (s: GameState, v: number) => { s.stats.apprBoost = (s.stats.apprBoost ?? 0) + v; };
const arid = (c: Country) => ['ME', 'AF', 'SA'].includes(c.region) || c.eco.foodCap < c.eco.foodDemand * 0.8;

export const TRACKS: { id: TrackId; icon: string; name: string; blurb: string }[] = [
  { id: 'inf', icon: '🛤', name: 'Infrastructure', blurb: 'Roads, rail, ports and networks: everything else runs on them.' },
  { id: 'sci', icon: '🔬', name: 'Science', blurb: 'Universities, laboratories and the frontier: faster research, new kinds of power.' },
  { id: 'agr', icon: '🌾', name: 'Farms & water', blurb: 'Food security, water, and an export trade in food.' },
  { id: 'ind', icon: '🏭', name: 'Industry', blurb: 'Factories, zones and automation: output, exports, and who gets the jobs.' },
];

export const RUNGS: Rung[] = [
  // ---- infrastructure
  { id: 'inf1', track: 'inf', tier: 1, icon: '🛣', name: 'Highway network', effect: 'Infrastructure +6 · the regions grateful (+4)', apply: (_s, c) => { c.eco.infra = clamp(c.eco.infra + 6, 5, 100); sway(c, 'regions', 4); } },
  { id: 'inf2', track: 'inf', tier: 2, icon: '🚂', name: 'Freight rail', effect: 'Infrastructure +6 · capital +2% · one more project at a time', apply: (_s, c) => { c.eco.infra = clamp(c.eco.infra + 6, 5, 100); mul(c, 'capital', 1.02); } },
  { id: 'inf3', track: 'inf', tier: 3, icon: '⚓', name: 'Deep-water ports', effect: 'Trade +4% · the economy more open to the world', apply: (_s, c) => { mul(c, 'tradeIndex', 1.04); c.eco.openness = clamp(c.eco.openness + 0.02, 0, 1.5); } },
  { id: 'inf4', track: 'inf', tier: 4, icon: '🌐', name: 'National fibre network', effect: 'Technology +3 · expanding chips and services 15% cheaper', apply: (_s, c) => { c.eco.tech = clamp(c.eco.tech + 3, 5, 100); } },
  { id: 'inf5', track: 'inf', tier: 5, icon: '🚄', name: 'High-speed rail', effect: 'Stability +3 · approval +3 · people move to the jobs (unemployment floor −0.4 pts)', apply: (s, c) => { c.eco.stability = clamp(c.eco.stability + 3, 0, 100); boost(s, 3); c.eco.uNat = Math.max(0.02, c.eco.uNat - 0.004); } },
  { id: 'inf6', track: 'inf', tier: 6, icon: '⚡', name: 'Smart grid', needs: ['sci3'], effect: 'Energy demand −5% · renewables give their full output', apply: (_s, c) => { mul(c, 'energyDemand', 0.95); const D = ensureDev(c), r = D.mix.renew ?? 0; c.eco.energyCap += r * 0.3 / 0.7; if (r) D.mix.renew = r / 0.7; } },
  { id: 'inf7', track: 'inf', tier: 7, icon: '🏙', name: 'Smart cities', needs: ['sci5'], effect: 'Productivity +2% · approval +4 · infrastructure +4', apply: (s, c) => { mul(c, 'tfp', 1.02); boost(s, 4); c.eco.infra = clamp(c.eco.infra + 4, 5, 100); } },
  // ---- science
  { id: 'sci1', track: 'sci', tier: 1, icon: '🎓', name: 'Research universities', effect: 'Technology +4 · fewer graduates leave (brain drain −10)', apply: (_s, c) => { c.eco.tech = clamp(c.eco.tech + 4, 5, 100); chal(c, 'braindrain', -10); } },
  { id: 'sci2', track: 'sci', tier: 2, icon: '🧪', name: 'National laboratories', effect: 'Research +15% · unlocks nuclear power', apply: () => undefined },
  { id: 'sci3', track: 'sci', tier: 3, icon: '🏢', name: 'Science parks', effect: 'Chips industry +0.6 level · renewables a third cheaper', apply: (_s, c) => { ensureIndustry(c).lv.tech += 0.6; } },
  { id: 'sci4', track: 'sci', tier: 4, icon: '🛡', name: 'Defence research agency', effect: 'Military technology +4 · intelligence +4 points', apply: (_s, c) => { c.mil.milTech = clamp(c.mil.milTech + 4, 0, 140); c.mil.intel = clamp(c.mil.intel + 0.04, 0, 1); } },
  { id: 'sci5', track: 'sci', tier: 5, icon: '🧬', name: 'Biotech cluster', effect: 'Productivity +1% · stability +2 · the ageing burden eases (−8)', apply: (_s, c) => { mul(c, 'tfp', 1.01); c.eco.stability = clamp(c.eco.stability + 2, 0, 100); chal(c, 'ageing', -8); } },
  { id: 'sci6', track: 'sci', tier: 6, icon: '⚛', name: 'Quantum computing centre', effect: 'Research +10% more · intelligence +5 points · military technology +3', apply: (_s, c) => { c.mil.intel = clamp(c.mil.intel + 0.05, 0, 1); c.mil.milTech = clamp(c.mil.milTech + 3, 0, 140); } },
  { id: 'sci7', track: 'sci', tier: 7, icon: '☀', name: 'Fusion programme', needs: ['inf6'], effect: 'Unlocks fusion power stations: vast, clean, no fuel', apply: () => undefined },
  // ---- farms & water
  { id: 'agr1', track: 'agr', tier: 1, icon: '💧', name: 'Irrigation canals', effect: 'Food +8% (+12% in a dry country) · water stress −6', apply: (_s, c) => { mul(c, 'foodCap', arid(c) ? 1.12 : 1.08); chal(c, 'water', -6); } },
  { id: 'agr2', track: 'agr', tier: 2, icon: '🧊', name: 'Cold chain & grain silos', effect: 'Food +5% · farming industry +0.3 level', apply: (_s, c) => { mul(c, 'foodCap', 1.05); ensureIndustry(c).lv.agri += 0.3; } },
  { id: 'agr3', track: 'agr', tier: 3, icon: '🌊', name: 'Desalination plants', effect: 'Food +6% · water stress −20 · energy demand +2%', apply: (_s, c) => { mul(c, 'foodCap', 1.06); chal(c, 'water', -20); mul(c, 'energyDemand', 1.02); } },
  { id: 'agr4', track: 'agr', tier: 4, icon: '🛰', name: 'Precision farming', effect: 'Food +6% · workers freed for other jobs (labour force +0.5%)', apply: (_s, c) => { mul(c, 'foodCap', 1.06); mul(c, 'laborForce', 1.005); } },
  { id: 'agr5', track: 'agr', tier: 5, icon: '🧺', name: 'Agri-food exporters', effect: 'Farming industry +0.8 level · trade +1%', apply: (_s, c) => { ensureIndustry(c).lv.agri += 0.8; mul(c, 'tradeIndex', 1.01); } },
  { id: 'agr6', track: 'agr', tier: 6, icon: '🏗', name: 'Vertical farms', needs: ['inf4'], effect: 'Food +10% · disasters hurt less (−8)', apply: (_s, c) => { mul(c, 'foodCap', 1.1); chal(c, 'disasters', -8); } },
  // ---- industry
  { id: 'ind1', track: 'ind', tier: 1, icon: '🏭', name: 'Industrial parks', effect: 'Capital +4% · one more project at a time', apply: (_s, c) => { mul(c, 'capital', 1.04); } },
  { id: 'ind2', track: 'ind', tier: 2, icon: '🏷', name: 'Special economic zones', effect: 'Capital +3% · more open to trade · business +6, unions −3', apply: (_s, c) => { mul(c, 'capital', 1.03); c.eco.openness = clamp(c.eco.openness + 0.02, 0, 1.5); sway(c, 'business', 6); sway(c, 'labour', -3); } },
  { id: 'ind3', track: 'ind', tier: 3, icon: '🧰', name: 'Vocational training', effect: 'Unemployment floor −0.5 pts · technology +2 · unions +4', apply: (_s, c) => { c.eco.uNat = Math.max(0.02, c.eco.uNat - 0.005); c.eco.tech = clamp(c.eco.tech + 2, 5, 100); sway(c, 'labour', 4); } },
  { id: 'ind4', track: 'ind', tier: 4, icon: '🤖', name: 'Automation drive', effect: 'Productivity +2% · but jobs go (unemployment floor +0.8 pts) · unions −8', apply: (_s, c) => { mul(c, 'tfp', 1.02); c.eco.uNat = Math.min(0.2, c.eco.uNat + 0.008); sway(c, 'labour', -8); } },
  { id: 'ind5', track: 'ind', tier: 5, icon: '📦', name: 'Export credit agency', effect: 'Trade +3% · manufacturing industry +0.5 level', apply: (_s, c) => { mul(c, 'tradeIndex', 1.03); ensureIndustry(c).lv.manuf += 0.5; } },
  { id: 'ind6', track: 'ind', tier: 6, icon: '🦾', name: 'Robotics & AI factories', needs: ['sci3'], effect: 'Productivity +2.5% · the ageing burden eases (−10)', apply: (_s, c) => { mul(c, 'tfp', 1.025); chal(c, 'ageing', -10); } },
];
export const rungById = (id: string) => RUNGS.find((r) => r.id === id);

export const SOURCES: { id: Source; icon: string; name: string; desc: string; needs?: string }[] = [
  { id: 'coal', icon: '🏭', name: 'Coal plant', desc: 'Cheapest and quickest. Smog, reputation −0.8, and the coal habit gets harder to break.' },
  { id: 'gas', icon: '🔥', name: 'Gas turbines', desc: 'Cheap and quick to build, but it burns fuel every week at the world gas price.' },
  { id: 'nuclear', icon: '☢', name: 'Nuclear reactor', desc: 'Dear and slow (a year and a half), then nearly free power for decades. Very rarely, an incident.', needs: 'sci2' },
  { id: 'renew', icon: '🌬', name: 'Wind & solar farm', desc: 'Clean, no fuel, reputation +0.6. Gives 70% of its rated power until you build a smart grid.' },
  { id: 'fusion', icon: '☀', name: 'Fusion plant', desc: 'The end of the science ladder: four times the power of a reactor, no fuel, no waste.', needs: 'sci7' },
];

export const ensureDev = (c: Country): Dev => (c.dev ??= { done: [], prog: [], mix: {} });
export const hasDev = (c: Country, id: string) => !!c.dev?.done.includes(id);
/** how many projects can be built at once */
export const devSlots = (c: Country) => 2 + (hasDev(c, 'inf2') ? 1 : 0) + (hasDev(c, 'ind1') ? 1 : 0);
/** research multiplier from the science ladder (used by research.ts) */
export const devResearch = (c: Country) => 1 + (hasDev(c, 'sci2') ? 0.15 : 0) + (hasDev(c, 'sci6') ? 0.1 : 0);
/** discount on expanding chips and services (fibre network) */
export const devSectorDiscount = (c: Country, sector: string) => (hasDev(c, 'inf4') && (sector === 'tech' || sector === 'services') ? 0.85 : 1);

/** what the next rung of a ladder is, what it costs, how long it takes, and anything that stands in the way */
export function nextRung(c: Country, track: TrackId): { rung: Rung | null; cost: number; weeks: number; why: string | null } {
  const D = ensureDev(c);
  const rung = RUNGS.find((r) => r.track === track && !D.done.includes(r.id)) ?? null;
  if (!rung) return { rung: null, cost: 0, weeks: 0, why: 'Every rung built' };
  const cost = (0.005 + 0.0025 * rung.tier) * c.eco.gdp;
  const weeks = 20 + 8 * rung.tier;
  let why: string | null = null;
  const missing = (rung.needs ?? []).filter((n) => !D.done.includes(n));
  if (D.prog.some((p) => p.id === rung.id)) why = 'Under construction';
  else if (missing.length) why = `Needs ${missing.map((n) => rungById(n)?.name ?? n).join(' and ')} first`;
  else if (D.prog.length >= devSlots(c)) why = `Building capacity full (${devSlots(c)} projects at a time)`;
  return { rung, cost, weeks, why };
}

/** a power station of a kind: what it costs, how long, how much power it adds, and what stands in the way */
export function stationOf(c: Country, src: Source): { cost: number; weeks: number; add: number; why: string | null } {
  const D = ensureDev(c), e = c.eco;
  const S = SOURCES.find((x) => x.id === src)!;
  const base = 0.08 * e.energyDemand;
  const k = { coal: [0.35, 20, 1], gas: [0.4, 24, 1], nuclear: [1.1, 78, 1.75], renew: [hasDev(c, 'sci3') ? 0.47 : 0.7, 30, hasDev(c, 'inf6') ? 1 : 0.7], fusion: [1.5, 52, 7] }[src];
  let why: string | null = null;
  if (S.needs && !D.done.includes(S.needs)) why = `Needs ${rungById(S.needs)?.name ?? S.needs} first`;
  else if (D.prog.length >= devSlots(c)) why = `Building capacity full (${devSlots(c)} projects at a time)`;
  return { cost: (k[0] / 100) * e.gdp, weeks: k[1], add: base * k[2], why };
}

export function actBuildRung(s: GameState, track: TrackId) {
  const c = s.countries[s.player];
  const x = nextRung(c, track);
  if (!x.rung || x.why) return { ok: false, message: x.why ?? 'Nothing to build' };
  const f = fund(s, c.id, x.cost, `Development: ${x.rung.name}`);
  if (!f.ok) return f;
  ensureDev(c).prog.push({ id: x.rung.id, start: s.tick, until: s.tick + x.weeks, cost: x.cost });
  return { ok: true, message: `${x.rung.icon} ${x.rung.name}: work begins, ready in ${x.weeks} weeks. ${f.message}` };
}
export function actBuildStation(s: GameState, src: Source) {
  const c = s.countries[s.player];
  const x = stationOf(c, src);
  if (x.why) return { ok: false, message: x.why };
  const S = SOURCES.find((y) => y.id === src)!;
  const f = fund(s, c.id, x.cost, `Power: ${S.name}`);
  if (!f.ok) return f;
  ensureDev(c).prog.push({ id: `pow:${src}`, start: s.tick, until: s.tick + x.weeks, cost: x.cost });
  return { ok: true, message: `${S.icon} A ${S.name.toLowerCase()} is under construction: on line in ${x.weeks} weeks. ${f.message}` };
}

function finish(s: GameState, c: Country, p: DevProg) {
  const D = ensureDev(c);
  if (p.id.startsWith('pow:')) {
    const src = p.id.slice(4) as Source;
    const add = stationOf(c, src).add;
    c.eco.energyCap += add;
    D.mix[src] = (D.mix[src] ?? 0) + add;
    if (src === 'gas') D.fuel = (D.fuel ?? 0) + add;
    if (src === 'coal') { chal(c, 'coal', 5); c.reputation = clamp(c.reputation - 0.8, 0, 100); }
    if (src === 'renew') { chal(c, 'coal', -3); c.reputation = clamp(c.reputation + 0.6, 0, 100); }
    const S = SOURCES.find((y) => y.id === src)!;
    logEvent(s, `${S.icon} A new ${S.name.toLowerCase()} comes on line: power supply +${((add / Math.max(1, c.eco.energyDemand)) * 100).toFixed(0)}% of demand.`, 'econ', [c.id], true);
    return;
  }
  const r = rungById(p.id);
  if (!r) return;
  r.apply(s, c);
  if (!D.done.includes(r.id)) D.done.push(r.id);
  logEvent(s, `${r.icon} ${r.name.toUpperCase()} COMPLETED: ${r.effect}.`, 'econ', [c.id], true, { big: r.tier >= 4 });
}

/** Weekly (the player): projects complete; gas burns fuel at the world price; reactors are, very rarely, a scare. */
export function stepDevelop(s: GameState) {
  const c = s.countries[s.player];
  const D = c?.dev;
  if (!c?.alive || !D) return;
  for (const p of [...D.prog]) if (s.tick >= p.until) { D.prog = D.prog.filter((x) => x !== p); finish(s, c, p); }
  if (D.fuel) c.eco.cash -= D.fuel * s.market.priceE * 0.35 * c.eco.price / 52; // a year's fuel is about a third of the plant's output value
  const nuc = D.mix.nuclear ?? 0;
  if (nuc > 0 && s.tick % 52 === 26 && hash01('nuke', c.id, s.tick, s.settings.seed) < 0.02 * Math.min(4, nuc / Math.max(1, 0.14 * c.eco.energyDemand))) {
    c.eco.stability = clamp(c.eco.stability - 4, 0, 100);
    c.reputation = clamp(c.reputation - 2, 0, 100);
    logEvent(s, `☢ An incident at one of ${c.name}'s reactors: a leak is contained, but the country is shaken.`, 'danger', [c.id], true, { big: true });
  }
}

/** The yearly fuel bill of your gas turbines, at today's price. */
export const fuelBill = (s: GameState, c: Country) => (c.dev?.fuel ?? 0) * s.market.priceE * 0.35 * c.eco.price;
