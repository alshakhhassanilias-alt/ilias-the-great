/**
 * National storylines. Every country has one, written from its real situation (data/stories.ts): four acts, each a
 * decision with branches, and an ending that depends on the road taken.
 *
 *   Act I   — the problem that defines its age. How you answer sets your path: the reformer, the iron hand, or the
 *             pragmatist who looks for outside help.
 *   Act II  — its rival or its most difficult neighbour. Your path unlocks one option the others do not have.
 *   Act III — the future of its economy, shaped by what it lives on (oil, mines, farms, factories, tech ...).
 *   Act IV  — its place in the world. You can set out on a change of course (West, East, a third way, your region).
 *
 * When the fourth act closes the chapter gets its ending. Some years later a new chapter opens, built from where the
 * country stands by then (debt, inflation, war damage, sanctions, unrest), not from where it stood in 2024.
 *
 * AI countries play their storylines too, choosing by their character; the turns of the big powers make the news.
 */
import type { Geo } from './geo';
import { RIVALRIES, CLAIMS, COUNTRY_BASE } from '../data/countryData';
import { STORIES, type EconKind, type IssueKind } from '../data/stories';
import { hash01, nextRand } from './rng';
import { clamp, fmtMoney } from './util';
import { logEvent } from './log';
import { NAME_TO_ID, addRelation, areAtWar, getRelation, isAtWar, orgsOf } from './relations';
import { neighborsOf } from './diplomacy';
import { strength } from './military';
import { fund } from './actions';
import { sway, spendPC } from './domestic';
import { changeGov } from './alignment';
import { coursesFor, type CourseId } from './courses';
import { isMajor } from './drama';
import { addRec, type RecKey } from './minds';
import { geoRefGet } from './geoRef';
import type { EventDef, EventOption, D } from './eventkit';
import type { Country, CountryId, FactionId, GameState } from './types';

export type Arch = 'reform' | 'iron' | 'pragmatic';
export const ARCH_LABEL: Record<Arch, string> = { reform: 'the reformer', iron: 'the iron hand', pragmatic: 'the pragmatist' };
const ARCHS: Arch[] = ['reform', 'iron', 'pragmatic'];

// ------------------------------------------------------------------ effects
interface Fx {
  stab?: number; rep?: number; pc?: number; cash?: number; fac?: Partial<Record<FactionId, number>>;
  social?: number; mil?: number; collection?: number; debtCut?: number; inflation?: number; tfp?: number; capital?: number; tech?: number; infra?: number;
  food?: number; energy?: number; labour?: number; readiness?: number; gov?: string; orient?: number; hostile?: number;
  rival?: number; patron?: number; west?: number; east?: number; neighbors?: number; cb?: boolean; chance?: [number, Fx, string];
  /** what the world will remember about this choice */
  rec?: Partial<Record<RecKey, number>>;
}
const fmtFx = (f: Fx) => {
  const o: string[] = [];
  if (f.cash) o.push(f.cash < 0 ? `Costs ${(-f.cash * 100).toFixed(1)}% of GDP` : `Gain ${(f.cash * 100).toFixed(1)}% of GDP`);
  if (f.pc) o.push(`Costs ${-f.pc} political capital`);
  if (f.stab) o.push(`stability ${f.stab > 0 ? '+' : ''}${f.stab}`);
  if (f.rep) o.push(`reputation ${f.rep > 0 ? '+' : ''}${f.rep}`);
  if (f.rival) o.push(`relations with your rival ${f.rival > 0 ? '+' : ''}${f.rival}`);
  if (f.patron) o.push(`relations with your patron ${f.patron > 0 ? '+' : ''}${f.patron}`);
  if (f.west) o.push(`Western relations ${f.west > 0 ? '+' : ''}${f.west}`);
  if (f.east) o.push(`Eastern relations ${f.east > 0 ? '+' : ''}${f.east}`);
  if (f.neighbors) o.push(`neighbours ${f.neighbors > 0 ? '+' : ''}${f.neighbors}`);
  if (f.orient) o.push(f.orient > 0 ? 'leans West' : 'leans East');
  if (f.gov) o.push(f.gov === 'D' ? 'becomes a democracy' : f.gov === 'A' ? 'becomes authoritarian' : 'a freer system');
  if (f.social) o.push(`public spending ${f.social > 0 ? '+' : ''}${(f.social * 100).toFixed(1)}% of GDP/yr`);
  if (f.mil) o.push(`defence ${f.mil > 0 ? '+' : ''}${(f.mil * 100).toFixed(1)}% of GDP/yr`);
  if (f.debtCut) o.push(`debt −${(f.debtCut * 100).toFixed(0)}%`);
  if (f.inflation) o.push(`inflation ${f.inflation < 0 ? 'down' : 'up'}`);
  if (f.tfp || f.capital || f.tech) o.push('economy grows');
  if (f.food) o.push('more food');
  if (f.energy) o.push('more energy');
  if (f.cb) o.push('a cause for war');
  if (f.fac) for (const [k, v] of Object.entries(f.fac)) if (v) o.push(`${k} ${(v as number) > 0 ? '+' : ''}${v}`);
  if (f.chance) o.push(`${Math.round(f.chance[0] * 100)}%: ${f.chance[2]}`);
  const world = f.rec?.repress ? 'the world will remember the crackdown' : f.rec?.reform ? 'the world notices the reform' : f.rec?.defaulted ? 'creditors will remember' : '';
  if (world) o.splice(Math.min(2, o.length), 0, world);
  return o.slice(0, 7).join(' · ');
};

/** The country's patron: the strongest power it gets on with. */
function patronOf(s: GameState, c: Country): CountryId | -1 {
  return s.countries.filter((x) => x.alive && x.id !== c.id && isMajor(s, x.id)).sort((a, b) => getRelation(s, c.id, b.id) * 2 + strength(b) / 1e6 - (getRelation(s, c.id, a.id) * 2 + strength(a) / 1e6))[0]?.id ?? -1;
}
const camp = (s: GameState, sign: number, me: number) => s.countries.filter((x) => x.alive && x.id !== me && (x.orient ?? 0) * sign > 0.5).sort((a, b) => strength(b) - strength(a)).slice(0, 3).map((x) => x.id);

function applyFx(s: GameState, c: Country, f: Fx, d: D): string {
  const e = c.eco;
  if (f.pc) spendPC(c, -f.pc);
  if (f.cash) { if (f.cash < 0) fund(s, c.id, -f.cash * e.gdp, 'Storyline decision'); else e.cash += f.cash * e.gdp; }
  if (f.stab) e.stability = clamp(e.stability + f.stab, 0, 100);
  if (f.rep) c.reputation = clamp(c.reputation + f.rep, 0, 100);
  if (f.fac && c.isPlayer) for (const [k, v] of Object.entries(f.fac)) sway(c, k as FactionId, v as number);
  if (f.social) c.budget.social = clamp(c.budget.social + f.social, 0, 0.35);
  if (f.mil) c.budget.military = clamp(c.budget.military + f.mil, 0.002, 0.2);
  if (f.collection) e.collection = clamp(e.collection + f.collection, 0.4, 0.98);
  if (f.debtCut) e.debt *= 1 - f.debtCut;
  if (f.inflation) e.monetary += f.inflation;
  if (f.tfp) e.tfp *= 1 + f.tfp;
  if (f.capital) e.capital *= 1 + f.capital;
  if (f.tech) e.tech = clamp(e.tech + f.tech, 0, 100);
  if (f.infra) e.infra = clamp(e.infra + f.infra, 5, 100);
  if (f.food) e.foodCap *= 1 + f.food;
  if (f.energy) e.energyCap *= 1 + f.energy;
  if (f.labour) { e.laborForce *= 1 + f.labour; e.pop *= 1 + f.labour * 0.6; }
  if (f.readiness) c.mil.readiness = clamp(c.mil.readiness + f.readiness, 0.2, 1);
  if (f.orient) c.orient = clamp((c.orient ?? 0) + f.orient, -1, 1);
  if (f.hostile) c.hostile = clamp((c.hostile ?? 0) + f.hostile, 0, 1);
  if (f.gov && c.gov !== f.gov) changeGov(s, c, f.gov, f.gov === 'D' ? 'a new constitution guarantees free elections' : f.gov === 'A' ? 'the government suspends the old checks and balances' : 'power is shared more widely');
  const rival = d.rv ?? -1;
  if (f.rival && rival >= 0 && s.countries[rival]?.alive) addRelation(s, c.id, rival, f.rival);
  if (f.cb && rival >= 0) s.stats[`cb:${c.id}>${rival}`] = 1;
  const p = patronOf(s, c);
  if (f.patron && p >= 0) addRelation(s, c.id, p, f.patron);
  if (f.west) for (const x of camp(s, 1, c.id)) addRelation(s, c.id, x, f.west);
  if (f.east) for (const x of camp(s, -1, c.id)) addRelation(s, c.id, x, f.east);
  if (f.neighbors) { const geo = geoRefGet(); if (geo) for (const x of neighborsOf(s, geo, c.id)) addRelation(s, c.id, x, f.neighbors); }
  if (f.rec) for (const [k, v] of Object.entries(f.rec)) addRec(s, c.id, k as RecKey, v as number);
  if (f.chance) { if (nextRand(s) < f.chance[0]) { applyFx(s, c, f.chance[1], d); return f.chance[2]; } }
  return '';
}

// ------------------------------------------------------------------ Act I: the defining problem
type Opt = [label: string, hint: string, fx: Fx, done: string];
const ISSUE: Record<IssueKind, { title: string; opts: [Opt, Opt, Opt] }> = {
  corruption: { title: 'The Clean-Up', opts: [
    ['Independent anti-graft courts', '', { rec: { reform: 0.5 }, pc: -15, collection: 0.02, rep: 4, stab: -2, fac: { liberals: 10, business: -6 } }, 'Prosecutors start knocking on doors.'],
    ['Purge the oligarchs, seize their assets', '', { rec: { repress: 0.4 }, cash: 0.008, stab: 3, rep: -4, fac: { business: -14, nationalists: 8, liberals: -8 } }, 'Yachts, villas and factories pass to the state.'],
    ['Invite foreign auditors and a reform programme', '', { collection: 0.01, rep: 3, patron: 8, fac: { nationalists: -6, business: 4 } }, 'Foreign advisers move into the ministries.'] ] },
  debt: { title: 'The Debt Trap', opts: [
    ['Austerity and reform', '', { social: -0.01, debtCut: 0.06, stab: -4, rep: 3, fac: { business: 8, labour: -10 } }, 'The budget is cut to the bone. Bond markets cheer; the unions do not.'],
    ['Default and blame the foreigners', '', { rec: { defaulted: 1 }, debtCut: 0.3, rep: -10, stab: 2, fac: { nationalists: 10, business: -10 } }, 'The country stops paying. Creditors howl.'],
    ['A bailout from a great power', '', { cash: 0.02, patron: 10, orient: 0, fac: { nationalists: -6 } }, 'The money arrives, and so do the conditions.'] ] },
  separatism: { title: 'The Restless Region', opts: [
    ['Autonomy and federalism', '', { rec: { reform: 0.3 }, stab: 3, rep: 3, fac: { regions: 15, nationalists: -10 } }, 'A new statute gives the region its own parliament.'],
    ['Crush the separatists', '', { rec: { repress: 1 }, stab: -3, rep: -6, readiness: 0.03, fac: { military: 8, regions: -15, liberals: -10 } }, 'Troops and police move in. The leaders flee or are arrested.'],
    ['Let the region vote', '', { rec: { reform: 0.6 }, rep: 6, chance: [0.6, { stab: 6, fac: { regions: 10 } }, 'they vote to stay'], fac: { nationalists: -8 } }, 'The ballots are counted under international observers.'] ] },
  insurgency: { title: 'The War in the Hills', opts: [
    ['Peace talks and amnesty', '', { pc: -10, rep: 5, chance: [0.55, { stab: 8 }, 'the rebels lay down their arms'], fac: { military: -6, liberals: 6 } }, 'Negotiators meet in a neutral capital.'],
    ['Total war on the rebels', '', { rec: { repress: 0.5 }, mil: 0.005, stab: 4, rep: -4, readiness: 0.05, fac: { military: 10, liberals: -8 } }, 'Offensives roll into the rebel strongholds.'],
    ['Call in foreign help', '', { stab: 5, patron: 10, orient: 0, fac: { nationalists: -10, military: -4 } }, 'Foreign advisers, drones and special forces arrive.'] ] },
  divided: { title: 'The Divided House', opts: [
    ['A power-sharing constitution', '', { rec: { reform: 0.4 }, pc: -10, stab: 5, rep: 4, fac: { regions: 8, nationalists: -6 } }, 'Every community gets its share, and its veto.'],
    ['One nation, one identity', '', { rec: { repress: 0.6 }, stab: -2, rep: -5, fac: { nationalists: 14, regions: -12, liberals: -8 } }, 'One language, one flag, one story in every school.'],
    ['Federal regions run their own affairs', '', { stab: 3, fac: { regions: 12, business: 3 } }, 'Power flows from the capital to the regions.'] ] },
  succession: { title: 'The Succession', opts: [
    ['Hand power to an elected parliament', '', { rec: { reform: 1 }, gov: 'F', rep: 8, stab: -4, orient: 0.08, fac: { liberals: 15, military: -8 } }, 'For the first time, parliament holds real power.'],
    ['The heir takes over, the grip tightens', '', { rec: { repress: 0.6 }, gov: 'A', stab: 4, rep: -5, fac: { military: 8, liberals: -12 } }, 'A carefully staged handover. The security services watch everyone.'],
    ['A council of elders and technocrats', '', { stab: 2, collection: 0.01, fac: { business: 6 } }, 'A collective leadership balances the clans and the ministries.'] ] },
  climate: { title: 'The Rising Waters', opts: [
    ['Sea walls, drainage and resilient towns', '', { cash: -0.01, infra: 3, stab: 2, rep: 4 }, 'Bulldozers and engineers reshape the coast.'],
    ['Growth first, adapt later', '', { tfp: 0.003, stab: -2, rep: -3, fac: { business: 6 } }, 'The money goes to growth. The water keeps rising.'],
    ['Take the case to the world', '', { cash: 0.006, rep: 6, west: 4 }, 'A climate fund and a court case at The Hague.'] ] },
  exodus: { title: 'The Empty Cradle', opts: [
    ['Open the doors to immigrants', '', { labour: 0.01, stab: -2, fac: { business: 8, nationalists: -10, liberals: 6 } }, 'Visas, citizenship tracks and language schools.'],
    ['Families first: pay people to stay and have children', '', { social: 0.005, stab: 2, fac: { nationalists: 6, labour: 4 } }, 'Child bonuses, cheap housing and longer leave.'],
    ['Robots, diaspora bonds and tech hubs', '', { tech: 2, cash: 0.003, capital: 0.01, fac: { business: 4 } }, 'Factories automate; the diaspora invests.'] ] },
  rebuild: { title: 'Out of the Ruins', opts: [
    ['Truth, reconciliation and elections', '', { rec: { reform: 0.6 }, pc: -10, stab: 5, rep: 6, gov: 'F', fac: { liberals: 10, military: -6 } }, 'Commissions hear the stories; ballot boxes go up.'],
    ['A victor\'s peace and a strong state', '', { rec: { repress: 0.5 }, stab: 4, rep: -5, mil: 0.004, fac: { military: 10, liberals: -10 } }, 'The winners write the rules.'],
    ['A donors\' conference', '', { cash: 0.015, infra: 2, patron: 8, fac: { nationalists: -6 } }, 'Pledges pour in, with strings attached.'] ] },
  crime: { title: 'The Cartels', opts: [
    ['Clean police, real courts', '', { rec: { reform: 0.4 }, pc: -12, collection: 0.01, rep: 3, chance: [0.5, { stab: 6 }, 'crime starts to fall'], fac: { liberals: 6 } }, 'Purged police forces and new prosecutors.'],
    ['Mano dura: mass arrests', '', { rec: { repress: 0.8 }, stab: 6, rep: -6, fac: { liberals: -14, nationalists: 8, military: 4 } }, 'Tens of thousands are rounded up. The streets go quiet.'],
    ['A quiet truce with the gangs', '', { stab: 3, rep: -3, fac: { business: -4 } }, 'The killings drop. Nobody asks what was promised.'] ] },
  polarised: { title: 'The Broken Consensus', opts: [
    ['Reach across the divide', '', { pc: -10, stab: 4, fac: { liberals: 4, nationalists: 4 } }, 'A grand coalition and a national dialogue.'],
    ['Rule for your own camp', '', { rec: { repress: 0.2 }, stab: -3, pc: 10, fac: { nationalists: 8, liberals: -10 } }, 'Your base loves it. The other half seethes.'],
    ['Change the rules: electoral reform', '', { rec: { reform: 0.5 }, pc: -8, rep: 3, stab: 2, fac: { liberals: 8 } }, 'A new voting system and an independent electoral commission.'] ] },
  isolated: { title: 'Out in the Cold', opts: [
    ['Talks to lift the sanctions', '', { hostile: -0.2, west: 8, orient: 0.08, fac: { nationalists: -8, business: 8 } }, 'Envoys meet in neutral capitals.'],
    ['Fortress economy', '', { stab: 2, tfp: -0.002, fac: { nationalists: 8, business: -4 } }, 'Self-reliance, rationing and pride.'],
    ['Sanction-busting with the East', '', { cash: 0.004, east: 8, orient: -0.06 }, 'Shadow tankers and new payment channels.'] ] },
  reunify: { title: 'The Divided Land', opts: [
    ['Engagement: trade, families, talks', '', { rival: 15, rep: 5, stab: -1, fac: { business: 6, nationalists: -6 } }, 'Border crossings reopen; families meet.'],
    ['Deterrence and pressure', '', { rival: -10, mil: 0.005, readiness: 0.05, fac: { military: 8, nationalists: 6 } }, 'More troops, more missiles, harder words.'],
    ['Ask the great powers for guarantees', '', { patron: 10, rep: 3 }, 'Diplomats seek a deal over your heads, and on your behalf.'] ] },
  army: { title: 'The Generals', opts: [
    ['Civilian control over the army', '', { rec: { reform: 0.8 }, pc: -15, rep: 6, gov: 'F', chance: [0.25, { stab: -8 }, 'the officers resist'], fac: { military: -14, liberals: 10 } }, 'The defence ministry gets a civilian chief and the army goes back to barracks.'],
    ['Let the generals run the state', '', { rec: { repress: 0.8 }, gov: 'A', stab: 5, rep: -6, fac: { military: 14, liberals: -12 } }, 'The officers take the ministries.'],
    ['Buy their loyalty', '', { mil: 0.004, cash: -0.003, stab: 2, fac: { military: 8 } }, 'Pay rises, villas and business licences for the officer corps.'] ] },
  inflation: { title: 'The Runaway Prices', opts: [
    ['Shock therapy: high rates, balanced budget', '', { inflation: -0.03, stab: -5, fac: { business: 8, labour: -10 } }, 'Rates soar; prices stop climbing, and so do jobs.'],
    ['Price controls and subsidies', '', { social: 0.005, stab: 3, inflation: 0.01, fac: { labour: 8, business: -8 } }, 'Shops get price lists from the government.'],
    ['Dollarise: abandon the national currency', '', { inflation: -0.04, stab: -2, rep: 2, fac: { nationalists: -10, business: 6 } }, 'The central bank hands over the keys.'] ] },
  energy: { title: 'The Energy Shock', opts: [
    ['Wind, sun and grids', '', { cash: -0.008, energy: 0.06, rep: 4, fac: { liberals: 6 } }, 'Turbines and panels go up everywhere.'],
    ['A nuclear renaissance', '', { cash: -0.01, energy: 0.08, fac: { business: 4, liberals: -4 } }, 'New reactors are ordered.'],
    ['Long-term deals with suppliers', '', { energy: 0.04, patron: 6, cash: -0.002 }, 'Twenty-year contracts with the big producers.'] ] },
};

/** How a later chapter's trouble is introduced (chapter I uses the country's own 2024 text). */
const NEW_TROUBLE: Record<IssueKind, string> = {
  corruption: 'graft has crept back into every ministry', debt: 'the debt has grown too big to roll over', separatism: 'a region wants out',
  insurgency: 'armed rebels hold the hills again', divided: 'the communities have drifted apart', succession: 'the question of who rules next is open',
  climate: 'droughts, floods and heat are hitting harder', exodus: 'the young are leaving and the cradles are empty', rebuild: 'war has left towns in ruins',
  crime: 'gangs are taking over whole districts', polarised: 'politics has split the country in two', isolated: 'sanctions have cut you off',
  reunify: 'the old division of the nation is back on the table', army: 'the generals are restless', inflation: 'prices are running away',
  energy: 'the lights are flickering and fuel is short',
};

// ------------------------------------------------------------------ Act III: the economy
const ECON: Record<EconKind, { title: string; frame: string; opts: [Opt, Opt, Opt] }> = {
  oil: { title: 'After the Oil', frame: 'Oil and gas pay for everything, and the world is changing.', opts: [
    ['Diversify: a sovereign fund and new industries', '', { cash: -0.006, tfp: 0.004, capital: 0.015, fac: { business: 6 } }, 'The fund buys stakes in the industries of the future.'],
    ['Pump more, while it lasts', '', { cash: 0.012, energy: 0.06, rep: -3 }, 'Rigs go up; the money flows.'],
    ['Nationalise the foreign oil majors', '', { cash: 0.006, west: -8, fac: { nationalists: 10, business: -8 } }, 'The flag goes up over the oil fields.'] ] },
  minerals: { title: 'The Treasure Underground', frame: 'The world needs what lies under your soil: the battery metals, the copper, the rare earths.', opts: [
    ['Process it at home', '', { cash: -0.006, capital: 0.02, tech: 1, fac: { labour: 6 } }, 'Smelters and refineries rise next to the mines.'],
    ['Sell to China', '', { cash: 0.006, east: 10, orient: -0.05 }, 'Long-term contracts with Chinese buyers.'],
    ['Sell to the West', '', { cash: 0.005, west: 10, orient: 0.05 }, 'A critical-minerals partnership with the West.'] ] },
  farms: { title: 'The Land', frame: 'Farming still employs millions and feeds the nation.', opts: [
    ['Modernise the farms', '', { cash: -0.005, food: 0.06, tfp: 0.002, fac: { regions: 4 } }, 'Irrigation, seeds and machines.'],
    ['Land reform', '', { food: 0.02, stab: 2, fac: { regions: 10, business: -8, labour: 4 } }, 'Big estates are broken up and handed to small farmers.'],
    ['An export drive', '', { cash: 0.005, food: -0.02, fac: { business: 6, regions: -4 } }, 'Grain and fruit for the world, at a price at home.'] ] },
  industry: { title: 'The Factories', frame: 'Industry built the middle class; competition is fierce.', opts: [
    ['Climb the value chain', '', { cash: -0.006, tech: 2, tfp: 0.003, fac: { business: 4 } }, 'Engineers, research labs and high-end products.'],
    ['Protect the jobs with tariffs', '', { stab: 2, tfp: -0.002, fac: { labour: 10, business: -4 } }, 'Tariffs keep foreign goods out and factories open.'],
    ['Free-trade zones for foreign investors', '', { capital: 0.02, neighbors: 4, fac: { business: 8, nationalists: -4 } }, 'Zones with low taxes and fast permits.'] ] },
  tech: { title: 'The Digital Frontier', frame: 'Chips, software and AI will decide who leads.', opts: [
    ['Chips and AI: a national programme', '', { cash: -0.008, tech: 4, tfp: 0.003 }, 'Fabs, data centres and scholarships.'],
    ['Open the doors to the tech giants', '', { capital: 0.015, tech: 2, fac: { business: 8, nationalists: -6 } }, 'The giants build their regional headquarters here.'],
    ['Digital sovereignty', '', { tech: 1, stab: 2, fac: { nationalists: 8, business: -4 } }, 'Data stays at home; home-grown platforms are favoured.'] ] },
  services: { title: 'The Hub', frame: 'Banking, trade and logistics carry the economy.', opts: [
    ['Clean, transparent finance', '', { rep: 6, collection: 0.01, cash: -0.002 }, 'The registers open; the dirty money leaves.'],
    ['Low taxes and no questions asked', '', { cash: 0.008, rep: -6, fac: { business: 8 } }, 'Money pours in from everywhere.'],
    ['Ports, airports and logistics', '', { cash: -0.006, infra: 4, capital: 0.01 }, 'A new port and an airport hub.'] ] },
  tourism: { title: 'The Visitors', frame: 'Tourism brings the money, and the crowds.', opts: [
    ['Eco-tourism and luxury', '', { rep: 4, cash: 0.003, fac: { regions: 4 } }, 'Fewer visitors, richer ones.'],
    ['Mass tourism and casinos', '', { cash: 0.008, stab: -2, rep: -2, fac: { business: 6 } }, 'Resorts and casinos rise along the coast.'],
    ['Diversify beyond tourism', '', { cash: -0.004, tfp: 0.002, tech: 1 }, 'Training, digital services and a second economy.'] ] },
  aid: { title: 'Standing Alone', frame: 'Aid and money sent home by emigrants keep the country going.', opts: [
    ['Education and skills', '', { cash: -0.004, tech: 2, tfp: 0.002, rep: 2 }, 'Schools, scholarships and a university.'],
    ['Big projects: roads and dams', '', { cash: -0.004, infra: 5, fac: { regions: 4 } }, 'A dam, a highway and a new airport.'],
    ['A partnership with a patron', '', { cash: 0.008, patron: 10, fac: { nationalists: -6 } }, 'A great power pays, and gets a say.'] ] },
};

// ------------------------------------------------------------------ building the acts for a country
export type StoryState = NonNullable<Country['story']>;
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const roman = (n: number) => ROMAN[n - 1] ?? String(n);
export const seedOf = (c: Country) => STORIES[c.name] ?? { issue: 'polarised' as IssueKind, text: 'old divisions run deep', econ: 'services' as EconKind, ambition: 'a better future' };
export const storyTitle = (c: Country) => `${c.name}: ${seedOf(c).ambition}`;
/** The problem of the current chapter (chapter I: the real one from 2024; later: what the country faces by then). */
export const issueOf = (c: Country): IssueKind => (c.story?.issue as IssueKind | undefined) ?? seedOf(c).issue;
export const ISSUE_TITLE = (k: IssueKind) => ISSUE[k].title;
/** "Chapter II · Act III of 4" */
export const storyChip = (c: Country) => { const st = c.story; return st ? `Chapter ${roman(st.ch ?? 1)} · ${st.act > 4 ? 'written' : `act ${roman(st.act)} of IV`}` : ''; };

/** What the next chapter will be about: whatever hurts most by then. */
export function issueNow(s: GameState, c: Country): IssueKind {
  const e = c.eco, prev = c.story?.issue ?? seedOf(c).issue;
  const ratio = e.debt / Math.max(1, e.gdp);
  const pick = (k: IssueKind) => k;
  if (e.damage > 0.12) return pick('rebuild');
  if (e.inflation > 0.15 && prev !== 'inflation') return pick('inflation');
  if (ratio > 1.1 && prev !== 'debt') return pick('debt');
  if ((e.sanctionShare > 0.15 || (c.hostile ?? 0) > 0.6) && prev !== 'isolated') return pick('isolated');
  if (e.stability < 40) return pick(c.gov === 'D' || c.gov === 'F' ? 'polarised' : 'army');
  if (e.energyUnmet > 0.08 && prev !== 'energy') return pick('energy');
  if (e.collection < 0.62 && prev !== 'corruption') return pick('corruption');
  if (c.baseline && e.pop < c.baseline.pop * 0.97 && prev !== 'exodus') return pick('exodus');
  const pool: IssueKind[] = (['polarised', 'energy', 'corruption', 'exodus', 'climate', 'succession', 'crime'] as IssueKind[]).filter((k) => k !== prev && (k !== 'succession' || c.gov === 'A' || c.gov === 'M') && (k !== 'polarised' || c.gov === 'D' || c.gov === 'F'));
  return pool[Math.floor(hash01('chap', c.id, c.story?.ch ?? 1, s.settings.seed) * pool.length)];
}

/** The rival of a country's story: a claim, an old rivalry, else its most difficult neighbour. */
export function storyRival(s: GameState, c: Country, geo: Geo): CountryId {
  let best = -1, bv = 0;
  for (const [a, b, v] of RIVALRIES) {
    const o = a === c.name ? b : b === c.name ? a : null;
    if (o && NAME_TO_ID[o] !== undefined && s.countries[NAME_TO_ID[o]]?.alive && v < bv) { bv = v; best = NAME_TO_ID[o]; }
  }
  for (const [a, b] of CLAIMS) if (a === c.name && NAME_TO_ID[b] !== undefined && s.countries[NAME_TO_ID[b]]?.alive) best = NAME_TO_ID[b];
  if (best >= 0) return best;
  const nb = neighborsOf(s, geo, c.id).sort((x, y) => getRelation(s, c.id, x) - getRelation(s, c.id, y));
  return nb[0] ?? -1;
}

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const pathLine = (st: StoryState | undefined) => (st?.arch ? `You have walked the road of ${ARCH_LABEL[st.arch]}. ` : '');
const opt = (o: Opt, act: number, idx: number): EventOption => ({ label: o[0], hint: fmtFx(o[2]), enabled: (_s, c) => !o[2].pc || (c.politics?.pc ?? 100) >= -o[2].pc, why: () => `Needs ${-(o[2].pc ?? 0)} political capital`, apply: (s, c, d) => choose(s, c, act, idx, o[2], d, o[3]) });

/** The event definitions of the storylines (registered with all the other events). */
export function storyEvents(): EventDef[] {
  const out: EventDef[] = [];
  for (const [k, v] of Object.entries(ISSUE) as [IssueKind, (typeof ISSUE)[IssueKind]][]) {
    out.push({
      id: `story1_${k}`, icon: '📖', title: `Act I: ${v.title}`, weight: 0, cooldown: 0, ttl: 30, eligible: () => null,
      text: (_s, c) => (c.story?.ch ?? 1) > 1 ? `${storyTitle(c)}, chapter ${roman(c.story!.ch!)}. ${c.story!.past?.length ? `The last chapter ended as ${c.story!.past[c.story!.past.length - 1].ending}. ` : ''}Now a new trouble defines the age: ${NEW_TROUBLE[k]}. ${whyLine(c)} A new chapter means a new road: answer as you see fit.` : `${storyTitle(c)}. ${whyLine(c)}The question of your age: ${seedOf(c).text}. How you answer will decide what kind of leader history remembers.`,
      options: v.opts.map((o, i) => opt(o, 1, i)),
      lapse: (s, c, d) => choose(s, c, 1, -1, { stab: -2 }, d, 'Events decide for you; the problem festers.'),
    });
  }
  for (const a of ARCHS) {
    const base: Opt[] = [
      ['Negotiate', '', { rival: 15, rep: 3, fac: { nationalists: -6 } }, 'Envoys meet, and the temperature drops.'],
      ['Stand firm', '', { rival: -10, readiness: 0.04, fac: { military: 6, nationalists: 8 } }, 'You give nothing. Troops move up to the border.'],
      ['Find a protector', '', { patron: 12, rival: -4, fac: { nationalists: -4 } }, 'A great power promises to stand by you.'],
    ];
    const extra: Opt = a === 'reform' ? ['International arbitration', '', { rep: 6, chance: [0.5, { rival: 25, stab: 3 }, 'the court rules and both sides accept'], rival: 5 }, 'The case goes to an international court.']
      : a === 'iron' ? ['Prepare for war', '', { mil: 0.006, readiness: 0.08, cb: true, rival: -20, rep: -4, fac: { military: 12, nationalists: 10, liberals: -8 } }, 'Mobilisation plans are dusted off; the generals get a casus belli.']
      : ['A deal behind closed doors', '', { cash: -0.004, rival: 20, fac: { business: 6, nationalists: -4 } }, 'A quiet bargain: money and concessions, no cameras.'];
    out.push({
      id: `story2_${a}`, icon: '📖', title: 'Act II: The Neighbour', weight: 0, cooldown: 0, ttl: 30, eligible: () => null,
      text: (s, c, d) => { const r = d.rv >= 0 ? s.countries[d.rv] : null; const claim = r && CLAIMS.some(([x, y]) => (x === c.name && y === r.name) || (y === c.name && x === r.name)); return `${pathLine(c.story)}${whyLine(c)}Now ${r ? `${r.name} ${claim ? 'and the land you both claim' : 'and the old enmity between you'}` : 'your neighbourhood'} will test you. Relations stand at ${r ? getRelation(s, c.id, r.id).toFixed(0) : '?'}. ${a === 'reform' ? 'As a reformer you can take it to an international court.' : a === 'iron' ? 'As the iron hand you can prepare for war.' : 'As a pragmatist you can strike a quiet deal.'}`; },
      options: [...base, extra].map((o, i) => opt(o, 2, i)),
      lapse: (s, c, d) => choose(s, c, 2, -1, { rival: -5 }, d, 'You let it drift; the tension grows.'),
    });
  }
  for (const [k, v] of Object.entries(ECON) as [EconKind, (typeof ECON)[EconKind]][]) for (const a of ARCHS) {
    const extra: Opt = a === 'reform' ? ['A social contract: growth shared with workers', '', { social: 0.004, tfp: 0.002, stab: 4, fac: { labour: 10, business: -4 } }, 'Wages, pensions and skills rise with the economy.']
      : a === 'iron' ? ['State champions under the government\'s thumb', '', { capital: 0.02, rep: -3, fac: { business: -6, nationalists: 8 } }, 'The state takes stakes in the biggest companies.']
      : ['Play the great powers against each other for investment', '', { cash: 0.006, west: 4, east: 4, capital: 0.01 }, 'Washington and Beijing bid for your favour.'];
    out.push({
      id: `story3_${k}_${a}`, icon: '📖', title: `Act III: ${v.title}`, weight: 0, cooldown: 0, ttl: 30, eligible: () => null,
      text: (_s, c) => `${pathLine(c.story)}${whyLine(c)}To reach ${seedOf(c).ambition}, the economy must change. ${v.frame}`,
      options: [...v.opts, extra].map((o, i) => opt(o, 3, i)),
      lapse: (s, c, d) => choose(s, c, 3, -1, {}, d, 'The economy carries on as before.'),
    });
  }
  out.push({
    id: 'story4', icon: '📖', title: 'Act IV: Your Place in the World', weight: 0, cooldown: 0, ttl: 30, eligible: () => null,
    text: (s, c) => `${pathLine(c.story)}${whyLine(c)}The world is choosing sides, and ${c.name} must decide where it stands. ${c.story?.path[1] === 2 ? 'Your protector expects loyalty. ' : ''}Whatever you choose sets out a course of several steps (you will walk it in Diplomacy).`,
    options: ([['west', 'Turn toward the West'], ['east', 'Turn toward the East'], ['third', 'A third way'], ['region', 'Lead your region']] as [CourseId, string][]).map(([id, label], i): EventOption => ({
      label, hint: 'Starts a change-of-course storyline in Diplomacy', enabled: (s, c) => { const g = geoRefGet(); return !!g && !c.course && !!coursesFor(s, c, g).find((k) => k.id === id)?.ok; },
      why: (s, c) => { if (c.course) return 'You are already on a course'; const g = geoRefGet(); const k = g && coursesFor(s, c, g).find((x) => x.id === id); return k?.why ?? 'Not open to you now'; },
      apply: (s, c, d) => { const g = geoRefGet()!; const k = coursesFor(s, c, g).find((x) => x.id === id)!; c.course = { id, stage: 0, until: 0, started: s.tick, leaders: k.leaders, old: k.old, neighbors: k.neighbors, org: k.org?.id }; return choose(s, c, 4, i, {}, d, `You set out: ${k.title}.`); },
    })).concat([{ label: 'Stay as we are', hint: 'stability +2 · no course', apply: (s, c, d) => choose(s, c, 4, 4, { stab: 2 }, d, 'You keep your place, and your options.') }]),
    lapse: (s, c, d) => choose(s, c, 4, -1, {}, d, 'You let the world decide where you stand.'),
  });
  return out;
}

// ------------------------------------------------------------------ choosing, and the ending
const ENDING_ADJ: Record<Arch, string> = { reform: 'Reformed', iron: 'Iron', pragmatic: 'Pragmatic' };
/** The economy each road's own Act III option builds. */
const ROAD_NOUN: Record<Arch, string> = { reform: 'Social Market', iron: 'Corporate State', pragmatic: 'Swing Economy' };
const ENDING_NOUN: Record<EconKind, [string, string, string, string]> = {
  oil: ['Post-Oil Economy', 'Petro-State', 'Resource Fortress', 'Oil Nation'], minerals: ['Industrial Mining Nation', 'Eastern Mine', 'Western Mine', 'Mining Nation'],
  farms: ['Farming Powerhouse', 'Land of Small Farmers', 'Breadbasket', 'Farming Nation'], industry: ['Industrial Power', 'Protected Workshop', 'Open Workshop', 'Workshop'],
  tech: ['Tech Power', 'Tech Colony', 'Digital Fortress', 'Digital Nation'], services: ['Clean Hub', 'Offshore Haven', 'Logistics Hub', 'Hub'],
  tourism: ['Green Paradise', 'Pleasure Coast', 'Diverse Economy', 'Island Economy'], aid: ['Learning Nation', 'Builder State', 'Client State', 'Small State'],
};
const CHAPTER_GAP = 200;
/** The title an ending earns: the road (Act I) and the economy chosen (Act III). */
export function endingOf(c: Country, st: Pick<StoryState, 'arch' | 'path'>): string {
  const n3 = st.path[2] ?? -1, arch = st.arch ?? 'pragmatic';
  return `The ${ENDING_ADJ[arch]} ${n3 === 3 ? ROAD_NOUN[arch] : ENDING_NOUN[seedOf(c).econ][n3 >= 0 && n3 < 3 ? n3 : 3]}`;
}
/** Every ending still within reach on the current road (for the storyline panel). */
export function possibleEndings(c: Country): string[] {
  const st = c.story;
  const archs: Arch[] = st?.arch ? [st.arch] : ARCHS;
  const n3s = st?.path[2] !== undefined ? [st.path[2]] : [0, 1, 2, 3];
  const out = new Set<string>();
  for (const a of archs) for (const n of n3s) out.add(endingOf(c, { arch: a, path: [0, 0, n] }));
  return [...out];
}
/** Act titles of the current chapter, for the panel. */
export function actTitles(c: Country): string[] {
  return [`Act I: ${ISSUE[issueOf(c)].title}`, 'Act II: The Neighbour', `Act III: ${ECON[seedOf(c).econ].title}`, 'Act IV: Your Place in the World'];
}
/** The label of the option taken in an act (or how it lapsed). */
export function choiceLabel(c: Country, act: number, idx: number | undefined): string {
  if (idx === undefined) return '';
  if (idx < 0) return 'let it lapse';
  const st = c.story;
  if (act === 1) return ISSUE[issueOf(c)].opts[idx]?.[0] ?? '';
  const id = act === 2 ? `story2_${st?.arch ?? 'pragmatic'}` : act === 3 ? `story3_${seedOf(c).econ}_${st?.arch ?? 'pragmatic'}` : 'story4';
  return storyEventsCache().find((e) => e.id === id)?.options[idx]?.label ?? '';
}

function choose(s: GameState, c: Country, act: number, idx: number, fx: Fx, d: D, done: string): string {
  const st = (c.story ??= { act: 1, next: 0, path: [] });
  st.path[act - 1] = idx;
  if (act === 1) st.arch = idx >= 0 ? ARCHS[idx] : 'pragmatic';
  const extra = applyFx(s, c, fx, d);
  st.act = act + 1;
  // the next act waits for something to happen (at least half a year), or arrives anyway when its time runs out
  st.next = s.tick + 26;
  st.due = s.tick + 70 + Math.floor(hash01('story', c.id, act, st.ch ?? 1, s.settings.seed) * 40);
  delete st.why;
  const g = geoRefGet();
  if (g) st.snap = snapOf(s, g, c, st);
  if (act === 4) {
    st.ending = endingOf(c, st);
    st.next = s.tick + CHAPTER_GAP + Math.floor(hash01('chapter', c.id, st.ch ?? 1, s.settings.seed) * 80); // the next chapter opens years later
    const road = st.path[3] !== undefined && st.path[3] >= 0 && st.path[3] < 4 ? `leads ${['West', 'East', 'between the camps', 'to regional leadership'][st.path[3]]}` : 'keeps its place in the world';
    if (c.isPlayer) logEvent(s, `📖 CHAPTER ${roman(st.ch ?? 1)} OF YOUR STORY IS WRITTEN: ${st.ending}. ${cap(ARCH_LABEL[st.arch ?? 'pragmatic'])}'s road ${road}. A new chapter will open in a few years.`, 'info', [c.id], true, { big: true });
    else if (isMajor(s, c.id)) logEvent(s, `📖 ${c.name}'s chapter ${roman(st.ch ?? 1)} closes: ${st.ending}.`, 'info', [c.id], false);
  }
  return `${done}${extra ? ` (${extra})` : ''}`;
}

/** Weekly: the next act arrives when its time comes; AI countries answer their own acts by character. */
export function stepStories(s: GameState, geo: Geo) {
  for (const c of s.countries) {
    if (!c.alive) continue;
    const st = (c.story ??= { act: 1, next: 8, due: 16 + Math.floor(hash01('story0', c.id, s.settings.seed) * 40), path: [] });
    if (s.tick < st.next) continue;
    if (st.act > 4) { newChapter(s, c, geo); continue; }
    if (st.rival === undefined || (st.rival >= 0 && !s.countries[st.rival]?.alive)) st.rival = storyRival(s, c, geo);
    // a reactive act: wait for its moment (AI countries look once a month)
    if (st.due !== undefined && st.why === undefined) {
      if (!c.isPlayer && (s.tick + c.id) % 4 !== 0 && s.tick < st.due) continue;
      st.snap ??= snapOf(s, geo, c, st);
      const why = actTrigger(s, geo, c, st);
      if (!why && s.tick < st.due) continue;
      st.why = why ?? '';
    }
    const id = st.act === 1 ? `story1_${issueOf(c)}` : st.act === 2 ? `story2_${st.arch ?? 'pragmatic'}` : st.act === 3 ? `story3_${seedOf(c).econ}_${st.arch ?? 'pragmatic'}` : 'story4';
    const data = { rv: st.rival ?? -1 };
    if (c.isPlayer) {
      if (s.inbox.some((x) => x.id.startsWith('story')) || s.inbox.length >= 4 || (s.legacy && s.legacy.status !== 'office')) { st.next = s.tick + 4; continue; }
      s.inbox.push({ uid: s.nextInbox++, id, tick: s.tick, expires: s.tick + 30, urgent: false, data });
      st.next = s.tick + 34; // waits for the answer (answering or letting it lapse moves the story on)
    } else aiAct(s, c, id, data);
  }
}

// ------------------------------------------------------------------ reactive acts: what makes the moment
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const orgSig = (s: GameState, ids: CountryId[]) => ids.map((n) => `${n}:${orgsOf(s, n).map((o) => o.id).join('.')}`).join('|');
function snapOf(s: GameState, geo: Geo, c: Country, st: StoryState): NonNullable<StoryState['snap']> {
  const R = st.rival !== undefined && st.rival >= 0 ? s.countries[st.rival] : undefined;
  return {
    t: s.tick, rel: R ? getRelation(s, c.id, R.id) : 0, troops: R?.mil.troops ?? 0, ws: s.stats.westShare ?? 0.5, gdp: c.eco.gdp,
    nb: orgSig(s, neighborsOf(s, geo, c.id)), ml: s.countries.filter((x) => x.alive && isMajor(s, x.id) && x.leader).map((x) => `${x.id}:${x.leader!.name}`).join('|'),
  };
}
/** Has something happened that makes this the moment for the next act? Returns what happened, in words. */
export function actTrigger(s: GameState, geo: Geo, c: Country, st: StoryState): string | null {
  const e = c.eco, sn = st.snap!;
  if (st.act === 1) {
    switch (issueOf(c)) {
      case 'inflation': return e.inflation > 0.12 ? `inflation has hit ${pct(e.inflation)}` : null;
      case 'debt': return e.debt / e.gdp > 1 ? `the national debt has reached ${pct(e.debt / e.gdp)} of GDP` : null;
      case 'energy': return e.energyUnmet > 0.04 ? `the power cuts have begun: ${pct(e.energyUnmet)} of demand goes unmet` : null;
      case 'isolated': return e.sanctionShare > 0.08 ? `sanctions now cut off ${pct(e.sanctionShare)} of your trade` : null;
      case 'rebuild': return e.damage > 0.05 ? `war damage has wrecked ${pct(e.damage)} of the country` : null;
      case 'exodus': return e.pop < c.baseline.pop * 0.995 ? 'the population has started to shrink' : null;
      case 'climate': case 'succession': case 'reunify': return null;
      default: return e.stability < 45 ? `stability has fallen to ${e.stability.toFixed(0)}` : null;
    }
  }
  if (st.act === 2) {
    const R = st.rival !== undefined && st.rival >= 0 ? s.countries[st.rival] : undefined;
    if (!R?.alive) return null;
    const war = s.wars.find((w) => w.attackers[0] === R.id && w.start > sn.t);
    if (war) return `${R.name} has just gone to war with ${s.countries[war.defenders[0]].name}`;
    if (R.goal && R.goal.target === c.id && R.goal.since > sn.t) return `${R.name}'s government has made you its aim: ${R.goal.text.charAt(0).toLowerCase() + R.goal.text.slice(1)}`;
    if (sn.troops > 0 && R.mil.troops > sn.troops * 1.15) return `${R.name} has grown its army by ${pct(R.mil.troops / sn.troops - 1)}`;
    const rel = getRelation(s, c.id, R.id);
    if (rel < sn.rel - 12) return `relations with ${R.name} have fallen to ${rel.toFixed(0)}`;
    if (R.leader && R.leader.since > sn.t && R.leader.traits.some((t) => t === 'hawk' || t === 'nationalist' || t === 'strongman')) return `${R.name} has a new hard-line leader, ${R.leader.name}`;
    return null;
  }
  if (st.act === 3) {
    if (e.growth < -0.005) return `the economy is shrinking (${(e.growth * 100).toFixed(1)}% a year)`;
    if (e.unemployment > e.uNat + 0.03) return `unemployment has climbed to ${pct(e.unemployment)}`;
    if (e.growth > 0.05) return `a boom (growth ${(e.growth * 100).toFixed(1)}%) gives you room to choose`;
    return null;
  }
  // act IV: the world shifts around you
  const ws = s.stats.westShare ?? 0.5;
  if (Math.abs(ws - sn.ws) > 0.03) return `the balance of power is shifting toward the ${ws > sn.ws ? 'West' : 'East'}`;
  const nb = orgSig(s, neighborsOf(s, geo, c.id));
  if (nb !== sn.nb) {
    const old = new Map(sn.nb.split('|').map((x) => x.split(':') as [string, string]));
    for (const part of nb.split('|')) {
      const [n, ids] = part.split(':');
      const was = (old.get(n) ?? '').split('.').filter(Boolean), now = (ids ?? '').split('.').filter(Boolean);
      const joined = now.find((x) => !was.includes(x)), left = was.find((x) => !now.includes(x));
      const org = (id?: string) => s.orgs?.find((o) => String(o.id) === id)?.name;
      if (joined && org(joined)) return `your neighbour ${s.countries[+n].name} has joined ${org(joined)}`;
      if (left && old.has(n)) return `your neighbour ${s.countries[+n].name} has left ${org(left) ?? 'its bloc'}`;
    }
  }
  const ml = s.countries.filter((x) => x.alive && isMajor(s, x.id) && x.leader && x.leader.since > sn.t && !sn.ml.includes(`${x.id}:${x.leader.name}`));
  if (ml.length) return `a new government in ${ml[0].name} (${ml[0].leader!.name}) is reshaping the world`;
  return null;
}
const whyLine = (c: Country) => (c.story?.why ? `${cap(c.story.why)}. ` : '');

/** A chapter closed some years ago: open the next one, about what the country faces now. */
function newChapter(s: GameState, c: Country, geo: Geo) {
  const st = c.story!;
  (st.past ??= []).push({ ch: st.ch ?? 1, ending: st.ending ?? '', arch: st.arch ?? 'pragmatic', issue: issueOf(c), path: [...st.path], tick: s.tick });
  if (st.past.length > 8) st.past.shift();
  st.issue = issueNow(s, c);
  st.ch = (st.ch ?? 1) + 1;
  st.act = 1; st.path = []; delete st.arch; delete st.ending; delete st.rival;
  st.next = s.tick + (c.isPlayer ? 0 : Math.floor(hash01('ch0', c.id, st.ch, s.settings.seed) * 10));
  st.due = st.next + 8; delete st.why; st.snap = snapOf(s, geo, c, st);
  if (c.isPlayer) logEvent(s, `📖 Chapter ${roman(st.ch)} of your story opens: ${ISSUE[st.issue as IssueKind].title}.`, 'info', [c.id], true);
}

/** AI governments answer by character: reformers in democracies, iron hands where the army or the aggressive rule. */
function aiAct(s: GameState, c: Country, id: string, data: D) {
  const st = c.story!;
  let idx: number;
  if (st.act === 1) idx = c.gov === 'D' ? 0 : c.gov === 'A' || c.gov === 'C' || c.ai.aggression > 0.8 ? 1 : 2;
  else if (st.act === 2) idx = c.ai.aggression > 0.9 && st.arch === 'iron' && !isAtWar(s, c.id) ? 3 : c.ai.caution > 0.6 ? 2 : c.ai.trade > 0.6 ? 0 : Math.floor(hash01('a2', c.id, s.settings.seed) * 3);
  else if (st.act === 3) idx = Math.floor(hash01('a3', c.id, s.settings.seed) * 4);
  else idx = 4; // AI governments change course through their own logic, not their storyline
  const def = storyEventsCache().find((e) => e.id === id);
  const o = def?.options[idx] ?? def?.options[0];
  if (!def || !o) { st.act = 5; return; }
  if (o.enabled && !o.enabled(s, c)) { choose(s, c, st.act, -1, {}, data, ''); return; }
  o.apply(s, c, data, geoRefGet()!);
  if (isMajor(s, c.id) && st.act <= 4 && st.act !== 1) logEvent(s, `📖 ${c.name}: ${def.title.replace(/^Act [IV]+: /, '')}: ${o.label.toLowerCase()}.`, 'info', [c.id], false);
}
let cache: EventDef[] | null = null;
const storyEventsCache = () => (cache ??= storyEvents());
export const storyAct = (c: Country) => c.story?.act ?? 1;
export { fmtMoney, lowerFirst, areAtWar, COUNTRY_BASE };
