export type CountryId = number;
export type ProvId = number;

export type VictoryMode = 'none' | 'economic' | 'conquest' | 'hegemon';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type StartCondition = 'historical' | 'crisis' | 'prosperous';

export interface Settings {
  seed: number;
  aggression: number; // AI aggression multiplier 0.3 .. 2.0
  difficulty: Difficulty;
  start: StartCondition;
  defensiveAlliances: boolean;
  victory: VictoryMode;
}

export const DEFAULT_SETTINGS: Settings = {
  seed: 20240101,
  aggression: 1,
  difficulty: 'normal',
  start: 'historical',
  defensiveAlliances: true,
  victory: 'none',
};

/** Policy levers. Rates and spending shares are fractions (0.25 = 25%) of GDP / tax base. */
export interface Budget {
  taxIncome: number; // effective rate on household income (base ~50% of GDP)
  taxCorporate: number; // rate on profits (base ~20% of GDP)
  taxVat: number; // consumption tax (base ~55% of GDP)
  social: number; // public services, health, pensions, administration (% GDP)
  infra: number;
  industry: number; // industrial policy / state investment
  education: number; // education + R&D
  military: number; // total military budget
  intel: number; // intelligence services (part of military budget)
  milArmy: number; // procurement mix, sums to 1
  milAir: number;
  milNavy: number;
}

export interface Economy {
  pop: number;
  laborForce: number;
  lfShare: number;
  realGdp: number; // real output at base prices
  price: number; // price level index (1.0 at start)
  gdp: number; // nominal GDP, USD
  potential: number; // real output the economy is converging towards
  capital: number; // industrial capital stock, USD
  tfp: number;
  tfpTrend: number; // baseline TFP growth per year
  infra: number; // 0-100
  tech: number; // 0-100
  energyCap: number; // domestic energy production (USD-eq at base price)
  energyDemand: number;
  foodCap: number;
  foodDemand: number;
  energyUnmet: number; // share of energy demand that could not be met
  foodUnmet: number;
  debt: number;
  cash: number;
  reserves: number; // foreign reserves (cumulative trade balance)
  avgRate: number; // average interest rate on debt
  inflation: number;
  unemployment: number;
  uNat: number;
  monetary: number; // inflationary pressure from money printing
  openness: number;
  goodsBias: number;
  exports: number;
  imports: number;
  tradeIndex: number;
  sanctionShare: number;
  blockade: number;
  stability: number; // 0-100
  damage: number; // war damage 0-1
  savings: number; // private investment rate
  baseGrowth: number;
  baseSocial: number;
  baseEdu: number;
  baseTaxRevenue: number;
  collection: number;
  popGrowthMod: number;
  /** last-tick annualised flows (for display) */
  revenue: number;
  spending: number;
  interest: number;
  growth: number; // smoothed real growth, annual
  /** growth explanation: annualised contributions (log points) */
  explain: Record<string, number>;
  lastDefault: number;
  tradeBase: number; // baseline trade boost (initial agreements) used to normalise tradeIndex
  prev: Record<string, number>; // previous-tick log values for growth decomposition
  occupation: number; // unrest from recently conquered provinces 0..1
}

export interface Military {
  troops: number;
  equipArmy: number;
  equipAir: number;
  equipNavy: number;
  readiness: number; // 0..1
  supply: number; // 0..1 logistic capacity
  intel: number; // 0..1
  milTech: number;
  exhaustion: number; // 0..1
  casualties: number; // lifetime
  commit: number; // share of army committed to offensive operations
  autoAdvance: boolean;
  focus: ProvId[]; // player-chosen offensive targets
  upkeep: number; // annual cost
  procurement: number; // annual spend on new equipment
  nuclear: boolean;
  unitCost: number; // annual cost per soldier at base prices (incl. support)
}

export interface Personality {
  aggression: number; // 0..1.5
  expansion: number; // 0..1
  trade: number; // 0..1
  ideology: number; // 0..1 how much regime type matters
  caution: number; // 0..1
}

export interface Country {
  id: CountryId;
  name: string;
  iso3: string;
  gov: string;
  region: string;
  color: number; // hue 0-360
  estimated: boolean;
  alive: boolean;
  capital: ProvId;
  provinces: ProvId[];
  eco: Economy;
  budget: Budget;
  mil: Military;
  ai: Personality;
  reputation: number; // 0..100, trustworthiness on the world stage
  isPlayer: boolean;
  /** simple ring-buffer history for charts (one sample every HIST_EVERY ticks) */
  hist: { gdp: number[]; gdppc: number[]; debt: number[]; mil: number[]; stab: number[]; infl: number[]; unemp: number[]; pop: number[]; trade: number[] };
  baseline: { gdp: number; pop: number; provinces: number };
  lastWarDecl: number;
}

export interface Treaty {
  trade: boolean;
  nap: boolean;
  alliance: boolean;
  coop: boolean;
  /** sanctions imposed by the lower-id country on the higher (sAB) and vice versa. 0 none, 1 sanction, 2 embargo */
  sAB: number;
  sBA: number;
}

export interface War {
  id: number;
  name: string;
  attackers: CountryId[];
  defenders: CountryId[];
  start: number;
  /** active offensives: province being contested, who attacks, progress 0..1 */
  fronts: { prov: ProvId; by: CountryId; progress: number; amphibious: boolean }[];
  casualties: Record<number, number>;
  /** provinces captured (value, as share of enemy base weight) by each country in this war */
  gained: Record<number, number>;
  /** share of its holdings each country lost in this war */
  lost: Record<number, number>;
  /** at war start: total provinces held by each country, for war score */
  startProvs: Record<number, number>;
}

export type OfferKind = 'trade' | 'nap' | 'alliance' | 'coop' | 'peace';
export interface Offer { id: number; from: CountryId; kind: OfferKind; terms?: { kind: string; share?: number }; tick: number }

export type LogKind = 'info' | 'war' | 'peace' | 'diplo' | 'econ' | 'danger' | 'territory';
export interface LogEntry { seq: number; tick: number; text: string; kind: LogKind; countries: CountryId[]; important?: boolean }

export interface Market { priceE: number; priceF: number; scarcityE: number; scarcityF: number }

export interface GameState {
  version: number;
  tick: number;
  rng: number;
  settings: Settings;
  player: CountryId;
  countries: Country[];
  owner: number[];
  core: number[];
  integ: number[];
  treaties: Record<string, Treaty>;
  relDelta: Record<string, number>;
  wars: War[];
  nextWarId: number;
  market: Market;
  log: LogEntry[];
  victory: { achieved: boolean; text: string } | null;
  worldHist: { gdp: number[] };
  offers: Offer[];
  nextOfferId: number;
  logSeq: number;
}

export const START_YEAR = 2024;
export const TICKS_PER_YEAR = 52;
export const DT = 1 / TICKS_PER_YEAR;
export const HIST_EVERY = 4;
export const HIST_MAX = 120;
