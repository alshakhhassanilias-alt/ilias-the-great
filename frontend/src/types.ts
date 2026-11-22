export interface Leader { name: string; title: string; born: number; since: number; traits: Record<string, number>; digital?: boolean }
export interface CountrySummary {
  tag: string; name: string; adj: string; color: string; alive: boolean; gov: string; ideology: string; ideology_id: string; leader: Leader
  gdp: number; pop: number; stability: number; overlord: string | null; power: number; capital: string | null; home: string; founded: number | null; fell: number | null
}
export interface Memory { y: number; other: string; kind: string; w: number; text: string; hist?: boolean }
export interface Project { id: string; kind: string; name: string; target?: string; cost: number; years: number; progress: number; started: number; desc: string }
export interface PlayerCountry extends CountrySummary {
  legitimacy: number; war_support: number; exhaustion: number; treasury: number; debt: number; budget: Record<string, number>
  army: number; navy: number; air: number; space: number; nukes: number; mil_mix: Record<string, number>; techs: string[]
  research: { target: string | null; progress: number; cost?: number; name?: string; rate: number; queue?: string[] }; focus: string | null
  policies: Record<string, any>; laws: { name: string; text: string; year: number }[]; pops: { dig: number; ai: number; enh: number }
  flags: Record<string, any>; origin: string; heritage: { name: string; tag?: string; rose?: number; fell?: number }[]; ambitions: string[]
  memories: Memory[]; claims: number; projects: Project[]; gpc: number; ideology_desc: string; dynasty?: { name: string; founded: number; rulers: number }
  faith?: string; unlocks: string[]
}
export interface Objective { text: string; cond: any; done?: boolean }
export interface Mission {
  id: string; key: string; title: string; category: string; desc: string; importance: string; objectives: Objective[]; mode: string
  rewards: Record<string, number>; reward_text: string; failure: Record<string, number>; failure_text: string; deadline: number | null
  optional: boolean; hidden: boolean; status: string; created: number; closed?: number; source: string; progress: number; tracked: boolean; note?: string; actors: string[]
}
export interface Thread { id: string; kind: string; title: string; summary: string; actors: string[]; tension: number; started: number; beats: { y: number; t: string }[]; status: string }
export interface Decision { id: string; kind: string; title: string; body: string; options: { id: string; label: string; desc: string }[]; year: number; month: number; deadline: number }
export interface War { id: string; name: string; att: string[]; def: string[]; lead_att: string; lead_def: string; start: number; goal: string; score: number; exh: Record<string, number>; cas: Record<string, number>; world_war: boolean }
export interface Org { id: string; name: string; kind: string; founded: number; members: string[]; desc: string; leader: string | null }
export interface Treaty { id: string; type: string; members: string[]; since: number; name: string; secret: boolean }
export interface GameEvent { id: number; year: number; month: number; kind: string; title: string; body: string; actors: string[]; importance: number; provinces: string[]; tags: string[]; thread?: string | null; data?: any; backstory?: boolean }
export interface Body { id: string; name: string; kind: string; unlocked: number; by: string; terraform: number }
export interface ExtraGeo { name: string; c: [number, number]; nb: string[]; body: string }
// province tuple: owner, ctrl, unrest, pop, gpc, integ, body, core, autonomy_desire
export type ProvTuple = [string | null, string | null, number, number, number, number, string, number, number]
export interface CampaignView {
  id: string; name: string
  meta: { year: number; month: number; start_year: number; scenario: string; scenario_name: string; player: string; era: string; period: string; phase: string; phase_label: string; phase_metrics: Record<string, number>; divergence: string; world_wars?: number; [k: string]: any }
  player: PlayerCountry | null; countries: Record<string, CountrySummary>; wars: War[]; treaties: Treaty[]; orgs: Org[]
  missions: Mission[]; hidden_missions: number; threads: Thread[]; decisions: Decision[]; bodies: Record<string, Body>; extra_geo: Record<string, ExtraGeo>
  history: Record<string, number[][]>; world: { gdp: number; pop: number; countries: number; dig: number; offworld: number }
  milestones: { y: number; title: string; actors: string[]; kind: string }[]; ideologies: Record<string, any>; faiths: Record<string, any>
  recent_events: GameEvent[]; provinces?: Record<string, ProvTuple>; relations?: Record<string, [number, number]>
}
export interface Assessment { ok: boolean; feasibility: string; cost: number; years: number; explanation: string; consequences: string[]; alternative?: any }
export interface PlannedAction { type: string; summary: string; assessment: Assessment; [k: string]: any }
export interface Plan { text: string; actions: PlannedAction[]; notes: string[]; clarify: string | null; interpreter: string }
export interface Scenario { id: string; name: string; year: number | null; month: number; kind: string; desc: string }
export interface ScenarioCountry { tag: string; name: string; color: string; gov: string; ideology: string; leader: string; gdp_share: number; pop: number; power: number; subject_of: string | null; provinces: number }
