export type CountryId = number;
export type ProvId = number;

export type VictoryMode = 'none' | 'economic' | 'conquest' | 'hegemon';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type StartCondition = 'historical' | 'crisis' | 'prosperous';

export type GameMode = 'sandbox' | 'legacy';
/** how much the player steers each area: the advisers run it, propose and you approve, or you do it all */
export type ControlLevel = 'auto' | 'guided' | 'hands';
export type ControlArea = 'economy' | 'military' | 'diplomacy';
export type WorldStart = 'current' | 'depression' | 'coldwar' | 'peace';

export interface Settings {
  seed: number;
  aggression: number; // AI aggression multiplier 0.3 .. 2.0
  difficulty: Difficulty;
  start: StartCondition;
  defensiveAlliances: boolean;
  victory: VictoryMode;
  /** the fields below are optional so older saves still load */
  mode?: GameMode;
  control?: Record<ControlArea, ControlLevel>;
  /** what the economic autopilot aims for */
  econFocus?: 'growth' | 'stability' | 'military';
  randomEvents?: boolean;
  nukes?: boolean;
  world?: WorldStart;
  /** sandbox: stop at this year (null = endless) */
  endYear?: number | null;
  /** the player's (fictional) name, used in Legacy */
  leaderName?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  seed: 20240101,
  aggression: 1,
  difficulty: 'normal',
  start: 'historical',
  defensiveAlliances: true,
  victory: 'none',
  mode: 'sandbox',
  control: { economy: 'hands', military: 'hands', diplomacy: 'hands' },
  econFocus: 'growth',
  randomEvents: true,
  nukes: true,
  world: 'current',
  endYear: null,
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
  stabParts: Record<string, number>; // contributions to the stability target (for the explanation panel)
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
  warEconomy: boolean; // war footing: faster procurement, but unrest and inflation
  bld: { fort: number; airbase: number; port: number; factory: number; barracks: number; depot?: number }; // building levels owned (derived)
  unitCost: number; // annual cost per soldier at base prices (incl. support)
  /** public support for the war effort 0..1 (0.6 = normal); optional for older saves */
  warSupport?: number;
  /** last week's change in war support, split by cause (for the explanation panel) */
  wsParts?: Record<string, number>;
  /** casualties counter at the previous tick (weekly losses drive war support) */
  lastCas?: number;
  /** number of own regions currently cut off from supplies */
  pocket?: number;
  /** special operations under way (naval invasions, airborne assaults) */
  ops?: { prov: number; kind: 'naval' | 'airborne'; until: number }[];
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
  intent: string; // what this country is currently up to (AI), shown to the player
  /** national doctrines (economy / military / foreign policy) and when they last changed. Optional: derived from the government type when unset */
  /** an AI country's head of government (fictional) and its long-term aim */
  leader?: Leader;
  goal?: NatGoal;
  doctrine?: { eco: string; mil: string; dip: string; changed: number };
  /** the army's commanders (created when the country first goes to war) */
  generals?: General[];
}

export interface General {
  id: number; name: string; trait: string; xp: number; wins: number;
  status: 'active' | 'fallen' | 'retired'; since: number;
  /** region of the offensive this general leads (-1: home defence) */
  front: number;
  /** the player pinned this general to a front */
  pinned?: boolean;
}

export interface Leader { name: string; traits: [string, string]; since: number; /** personality deltas currently applied, so a successor can undo them */ applied: Partial<Record<'aggression' | 'expansion' | 'trade' | 'ideology' | 'caution', number>> }
export interface NatGoal { kind: string; target: number; text: string; since: number }
export interface Grudge { tick: number; why: string; w: number }

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
  fronts: { prov: ProvId; by: CountryId; progress: number; amphibious: boolean; atk?: number; def?: number; la?: number; ld?: number; gates?: boolean; rate?: number; sup?: number; from?: number; pocket?: boolean }[];
  /** casualty milestone already reported (index into drama.MILESTONES) */
  mile?: number;
  casualties: Record<number, number>;
  /** provinces captured (value, as share of enemy base weight) by each country in this war */
  gained: Record<number, number>;
  /** share of its holdings each country lost in this war */
  lost: Record<number, number>;
  /** at war start: total provinces held by each country, for war score */
  startProvs: Record<number, number>;
  /** regions captured in battle by each country */
  taken?: Record<number, number>;
}

/** A finished war between two countries (kept for the war history and the end-of-war summary). */
export interface WarRecord {
  id: number; name: string; a: CountryId; b: CountryId; start: number; end: number;
  casA: number; casB: number; provsA: number; provsB: number;
  /** who came out on top: 'a', 'b' or a draw */
  winner: 'a' | 'b' | 'draw'; terms: string;
}

export type OfferKind = 'trade' | 'nap' | 'alliance' | 'coop' | 'peace';
export interface Offer { id: number; from: CountryId; kind: OfferKind; terms?: { kind: string; share?: number }; tick: number }

export type LogKind = 'info' | 'war' | 'peace' | 'diplo' | 'econ' | 'danger' | 'territory';
/** `big` entries get a full-width BREAKING banner, a sound and a ring on the map at `prov` */
export interface LogEntry { seq: number; tick: number; text: string; kind: LogKind; countries: CountryId[]; important?: boolean; big?: boolean; prov?: number }

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
  /** last tick each AI proposal was sent to the player (prevents nagging) */
  offerLog: Record<string, number>;
  /** decision event waiting for the player (the game pauses until it is answered) */
  /** decisions waiting for the player: they never stop the clock, they lapse when ignored */
  inbox: InboxItem[];
  /** national megaprojects under way (player and AI) */
  projects: ProjectRun[];
  /** long memories: key `${victim}>${offender}` -> things the victim has not forgotten */
  grudges: Record<string, Grudge[]>;
  /** player trophies: id -> tick unlocked */
  trophies: Record<string, number>;
  /** the last end-of-year summary card shown to the player */
  review: { tick: number; title: string; lines: string[] } | null;
  /** the player's main rival (country id) or -1 */
  rival: number;
  /** the current world-wide crisis (recession, pandemic, cold war ...) and when the next one may start */
  crisis: { id: string; start: number; end: number } | null;
  nextCrisis: number;
  nextProject: number;
  nextInbox: number;
  recentEvents: string[];
  eventCooldown: Record<string, number>;
  lastEventTick: number;
  goalsDone: Record<string, number>;
  goalsActive: string[];
  goalBase: { trade: number; allies: number; rank: number; gdp: number; tech: number; debt: number };
  /** countries whose real numbers the player can currently see (intel op) → expiry tick */
  intelUntil: Record<number, number>;
  opCooldown: Record<string, number>;
  /** one-way security guarantees: "guarantor>protected" */
  guarantees: string[];
  scheduled: Scheduled[];
  /** province buildings: "provinceId:type" -> level 0..3 */
  bld: Record<string, number>;
  lastRipple: Ripple | null;
  resolutions: Resolution[];
  nextResolution: number;
  /** headline reactions of the last few player deals */
  history: { tick: number; text: string }[];
  /** counters used by objectives */
  stats: Record<string, number>;
  /** finished wars, newest last (optional for older saves) */
  warHistory?: WarRecord[];
  /** Legacy mode: your career as head of government */
  legacy?: LegacyState;
  /** the player's army groups (commanded in Guided / Hands-on military) */
  armies?: Army[];
}
export interface Reaction { id: CountryId; delta: number; text: string }
export interface Ripple { tick: number; a: CountryId; b: CountryId; kind: string; reactions: Reaction[]; summary: string }
export interface Scheduled { tick: number; id: string; data: Record<string, number> }
export interface Resolution { id: number; kind: 'condemn' | 'sanction' | 'ceasefire' | 'aid'; target: CountryId; victim: number; tick: number; yes: number; no: number; passed: boolean | null }
export interface ProjectRun { uid: number; id: string; owner: CountryId; cost: number; weeks: number; done: number; start: number; stalled: boolean }
export interface InboxItem { uid: number; id: string; tick: number; expires: number; urgent: boolean; data: Record<string, number> }

export const START_YEAR = 2024;
export const TICKS_PER_YEAR = 52;
export const DT = 1 / TICKS_PER_YEAR;
export const HIST_EVERY = 4;
export const HIST_MAX = 120;

export interface AgendaPick { id: string; start: number; base: number; done: boolean; failed?: boolean }
export interface TermRecord { term: number; start: number; end: number; score: number; headline: string; lines: string[]; result: 'reelected' | 'defeated' | 'retired' | 'ended' | 'ousted' | 'returned' | 'removed' }
export interface LegacyState {
  leader: string; title: string;
  status: 'office' | 'opposition' | 'ended';
  term: number; termStart: number; nextVote: number;
  agenda: AgendaPick[];
  /** cards offered at the start of a term (non-empty: the player is choosing) */
  hand: string[];
  score: number; parts: Record<string, number>;
  terms: TermRecord[];
  opposition?: { support: number; since: number; attempts: number; gov: string };
  start: { gdppc: number; rank: number; provinces: number; pop: number; stability: number; tick: number; power: number; rep?: number; allies?: number };
  endReason?: string;
  maxYear: number;
  /** milestones already written into the history book */
  chronicle: { tick: number; text: string }[];
}

export type ArmyOrder = 'advance' | 'hold' | 'encircle' | 'raid' | 'defend';
export interface Army {
  id: number; name: string;
  /** share of the field army (weights, normalised over all armies) */
  weight: number;
  order: ArmyOrder;
  /** the region it is ordered towards (enemy: attack it; own: stand there), -1 none */
  target: number;
  /** general in command (id), -1 none */
  general: number;
  /** where it was last seen (province), for drawing */
  at: number;
}
