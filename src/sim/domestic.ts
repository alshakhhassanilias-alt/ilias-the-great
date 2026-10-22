/**
 * Domestic politics: the game inside your own country.
 *
 * Six factions (unions, business, the military, nationalists, liberals, the regions) each have a share of the
 * population (seats in parliament in a democracy), a clout (who really matters: the army in a junta, voters in a
 * democracy) and a mood that follows what you do: the budget, the economy, wars, the laws you pass and the
 * promises you keep or break. Their mood feeds stability, approval and elections. Happy factions give you
 * perks; furious ones strike, riot, move their money abroad or plot a coup.
 *
 * Political capital (PC) is the scarce currency of power: it trickles in each week (faster when you are popular
 * and your cabinet is loyal) and you spend it on laws, decrees, whipping votes and crisis responses. You can never
 * do everything: every few months you must choose what to spend it on.
 *
 * Laws go to a parliamentary vote in a democracy (you see the forecast, faction by faction, and can whip votes
 * with PC), are rubber-stamped with a little help in a hybrid regime, and are simply decreed in an autocracy,
 * at a higher price and with a cost to legitimacy. Only the player has politics; AI countries are unaffected.
 */
import { clamp, keyOf } from './util';
import { hash01, nextRand } from './rng';
import { logEvent } from './log';
import { nationalName } from './names';
import { avgLoyalty } from './cabinet';
import { isAtWar, getRelation } from './relations';
import { setBudget } from './actions';
import type { Eff } from './doctrines';
import type { Budget, Country, Faction, FactionId, GameState, InboxItem, Politics } from './types';

export const FACTIONS: { id: FactionId; short: string; name: string; icon: string; people: string; wants: string; color: string }[] = [
  { id: 'labour', short: 'Unions', name: 'Unions & Workers', icon: '🛠', people: 'union leader', wants: 'jobs, public services, low consumer taxes', color: '#d0573f' },
  { id: 'business', short: 'Business', name: 'Business & Finance', icon: '💼', people: 'business federation chief', wants: 'growth, low taxes, open markets, stable prices', color: '#3f8fd0' },
  { id: 'military', short: 'Military', name: 'The Military', icon: '🎖', people: 'chief of the general staff', wants: 'a bigger defence budget, victories, respect', color: '#7b8a3a' },
  { id: 'nationalists', short: 'Nationalists', name: 'Nationalists', icon: '🚩', people: 'nationalist firebrand', wants: 'strength, territory, a hard line abroad', color: '#a33a52' },
  { id: 'liberals', short: 'Liberals', name: 'Liberals & Civil Society', icon: '🕊', people: 'civil-rights campaigner', wants: 'freedoms, a good name abroad, peace', color: '#4fae8a' },
  { id: 'regions', short: 'Regions', name: 'Regions & Farmers', icon: '🌾', people: 'regional governor', wants: 'roads, farms, energy and food security', color: '#c9a24a' },
];
export const factionMeta = (id: FactionId) => FACTIONS.find((f) => f.id === id)!;
export const free = (c: Country) => c.gov === 'D' || c.gov === 'F';

/** How much each faction counts, by regime. */
export function clout(c: Country, f: FactionId): number {
  const auto = c.gov === 'A' || c.gov === 'C' || c.gov === 'M';
  const t: Record<FactionId, [number, number]> = { labour: [1, 0.8], business: [1.1, 1.3], military: [0.6, 2], nationalists: [0.9, 1], liberals: [1.1, 0.4], regions: [0.9, 0.8] };
  return t[f][auto ? 1 : 0];
}

export const moodLabel = (m: number) => (m >= 82 ? 'Devoted' : m >= 66 ? 'Happy' : m >= 52 ? 'Content' : m >= 38 ? 'Uneasy' : m >= 24 ? 'Angry' : 'Furious');
export const moodColor = (m: number) => (m >= 66 ? 'var(--green)' : m >= 45 ? '#c9b54a' : m >= 28 ? 'var(--amber)' : 'var(--red)');

// ------------------------------------------------------------------ laws
export interface Law {
  id: string; cat: 'Economy' | 'Labour & welfare' | 'Security' | 'Society' | 'Foreign & trade' | 'Constitution';
  icon: string; title: string; desc: string; pc: number;
  /** how each faction feels about it while it is in force (mood points) */
  lean: Partial<Record<FactionId, number>>;
  eff: Eff; pros: string[]; cons: string[];
  /** one-off budget changes when passed (undone on repeal) */
  budget?: Partial<Record<keyof Budget, number>>;
  once?: (s: GameState, c: Country) => void;
  excl?: string;
  /** why it cannot be passed in this country right now (e.g. term limits need elections), or null */
  req?: (c: Country) => string | null;
}
export const LAWS: Law[] = [
  { id: 'min_wage', cat: 'Labour & welfare', icon: '💵', title: 'Minimum Wage Rise', desc: 'Lift the minimum wage by a fifth over two years.', pc: 18, lean: { labour: 18, business: -14, liberals: 4 }, eff: { stab: 2, tfp: -0.001 }, pros: ['Stability +2'], cons: ['Productivity −0.1%/yr'] },
  { id: 'healthcare', cat: 'Labour & welfare', icon: '🏥', title: 'Universal Healthcare', desc: 'Free care at the point of use, paid for by the state.', pc: 26, lean: { labour: 14, liberals: 10, regions: 6, business: -10 }, eff: { stab: 3 }, budget: { social: 0.01 }, pros: ['Stability +3'], cons: ['Public spending +1% of GDP'] },
  { id: 'pension_age', cat: 'Labour & welfare', icon: '👴', title: 'Raise the Retirement Age', desc: 'Work two more years before the state pension starts.', pc: 24, lean: { business: 12, labour: -18, regions: -6 }, eff: { tfp: 0.001, stab: -1 }, budget: { social: -0.008 }, pros: ['Public spending −0.8% of GDP', 'Productivity +0.1%/yr'], cons: ['Stability −1'] },
  { id: 'flat_tax', cat: 'Economy', icon: '📉', title: 'Flat Tax', desc: 'One low income-tax rate for everyone.', pc: 22, lean: { business: 18, labour: -14, liberals: -3 }, eff: { tfp: 0.002 }, budget: { taxIncome: -0.02 }, pros: ['Productivity +0.2%/yr'], cons: ['Income tax −2 points (less revenue)'], excl: 'wealth_tax' },
  { id: 'wealth_tax', cat: 'Economy', icon: '🏦', title: 'Wealth & Windfall Tax', desc: 'Tax the largest fortunes and record profits.', pc: 20, lean: { labour: 12, liberals: 4, business: -20 }, eff: { tfp: -0.0008 }, budget: { taxCorporate: 0.02 }, pros: ['Corporate tax +2 points (more revenue)'], cons: ['Productivity −0.08%/yr'], excl: 'flat_tax' },
  { id: 'privatise', cat: 'Economy', icon: '🏷', title: 'Privatise State Companies', desc: 'Sell the state airline, ports and telecoms.', pc: 24, lean: { business: 15, labour: -15, nationalists: -6, regions: -4 }, eff: { tfp: 0.0015 }, budget: { industry: -0.004 }, once: (_s, c) => { c.eco.cash += 0.02 * c.eco.gdp; }, pros: ['A one-off windfall of 2% of GDP', 'Productivity +0.15%/yr'], cons: ['State investment −0.4% of GDP'], excl: 'nationalise' },
  { id: 'nationalise', cat: 'Economy', icon: '🏭', title: 'Nationalise Energy', desc: 'Bring power plants and the grid under state control.', pc: 26, lean: { labour: 10, nationalists: 8, regions: 4, business: -20 }, eff: { stab: 1, tfp: -0.001 }, once: (_s, c) => { c.eco.energyCap *= 1.03; }, pros: ['Energy supply +3%', 'Stability +1'], cons: ['Productivity −0.1%/yr'], excl: 'privatise' },
  { id: 'tech_fund', cat: 'Economy', icon: '🔬', title: 'National Technology Fund', desc: 'A sovereign fund for chips, AI and biotech.', pc: 20, lean: { business: 8, liberals: 6, military: 3 }, eff: { tfp: 0.0015, milTech: 0.3 }, budget: { education: 0.004 }, pros: ['Productivity +0.15%/yr', 'Military tech +0.3/yr'], cons: ['Spending +0.4% of GDP'] },
  { id: 'farm_aid', cat: 'Economy', icon: '🚜', title: 'Farm Support Act', desc: 'Subsidies and cheap credit for farmers.', pc: 16, lean: { regions: 16, business: -5, liberals: -2 }, eff: { stab: 1 }, budget: { social: 0.003 }, once: (_s, c) => { c.eco.foodCap *= 1.04; }, pros: ['Food output +4%', 'Stability +1'], cons: ['Spending +0.3% of GDP'] },
  { id: 'green_deal', cat: 'Economy', icon: '🌱', title: 'Green Deal', desc: 'Close coal plants, build wind and solar, tax carbon.', pc: 24, lean: { liberals: 15, business: -4, regions: -9, labour: -3 }, eff: { rep: 2, tfp: -0.0005 }, once: (_s, c) => { c.eco.energyCap *= 1.02; }, pros: ['Reputation +2/yr', 'Energy +2% in the long run'], cons: ['Productivity −0.05%/yr'] },
  { id: 'conscription', cat: 'Security', icon: '🪖', title: 'Universal Conscription', desc: 'Every 18-year-old serves one year.', pc: 22, lean: { military: 15, nationalists: 10, liberals: -15, labour: -5 }, eff: { manpower: 1.25, stab: -1 }, pros: ['Manpower +25%'], cons: ['Stability −1'] },
  { id: 'police', cat: 'Security', icon: '🚔', title: 'Expanded Police Powers', desc: 'Surveillance, detention without charge, protest permits.', pc: 18, lean: { nationalists: 10, military: 5, liberals: -22 }, eff: { stab: 3, rep: -1, ops: 0.05 }, pros: ['Stability +3', 'Covert ops +5%'], cons: ['Reputation −1/yr'] },
  { id: 'war_powers', cat: 'Security', icon: '⚔', title: 'War Powers Act', desc: 'Let the government wage war without asking parliament.', pc: 20, lean: { military: 12, nationalists: 8, liberals: -14 }, eff: { off: 1.05, deter: 0.94 }, pros: ['Offensive power +5%', 'Enemies think twice (−6%)'], cons: [] },
  { id: 'border_wall', cat: 'Security', icon: '🧱', title: 'Border Fortification Act', desc: 'Walls, sensors and new garrisons along every frontier.', pc: 18, lean: { nationalists: 14, military: 8, liberals: -10, business: -3 }, eff: { def: 1.06 }, budget: { military: 0.002 }, pros: ['Defensive power +6%'], cons: ['Military budget +0.2% of GDP'] },
  { id: 'press_law', cat: 'Society', icon: '📺', title: 'Media Control Law', desc: 'A state regulator licenses every newspaper and channel.', pc: 20, lean: { nationalists: 4, military: 3, liberals: -26 }, eff: { stab: 2, rep: -2 }, pros: ['Stability +2', 'Scandals hurt less'], cons: ['Reputation −2/yr'] },
  { id: 'anti_graft', cat: 'Society', icon: '⚖', title: 'Anti-Corruption Agency', desc: 'An independent agency with power to prosecute ministers.', pc: 20, lean: { liberals: 15, business: 5, labour: 4 }, eff: { rep: 2, stab: 1, tfp: 0.0005 }, pros: ['Reputation +2/yr', 'Stability +1', 'Fewer cabinet scandals'], cons: ['Fixers in your cabinet hate it'], once: (_s, c) => { for (const m of c.cabinet ?? []) if (m.trait === 'fixer') m.loyalty = clamp(m.loyalty - 25, 0, 100); } },
  { id: 'autonomy', cat: 'Society', icon: '🏘', title: 'Regional Autonomy', desc: 'Regional parliaments with their own budgets.', pc: 20, lean: { regions: 15, liberals: 5, nationalists: -12 }, eff: { stab: 2 }, pros: ['Stability +2', 'Conquered regions integrate faster'], cons: [] },
  { id: 'migration', cat: 'Society', icon: '🧳', title: 'Open Labour Migration', desc: 'Fast work visas for doctors, engineers and builders.', pc: 20, lean: { business: 12, liberals: 10, nationalists: -20, labour: -4 }, eff: { tfp: 0.001 }, once: (_s, c) => { c.eco.laborForce *= 1.015; c.eco.pop *= 1.01; }, pros: ['Workforce +1.5%', 'Productivity +0.1%/yr'], cons: [] },
  { id: 'free_trade', cat: 'Foreign & trade', icon: '🚢', title: 'Free Trade Act', desc: 'Scrap tariffs and quotas unilaterally.', pc: 20, lean: { business: 15, liberals: 5, regions: -8, labour: -6 }, eff: { tfp: 0.0015, accept: 0.03 }, pros: ['Productivity +0.15%/yr', 'Treaties easier (+3 pts)'], cons: [] },
  { id: 'foreign_aid', cat: 'Foreign & trade', icon: '🤲', title: 'Foreign Aid Programme', desc: 'Give 0.3% of GDP a year to poorer countries.', pc: 14, lean: { liberals: 12, nationalists: -10 }, eff: { rep: 3, accept: 0.04 }, budget: { social: 0.003 }, pros: ['Reputation +3/yr', 'Treaties easier (+4 pts)'], cons: ['Spending +0.3% of GDP'] },
  // ------------------------------------------------ the constitution: how the country is governed
  { id: 'federal', cat: 'Constitution', icon: '🗺', title: 'Federal Constitution', desc: 'States with their own governments, and a senate of the regions in the capital.', pc: 28, lean: { regions: 16, liberals: 4, nationalists: -10 }, eff: { stab: 2 }, pros: ['Stability +2', 'Separatist and divided-country troubles lose their edge'], cons: ['Every other law costs 10% more capital (more veto players)'] },
  { id: 'central_bank', cat: 'Constitution', icon: '🏛', title: 'Independent Central Bank', desc: 'Interest rates and the money supply are taken out of the government\'s hands.', pc: 20, lean: { business: 12, labour: -4, nationalists: -2 }, eff: {}, pros: ['Inflation pressures fade twice as fast', 'Borrowing costs −0.5 points'], cons: ['You can no longer print money'] },
  { id: 'term_limits', cat: 'Constitution', icon: '⏳', title: 'Term Limits', desc: 'No head of government may serve more than two terms.', pc: 18, lean: { liberals: 12, nationalists: -4 }, eff: { rep: 1 }, pros: ['Reputation +1 a year', 'The wear of power on approval is cut by a third'], cons: ['Political capital −0.05 a week'], req: (c) => (free(c) ? null : 'Needs elections (a democracy or flawed democracy)') },
  { id: 'presidential', cat: 'Constitution', icon: '🦅', title: 'Presidential System', desc: 'A directly elected executive with wide powers; parliament checks it, but less.', pc: 26, lean: { nationalists: 6, business: 3, liberals: -8 }, eff: { rep: -0.5 }, pros: ['Laws cost 15% less capital', 'Political capital +0.08 a week'], cons: ['Reputation −0.5 a year', 'Liberals uneasy'] },
  { id: 'crown', cat: 'Constitution', icon: '👑', title: 'A Ceremonial Crown', desc: 'A monarch who reigns but does not rule: a symbol above party politics.', pc: 22, lean: { nationalists: 8, regions: 3, liberals: -4 }, eff: { stab: 3 }, pros: ['Stability +3'], cons: ['Liberals grumble'], req: (c) => (c.gov === 'M' ? 'You already have a crown that rules' : null) },
  { id: 'clerics', cat: 'Constitution', icon: '🕌', title: 'Council of Guardians', desc: 'A council of clerics vets every law and every candidate: the country becomes a theocracy.', pc: 30, lean: { nationalists: 8, military: 2, liberals: -18, business: -4 }, eff: { stab: 4, rep: -1.5, tfp: -0.001 }, pros: ['Stability +4: the faithful rally to the state'], cons: ['Reputation −1.5 a year', 'Productivity −0.1%/yr', 'Democracies distrust you'], req: (c) => (free(c) ? 'A free parliament would never pass it: change the system first (Politics → The system)' : null) },
];
export const lawById = (id: string) => LAWS.find((l) => l.id === id);
/** The name of a country's system, including what its constitution has made of it. */
export const govName = (c: Country, fallback: Record<string, string>) => (hasLaw(c, 'clerics') ? 'theocracy' : hasLaw(c, 'crown') && (c.gov === 'D' || c.gov === 'F') ? 'constitutional monarchy' : hasLaw(c, 'federal') && c.gov === 'D' ? 'federal democracy' : fallback[c.gov] ?? c.gov);
export const hasLaw = (c: Country, id: string) => !!c.politics?.laws.some((l) => l.id === id);

/** Laws in force plus perks from happy factions, as doctrine-style modifiers. */
export function politicsEff(c: Country): Eff {
  const out = { tfp: 0, stab: 0, accept: 0, ops: 0, rep: 0, milTech: 0, infra: 0, off: 1, def: 1, cost: 1, deter: 1, manpower: 1 };
  const P = c.politics;
  if (!P) return out;
  for (const l of P.laws) {
    const e = lawById(l.id)?.eff ?? {};
    out.tfp += e.tfp ?? 0; out.stab += e.stab ?? 0; out.accept += e.accept ?? 0; out.ops += e.ops ?? 0; out.rep += e.rep ?? 0; out.milTech += e.milTech ?? 0;
    out.off *= e.off ?? 1; out.def *= e.def ?? 1; out.cost *= e.cost ?? 1; out.deter *= e.deter ?? 1; out.manpower *= e.manpower ?? 1;
  }
  for (const f of P.factions) {
    if (f.mood < 75) continue;
    if (f.id === 'labour') out.tfp += 0.001;
    if (f.id === 'business') out.tfp += 0.0015;
    if (f.id === 'military') { out.def *= 1.04; out.off *= 1.02; }
    if (f.id === 'nationalists') out.deter *= 0.95;
    if (f.id === 'liberals') { out.rep += 1; out.accept += 0.03; }
    if (f.id === 'regions') out.infra += 1;
  }
  return out;
}
export const politicsKey = (c: Country) => (c.politics ? `${c.politics.laws.map((l) => l.id).join('.')}|${c.politics.factions.map((f) => (f.mood >= 75 ? 1 : 0)).join('')}` : '');

/** What each faction wants perks-wise, in plain words (for the UI). */
export const PERK: Record<FactionId, string> = {
  labour: 'Productivity +0.1%/yr', business: 'Productivity +0.15%/yr (investment)', military: 'Defence +4%, attack +2%', nationalists: 'Enemies 5% less keen to attack', liberals: 'Reputation +1/yr, treaties easier', regions: 'Infrastructure +1/yr',
};
export const REVOLT: Record<FactionId, string> = {
  labour: 'a general strike', business: 'capital flight', military: 'insubordination, or a coup', nationalists: 'riots', liberals: 'mass protests', regions: 'road blockades and tax revolts',
};

// ------------------------------------------------------------------ setup
/** Each major country starts with its own political landscape. */
const NATIONAL_POLITICS: Record<string, { sup?: Partial<Record<FactionId, number>>; mood?: Partial<Record<FactionId, number>> }> = {
  'United States of America': { sup: { nationalists: 22, liberals: 26, labour: 14, military: 9 }, mood: { liberals: -8, nationalists: -8 } },
  Russia: { sup: { military: 24, nationalists: 26, liberals: 5 }, mood: { liberals: -20, military: 6 } },
  China: { sup: { labour: 24, military: 20, business: 22, liberals: 4 }, mood: { liberals: -15 } },
  Israel: { sup: { nationalists: 28, military: 14, liberals: 22 }, mood: { liberals: -10, nationalists: 4 } },
  Iran: { sup: { nationalists: 28, military: 22, liberals: 12 }, mood: { liberals: -22, labour: -6 } },
  France: { sup: { labour: 26 }, mood: { labour: -12 } },
  Brazil: { sup: { regions: 24, labour: 26 }, mood: { regions: -4 } },
  Turkey: { sup: { nationalists: 26 }, mood: { liberals: -10, business: -8 } },
  Poland: { sup: { nationalists: 20, regions: 18 }, mood: { military: 6 } },
  Ukraine: { sup: { military: 16, nationalists: 20 }, mood: { military: 12, nationalists: 8 } },
  Nigeria: { sup: { regions: 26 }, mood: { regions: -8, labour: -6 } },
  Egypt: { sup: { military: 26 }, mood: { labour: -8, liberals: -12 } },
  India: { sup: { regions: 24, nationalists: 22 }, mood: { nationalists: 6 } },
  Japan: { sup: { business: 22, regions: 20 }, mood: { labour: -4 } },
  Germany: { sup: { labour: 22, liberals: 26, business: 20 }, mood: { business: -8 } },
  'United Kingdom': { sup: { liberals: 24, labour: 22 }, mood: { labour: -6, business: -4 } },
  'Saudi Arabia': { sup: { business: 22, military: 20, liberals: 4 }, mood: { liberals: -10 } },
  Mexico: { sup: { labour: 26, regions: 20 }, mood: { regions: -6 } },
  'South Korea': { sup: { business: 24, labour: 20 }, mood: { labour: -6 } },
  Indonesia: { sup: { regions: 24 }, mood: {} },
};

export function ensurePolitics(s: GameState) {
  const c = s.countries[s.player];
  if (!c || c.politics) return;
  const sup: Record<string, Record<FactionId, number>> = {
    D: { labour: 22, business: 16, military: 7, nationalists: 14, liberals: 24, regions: 17 },
    F: { labour: 20, business: 17, military: 12, nationalists: 20, liberals: 13, regions: 18 },
    X: { labour: 19, business: 15, military: 21, nationalists: 21, liberals: 8, regions: 16 },
  };
  const base = { ...sup[c.gov === 'D' ? 'D' : c.gov === 'F' ? 'F' : 'X'], ...(NATIONAL_POLITICS[keyOf(c)]?.sup ?? {}) };
  const moodAdj = NATIONAL_POLITICS[keyOf(c)]?.mood ?? {};
  const b = c.budget;
  const factions: Faction[] = FACTIONS.map((f, i) => {
    const jitter = (hash01('fac', c.id, i) - 0.5) * 6;
    return { id: f.id, support: Math.max(4, base[f.id] + jitter), mood: clamp(52 + (hash01('fm', c.id, i) - 0.5) * 16 + (moodAdj[f.id] ?? 0), 5, 95), mem: 0, leader: nationalName(c, hash01('fl', c.id, i), hash01('ff', c.id, i), hash01('fn', c.id, i), f.id === 'military' ? 'general' : 'politician') };
  });
  const tot = factions.reduce((t, f) => t + f.support, 0);
  for (const f of factions) f.support = (100 * f.support) / tot;
  c.politics = {
    pc: 40, laws: [], factions,
    base: { social: b.social, infra: b.infra, military: b.military, taxVat: b.taxVat, taxIncome: b.taxIncome, taxCorporate: b.taxCorporate, education: b.education, provinces: c.provinces.length },
    nextDemand: s.tick + 14, lastArc: s.tick, stab: 0, appr: 0,
  };
}

// ------------------------------------------------------------------ moods
export interface MoodPart { label: string; v: number }
/** Where a faction's mood is heading, and why. */
export function factionTarget(s: GameState, c: Country, f: Faction): { target: number; parts: MoodPart[] } {
  const P = c.politics!, e = c.eco, b = c.budget, B = P.base;
  const parts: MoodPart[] = [];
  const add = (label: string, v: number) => { if (Math.abs(v) >= 0.5) parts.push({ label, v }); };
  const war = isAtWar(s, c.id);
  const lostProv = c.provinces.length - B.provinces;
  switch (f.id) {
    case 'labour':
      add('Public services spending', clamp(260 * (b.social - B.social), -15, 15));
      add('Unemployment', clamp(-280 * Math.max(0, e.unemployment - e.uNat - 0.005), -22, 0));
      add('Consumption tax', clamp(-160 * (b.taxVat - B.taxVat), -12, 10));
      add('Wages & growth', clamp(250 * (e.growth - 0.02), -10, 8));
      add('Prices', clamp(-200 * Math.max(0, e.inflation - 0.04), -14, 0));
      break;
    case 'business':
      add('Corporate & income tax', clamp(-180 * (b.taxCorporate - B.taxCorporate) - 120 * (b.taxIncome - B.taxIncome), -16, 14));
      add('Growth', clamp(400 * (e.growth - 0.02), -16, 12));
      add('Inflation', clamp(-250 * Math.max(0, e.inflation - 0.035), -14, 0));
      add('Sanctions and lost markets', clamp(-60 * e.sanctionShare, -12, 0));
      add('Public debt', clamp(-12 * Math.max(0, e.debt / e.gdp - 0.9), -10, 0));
      add('War damage', war ? clamp(-30 * e.damage - 4, -14, 0) : 0);
      break;
    case 'military':
      add('Defence budget', clamp(900 * (b.military - B.military), -20, 18));
      add('Readiness', clamp(30 * (c.mil.readiness - 0.75), -8, 6));
      add(war ? 'At war' : 'Peace dividend talk', war ? 5 : 0);
      add('Exhaustion', clamp(-25 * c.mil.exhaustion, -10, 0));
      break;
    case 'nationalists':
      add(lostProv >= 0 ? 'Land won' : 'Land lost', clamp(lostProv >= 0 ? 3 * lostProv : 6 * lostProv, -30, 18));
      add('Hostile neighbours unpunished', s.rival >= 0 && getRelation(s, c.id, s.rival) < -40 && !isAtWar(s, s.rival) ? -3 : 0);
      add('National pride (stability)', clamp((e.stability - 55) * 0.15, -6, 5));
      break;
    case 'liberals':
      add('Reputation abroad', clamp((c.reputation - 55) * 0.4, -14, 10));
      add(war ? 'War' : 'Peace', war ? -6 : 3);
      add('Democracy', c.gov === 'D' ? 4 : c.gov === 'F' ? -2 : -8);
      break;
    case 'regions':
      add('Infrastructure spending', clamp(500 * (b.infra - B.infra), -12, 12));
      add('Food and energy shortages', clamp(-60 * e.foodUnmet - 50 * e.energyUnmet, -18, 0));
      add('Occupied & restless regions', clamp(-40 * e.occupation, -10, 0));
      add('Stability at home', clamp((e.stability - 55) * 0.12, -6, 4));
      break;
  }
  // favours are forgotten quickly, grievances slowly: a law's pull fades as people get used to it
  for (const l of P.laws) {
    const v = lawById(l.id)?.lean[f.id] ?? 0;
    if (!v) continue;
    const age = (s.tick - l.since) / 52;
    add(`Law: ${lawById(l.id)!.title}`, v * (v > 0 ? 0.3 + 0.7 * Math.exp(-age / 1.2) : 0.6 + 0.4 * Math.exp(-age / 3)));
  }
  // rising expectations: the longer you govern, the more every faction expects
  const years = s.legacy?.status === 'office' ? (s.tick - s.legacy.termStart) / 52 : s.tick / 52;
  add('Expectations rise over time', -Math.min(10, years * 2.2));
  if (Math.abs(f.mem) >= 0.5) add('Recent decisions', f.mem);
  const target = clamp(50 + parts.reduce((t, p) => t + p.v, 0), 0, 100);
  return { target, parts: parts.sort((a, b2) => Math.abs(b2.v) - Math.abs(a.v)) };
}

/** Change a faction's mood through a decision (remembered, fading over about a year). */
export function sway(c: Country, f: FactionId, v: number) {
  const x = c.politics?.factions.find((y) => y.id === f);
  if (!x) return;
  x.mem = clamp(x.mem + v, -40, 40);
  x.mood = clamp(x.mood + v * 0.35, 0, 100);
}
export function spendPC(c: Country, n: number) {
  const P = c.politics;
  if (!P || P.pc < n) return false;
  P.pc -= n;
  return true;
}
export const pcOf = (c: Country) => c.politics?.pc ?? 0;
/** Success builds political capital: a deal signed, an objective met, a war won. */
export function gainPC(s: GameState, n: number) {
  const P = s.countries[s.player]?.politics;
  if (P && (!s.legacy || s.legacy.status === 'office')) P.pc = clamp(P.pc + n, 0, 100);
}

/** Weekly income of political capital, and why. */
export function pcIncome(s: GameState, c: Country, appr: number): { v: number; parts: MoodPart[] } {
  const parts: MoodPart[] = [{ label: 'Base', v: 0.45 }];
  parts.push({ label: 'Public approval', v: clamp((appr - 45) / 45, -0.25, 0.45) });
  if (c.cabinet?.length) parts.push({ label: 'Cabinet loyalty', v: clamp((avgLoyalty(c) - 50) / 120, -0.15, 0.2) });
  const happy = c.politics?.factions.filter((f) => f.mood >= 60).length ?? 0;
  if (happy >= 3) parts.push({ label: `${happy} happy factions`, v: 0.05 * (happy - 2) });
  const L = s.legacy;
  if (L?.status === 'office' && s.tick - L.termStart < 26) parts.push({ label: 'Honeymoon after the vote', v: 0.3 });
  if (c.gov !== 'D') parts.push({ label: 'Unchecked power', v: 0.1 });
  if (hasLaw(c, 'presidential')) parts.push({ label: 'Presidential powers', v: 0.08 });
  if (hasLaw(c, 'term_limits')) parts.push({ label: 'Term limits', v: -0.05 });
  return { v: parts.reduce((t, p) => t + p.v, 0), parts };
}

// ------------------------------------------------------------------ parliament
export interface Forecast { yes: number; by: { id: FactionId; seats: number; p: number }[]; mode: 'vote' | 'rigged' | 'decree'; cost: number }
export function forecast(c: Country, law: Law, whip: number): Forecast {
  const P = c.politics!;
  const mode = c.gov === 'D' ? 'vote' : c.gov === 'F' ? 'rigged' : 'decree';
  const by = P.factions.map((f) => {
    const lean = law.lean[f.id] ?? 0;
    const p = 1 / (1 + Math.exp(-((f.mood - 50) / 13 + lean / 7)));
    return { id: f.id, seats: f.support, p };
  });
  let yes = by.reduce((t, x) => t + (x.seats / 100) * x.p, 0) + whip * 0.008 + (mode === 'rigged' ? 0.1 : 0);
  if (mode === 'decree') yes = 1;
  const cmult = (hasLaw(c, 'federal') && law.id !== 'federal' ? 1.1 : 1) * (hasLaw(c, 'presidential') && law.id !== 'presidential' ? 0.85 : 1);
  return { yes: clamp(yes, 0, 1), by, mode, cost: Math.round(law.pc * (mode === 'decree' ? 1.3 : 1) * cmult) };
}

function applyBudget(s: GameState, c: Country, law: Law, sign: 1 | -1) {
  for (const [k, v] of Object.entries(law.budget ?? {})) setBudget(s, c.id, k as keyof Budget, c.budget[k as keyof Budget] + sign * (v as number));
}

/** Put a law to parliament (or decree it). `whip` = extra PC spent to win votes. */
export function actPassLaw(s: GameState, id: string, whip = 0) {
  const c = s.countries[s.player];
  ensurePolitics(s);
  const P = c.politics!, law = lawById(id);
  if (!law) return { ok: false, message: 'No such law' };
  if (hasLaw(c, id)) return { ok: false, message: 'Already in force' };
  if (law.excl && hasLaw(c, law.excl)) return { ok: false, message: `Repeal the ${lawById(law.excl)!.title} first` };
  const why = law.req?.(c);
  if (why) return { ok: false, message: why };
  if (s.tick - (s.stats[`lawTry:${id}`] ?? -999) < 12) return { ok: false, message: 'Parliament rejected it recently: wait a few weeks' };
  const fc = forecast(c, law, whip);
  if (!spendPC(c, fc.cost + whip)) return { ok: false, message: `Needs ${fc.cost + whip} political capital (you have ${Math.floor(P.pc)})` };
  const share = fc.mode === 'decree' ? 1 : clamp(fc.yes + (nextRand(s) - 0.5) * 0.06, 0, 1);
  if (share < 0.5) {
    s.stats[`lawTry:${id}`] = s.tick;
    P.pc += Math.floor(fc.cost / 2); // half the capital is saved
    c.eco.stability = clamp(c.eco.stability - 1, 0, 100);
    logEvent(s, `🗳 DEFEAT IN PARLIAMENT: the ${law.title} fails ${Math.round(share * 100)}% to ${Math.round((1 - share) * 100)}%.`, 'danger', [c.id], true);
    return { ok: false, message: `Defeated: ${Math.round(share * 100)}% voted yes. Half the political capital is lost.` };
  }
  P.laws.push({ id, since: s.tick });
  applyBudget(s, c, law, 1);
  law.once?.(s, c);
  for (const [f, v] of Object.entries(law.lean)) { const x = P.factions.find((y) => y.id === f); if (x) x.mood = clamp(x.mood + (v as number) * 0.4, 0, 100); }
  if (fc.mode === 'decree') { sway(c, 'liberals', -5); c.eco.stability = clamp(c.eco.stability - 1, 0, 100); }
  const how = fc.mode === 'vote' ? `passes parliament ${Math.round(share * 100)}% to ${Math.round((1 - share) * 100)}%` : fc.mode === 'rigged' ? `sails through a loyal parliament (${Math.round(share * 100)}%)` : 'is signed into force by decree';
  logEvent(s, `📜 ${law.title} ${how}.`, 'info', [c.id], true);
  return { ok: true, message: `${law.title} is law.` };
}

export function actRepealLaw(s: GameState, id: string) {
  const c = s.countries[s.player];
  const P = c.politics, law = lawById(id);
  if (!P || !law || !hasLaw(c, id)) return { ok: false, message: 'Not in force' };
  const cost = Math.round(law.pc / 2);
  if (!spendPC(c, cost)) return { ok: false, message: `Needs ${cost} political capital` };
  P.laws = P.laws.filter((l) => l.id !== id);
  applyBudget(s, c, law, -1);
  for (const [f, v] of Object.entries(law.lean)) sway(c, f as FactionId, -(v as number) * 0.3);
  logEvent(s, `📜 The ${law.title} is repealed.`, 'info', [c.id], true);
  return { ok: true, message: `${law.title} repealed.` };
}

// ------------------------------------------------------------------ the weekly step
function queue(s: GameState, id: string, data: Record<string, number>, ttl: number, urgent: boolean, quiet = false) {
  if (s.inbox.length >= 4 || s.inbox.some((x) => x.id === id)) return false;
  const it: InboxItem = { uid: s.nextInbox++, id, tick: s.tick, expires: s.tick + ttl, urgent, data };
  s.inbox.push(it);
  // a routine faction demand does not hold back the other stories the world has for you
  if (!quiet) s.lastEventTick = s.tick;
  return true;
}

export function stepPolitics(s: GameState, appr: number) {
  const c = s.countries[s.player];
  if (!c?.alive) return;
  ensurePolitics(s);
  const P = c.politics!;
  const inPower = !s.legacy || s.legacy.status === 'office';
  if (inPower) P.pc = clamp(P.pc + pcIncome(s, c, appr).v, 0, 100);
  let st = 0, ap = 0;
  for (const f of P.factions) {
    const { target } = factionTarget(s, c, f);
    f.mood = clamp(f.mood + (target - f.mood) * 0.06, 0, 100);
    f.mem *= 0.985;
    st += (f.support / 100) * clout(c, f.id) * (f.mood - 50) * 0.3;
    ap += (f.support / 100) * (f.mood - 50) * 0.3;
  }
  P.stab = clamp(st, -14, 10);
  P.appr = clamp(ap, -12, 10);
  if (!inPower) return;
  // a faction in revolt hurts every week until it ends
  const U = P.unrest;
  if (U && s.tick < U.until) {
    if (U.f === 'labour') c.eco.tfp *= 0.9993;
    if (U.f === 'business') c.eco.capital *= 0.9992;
    if (U.f === 'nationalists' || U.f === 'liberals') c.eco.stability = clamp(c.eco.stability - 0.3, 0, 100);
    if (U.f === 'liberals') c.reputation = clamp(c.reputation - 0.05, 0, 100);
    if (U.f === 'regions') { c.eco.stability = clamp(c.eco.stability - 0.2, 0, 100); c.eco.foodCap *= 0.9995; }
    if (U.f === 'military') c.mil.readiness = clamp(c.mil.readiness - 0.006, 0.2, 1);
  } else if (U) P.unrest = undefined;
  // demands from the unhappiest faction
  if (s.tick >= P.nextDemand) {
    // the unhappiest faction speaks up: never the same one twice in a row, and each at most once a year
    const worst = [...P.factions].sort((a, b) => a.mood - b.mood).find((f) => P.factions.indexOf(f) !== s.stats.lastDemandF && s.tick - (s.stats[`facAt:${f.id}`] ?? -999) >= 52);
    P.nextDemand = s.tick + 60 + Math.floor(nextRand(s) * 30);
    if (worst && worst.mood < 44) {
      const fi = P.factions.indexOf(worst);
      // they remember how you answered last time (1 gave in, 2 a smaller deal, 3 refused, 0 ignored)
      const prev = s.stats[`facAns:${worst.id}`] ?? -1;
      if (queue(s, 'fac_demand', { f: fi, k: Math.floor(nextRand(s) * 2), prev }, 16, false, true)) { s.stats.lastDemandF = fi; s.stats[`facAt:${worst.id}`] = s.tick; }
    }
  }
  // a furious faction rises up
  if (!P.unrest) {
    const furious = P.factions.filter((f) => f.mood < 24 && f.support * clout(c, f.id) > 8);
    // the same faction does not rise up again within a year
    const f0 = furious.find((f) => s.tick - (s.stats[`unrestAt:${f.id}`] ?? -999) >= 52);
    if (f0 && nextRand(s) < 0.04 && queue(s, 'fac_unrest', { f: P.factions.indexOf(f0) }, 10, true)) s.stats[`unrestAt:${f0.id}`] = s.tick;
  }
}

/** One-time "start of the game" population (used by tests and saves made before politics existed). */
export const factionOf = (c: Country, id: FactionId) => c.politics?.factions.find((f) => f.id === id);
void hash01;
