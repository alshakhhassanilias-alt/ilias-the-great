/**
 * National character: what makes one country play differently from another.
 *
 * TRAITS are permanent facts of geography, demography and economy (an oil state, an ageing society, a frontline
 * state, an island, a financial hub...). Each changes the rules a little: an oil state's budget rides on the oil
 * price, an ageing society loses workers every year, a frontline state defends harder.
 *
 * CHALLENGES are the long problems each country starts with (an insurgency, an inflation spiral, a pension
 * crisis, cartels, a property bubble, water running out...). Each has a severity (0..100) that drifts with the
 * country's situation and weighs on stability, productivity, prices or the army. The player answers them with
 * concrete responses: each costs political capital and/or money, takes effect at once or over years, and has a
 * side effect. AI countries answer theirs too, so the world's problems move.
 */
import { ENERGY_RATIO, FOOD_RATIO } from '../data/countryData';
import type { Country, GameState } from './types';
import { DT } from './types';
import { applyFx, type Fx } from './nations';
import { spendPC } from './domestic';
import { fund } from './actions';
import { logEvent } from './log';
import { hash01 } from './rng';
import { clamp, keyOf } from './util';
import { geoRefGet } from './geoRef';

// ------------------------------------------------------------------ traits
export interface TraitEff {
  tfp?: number; stab?: number; def?: number; deter?: number;
  /** change in borrowing cost (0.005 = +0.5 points) */
  rate?: number;
  /** 1: landlocked (war cuts its trade routes twice as hard) */
  trade?: number;
  /** labour force growth per year (−0.006 = −0.6%/yr) */
  labour?: number;
  /** how strongly state revenue follows the oil price (0.35: a 50% price rise lifts revenue 17.5%) */
  oil?: number;
  /** how strongly an energy price shock hits inflation (multiplier) */
  shock?: number;
  /** growth hit while at war or unstable (tourism) */
  fragile?: number;
}
export interface Trait { id: string; icon: string; title: string; blurb: string; effects: string[]; eff: TraitEff }

export const TRAITS: Record<string, Trait> = {
  petro: { id: 'petro', icon: '🛢', title: 'Petro-state', blurb: 'Oil and gas pay for the state.', effects: ['State revenue rises and falls with the oil price', 'Productivity −0.2% a year (other industries wither)'], eff: { oil: 0.4, tfp: -0.002 } },
  bread: { id: 'bread', icon: '🌾', title: 'Breadbasket', blurb: 'It feeds much of the world.', effects: ['Stability +2 (food is never short)', 'Food prices abroad are your leverage'], eff: { stab: 2 } },
  importer: { id: 'importer', icon: '⛽', title: 'Energy importer', blurb: 'Almost every barrel and cubic metre comes from abroad.', effects: ['Energy price shocks hit inflation 60% harder'], eff: { shock: 1.6 } },
  ageing: { id: 'ageing', icon: '👴', title: 'Ageing society', blurb: 'More pensioners every year, fewer workers.', effects: ['Workforce shrinks 0.6% a year', 'Borrowing 0.5 points cheaper (high savings)'], eff: { labour: -0.006, rate: -0.005 } },
  young: { id: 'young', icon: '👶', title: 'Youth bulge', blurb: 'Half the country is under twenty-five.', effects: ['Workforce grows 1% a year', 'Stability −3 unless growth creates jobs'], eff: { labour: 0.01 } },
  frontline: { id: 'frontline', icon: '🛡', title: 'Frontline state', blurb: 'It lives next to a power that threatens it.', effects: ['Defence +10%', 'Aggressors think twice (−8% attack appetite)'], eff: { def: 1.1, deter: 0.92 } },
  island: { id: 'island', icon: '🏝', title: 'Island nation', blurb: 'The sea is its moat and its highway.', effects: ['Defence +6% (invaders must come by sea)'], eff: { def: 1.06 } },
  landlocked: { id: 'landlocked', icon: '🏔', title: 'Landlocked', blurb: 'Every export crosses a neighbour first.', effects: ['War cuts its trade twice as hard (the routes run through neighbours)', 'Naval blockades cannot touch it'], eff: { trade: 1 } },
  chips: { id: 'chips', icon: '💾', title: 'Silicon shield', blurb: 'The world runs on its chips.', effects: ['Productivity +0.3% a year', 'Aggressors think twice (−12% attack appetite)'], eff: { tfp: 0.003, deter: 0.88 } },
  minerals: { id: 'minerals', icon: '⛏', title: 'Mineral giant', blurb: 'Copper, lithium, cobalt or rare earths: the energy transition needs what it digs up.', effects: ['Productivity +0.1% a year', 'Stability −1 (mining towns, boom and bust)'], eff: { tfp: 0.001, stab: -1 } },
  finance: { id: 'finance', icon: '🏦', title: 'Financial hub', blurb: 'Money from all over the world is managed here.', effects: ['Borrowing 0.7 points cheaper', 'Productivity +0.2% a year'], eff: { rate: -0.007, tfp: 0.002 } },
  remit: { id: 'remit', icon: '✉', title: 'Remittance economy', blurb: 'Millions working abroad send money home.', effects: ['Stability +2 (families have a lifeline)'], eff: { stab: 2 } },
  tourism: { id: 'tourism', icon: '🏖', title: 'Tourist magnet', blurb: 'Beaches, ruins and cities draw visitors from everywhere.', effects: ['Growth −1.5% a year while at war or unstable (stability below 40)'], eff: { fragile: 0.015 } },
  giant: { id: 'giant', icon: '🌐', title: 'Continental power', blurb: 'Big enough to be a world of its own.', effects: ['Aggressors think twice (−10% attack appetite)', 'Stability +1'], eff: { deter: 0.9, stab: 1 } },
};

const L = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const TRAIT_LISTS: Record<string, string[]> = {
  ageing: L('Japan, Italy, Germany, South Korea, Spain, Portugal, Greece, Taiwan, Bulgaria, Croatia, Finland, China, Latvia, Lithuania, Hungary, Slovenia, Austria, Poland, Serbia, Bosnia and Herz., Cuba, Ukraine'),
  young: L('Nigeria, Ethiopia, Pakistan, Egypt, Bangladesh, Kenya, Dem. Rep. Congo, Tanzania, Uganda, Niger, Mali, Afghanistan, Iraq, Philippines, Angola, Mozambique, Chad, Somalia, Burkina Faso, Madagascar, Zambia, Malawi, Yemen, Sudan, Senegal, Guinea, Cameroon, Ghana, Côte d\'Ivoire, Rwanda, Burundi, S. Sudan'),
  frontline: L('Poland, Estonia, Latvia, Lithuania, Finland, Ukraine, Taiwan, South Korea, Israel, Georgia, Moldova, Armenia, Romania, Pakistan, Guyana'),
  island: L('Japan, United Kingdom, Australia, New Zealand, Taiwan, Sri Lanka, Philippines, Indonesia, Iceland, Cuba, Madagascar, Ireland, Jamaica, Cyprus, Malta, Singapore, Fiji, Bahrain, Papua New Guinea'),
  chips: L('Taiwan, South Korea, Netherlands, Japan'),
  minerals: L('Dem. Rep. Congo, Australia, Chile, Peru, Zambia, Bolivia, South Africa, Indonesia, Mongolia, Kazakhstan, Guinea, Zimbabwe, Brazil, China'),
  finance: L('Switzerland, Singapore, United Kingdom, Luxembourg, United Arab Emirates, Ireland, Netherlands, Liechtenstein, Monaco'),
  remit: L('Philippines, Egypt, Pakistan, Bangladesh, Nepal, Guatemala, Honduras, El Salvador, Haiti, Tajikistan, Kyrgyzstan, Lebanon, Mexico, Morocco, Jamaica, Nicaragua, Moldova'),
  tourism: L('Thailand, Greece, Croatia, Spain, Maldives, Dominican Rep., Jamaica, Fiji, Cyprus, Malta, Montenegro, Egypt, Morocco, Turkey, Portugal, Italy, Bahamas, Barbados, Seychelles, Mauritius'),
  giant: L('United States of America, China, India, Russia, Brazil'),
};
const SET = Object.fromEntries(Object.entries(TRAIT_LISTS).map(([k, v]) => [k, new Set(v)]));

const traitCache = new Map<number, Trait[]>();
/** The traits of a country (derived from its data and geography; they never change). */
export function traitsOf(c: Country): Trait[] {
  const hit = traitCache.get(c.id);
  if (hit) return hit;
  const out: Trait[] = [];
  const has = (k: string) => SET[k]?.has(keyOf(c));
  if ((ENERGY_RATIO[keyOf(c)] ?? 1) >= 2.2) out.push(TRAITS.petro);
  if ((ENERGY_RATIO[keyOf(c)] ?? 1) <= 0.35) out.push(TRAITS.importer);
  if ((FOOD_RATIO[keyOf(c)] ?? 1) >= 1.6) out.push(TRAITS.bread);
  for (const k of ['giant', 'chips', 'frontline', 'ageing', 'young', 'finance', 'minerals', 'island', 'remit', 'tourism']) if (has(k)) out.push(TRAITS[k]);
  const geo = geoRefGet();
  if (geo && c.provinces.length && !c.provinces.some((p) => geo.provinces[p].coast > 0.15) && !has('island')) out.push(TRAITS.landlocked);
  const res = out.slice(0, 4);
  if (geo) traitCache.set(c.id, res);
  return res;
}
const hasTrait = (c: Country, id: string) => traitsOf(c).some((t) => t.id === id);

// ------------------------------------------------------------------ challenges
export interface ChalEff { stab?: number; tfp?: number; infl?: number; rate?: number; labour?: number; food?: number; troops?: number; rev?: number; rep?: number }
export interface ChalResponse { id: string; label: string; desc: string; pc: number; cost: number; sev: number; drift?: number; years?: number; fx?: Fx; side: string; gov?: string[] }
export interface ChallengeDef {
  id: string; icon: string; title: string; desc: string;
  /** country → [starting severity, local name of the problem] */
  where: Record<string, [number, string]>;
  /** effects at full severity (100); they scale with severity */
  eff: ChalEff;
  effects: string[];
  /** severity change per year from the country's situation */
  drift: (s: GameState, c: Country) => number;
  responses: ChalResponse[];
}
const W = (rows: [string, number, string][]) => Object.fromEntries(rows.map(([n, v, t]) => [n, [v, t] as [number, string]]));

export const CHALLENGES: ChallengeDef[] = [
  {
    id: 'insurgency', icon: '🔥', title: 'Insurgency', desc: 'Armed groups hold territory, ambush soldiers and tax the villages they control.',
    where: W([['Nigeria', 65, 'Boko Haram and ISWAP in the north-east, bandits in the north-west'], ['Mali', 80, 'jihadist groups across the north and centre'], ['Burkina Faso', 85, 'jihadists control much of the countryside'], ['Niger', 70, 'jihadist attacks along the borders'], ['Somalia', 85, 'al-Shabaab holds the south'], ['Afghanistan', 45, 'ISIS-K and armed resistance in the valleys'], ['Pakistan', 55, 'TTP militants in the north-west and insurgents in Balochistan'], ['Iraq', 35, 'ISIS cells in the desert'], ['Syria', 70, 'armed groups and foreign forces divide the country'], ['Colombia', 45, 'ELN guerrillas and FARC dissidents'], ['Mozambique', 55, 'the insurgency in Cabo Delgado'], ['Dem. Rep. Congo', 85, 'M23 and dozens of militias in the east'], ['Ethiopia', 60, 'Fano and OLA rebels in Amhara and Oromia'], ['Myanmar', 90, 'resistance armies fighting the junta'], ['Philippines', 30, 'Mindanao militants and communist rebels'], ['Cameroon', 55, 'the Anglophone crisis and Boko Haram'], ['Chad', 50, 'rebels in the north and Boko Haram by the lake'], ['Sudan', 95, 'the RSF and the army at war'], ['Yemen', 85, 'the Houthis hold the north'], ['Libya', 65, 'rival governments and their militias'], ['Central African Rep.', 75, 'armed groups control the provinces'], ['S. Sudan', 70, 'ethnic militias and cattle wars'], ['India', 15, 'Maoist rebels and unrest in the north-east'], ['Turkey', 20, 'the PKK in the south-east'], ['Israel', 45, 'Hamas and Hezbollah on its borders'], ['Mexico', 0, '']]),
    eff: { stab: -11, tfp: -0.006, troops: 0.0005 }, effects: ['Stability −11', 'Productivity −0.6% a year', 'Soldiers lost every week'],
    drift: (s, c) => (c.eco.stability < 45 ? 4 : c.eco.stability > 65 ? -2 : 0.5) + (c.budget.military > 0.025 ? -1.5 : 0.5) + (c.eco.growth < 0.02 ? 1.5 : 0),
    responses: [
      { id: 'offensive', label: 'Military offensive', desc: 'Send the army into the areas they hold.', pc: 6, cost: 0.003, sev: -16, side: 'Reputation −2, soldiers lost, civilians caught in the fighting', fx: { rep: -2, troops: -0.01, fac: { military: 6, liberals: -6 } } },
      { id: 'talks', label: 'Peace talks and amnesty', desc: 'Offer fighters a way home and their leaders a seat at the table.', pc: 14, cost: 0, sev: -6, drift: -6, years: 3, side: 'Nationalists −8, the army −5', fx: { fac: { nationalists: -8, military: -5, liberals: 6 } } },
      { id: 'develop', label: 'Development surge', desc: 'Roads, schools, jobs and police stations in the neglected regions.', pc: 8, cost: 0.006, sev: -5, drift: -5, years: 5, side: 'Expensive and slow', fx: { infra: 2, fac: { regions: 8 } } },
    ],
  },
  {
    id: 'cartels', icon: '💀', title: 'Organised crime', desc: 'Cartels and gangs run whole cities, corrupt police and fight each other in the streets.',
    where: W([['Mexico', 70, 'drug cartels fight for routes to the north'], ['Colombia', 45, 'cocaine cartels and armed groups'], ['Ecuador', 70, 'gangs took over prisons and ports'], ['Honduras', 65, 'maras rule the neighbourhoods'], ['Guatemala', 55, 'gangs and drug smugglers'], ['Haiti', 95, 'gangs control most of the capital'], ['Venezuela', 55, 'criminal gangs and illegal mining'], ['Brazil', 45, 'the PCC and Comando Vermelho'], ['El Salvador', 15, 'the gangs, crushed but not gone'], ['South Africa', 40, 'construction mafias and violent crime'], ['Jamaica', 45, 'gang violence'], ['Peru', 30, 'extortion gangs and drug trafficking'], ['Costa Rica', 25, 'drug-route violence'], ['Italy', 15, 'the mafia'], ['Sweden', 15, 'gang shootings in the suburbs'], ['Albania', 25, 'drug clans']]),
    eff: { stab: -9, tfp: -0.004, rev: -0.04 }, effects: ['Stability −9', 'Productivity −0.4% a year', 'Tax collection −4%'],
    drift: (s, c) => 1 + (c.eco.stability < 40 ? 2 : 0) - (c.politics?.laws.some((l) => l.id === 'police') ? 2 : 0) - (c.politics?.laws.some((l) => l.id === 'anti_graft') ? 1.5 : 0),
    responses: [
      { id: 'iron', label: 'Iron fist', desc: 'Mass arrests, soldiers on the streets, mega-prisons.', pc: 8, cost: 0.002, sev: -20, side: 'Reputation −3, liberals −10 (human rights)', fx: { rep: -3, fac: { liberals: -10, nationalists: 6 } } },
      { id: 'police', label: 'Clean up the police', desc: 'Vet, train and pay the police; protect judges and witnesses.', pc: 12, cost: 0.003, sev: -6, drift: -5, years: 4, side: 'Slow', fx: { fac: { liberals: 5 } } },
      { id: 'money', label: 'Follow the money', desc: 'Seize assets, freeze accounts, work with foreign banks.', pc: 10, cost: 0.001, sev: -10, side: 'Business −6 (bankers dislike the scrutiny)', fx: { fac: { business: -6 }, rep: 2 } },
    ],
  },
  {
    id: 'ageing', icon: '👵', title: 'Pension time bomb', desc: 'Too few workers pay for too many pensions, and the gap grows every year.',
    where: W([['Japan', 75, 'the oldest society on earth'], ['Italy', 70, 'pensions eat 16% of GDP'], ['Germany', 55, 'the baby boomers are retiring'], ['South Korea', 65, 'the lowest birth rate in the world'], ['Spain', 50, 'a shrinking pension pot'], ['Greece', 55, 'young people emigrate, pensioners stay'], ['Portugal', 50, 'an ageing, emptying countryside'], ['China', 50, 'growing old before growing rich'], ['Taiwan', 45, 'a birth rate below one child per woman'], ['Bulgaria', 55, 'the fastest-shrinking population in the world'], ['Russia', 35, 'a shrinking working-age population'], ['Poland', 30, 'too few babies, too many emigrants'], ['Ukraine', 50, 'war, emigration and no births'], ['Cuba', 50, 'the young leave, the old remain'], ['Thailand', 35, 'old before it is rich']]),
    eff: { tfp: -0.003, stab: -3, labour: -0.003 }, effects: ['Productivity −0.3% a year', 'Stability −3', 'Workforce shrinks a further 0.3% a year'],
    drift: (s, c) => 1 - (c.politics?.laws.some((l) => l.id === 'migration') ? 2 : 0),
    responses: [
      { id: 'age', label: 'Raise the retirement age', desc: 'Work two more years before the pension starts.', pc: 14, cost: 0, sev: -18, side: 'Unions −14, stability −2', fx: { stab: -2, fac: { labour: -14, business: 6 } } },
      { id: 'migrants', label: 'Open the door to workers', desc: 'Visas for nurses, builders and engineers from abroad.', pc: 10, cost: 0, sev: -10, drift: -3, years: 5, side: 'Nationalists −12', fx: { labour: 0.01, fac: { nationalists: -12, business: 6 } } },
      { id: 'robots', label: 'Automate everything', desc: 'Robots in factories and care homes, AI in offices.', pc: 6, cost: 0.006, sev: -8, side: 'Expensive', fx: { capital: 0.01, tech: 2, fac: { business: 4, labour: -3 } } },
    ],
  },
  {
    id: 'inflation', icon: '📈', title: 'Inflation spiral', desc: 'Prices rise every month; people buy dollars, wages never catch up.',
    where: W([['Argentina', 90, 'triple-digit inflation and a collapsing peso'], ['Turkey', 70, 'a lira that loses half its value in a year'], ['Iran', 70, 'sanctions and money printing'], ['Venezuela', 80, 'the bolívar is worthless'], ['Egypt', 60, 'a devalued pound and costly bread'], ['Nigeria', 55, 'a falling naira and costly fuel'], ['Pakistan', 55, 'the rupee under pressure'], ['Lebanon', 85, 'the banks froze everyone\'s savings'], ['Zimbabwe', 80, 'yet another new currency'], ['Sudan', 80, 'war-time hyperinflation'], ['Ethiopia', 50, 'a currency crisis'], ['Ghana', 45, 'after the debt default'], ['Sri Lanka', 35, 'still recovering from the crash'], ['Syria', 75, 'a currency in free fall'], ['Russia', 25, 'war spending overheats the economy'], ['Malawi', 50, 'shortages of foreign currency']]),
    eff: { infl: 0.12, stab: -6 }, effects: ['Inflation +12 points', 'Stability −6'],
    drift: (s, c) => (c.eco.inflation > 0.1 ? 3 : c.eco.inflation < 0.05 ? -5 : -1) + (c.eco.monetary > 0.02 ? 3 : 0) - (c.politics?.laws.some((l) => l.id === 'central_bank') ? 3 : 0),
    responses: [
      { id: 'shock', label: 'Shock therapy', desc: 'Interest rates through the roof, spending slashed, the currency floated.', pc: 16, cost: 0, sev: -30, side: 'Stability −6, unions −12, a short recession', fx: { stab: -6, capital: -0.01, fac: { labour: -12, business: 8, liberals: 4 } } },
      { id: 'imf', label: 'An IMF programme', desc: 'A rescue loan in return for reforms the IMF writes.', pc: 10, cost: -0.01, sev: -15, drift: -4, years: 3, side: 'Nationalists −8; you receive 1% of GDP', fx: { fac: { nationalists: -8, business: 6 }, rep: 2 } },
      { id: 'peg', label: 'Peg to the dollar', desc: 'Tie the currency to the dollar and stop printing money.', pc: 12, cost: 0, sev: -20, side: 'You lose control over your own currency', gov: undefined, fx: { fac: { business: 6 } } },
    ],
  },
  {
    id: 'corruption', icon: '💼', title: 'Corruption', desc: 'Bribes for every permit, contracts for friends, and money that disappears abroad.',
    where: W([['Nigeria', 70, 'oil money that vanishes'], ['Ukraine', 50, 'oligarchs and procurement scandals'], ['Russia', 65, 'the kleptocracy around the Kremlin'], ['Brazil', 40, 'the Car Wash scandals'], ['India', 40, 'bribes at every counter'], ['Mexico', 50, 'politicians on the cartels\' payroll'], ['Kenya', 55, 'state contracts for friends'], ['Bangladesh', 55, 'graft in every ministry'], ['Indonesia', 40, 'bribery in courts and ports'], ['Philippines', 45, 'pork-barrel politics'], ['Lebanon', 80, 'a ruling class that looted the state'], ['Iraq', 75, 'ghost employees and stolen oil revenue'], ['South Africa', 55, 'state capture'], ['Pakistan', 55, 'patronage politics'], ['Egypt', 50, 'the army\'s business empire'], ['Venezuela', 85, 'a looted oil company'], ['Angola', 60, 'the oil elite'], ['Azerbaijan', 55, 'the ruling family\'s businesses'], ['Kazakhstan', 45, 'the old clans'], ['Hungary', 25, 'friends of the government win every tender'], ['Afghanistan', 60, 'warlords and smuggling'], ['Dem. Rep. Congo', 70, 'mining money that never reaches the state']]),
    eff: { tfp: -0.006, rev: -0.08, stab: -4 }, effects: ['Productivity −0.6% a year', 'Tax collection −8%', 'Stability −4'],
    drift: (s, c) => (c.politics?.laws.some((l) => l.id === 'anti_graft') ? -3 : 0.5) + (c.eco.stability < 35 ? 1.5 : 0) + (c.gov === 'A' ? 0.5 : 0),
    responses: [
      { id: 'agency', label: 'An anti-corruption agency', desc: 'Independent investigators with the power to arrest ministers.', pc: 12, cost: 0.001, sev: -8, drift: -4, years: 4, side: 'Business −6, your own party −', fx: { fac: { business: -6, liberals: 8 }, rep: 3 } },
      { id: 'digital', label: 'Digital government', desc: 'Every permit, tax and tender online: no counters, no envelopes.', pc: 6, cost: 0.004, sev: -10, side: 'Expensive', fx: { tech: 1, infra: 1, fac: { liberals: 4 } } },
      { id: 'purge', label: 'A public purge', desc: 'Arrest a few big names on live television.', pc: 8, cost: 0, sev: -14, side: 'Reputation −2, business −8, it may be seen as a power grab', fx: { rep: -2, stab: 2, fac: { business: -8, nationalists: 6 } } },
    ],
  },
  {
    id: 'coal', icon: '🏭', title: 'Hooked on coal', desc: 'Coal keeps the lights on and the miners employed, while partners demand cleaner power.',
    where: W([['Poland', 60, 'coal still makes most of the electricity'], ['India', 60, 'three-quarters of power from coal'], ['China', 55, 'half the world\'s coal burned at home'], ['South Africa', 75, 'Eskom\'s ageing coal plants and blackouts'], ['Indonesia', 50, 'the world\'s biggest coal exporter'], ['Australia', 35, 'coal mines and export dependence'], ['Kazakhstan', 55, 'Soviet-era coal plants'], ['Vietnam', 40, 'coal for a growing industry'], ['Germany', 20, 'the last lignite mines'], ['Turkey', 30, 'imported coal for power'], ['Mongolia', 60, 'coal is its economy']]),
    eff: { tfp: -0.0015, stab: -1, rep: -1 }, effects: ['Productivity −0.15% a year', 'Reputation −1 a year', 'Stability −1 (smog)'],
    drift: (s, c) => -1.5 - (c.budget.industry > 0.02 ? 1 : 0),
    responses: [
      { id: 'phaseout', label: 'Phase out coal', desc: 'Close the mines by a fixed date, with money for the mining regions.', pc: 14, cost: 0.004, sev: -25, side: 'Unions −12 in mining regions, energy output −3%', fx: { energy: -0.03, rep: 4, fac: { labour: -12, regions: -6, liberals: 8 } } },
      { id: 'nuclear', label: 'Build nuclear plants', desc: 'Clean power that runs day and night, ready in about a decade.', pc: 8, cost: 0.008, sev: -6, drift: -4, years: 6, side: 'Very expensive and slow', fx: { energy: 0.04, fac: { business: 4 } } },
      { id: 'renew', label: 'Wind and solar drive', desc: 'Auctions for wind farms and rooftop solar.', pc: 6, cost: 0.004, sev: -12, side: 'Needs a stronger grid', fx: { energy: 0.02, fac: { liberals: 4 } } },
    ],
  },
  {
    id: 'water', icon: '💧', title: 'Water running out', desc: 'Rivers shrink, aquifers empty and harvests fail more often.',
    where: W([['Egypt', 65, 'the Nile and Ethiopia\'s great dam'], ['Iraq', 70, 'the Tigris and Euphrates dwindle'], ['Iran', 70, 'Tehran\'s reservoirs run dry'], ['Pakistan', 55, 'the Indus and melting glaciers'], ['India', 45, 'groundwater pumped dry'], ['Jordan', 75, 'one of the driest countries on earth'], ['Yemen', 80, 'Sanaa may run out of water'], ['Syria', 60, 'drought and broken canals'], ['Saudi Arabia', 40, 'desalination and fossil water'], ['Afghanistan', 55, 'drought and the Qosh Tepa canal'], ['Uzbekistan', 50, 'the vanished Aral Sea'], ['Turkmenistan', 45, 'the Amu Darya shrinks'], ['Morocco', 45, 'years of drought'], ['Algeria', 40, 'the desert advances'], ['Mexico', 30, 'Mexico City sinks as it pumps'], ['Spain', 25, 'drought in the south'], ['Niger', 55, 'the Sahel dries out'], ['Chad', 55, 'Lake Chad shrinks']]),
    eff: { food: -0.02, stab: -5 }, effects: ['Food production −2% a year', 'Stability −5'],
    drift: (s, c) => 2 - (c.eco.infra > 60 ? 1.5 : 0),
    responses: [
      { id: 'desal', label: 'Desalination plants', desc: 'Turn seawater into drinking water.', pc: 6, cost: 0.006, sev: -18, side: 'Expensive, needs a coast', fx: { food: 0.01 } },
      { id: 'irrig', label: 'Modern irrigation', desc: 'Drip irrigation and fixed canals: the same harvest with half the water.', pc: 8, cost: 0.003, sev: -8, drift: -3, years: 4, side: 'Farmers resist the change at first', fx: { food: 0.02, fac: { regions: -4 } } },
      { id: 'treaty', label: 'A water treaty', desc: 'Share the rivers with the countries upstream.', pc: 10, cost: 0, sev: -12, side: 'Nationalists −6', fx: { rep: 3, fac: { nationalists: -6 } } },
    ],
  },
  {
    id: 'inequality', icon: '⚖', title: 'Deep inequality', desc: 'Gated towers next to slums; anger simmers.',
    where: W([['Brazil', 60, 'favelas beside luxury towers'], ['South Africa', 80, 'the most unequal country on earth'], ['Colombia', 55, 'land and wealth in few hands'], ['Chile', 40, 'the 2019 uprising is not forgotten'], ['Mexico', 45, 'the poor south, the rich north'], ['United States of America', 35, 'a shrinking middle class'], ['Namibia', 70, 'the legacy of apartheid'], ['Botswana', 45, 'diamond wealth unevenly shared'], ['Zambia', 55, 'copper riches, rural poverty'], ['Peru', 40, 'Lima versus the Andes'], ['Angola', 60, 'oil wealth for a few'], ['Lebanon', 45, 'the rich left with their money'], ['Philippines', 40, 'dynasties and slums'], ['Turkey', 30, 'inflation widens the gap']]),
    eff: { stab: -9, tfp: -0.002 }, effects: ['Stability −9', 'Productivity −0.2% a year'],
    drift: (s, c) => 1 - (c.budget.social > c.eco.baseSocial * 1.1 ? 2.5 : 0) + (c.eco.unemployment > 0.1 ? 1 : 0),
    responses: [
      { id: 'cash', label: 'Cash transfers for the poorest', desc: 'A monthly payment for every poor family that keeps its children in school.', pc: 6, cost: 0.005, sev: -10, drift: -2, years: 4, side: 'Business −4', fx: { stab: 2, fac: { labour: 8, business: -4 } } },
      { id: 'tax', label: 'Tax the rich', desc: 'A wealth tax and an end to loopholes.', pc: 12, cost: -0.004, sev: -12, side: 'Business −14, some capital leaves; you collect 0.4% of GDP', fx: { capital: -0.006, fac: { business: -14, labour: 10 } } },
      { id: 'land', label: 'Housing and land reform', desc: 'Titles for slum dwellers, land for small farmers.', pc: 14, cost: 0.003, sev: -8, drift: -3, years: 5, side: 'Landowners and business −8', fx: { fac: { business: -8, regions: 6, labour: 6 } } },
    ],
  },
  {
    id: 'braindrain', icon: '✈', title: 'Brain drain', desc: 'Doctors, engineers and the young leave for better pay abroad.',
    where: W([['Nigeria', 50, 'the "japa" exodus of doctors and engineers'], ['Ukraine', 55, 'millions left during the war'], ['Romania', 45, 'a fifth of the people work abroad'], ['Bulgaria', 50, 'the young leave for the West'], ['Lebanon', 65, 'the professionals fled the crash'], ['Russia', 40, 'the programmers left after 2022'], ['Venezuela', 70, 'a quarter of the people have left'], ['Syria', 60, 'a generation in exile'], ['Zimbabwe', 55, 'nurses to Britain'], ['Serbia', 40, 'the young head to Germany'], ['Bosnia and Herz.', 50, 'emptying towns'], ['Moldova', 50, 'villages of grandparents'], ['Pakistan', 40, 'graduates leave for the Gulf'], ['India', 20, 'the best engineers to Silicon Valley'], ['Ghana', 35, 'nurses abroad'], ['Iran', 50, 'the educated leave'], ['Greece', 25, 'the crisis generation abroad'], ['Armenia', 40, 'an emptying country']]),
    eff: { tfp: -0.005, labour: -0.003 }, effects: ['Productivity −0.5% a year', 'Workforce shrinks 0.3% a year'],
    drift: (s, c) => (c.eco.growth < 0.02 ? 2.5 : c.eco.growth > 0.04 ? -2.5 : 0) + (c.eco.stability < 40 ? 1.5 : 0) - (c.eco.tech > 70 ? 1 : 0),
    responses: [
      { id: 'diaspora', label: 'Bring the diaspora home', desc: 'Tax breaks and fast jobs for those who come back.', pc: 6, cost: 0.002, sev: -10, side: 'Locals resent the perks', fx: { labour: 0.003, tech: 1, fac: { labour: -3 } } },
      { id: 'pay', label: 'Pay doctors and teachers properly', desc: 'Raise public-sector salaries to keep the talent.', pc: 4, cost: 0.004, sev: -8, drift: -2, years: 3, side: 'Expensive', fx: { fac: { labour: 6 } } },
      { id: 'hubs', label: 'Tech hubs and start-up visas', desc: 'Make the country a place where the young want to build things.', pc: 8, cost: 0.003, sev: -6, drift: -3, years: 4, side: 'Slow', fx: { tech: 2, fac: { business: 6, liberals: 4 } } },
    ],
  },
  {
    id: 'property', icon: '🏚', title: 'Property bubble', desc: 'House prices far above incomes, builders deep in debt. It grows until it bursts.',
    where: W([['China', 70, 'Evergrande, Country Garden and millions of empty flats'], ['Canada', 45, 'homes at ten times income'], ['Australia', 40, 'Sydney\'s house prices'], ['New Zealand', 40, 'the least affordable housing in the rich world'], ['United Kingdom', 30, 'a generation priced out'], ['South Korea', 45, 'household debt above GDP'], ['Sweden', 30, 'mortgages and rising rates'], ['Vietnam', 35, 'developers in trouble'], ['Ireland', 30, 'a housing shortage'], ['Netherlands', 30, 'too few homes']]),
    eff: { stab: -3, rate: 0.008 }, effects: ['Stability −3', 'Borrowing 0.8 points dearer', 'Above 85 it bursts: a sudden recession'],
    drift: () => 3,
    responses: [
      { id: 'deflate', label: 'Let the air out slowly', desc: 'Tighter mortgage rules and higher deposits.', pc: 8, cost: 0, sev: -12, drift: -3, years: 3, side: 'Growth slows for a year', fx: { capital: -0.004, fac: { business: -6 } } },
      { id: 'build', label: 'Build, build, build', desc: 'A million new homes: zoning freed, state land released.', pc: 10, cost: 0.004, sev: -15, side: 'Local opposition', fx: { capital: 0.004, fac: { regions: -6, labour: 6 } } },
      { id: 'bailout', label: 'Bail out the builders', desc: 'State banks take over the bad loans.', pc: 4, cost: 0.008, sev: -25, side: 'Very expensive; the bubble starts to grow again', fx: { fac: { business: 8, liberals: -6 } } },
    ],
  },
  {
    id: 'debt', icon: '🧾', title: 'Debt overhang', desc: 'Interest swallows the budget; creditors are nervous.',
    where: W([['Egypt', 65, 'half of revenue goes on interest'], ['Pakistan', 60, 'IMF bailout after IMF bailout'], ['Sri Lanka', 55, 'after the 2022 default'], ['Lebanon', 85, 'in default since 2020'], ['Ghana', 55, 'restructuring after default'], ['Zambia', 55, 'after the 2020 default'], ['Argentina', 70, 'nine defaults and counting'], ['Italy', 50, 'debt above 130% of GDP'], ['Greece', 50, 'still paying for the crisis'], ['Japan', 30, 'the biggest debt in the rich world'], ['Kenya', 45, 'Eurobonds coming due'], ['Ethiopia', 50, 'in default'], ['Tunisia', 45, 'close to default'], ['Bolivia', 45, 'reserves run out'], ['Ukraine', 50, 'war debts'], ['Mozambique', 50, 'the hidden-debt scandal'], ['Laos', 60, 'Chinese railway loans']]),
    eff: { rate: 0.02, stab: -4 }, effects: ['Borrowing 2 points dearer', 'Stability −4'],
    drift: (s, c) => { const r = c.eco.debt / Math.max(1, c.eco.gdp); return r > 1.2 ? 3 : r > 0.9 ? 1 : r < 0.6 ? -4 : -1; },
    responses: [
      { id: 'restructure', label: 'Restructure the debt', desc: 'Ask creditors to take a haircut.', pc: 10, cost: 0, sev: -35, side: 'Reputation −6; markets stay wary for years', fx: { rep: -6, fac: { business: -8 } } },
      { id: 'austerity', label: 'Austerity budget', desc: 'Cut spending and raise taxes until the books balance.', pc: 14, cost: -0.006, sev: -15, side: 'Stability −4, unions −12; you save 0.6% of GDP', fx: { stab: -4, fac: { labour: -12, business: 6 } } },
      { id: 'growth', label: 'Growth reforms', desc: 'Sell state firms, cut red tape, open the economy.', pc: 12, cost: 0, sev: -6, drift: -4, years: 4, side: 'Unions −6', fx: { capital: 0.004, fac: { business: 8, labour: -6 } } },
    ],
  },
  {
    id: 'disasters', icon: '🌀', title: 'Climate disasters', desc: 'Cyclones, floods and heatwaves arrive every year, stronger than before.',
    where: W([['Bangladesh', 70, 'cyclones and a rising sea'], ['Pakistan', 60, 'the floods of 2022 covered a third of the country'], ['Philippines', 60, 'twenty typhoons a year'], ['Mozambique', 60, 'cyclones off the Indian Ocean'], ['Haiti', 65, 'hurricanes and earthquakes'], ['Vietnam', 45, 'the Mekong delta sinks'], ['Madagascar', 55, 'cyclones and drought in the south'], ['Myanmar', 45, 'cyclones in the delta'], ['Honduras', 45, 'hurricanes'], ['Guatemala', 40, 'hurricanes and eruptions'], ['Fiji', 50, 'rising seas'], ['Maldives', 70, 'islands one metre above the sea'], ['India', 30, 'heatwaves and floods'], ['Indonesia', 35, 'floods, quakes and a sinking capital'], ['Malawi', 50, 'cyclones and drought'], ['Somalia', 55, 'drought after drought'], ['Nigeria', 25, 'floods in the Niger basin'], ['Cuba', 40, 'hurricanes']]),
    eff: { stab: -3, food: -0.005 }, effects: ['Stability −3', 'Food production −0.5% a year', 'Disasters strike more often and harder'],
    drift: () => 1,
    responses: [
      { id: 'walls', label: 'Sea walls and flood defences', desc: 'Dikes, storm drains and raised roads.', pc: 6, cost: 0.006, sev: -20, side: 'Expensive', fx: { infra: 2 } },
      { id: 'warning', label: 'Early-warning system', desc: 'Sirens, shelters and evacuation plans in every district.', pc: 4, cost: 0.001, sev: -8, side: 'Saves lives, not property', fx: { stab: 1 } },
      { id: 'finance', label: 'Appeal for climate finance', desc: 'Ask the rich countries to pay for the damage they caused.', pc: 6, cost: -0.003, sev: -6, side: 'You receive 0.3% of GDP; your bargaining power with donors drops', fx: { rep: 2 } },
    ],
  },
  {
    id: 'migration', icon: '🚶', title: 'Migration pressure', desc: 'Boats and caravans arrive faster than the system can process them.',
    where: W([['Italy', 50, 'boats from Libya and Tunisia'], ['Greece', 45, 'arrivals on the islands'], ['Spain', 35, 'boats to the Canaries'], ['Germany', 45, 'more asylum claims than anywhere in Europe'], ['United States of America', 50, 'the southern border'], ['Turkey', 55, 'nearly four million Syrian refugees'], ['Lebanon', 70, 'one in four people is a refugee'], ['Jordan', 55, 'refugees from Syria and Palestine'], ['Colombia', 45, 'millions of Venezuelans'], ['Poland', 35, 'refugees from Ukraine, pressure on the Belarus border'], ['United Kingdom', 35, 'small boats across the Channel'], ['Uganda', 45, 'the largest refugee population in Africa'], ['Bangladesh', 40, 'a million Rohingya'], ['Chad', 45, 'refugees from Sudan'], ['Kenya', 35, 'Somali refugee camps'], ['Pakistan', 40, 'Afghan refugees']]),
    eff: { stab: -5, labour: 0.003 }, effects: ['Stability −5', 'Workforce grows 0.3% a year'],
    drift: (s, c) => 1.5 - (c.politics?.laws.some((l) => l.id === 'border_wall') ? 2 : 0),
    responses: [
      { id: 'border', label: 'Close the border', desc: 'Fences, patrols and fast deportations.', pc: 8, cost: 0.002, sev: -16, side: 'Liberals −10, reputation −2, the workforce stops growing', fx: { rep: -2, fac: { liberals: -10, nationalists: 10 } } },
      { id: 'integrate', label: 'Integration programme', desc: 'Language classes, work permits, housing outside the camps.', pc: 8, cost: 0.003, sev: -8, drift: -3, years: 4, side: 'Nationalists −8', fx: { labour: 0.004, fac: { nationalists: -8, business: 6 } } },
      { id: 'deal', label: 'A deal with transit countries', desc: 'Pay the countries on the route to stop the crossings.', pc: 6, cost: 0.002, sev: -12, side: 'Human-rights groups object; liberals −5', fx: { fac: { liberals: -5 } } },
    ],
  },
  {
    id: 'sanctions', icon: '⛓', title: 'Life under sanctions', desc: 'Cut off from Western banks, parts and markets.',
    where: W([['Russia', 60, 'the toughest sanctions in history'], ['Iran', 75, 'decades of sanctions'], ['North Korea', 90, 'total isolation'], ['Venezuela', 55, 'oil sanctions'], ['Cuba', 60, 'the US embargo'], ['Syria', 70, 'the Caesar Act'], ['Belarus', 50, 'sanctions since 2020'], ['Myanmar', 40, 'sanctions on the junta'], ['Afghanistan', 60, 'frozen reserves, no recognition'], ['Nicaragua', 30, 'targeted sanctions']]),
    eff: { tfp: -0.005, stab: -3 }, effects: ['Productivity −0.5% a year', 'Stability −3'],
    drift: (s, c) => (c.eco.sanctionShare > 0.3 ? 2 : -4),
    responses: [
      { id: 'shadow', label: 'Sanctions-busting network', desc: 'A shadow fleet, front companies and friendly middlemen.', pc: 6, cost: 0.002, sev: -12, side: 'Reputation −3', fx: { rep: -3 } },
      { id: 'substitute', label: 'Make it at home', desc: 'Import substitution: build your own planes, chips and medicines.', pc: 8, cost: 0.005, sev: -8, drift: -3, years: 5, side: 'Expensive and the quality suffers at first', fx: { capital: 0.004, fac: { nationalists: 6, business: -4 } } },
      { id: 'pivot', label: 'Pivot to new partners', desc: 'Sell to China, India and the Gulf; trade in their currencies.', pc: 8, cost: 0, sev: -10, side: 'You depend on new patrons', fx: { orient: -0.05, rel: [['China', 6], ['India', 4]] } },
    ],
  },
];
export const challengeById = (id: string) => CHALLENGES.find((x) => x.id === id);

type ChalState = NonNullable<Country['chal']>[string];
/** A country's challenges (created from the data the first time they are asked for, so old saves get them too). */
export function challengesOf(c: Country): Record<string, ChalState> {
  if (c.chal) return c.chal;
  const out: Record<string, ChalState> = {};
  for (const d of CHALLENGES) { const w = d.where[keyOf(c)]; if (w && w[0] > 0) out[d.id] = { sev: w[0] }; }
  c.chal = out;
  return out;
}
export const localName = (c: Country, id: string) => challengeById(id)?.where[keyOf(c)]?.[1] ?? '';

/** Combined effect of all challenges (scaled by severity) and traits on one quantity. */
function chalSum(c: Country, k: keyof ChalEff): number {
  let t = 0;
  const ch = c.chal ?? challengesOf(c);
  for (const id in ch) { const d = challengeById(id); const v = d?.eff[k]; if (v) t += v * ch[id].sev / 100; }
  return t;
}
const traitSum = (c: Country, k: keyof TraitEff) => traitsOf(c).reduce((t, x) => t + ((x.eff[k] as number | undefined) ?? 0), 0);
const traitMul = (c: Country, k: 'def' | 'deter' | 'shock') => traitsOf(c).reduce((t, x) => t * ((x.eff[k] as number | undefined) ?? 1), 1);

/** hooks for the economy and the war */
export const charStab = (c: Country) => {
  let v = chalSum(c, 'stab') + traitSum(c, 'stab');
  if (hasTrait(c, 'young') && c.eco.growth < 0.03) v -= 3 * clamp((0.03 - c.eco.growth) / 0.03, 0, 1);
  return v;
};
export const charTfp = (c: Country) => chalSum(c, 'tfp') + traitSum(c, 'tfp');
export const charInfl = (c: Country) => chalSum(c, 'infl');
export const charRate = (c: Country) => chalSum(c, 'rate') + traitSum(c, 'rate');
export const charLabour = (c: Country) => chalSum(c, 'labour') + traitSum(c, 'labour');
/** landlocked countries: war cuts their trade routes twice as hard (0 or 1) */
export const charLocked = (c: Country) => traitSum(c, 'trade');
export const charShock = (c: Country) => traitMul(c, 'shock');
export const charDef = (c: Country) => traitMul(c, 'def');
export const charDeter = (c: Country) => traitMul(c, 'deter');
/** multiplier on state revenue: oil states ride the oil price, corruption and crime cost collection */
export function charRevenue(c: Country, priceE: number): number {
  const oil = traitSum(c, 'oil');
  return clamp((1 + oil * (priceE - 1)) * (1 + chalSum(c, 'rev')), 0.5, 1.6);
}
/** growth penalty for tourist economies at war or in turmoil (per year) */
export function charFragile(s: GameState, c: Country): number {
  const f = traitSum(c, 'fragile');
  if (!f) return 0;
  const hot = c.eco.stability < 40 || s.wars.some((w) => w.attackers.includes(c.id) || w.defenders.includes(c.id));
  return hot ? f : 0;
}

// ------------------------------------------------------------------ the weekly step
export function stepCharacter(s: GameState) {
  for (const c of s.countries) {
    if (!c.alive) continue;
    const ch = challengesOf(c);
    for (const id in ch) {
      const d = challengeById(id);
      if (!d) continue;
      const st = ch[id];
      const extra = st.until && st.until > s.tick ? (st.drift ?? 0) : 0;
      if (st.until && st.until <= s.tick) { delete st.until; delete st.drift; }
      const before = st.sev;
      st.sev = clamp(st.sev + (d.drift(s, c) + extra) * DT, 0, 100);
      st.sev = Math.round(st.sev * 100) / 100;
      // weekly effects that are not rates
      const sev = st.sev / 100;
      if (d.eff.troops && sev > 0) { const loss = c.mil.troops * d.eff.troops * sev; c.mil.troops -= loss; c.mil.casualties += loss; }
      if (d.eff.food) c.eco.foodCap *= 1 + d.eff.food * sev * DT;
      if (d.eff.rep && s.tick % 52 === c.id % 52) c.reputation = clamp(c.reputation + d.eff.rep * sev, 0, 100);
      if (id === 'disasters' && hash01('disaster', c.id, s.tick) < 0.006 * sev) disaster(s, c, sev);
      if (id === 'property' && st.sev >= 85) burst(s, c, st);
      if (c.isPlayer && before > 2 && st.sev <= 2) logEvent(s, `${d.icon} ${d.title} overcome: ${localName(c, id) || 'the problem'} is no longer holding ${c.name} back.`, 'info', [c.id], true);
      if (c.isPlayer && before < 75 && st.sev >= 75) logEvent(s, `${d.icon} ${d.title} is getting out of hand (${Math.round(st.sev)}/100). See your nation's challenges.`, 'danger', [c.id], true);
    }
    // AI governments respond to their worst problem now and then
    if (!c.isPlayer && (s.tick + c.id * 7) % 104 === 11) {
      const worst = Object.entries(ch).sort((a, b) => b[1].sev - a[1].sev)[0];
      if (worst && worst[1].sev > 40 && hash01('aichal', c.id, s.tick) < 0.45) {
        const d = challengeById(worst[0])!;
        const r = d.responses[Math.floor(hash01('aichalr', c.id, s.tick) * d.responses.length)];
        applyResponse(s, c, d, r, true);
      }
    }
  }
}

function disaster(s: GameState, c: Country, sev: number) {
  c.eco.damage = Math.min(1, c.eco.damage + 0.02 + 0.03 * sev);
  c.eco.stability = Math.max(0, c.eco.stability - 2 - 3 * sev);
  const kinds = ['A cyclone', 'Catastrophic floods', 'A deadly heatwave', 'A typhoon', 'Flash floods'];
  const k = kinds[Math.floor(hash01('dkind', c.id, s.tick) * kinds.length)];
  logEvent(s, `🌀 ${k} strikes ${c.name}: towns are destroyed and thousands are homeless.`, 'danger', [c.id], c.isPlayer, c.isPlayer ? { big: true, prov: c.capital } : undefined);
}
function burst(s: GameState, c: Country, st: ChalState) {
  st.sev = 30;
  c.eco.realGdp *= 0.97; c.eco.gdp = c.eco.realGdp * c.eco.price;
  c.eco.capital *= 0.97;
  c.eco.stability = Math.max(0, c.eco.stability - 6);
  logEvent(s, `🏚 ${c.name}'s property bubble bursts: house prices crash, builders go bust and banks are in trouble.`, 'econ', [c.id], true, c.isPlayer ? { big: true, prov: c.capital } : undefined);
}

function applyResponse(s: GameState, c: Country, d: ChallengeDef, r: ChalResponse, ai = false) {
  const st = challengesOf(c)[d.id];
  // AI governments get half the effect: they pick at random and rarely follow through
  const k = ai ? 0.5 : 1;
  st.sev = clamp(st.sev + r.sev * k, 0, 100);
  if (r.drift) { st.drift = r.drift * k; st.until = s.tick + 52 * (r.years ?? 3); }
  if (r.fx) applyFx(s, c, r.fx);
  if (r.cost < 0) c.eco.cash += -r.cost * c.eco.gdp;
  else if (ai && r.cost > 0) { c.eco.cash -= r.cost * c.eco.gdp; if (c.eco.cash < 0) { c.eco.debt -= c.eco.cash; c.eco.cash = 0; } }
  s.stats[`chr:${c.id}:${d.id}:${r.id}`] = s.tick;
}

export const RESPONSE_COOLDOWN = 104;
export function responseWait(s: GameState, c: Country, chal: string, resp: string) {
  const last = s.stats[`chr:${c.id}:${chal}:${resp}`];
  return last === undefined ? 0 : Math.max(0, last + RESPONSE_COOLDOWN - s.tick);
}
export function responseBlocked(s: GameState, c: Country, d: ChallengeDef, r: ChalResponse): string | null {
  const wait = responseWait(s, c, d.id, r.id);
  if (wait > 0) return `Possible again in ${wait} weeks`;
  if ((c.politics?.pc ?? 0) < r.pc) return `Needs ${r.pc} political capital`;
  if (d.id === 'water' && r.id === 'desal' && !c.provinces.some((p) => (geoRefGet()?.provinces[p].coast ?? 0) > 0.15)) return 'You have no coast';
  if ((challengesOf(c)[d.id]?.sev ?? 0) <= 0) return 'Already overcome';
  return null;
}
export function actChallenge(s: GameState, chal: string, resp: string): { ok: boolean; message: string } {
  const c = s.countries[s.player];
  const d = challengeById(chal);
  const r = d?.responses.find((x) => x.id === resp);
  if (!d || !r) return { ok: false, message: 'Unknown response' };
  const why = responseBlocked(s, c, d, r);
  if (why) return { ok: false, message: why };
  if (r.cost > 0) { const f = fund(s, c.id, r.cost * c.eco.gdp, r.label); if (!f.ok) return f; }
  if (r.pc && !spendPC(c, r.pc)) return { ok: false, message: `Needs ${r.pc} political capital` };
  applyResponse(s, c, d, r);
  logEvent(s, `${d.icon} ${c.name}: ${r.label.toLowerCase()} to tackle ${localName(c, d.id) || d.title.toLowerCase()}.`, 'info', [c.id], true);
  return { ok: true, message: `${r.label}: severity ${r.sev < 0 ? '' : '+'}${r.sev} now${r.drift ? `, then ${r.drift} a year for ${r.years ?? 3} years` : ''}.` };
}
