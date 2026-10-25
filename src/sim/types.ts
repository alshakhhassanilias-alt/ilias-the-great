export type CountryId = number;
export type ProvId = number;

export type VictoryMode = 'none' | 'superpower' | 'economic' | 'conquest' | 'hegemon';
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
  /** Legacy: your own leadership style (two traits); the world reacts to it */
  leaderTraits?: [string, string];
  /** Sandbox: your national storyline on (default) or off */
  storylines?: boolean;
  /** the year the game begins: 2021 (before the wars of 2022–24) or 2024 (today). Older saves: 2024 */
  startYear?: 2021 | 2024;
}

export const DEFAULT_SETTINGS: Settings = {
  seed: 20240101,
  aggression: 1,
  difficulty: 'normal',
  start: 'historical',
  defensiveAlliances: true,
  victory: 'superpower',
  mode: 'sandbox',
  control: { economy: 'hands', military: 'hands', diplomacy: 'hands' },
  econFocus: 'growth',
  randomEvents: true,
  nukes: true,
  startYear: 2021,
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

export interface Org {
  id: number; key: string; name: string; icon: string;
  /** defence: members are allied (an attack on one is an attack on all); union: deep political and economic ties; economic: a club */
  kind: 'defence' | 'union' | 'economic';
  /** relations bonus between members */
  bonus: number;
  members: CountryId[];
  founded: number;
  /** who founded it (new organisations) */
  founder?: CountryId;
  /** the bloc it stands for, if any: +1 Western, −1 Eastern, 0 neither */
  camp: number;
  /** how deep the ties run (0..1): grows while members get on, frays when they do not; scales the relations bonus */
  depth?: number;
  /** the bonus at full strength, before depth scales it */
  base?: number;
  /** what happened to it: founded, merged, upgraded, split, renamed */
  history?: { tick: number; text: string }[];
  /** a member threatening to walk out unless the others carry more of the load */
  ultimatum?: { by: CountryId; until: number; since: number; /** the partners' defence spending (share of GDP) when it was issued */ avg0?: number };
}
export interface LedgerEntry { t: number; what: string; amount: number; borrowed: number }
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
  /** player only: recent one-off costs, income and automatic borrowing (newest last) */
  ledger?: LedgerEntry[];
  /** player only: set once the treasury has run dry and the deficit is being borrowed */
  dry?: boolean;
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
  /** war campaigns under way: strategic bombing, blockade, general offensive, defence in depth (see campaigns.ts) */
  camps?: { kind: 'bombing' | 'blockade' | 'offensive' | 'dig_in'; target: number; aim?: 'industry' | 'energy' | 'cities'; start: number; until: number; taken0?: number }[];
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
  /** form of government; it can change (revolution, coup, reform, emergency rule) */
  gov: string;
  /** geopolitical orientation: −1 the Eastern camp … 0 non-aligned … +1 the Western camp. Drifts with history. */
  orient?: number;
  /** 0..1: how far the Western camp treats it as an adversary (falls as it normalises relations) */
  hostile?: number;
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
  /** AI countries: how the public feels (shapes who wins the next election or seizes power) */
  mood?: Mood;
  doctrine?: { eco: string; mil: string; dip: string; changed: number };
  /** the army's commanders (created when the country first goes to war) */
  generals?: General[];
  /** the player's cabinet: four named ministers */
  cabinet?: Minister[];
  /** the player's domestic politics: factions, political capital, laws, crises */
  politics?: Politics;
  /** national path: completed projects and the one under way */
  nat?: { done: string[]; active?: { id: string; start: number; until: number } };
  /** a change of foreign-policy course under way: West, East, a third way, or leading the region */
  course?: { id: 'west' | 'east' | 'third' | 'region' | 'lead'; stage: number; until: number; started: number; leaders: number[]; old: number[]; neighbors: number[]; org?: number; name?: string };
  /** the national storyline: next act, when it comes, choices made, path, rival, ending */
  story?: { act: number; next: number; path: number[]; arch?: 'reform' | 'iron' | 'pragmatic'; rival?: number; ending?: string; ch?: number; issue?: string; past?: { ch: number; ending: string; arch: string; issue: string; path: number[]; tick: number }[];
    /** reactive acts: the act waits (from `next`) for something to happen, or until `due`; `why` is what happened; `snap` the world when the last act closed */
    due?: number; why?: string; snap?: { t: number; rel: number; troops: number; ws: number; gdp: number; nb: string; ml: string } };
  /** courses completed, for the record */
  coursesDone?: string[];
  /** national challenges (see character.ts): severity 0..100 and any response still working */
  chal?: Record<string, { sev: number; drift?: number; until?: number }>;
  /** the player's weapons programmes */
  progs?: { id: string; until: number; done: boolean }[];
  /** the name this country's national data is filed under (set when it is renamed; see keyOf) */
  key?: string;
  /** whose names its people carry (a breakaway state keeps its parent's), see names.ts */
  culture?: string;
  /** how a nation founded during the game came to be (see epochs.ts) */
  origin?: { tick: number; from: CountryId; how: 'independence' | 'revival' | 'union' | 'collapse'; formerly?: string };
  /** the name before an imperial title or a union renamed it */
  baseName?: string;
  /** research: rungs climbed in each of the five branches (see research.ts) */
  rs?: import('./research').Research;
  /** industries: capacity in each of the eight sectors (see industry.ts) */
  ind?: import('./industry').Industry;
}

export type FactionId = 'labour' | 'business' | 'military' | 'nationalists' | 'liberals' | 'regions';
export interface Faction { id: FactionId; support: number; mood: number; mem: number; leader: string }
export interface ArcState { id: string; stage: number; started: number; next?: { ev: string; at: number; data: Record<string, number> } }
export interface Politics {
  /** political capital: earned weekly, spent on laws, decrees and crisis responses */
  pc: number;
  laws: { id: string; since: number }[];
  factions: Faction[];
  /** the budget and position when politics began: factions judge changes against it */
  base: { social: number; infra: number; military: number; taxVat: number; taxIncome: number; taxCorporate: number; education: number; provinces: number };
  nextDemand: number;
  /** a faction in open revolt and until when */
  unrest?: { f: FactionId; until: number };
  arc?: ArcState;
  lastArc: number;
  /** a change of political system under way (see regime.ts) */
  reform?: { path: string; stage: number; next: number; since: number; note?: string };
  /** the government: coalition partners (or the regime's pillars) and their demands (see coalition.ts) */
  gov?: import('./coalition').Coalition;
  /** multiplier on the capital laws cost (the leader's administration skill in Legacy) */
  lawMult?: number;
  /** last week's change in each faction's mood, and the stability/approval it adds */
  stab: number;
  appr: number;
}

export type MinRole = 'finance' | 'foreign' | 'defence' | 'interior';
export interface Minister {
  id: number; role: MinRole; name: string; trait: string;
  /** 1-5 */
  skill: number;
  /** 0-100: below 30 they brief against you, below 12 they quit */
  loyalty: number;
  since: number;
  /** tick of their last scandal */
  scandal?: number;
}
export interface Cable { tick: number; from: CountryId; text: string; mood: 'warm' | 'cold' | 'angry' | 'neutral'; seq: number }

export interface General {
  id: number; name: string; trait: string; xp: number; wins: number;
  status: 'active' | 'fallen' | 'retired'; since: number;
  /** region of the offensive this general leads (-1: home defence) */
  front: number;
  /** the player pinned this general to a front */
  pinned?: boolean;
}

export type Drive = 'security' | 'expansion' | 'wealth' | 'prestige' | 'ideology';
export interface Leader {
  name: string; traits: [string, string]; since: number;
  /** personality deltas currently applied, so a successor can undo them */
  applied: Partial<Record<'aggression' | 'expansion' | 'trade' | 'ideology' | 'caution', number>>;
  /** what this leader cares about (weights sum to 1) */
  agenda?: Record<Drive, number>;
  /** −1 "our country first" (wants out of foreign commitments) … +1 believes in alliances and institutions */
  commit?: number;
  /** the camp this leader personally prefers: −1 East … +1 West */
  lean?: number;
  /** why this leader came to power, in words */
  mandate?: string;
  /** a leader who broke with the old line: where the country stood when it began */
  turn?: { from: number; since: number };
}
/** How an AI country's public feels (0..1 each), smoothed month by month. */
export interface Mood { weary: number; burden: number; pain: number; threat: number; shame: number }
/** What a country has done, as the world remembers it (fades over about a decade). */
export interface Record_ { aggr: number; conquest: number; betray: number; loyal: number; sanction: number; repress: number; reform: number; aid: number; defaulted: number; nuke: number }
export interface NatGoal {
  kind: string; target: number; text: string; since: number;
  /** long-term plans: how far along (0..1), the best it has been, patience left (0..1), an org or other detail, last news */
  progress?: number; best?: number; patience?: number; ref?: number; note?: string; step?: number;
}
/**
 * A reconciliation process with a hostile country: back channel → confidence-building gestures → summit →
 * normalisation (a détente that lasts while it is kept up).
 */
export interface Track {
  stage: 1 | 2 | 3 | 4 | 5;
  /** a gesture they have asked for, and until when (doing it counts double) */
  ask?: string; askUntil?: number;
  /** when the summit succeeded (a friendship treaty needs a year of détente) */
  summitAt?: number;
  /** 0..100: built by gestures, broken by incidents */
  trust: number;
  /** the next step is possible from this tick */
  next: number;
  since: number;
  /** gestures already made (each once) */
  done: string[];
  /** while the détente lasts, relations warm every week */
  detenteUntil?: number;
  /** the last thing that happened, for the UI */
  note?: string;
}
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
  /** civilian deaths by country (estimated from the fighting on its soil) */
  civ?: Record<number, number>;
  /** people who fled regions that changed hands */
  displaced?: number;
  /** every 4 weeks: [tick, attackers' military casualties, defenders', attackers' war score ×100] */
  hist?: number[][];
}

/** A finished war between two countries (kept for the war history and the end-of-war summary). */
export interface WarRecord {
  id: number; name: string; a: CountryId; b: CountryId; start: number; end: number;
  casA: number; casB: number; provsA: number; provsB: number;
  /** who came out on top: 'a', 'b' or a draw */
  winner: 'a' | 'b' | 'draw'; terms: string;
  civ?: number; displaced?: number; hist?: number[][]; atk?: CountryId[]; def?: CountryId[];
}

export type OfferKind = 'trade' | 'nap' | 'alliance' | 'coop' | 'peace';
export interface Offer { id: number; from: CountryId; kind: OfferKind; terms?: { kind: string; share?: number; extras?: ('reparations' | 'demilitarise' | 'leave_alliances' | 'friendly_gov' | 'apology')[] }; tick: number }

export type LogKind = 'info' | 'war' | 'peace' | 'diplo' | 'econ' | 'danger' | 'territory';
/** `big` entries get a full-width BREAKING banner, a sound and a ring on the map at `prov` */
export interface LogEntry { seq: number; tick: number; text: string; kind: LogKind; countries: CountryId[]; important?: boolean; big?: boolean; prov?: number }

export interface Market { priceE: number; priceF: number; scarcityE: number; scarcityF: number; /** chips and critical minerals (1 = normal; see trade.ts) */ priceC?: number; priceM?: number }

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
  /** long memory between pairs of countries: decades of goodwill or enmity that outlast the news cycle */
  relHist?: Record<string, number>;
  /** international organisations (alliances, unions, economic clubs); membership changes with the world */
  orgs?: Org[];
  /** bumps whenever any organisation's membership changes (relation caches key on it) */
  orgVer?: number;
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
  /** each country's record as the world remembers it (by country id) */
  rec?: Record<number, Record_>;
  /** player trophies: id -> tick unlocked */
  trophies: Record<string, number>;
  /** the last end-of-year summary card shown to the player */
  review: { tick: number; title: string; lines: string[] } | null;
  /** the player's main rival (country id) or -1 */
  rival: number;
  /** negotiating-table memory per country: patience left and any standing counteroffer */
  nego?: Record<number, { patience: number; until: number; counter?: { goal: string; give: string[]; tick: number }; track?: Track; loan?: number }>;
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
  /** the long story of the map: nations born, revived, united and fallen (see epochs.ts) */
  chronicle?: ChronicleEntry[];
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
  /** quotes from foreign leaders to the player, newest last */
  cables?: Cable[];
  /** export bans: a producer stops selling a good to a country (see trade.ts) */
  bans?: { from: CountryId; to: CountryId; good: 'chips' | 'minerals' | 'energy' | 'food'; since: number }[];
  /** tariffs: "from>to" → tick imposed */
  tariffs?: Record<string, number>;
  /** obligations from peace treaties: reparations being paid, demilitarised countries */
  peaceDeals?: PeaceDeal[];
  /** occupied regions: resistance 0..1 (sparse: only regions held by a foreign power) */
  resist?: Record<number, number>;
  /** occupied regions: resentment built up by reprisals (pushes resistance back up later) */
  resent?: Record<number, number>;
  /** coalitions formed against aggressors */
  coalitions?: { target: CountryId; members: CountryId[]; since: number }[];
  /** what the world said about the player's last moves (see reactions.ts) */
  voices?: import('./reactions').VoiceSet[];
  /** world markets for the eight industrial sectors: prices, shares, booms and gluts (see industry.ts) */
  mkt?: import('./industry').MarketState;
  /** influence each power holds in each country: inf[target][power] (see influence.ts) */
  inf?: Record<number, Record<number, number>>;
  /** spheres of influence as of the last monthly update: target -> patron (see influence.ts) */
  sph?: Record<number, number>;
  /** the world's research: who knows what, the frontier, the leaders (refreshed monthly; see research.ts) */
  rsw?: import('./research').WorldResearch;
}
/** a peace obligation: `b` pays reparations to `a`, or `b` is demilitarised by `a`, until a tick */
export interface PeaceDeal { kind: 'rep' | 'demil'; a: CountryId; b: CountryId; until: number; share?: number; paid?: number }
export interface Reaction { id: CountryId; delta: number; text: string }
export interface Ripple { tick: number; a: CountryId; b: CountryId; kind: string; reactions: Reaction[]; summary: string }
export interface Scheduled { tick: number; id: string; data: Record<string, number> }
export interface Resolution { id: number; kind: 'condemn' | 'sanction' | 'ceasefire' | 'aid'; target: CountryId; victim: number; tick: number; yes: number; no: number; passed: boolean | null }
export interface ProjectRun { uid: number; id: string; owner: CountryId; cost: number; weeks: number; done: number; start: number; stalled: boolean }
export interface ChronicleEntry { tick: number; kind: 'born' | 'revived' | 'union' | 'fell' | 'renamed' | 'collapse'; text: string; ids: CountryId[] }
export interface InboxItem { uid: number; id: string; tick: number; expires: number; urgent: boolean; data: Record<string, number> }

/** the year of tick 0 for the game being played (set when a game is created or loaded) */
export let START_YEAR = 2024;
export function setStartYear(y: number) { START_YEAR = y; }
export const TICKS_PER_YEAR = 52;
export const DT = 1 / TICKS_PER_YEAR;
export const HIST_EVERY = 4;
export const HIST_MAX = 120;

/** pts: legacy points this promise earned (+) or cost (−) once judged */
export interface AgendaPick { id: string; start: number; base: number; done: boolean; failed?: boolean; pts?: number }
/** one war of yours during the career, as the legacy score counts it */
export interface LegacyWar { tick: number; name: string; foe: string; result: 'won' | 'lost' | 'draw'; pts: number; aim?: string; aimOk?: boolean; aimPts?: number }
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
  /** every war you fought while in office, with the points it earned (the "Wars" and "War aims" parts) */
  wars?: LegacyWar[];
  /** career promise tally */
  promises?: { kept: number; broken: number };
  /** your leadership style (two traits) */
  traits?: [string, string];
  /** what you did yourself, as the world remembers it: it follows you out of office and back in */
  rec?: Record_;
  /** the leader as a person: age, health, skills, the party rival, career deeds (see persona.ts) */
  persona?: import('./persona').Persona;
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
