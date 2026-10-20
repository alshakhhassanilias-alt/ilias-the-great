/**
 * Changing sides is a story, not a slider. Every country can set out on a foreign-policy course:
 *
 *   West   — court the Western powers, meet their standards, trade with them, break with the old patrons, knock on
 *            the door of a Western organisation.
 *   East   — court the Eastern powers, buy their arms and energy, turn your back on the West, sign a security pact,
 *            join an Eastern organisation.
 *   Third  — step back from your camp, trade with everyone, become the honest broker, rally the non-aligned.
 *   Region — lead your neighbourhood: a summit, a customs union, a common market, a regional organisation.
 *
 * Each step takes months, costs political capital (and some money), shifts the country's orientation, changes
 * relations with the camp it courts and the camp it leaves, and moves factions at home. The camp you are leaving
 * pushes back. The stories are written from the real situation of each country (who leads each camp today, which
 * organisation would take you, who your neighbours are), and major countries get their own flavour.
 */
import type { Geo } from './geo';
import { nextRand } from './rng';
import { clamp, fmtMoney, keyOf } from './util';
import { logEvent } from './log';
import { addRelation, areAtWar, getRelation, isAtWar, orgsOf, sanctionLevel } from './relations';
import { applyTreaty, liftSanction, neighborsOf, imposeSanction, type Proposal } from './diplomacy';
import { strength } from './military';
import { sway, spendPC } from './domestic';
import { fund } from './actions';
import { placeName } from './places';
import { isMajor } from './drama';
import { applicationVotes, admitted, foundOrg, initialOrientOf, joinOrg, leaveOrg, orientTarget, threatened } from './alignment';
import { cleanName, orgName } from './blocs';
import type { Country, CountryId, FactionId, GameState, Org } from './types';

export type CourseId = 'west' | 'east' | 'third' | 'region';
export interface CourseFx {
  orient?: number; hostile?: number; relTarget?: number; relOld?: number; relNeighbors?: number; relOrg?: number;
  fac?: Partial<Record<FactionId, number>>; stab?: number; rep?: number; lift?: boolean; treaty?: Proposal[]; treatyNeighbors?: Proposal;
  capital?: number; tfp?: number; energy?: number; milTech?: number; infra?: number; collection?: number;
  /** leave organisations of the camp you are turning away from */
  breakOld?: boolean;
  finale?: 'join' | 'found-camp' | 'found-neutral' | 'found-region';
}
export interface CourseStage { title: string; desc: string; weeks: number; pc: number; cost: number; fx: CourseFx }
export interface Course { id: CourseId; icon: string; title: string; intro: string; stages: CourseStage[]; dir: number; ok: boolean; why?: string; leaders: CountryId[]; old: CountryId[]; neighbors: CountryId[]; org?: Org }

// ------------------------------------------------------------------ national flavour
/** Titles and introductions for the countries where these choices are most charged. Stage titles override in order. */
const FLAVOUR: Record<string, Partial<Record<CourseId, { title?: string; intro?: string; stages?: string[] }>>> = {
  Turkey: {
    west: { title: 'Back to Europe', intro: 'Revive the EU accession talks, mend ties with Washington, and remember why Turkey joined NATO.', stages: ['A summit in Brussels', 'The Copenhagen criteria', 'A modernised customs union', 'Cancel the S-400 deal', 'Reopen the accession chapters'] },
    east: { title: 'The Eurasian Turn', intro: 'Ankara looks to Moscow and Beijing: gas, arms and a seat in their clubs.', stages: ['Ankara–Moscow summit', 'S-400s and the TurkStream deal', 'Leave the Western consensus', 'A strategic pact with Moscow', 'Apply to the Eastern club'] },
    third: { title: 'Bridge between worlds', intro: 'Neither East nor West: Turkey as the indispensable middle power.' },
  },
  India: {
    west: { title: 'The Quad Partnership', intro: 'Deepen the Quad with the US, Japan and Australia; trade the old Russian arms for Western ones.', stages: ['A state visit to Washington', 'Open markets and courts', 'A US–India trade deal', 'Phase out Russian arms', 'Join the Western alliance'] },
    east: { title: 'Strategic Autonomy, the Russian way', intro: 'Cheap Russian oil, Russian arms, and BRICS before the West.' },
    third: { title: 'Leader of the Global South', intro: 'India speaks for the non-aligned: a voice for the developing world, beholden to no bloc.' },
  },
  Ukraine: {
    west: { title: 'The European Choice', intro: 'Integrate fully with the EU and NATO, whatever Moscow says.', stages: ['Kyiv–Brussels summit', 'Anti-corruption reforms', 'A deep free-trade area', 'End the last ties to Moscow', 'Membership talks'] },
    east: { title: 'A deal with Moscow', intro: 'End the war on Moscow\'s terms and return to its sphere.' },
  },
  Iran: {
    west: { title: 'The Grand Bargain', intro: 'A nuclear deal, sanctions relief and a return to the world economy.', stages: ['Back-channel talks in Muscat', 'IAEA inspectors return', 'Oil contracts with Europe', 'End the proxy wars', 'A seat at the Western table'] },
    east: { title: 'The Axis', intro: 'Bind Iran to Moscow and Beijing: drones, oil and a security pact.' },
  },
  'Saudi Arabia': {
    west: { title: 'Vision 2030 with Washington', intro: 'A defence treaty with the US, normalisation in the region, Western capital for the post-oil economy.' },
    east: { title: 'Look East', intro: 'Sell oil in yuan, buy Chinese arms, join the Eastern clubs.' },
    third: { title: 'Petro-diplomacy', intro: 'Play every great power against the others; the oil market decides.' },
  },
  China: {
    west: { title: 'Reform and Opening II', intro: 'A grand bargain with Washington: markets open, tensions down, trade back.' },
    third: { title: 'The Middle Kingdom stands alone', intro: 'No blocs, no allies: China as a pole of its own.' },
    region: { title: 'The Asian Century', intro: 'Lead Asia: trade, development banks and a regional order with Beijing at the centre.' },
  },
  Russia: {
    west: { title: 'Normalisation with the West', intro: 'Diplomacy first: talks with Europe and the United States, step by step. (The deeper Reset of Russia itself is in its national path.) The hawks at home will call it surrender.' },
    region: { title: 'The Eurasian Union', intro: 'Bind the old republics into a union led from Moscow.' },
  },
  'United States of America': {
    third: { title: 'America First', intro: 'Pull back from the alliances, bring the troops home, let the allies pay for their own defence.', stages: ['Question the alliances', 'Tariffs on friend and foe', 'Bring the troops home', 'A new kind of club'] },
    east: { title: 'A Grand Bargain with Beijing', intro: 'Divide the world into spheres with China and end the new cold war.' },
    region: { title: 'Fortress America', intro: 'Bind the Western Hemisphere together under Washington\'s lead.' },
  },
  Germany: { third: { title: 'Europe\'s own way', intro: 'Strategic autonomy: a Europe that answers neither to Washington nor to Moscow.' }, region: { title: 'Mitteleuropa', intro: 'Lead Central Europe: industry, trade and a union around Berlin.' } },
  France: { third: { title: 'Gaullist independence', intro: 'Leave NATO\'s command, speak for a Europe of nations, deal with everyone.' }, region: { title: 'A Mediterranean Union', intro: 'Lead the Mediterranean from Paris.' } },
  'United Kingdom': { third: { title: 'Global Britain', intro: 'Trade with everyone, belong to no bloc.' } },
  Japan: { region: { title: 'The Free and Open Indo-Pacific', intro: 'Lead Asia\'s democracies in a regional order of their own.' }, third: { title: 'A normal country', intro: 'Stand on its own: less dependence on Washington, a voice of its own in Asia.' } },
  Poland: { region: { title: 'The Intermarium', intro: 'A bloc from the Baltic to the Black Sea, between Germany and Russia.' } },
  Brazil: { third: { title: 'Active non-alignment', intro: 'Friends with Washington and Beijing alike, leader of the South.' }, region: { title: 'Mercosur reborn', intro: 'Lead South America into a real union.' } },
  'South Africa': { third: { title: 'Ubuntu diplomacy', intro: 'Speak for Africa and the non-aligned world.' }, region: { title: 'African renaissance', intro: 'Lead a southern African union.' } },
  Indonesia: { third: { title: 'Free and active', intro: 'The Bandung spirit, seventy years on: belong to no bloc.' }, region: { title: 'ASEAN centrality', intro: 'Lead Southeast Asia from Jakarta.' } },
  Egypt: { region: { title: 'Pan-Arab revival', intro: 'Cairo leads the Arab world again.' }, east: { title: 'Pivot to the East', intro: 'Russian wheat, Chinese loans, BRICS membership.' } },
  Pakistan: { west: { title: 'Back to Washington', intro: 'Rebuild the old alliance with the United States.' }, east: { title: 'Iron brothers', intro: 'Bind Pakistan to China for good.' } },
  Israel: { region: { title: 'The Abraham Accords', intro: 'Normalise with the Arab states and build a regional order.' } },
  Serbia: { west: { title: 'The European path', intro: 'Choose Brussels over Moscow, at last.' }, east: { title: 'Brotherhood with Moscow', intro: 'Stand with Russia, whatever Brussels thinks.' } },
  Hungary: { east: { title: 'Eastern opening', intro: 'Russian gas, Chinese factories, and a Europe of sovereign nations.' } },
  Belarus: { west: { title: 'Out of Moscow\'s shadow', intro: 'A slow, dangerous turn toward Europe.' } },
  Kazakhstan: { west: { title: 'Multi-vector, Western vector', intro: 'Oil, uranium and a turn toward Western investors.' }, third: { title: 'The multi-vector state', intro: 'Balance Moscow, Beijing and the West, as always.' } },
  Vietnam: { west: { title: 'Bamboo diplomacy, Western wind', intro: 'Bend toward Washington against Beijing.' } },
  Philippines: { east: { title: 'The China pivot', intro: 'Loans and calm seas from Beijing, distance from Washington.' } },
  Venezuela: { west: { title: 'Return to the Americas', intro: 'Free elections, oil for the West, sanctions lifted.' } },
  Cuba: { west: { title: 'The thaw', intro: 'Reopen the embassies, reopen the economy.' } },
  'North Korea': { west: { title: 'The opening', intro: 'A peace treaty, inspectors, and the end of isolation.' } },
  'South Korea': { region: { title: 'Northeast Asian community', intro: 'Lead a regional order of Asia\'s democracies.' } },
  Australia: { region: { title: 'The Pacific family', intro: 'Lead the Pacific islands in a regional union.' } },
  Mexico: { third: { title: 'Doctrina Estrada', intro: 'Non-intervention and friendship with all.' } },
  Nigeria: { region: { title: 'ECOWAS renewed', intro: 'Lead West Africa from Abuja.' } },
  Ethiopia: { region: { title: 'Horn of Africa union', intro: 'Lead the Horn from Addis Ababa.' } },
};

// ------------------------------------------------------------------ building a course for a country
const top = (s: GameState, me: Country, f: (x: Country) => boolean, n = 3) => s.countries.filter((x) => x.alive && x.id !== me.id && f(x)).sort((a, b) => strength(b) - strength(a)).slice(0, n).map((x) => x.id);
const nm = (s: GameState, id?: CountryId) => (id === undefined ? 'them' : s.countries[id].name);

/** The organisation of a camp this country could aim for: a regional union first, then a regional pact, then a club. */
function targetOrg(s: GameState, c: Country, camp: number): Org | undefined {
  const same = (o: Org) => o.members.filter((m) => s.countries[m].region === c.region).length;
  const cands = (s.orgs ?? []).filter((o) => !o.members.includes(c.id) && (camp === 0 ? o.camp === 0 : o.camp === camp || (camp < 0 && o.camp === 0 && o.members.reduce((t, m) => t + (s.countries[m].orient ?? 0), 0) / o.members.length < -0.1)));
  return cands.filter((o) => o.kind === 'union' && same(o) >= o.members.length / 2)[0]
    ?? cands.filter((o) => o.kind === 'defence' && same(o) >= o.members.length * 0.2)[0]
    ?? cands.filter((o) => o.kind === 'economic')[0];
}

export function coursesFor(s: GameState, c: Country, geo: Geo): Course[] {
  const o = c.orient ?? 0;
  const west = top(s, c, (x) => (x.orient ?? 0) > 0.5), east = top(s, c, (x) => (x.orient ?? 0) < -0.5);
  const nbrs = neighborsOf(s, geo, c.id).filter((x) => !areAtWar(s, c.id, x));
  const fl = FLAVOUR[keyOf(c)] ?? {};
  const away = (dir: number) => Math.sign(initialOrientOf(c)) === -dir && initialOrientOf(c) !== 0; // turning against the camp it started in
  const backlash = (dir: number, k = 1): Partial<Record<FactionId, number>> => (away(dir) ? { military: -5 * k, nationalists: -5 * k } : {});
  const merge = (...fs: Partial<Record<FactionId, number>>[]) => { const r: Partial<Record<FactionId, number>> = {}; for (const f of fs) for (const [k, v] of Object.entries(f)) r[k as FactionId] = (r[k as FactionId] ?? 0) + (v as number); return r; };
  const out: Course[] = [];
  const titled = (id: CourseId, def: string, stages: CourseStage[]) => { const f = fl[id]; f?.stages?.forEach((t, i) => { if (stages[i]) stages[i].title = t; }); return { title: f?.title ?? def, intro: f?.intro, stages }; };

  // ---- West
  {
    const org = targetOrg(s, c, 1);
    const L0 = nm(s, west[0]), oldL = east.find((x) => getRelation(s, c.id, x) > 0) ?? east[0];
    const st: CourseStage[] = [
      { title: `Overture to ${L0}`, desc: `A state visit to ${L0}${west[1] !== undefined ? ` and ${nm(s, west[1])}` : ''}: you ask for a new start.`, weeks: 10, pc: 10, cost: 0.0005, fx: { orient: 0.08, relTarget: 10, relOld: -5, fac: { business: 3 } } },
      { title: 'Meet their standards', desc: 'Anti-corruption courts, an independent central bank and a freer press: what Western partners ask of a partner. Their sanctions on you may be lifted.', weeks: 20, pc: 15, cost: 0.003, fx: { orient: 0.08, hostile: -0.25, rep: 5, collection: 0.01, lift: true, fac: merge({ liberals: 8 }, backlash(1)) } },
      { title: `A trade pact with ${L0}`, desc: `Tariffs fall, Western investors arrive. Trade agreements with ${west.slice(0, 2).map((x) => nm(s, x)).join(' and ') || 'the Western powers'}.`, weeks: 16, pc: 10, cost: 0, fx: { orient: 0.1, treaty: ['trade'], capital: 0.01, fac: { business: 6, labour: -3 } } },
      { title: oldL !== undefined ? `Break with ${nm(s, oldL)}` : 'Burn the old bridges', desc: `Close the old bases, cancel the arms contracts, vote with your new friends${orgsOf(s, c.id).some((x) => x.camp < 0) ? `, and leave ${orgsOf(s, c.id).filter((x) => x.camp < 0).map((x) => x.name).join(' and ')}` : ''}.`, weeks: 14, pc: 15, cost: 0, fx: { orient: 0.14, hostile: -0.15, relOld: -15, breakOld: true, fac: merge({ liberals: 4 }, backlash(1, 1.6)) } },
      org ? { title: `Knock on the door of ${org.name.replace(/^the /, '')}`, desc: `Lobby every member capital, then apply to join ${org.name}. The members vote; the odds are shown before you begin.`, weeks: 12, pc: 10, cost: 0.001, fx: { relOrg: 12, finale: 'join' } }
        : { title: 'A club of new friends', desc: 'No Western organisation will have you yet: found your own with the friends you have made.', weeks: 12, pc: 10, cost: 0.001, fx: { finale: 'found-camp' } },
    ];
    const t = titled('west', 'Turn toward the West', st);
    out.push({ id: 'west', icon: '🌐', title: t.title, intro: t.intro ?? `Court ${west.slice(0, 2).map((x) => nm(s, x)).join(' and ') || 'the Western powers'}${org ? ` and aim for ${org.name}` : ''}.`, stages: t.stages, dir: 1, ok: o < 0.75 && west.length > 0, why: o >= 0.75 ? 'You are already firmly in the Western camp' : west.length ? undefined : 'There is no Western camp left to join', leaders: west, old: east, neighbors: nbrs, org });
  }
  // ---- East
  {
    const org = targetOrg(s, c, -1);
    const L0 = nm(s, east[0]), oldL = west.find((x) => getRelation(s, c.id, x) > 0) ?? west[0];
    const st: CourseStage[] = [
      { title: `Overture to ${L0}`, desc: `A state visit to ${L0}${east[1] !== undefined ? ` and ${nm(s, east[1])}` : ''}: friendship "without limits".`, weeks: 10, pc: 10, cost: 0.0005, fx: { orient: -0.08, relTarget: 10, relOld: -5, fac: { nationalists: 3 } } },
      { title: 'Arms and energy deals', desc: `Buy ${L0}'s weapons and pipelines: military cooperation, cheaper energy, better equipment.`, weeks: 16, pc: 10, cost: 0.002, fx: { orient: -0.08, treaty: ['coop'], energy: 0.03, milTech: 1, fac: { military: 6, liberals: -4 } } },
      { title: 'Turn your back on the West', desc: 'Vote against the West, expel its NGOs, ignore its sanctions. The West will start to treat you as an adversary.', weeks: 14, pc: 15, cost: 0, fx: { orient: -0.14, hostile: 0.15, relOld: -12, fac: merge({ nationalists: 8, liberals: -8, business: -4 }, backlash(-1)) } },
      { title: `A security pact with ${L0}`, desc: `A non-aggression pact and joint exercises with ${L0}${orgsOf(s, c.id).some((x) => x.camp > 0) ? `; you leave ${orgsOf(s, c.id).filter((x) => x.camp > 0).map((x) => x.name).join(' and ')}` : ''}.`, weeks: 16, pc: 15, cost: 0.001, fx: { orient: -0.1, treaty: ['nap', 'coop'], breakOld: true, relOld: -10, fac: merge({ military: 4 }, backlash(-1, 1.6)) } },
      org ? { title: `Join ${org.name.replace(/^the /, '')}`, desc: `Lobby the members of ${org.name}, then apply. The members vote.`, weeks: 12, pc: 10, cost: 0.001, fx: { relOrg: 12, finale: 'join' } }
        : { title: 'A club of new friends', desc: 'Found an organisation of your own with your new partners.', weeks: 12, pc: 10, cost: 0.001, fx: { finale: 'found-camp' } },
    ];
    const t = titled('east', 'Turn toward the East', st);
    out.push({ id: 'east', icon: '🐉', title: t.title, intro: t.intro ?? `Court ${east.slice(0, 2).map((x) => nm(s, x)).join(' and ') || 'the Eastern powers'}${org ? ` and aim for ${org.name}` : ''}.`, stages: t.stages, dir: -1, ok: o > -0.75 && east.length > 0, why: o <= -0.75 ? 'You are already firmly in the Eastern camp' : east.length ? undefined : 'There is no Eastern camp to join', leaders: east, old: west, neighbors: nbrs, org });
  }
  // ---- Third way
  {
    const patron = (o >= 0 ? west : east)[0];
    const st: CourseStage[] = [
      { title: patron !== undefined ? `Distance from ${nm(s, patron)}` : 'Distance from the blocs', desc: 'Decline the next summit, abstain at the Assembly, keep your options open.', weeks: 12, pc: 10, cost: 0, fx: { orient: -Math.sign(o) * 0.15, relOld: -6, rep: 2, fac: { nationalists: 5 } } },
      { title: 'Trade with everyone', desc: `Trade agreements with ${nm(s, west[0])} and ${nm(s, east[0])} alike.`, weeks: 16, pc: 10, cost: 0, fx: { orient: -Math.sign(o) * 0.08, treaty: ['trade'], capital: 0.01, fac: { business: 6 } } },
      { title: 'The honest broker', desc: 'Offer your capital for peace talks; build a reputation as the country everyone can talk to.', weeks: 16, pc: 10, cost: 0.001, fx: { rep: 6, relNeighbors: 4, stab: 2 } },
      { title: 'A non-aligned movement', desc: 'Rally the countries that belong to no camp into an organisation of your own.', weeks: 14, pc: 15, cost: 0.001, fx: { finale: 'found-neutral' } },
    ];
    const t = titled('third', 'A third way', st);
    out.push({ id: 'third', icon: '⚖', title: t.title, intro: t.intro ?? 'Step out of the camps: trade with everyone, side with no one, and lead those who do the same.', stages: t.stages, dir: 0, ok: Math.abs(o) > 0.2, why: Math.abs(o) > 0.2 ? undefined : 'You are already non-aligned', leaders: [...west.slice(0, 1), ...east.slice(0, 1)], old: o >= 0 ? west : east, neighbors: nbrs });
  }
  // ---- Region
  {
    const city = placeName(c.capital);
    const st: CourseStage[] = [
      { title: `A summit in ${city}`, desc: `Host your neighbours (${nbrs.slice(0, 4).map((x) => nm(s, x)).join(', ') || 'none'}) and propose a common future.`, weeks: 10, pc: 10, cost: 0.0008, fx: { relNeighbors: 8, rep: 2 } },
      { title: 'A customs union', desc: 'Trade agreements with every neighbour that will sign.', weeks: 16, pc: 10, cost: 0, fx: { treatyNeighbors: 'trade', capital: 0.01, fac: { business: 5, labour: -2 } } },
      { title: 'A common market', desc: 'Shared standards, roads and power lines across the borders.', weeks: 20, pc: 15, cost: 0.003, fx: { tfp: 0.004, infra: 2, relNeighbors: 4, fac: { regions: 4 } } },
      { title: 'Found a regional organisation', desc: 'Make it permanent: a union of the region, with you at its heart. You choose its name.', weeks: 14, pc: 15, cost: 0.001, fx: { finale: 'found-region' } },
    ];
    const t = titled('region', 'Lead your region', st);
    out.push({ id: 'region', icon: '🧭', title: t.title, intro: t.intro ?? `Bind your neighbours together around ${city}.`, stages: t.stages, dir: 0, ok: nbrs.length >= 2, why: nbrs.length >= 2 ? undefined : 'You need at least two neighbours at peace with you', leaders: [], old: [], neighbors: nbrs });
  }
  return out;
}

const courseOf = (s: GameState, c: Country, geo: Geo) => (c.course ? coursesFor(s, c, geo).find((x) => x.id === c.course!.id) : undefined);
/** The course stage the country is on (running or waiting to start). */
export function currentStage(s: GameState, c: Country, geo: Geo) {
  const k = courseOf(s, c, geo);
  return k && c.course ? { course: k, stage: k.stages[c.course.stage], i: c.course.stage, running: c.course.until > s.tick } : null;
}

// ------------------------------------------------------------------ doing it
function applyFx(s: GameState, c: Country, fx: CourseFx, k: { leaders: CountryId[]; old: CountryId[]; neighbors: CountryId[]; org?: number; dir: number }, name?: string): string {
  const e = c.eco;
  const notes: string[] = [];
  if (fx.orient) c.orient = clamp((c.orient ?? 0) + fx.orient, -1, 1);
  if (fx.hostile) c.hostile = clamp((c.hostile ?? 0) + fx.hostile, 0, 1);
  for (const x of k.leaders) if (fx.relTarget && s.countries[x]?.alive) addRelation(s, c.id, x, fx.relTarget);
  for (const x of k.old) if (fx.relOld && s.countries[x]?.alive) addRelation(s, c.id, x, fx.relOld);
  for (const x of k.neighbors) if (fx.relNeighbors && s.countries[x]?.alive) addRelation(s, c.id, x, fx.relNeighbors);
  if (fx.fac && c.isPlayer) for (const [f, v] of Object.entries(fx.fac)) sway(c, f as FactionId, v as number);
  if (fx.stab) e.stability = clamp(e.stability + fx.stab, 0, 100);
  if (fx.rep) c.reputation = clamp(c.reputation + fx.rep, 0, 100);
  if (fx.capital) e.capital *= 1 + fx.capital;
  if (fx.tfp) e.tfp *= 1 + fx.tfp;
  if (fx.energy) e.energyCap *= 1 + fx.energy;
  if (fx.infra) e.infra = clamp(e.infra + fx.infra, 5, 100);
  if (fx.milTech) c.mil.milTech = clamp(c.mil.milTech + fx.milTech, 5, 110);
  if (fx.collection) e.collection = clamp(e.collection + fx.collection, 0.4, 0.98);
  if (fx.lift) for (const x of s.countries) if (x.alive && x.id !== c.id && (x.orient ?? 0) > 0.3 && sanctionLevel(s, x.id, c.id) > 0 && getRelation(s, x.id, c.id) > -45) { liftSanction(s, x.id, c.id); notes.push(`${x.name} lifts its sanctions`); }
  for (const kind of fx.treaty ?? []) {
    // with the leading powers of the camp; the third way trades with one power of each camp
    for (const x of k.leaders.slice(0, k.dir === 0 ? 2 : 2)) {
      if (!s.countries[x]?.alive || areAtWar(s, c.id, x) || getRelation(s, c.id, x) < -20) continue;
      const t = s.treaties[c.id < x ? `${c.id}-${x}` : `${x}-${c.id}`];
      if (!t?.[kind]) { applyTreaty(s, c.id, x, kind, true); notes.push(`${kind} with ${s.countries[x].name}`); }
    }
  }
  if (fx.treatyNeighbors) for (const x of k.neighbors) {
    if (!s.countries[x]?.alive || getRelation(s, c.id, x) < 10) continue;
    const t = s.treaties[c.id < x ? `${c.id}-${x}` : `${x}-${c.id}`];
    if (!t?.[fx.treatyNeighbors]) { applyTreaty(s, c.id, x, fx.treatyNeighbors, true); notes.push(`${fx.treatyNeighbors} with ${s.countries[x].name}`); }
  }
  if (fx.breakOld) for (const o of orgsOf(s, c.id)) if (o.camp !== 0 && Math.sign(o.camp) === -Math.sign(k.dir || 0)) { leaveOrg(s, o, c.id, 'it has changed sides'); notes.push(`leaves ${o.name}`); }
  const org = k.org !== undefined ? s.orgs?.find((x) => x.id === k.org) : undefined;
  if (fx.relOrg && org) for (const m of org.members) addRelation(s, c.id, m, fx.relOrg);
  if (fx.finale === 'join' && org) {
    if (admitted(org, applicationVotes(s, org, c.id))) { joinOrg(s, org, c.id, 'the end of a long journey'); notes.push(`joins ${org.name}`); }
    else { const no = applicationVotes(s, org, c.id).filter((v) => !v.yes); notes.push(`${org.name} is not ready to admit you: ${no.slice(0, 3).map((v) => s.countries[v.m].name).join(', ')}${no.length > 3 ? ` and ${no.length - 3} more` : ''} vote no. Keep building ties and apply again`); }
  }
  if (fx.finale?.startsWith('found')) {
    const camp = fx.finale === 'found-neutral' ? 0 : fx.finale === 'found-region' ? 0 : k.dir;
    const pool = fx.finale === 'found-region' ? k.neighbors : s.countries.filter((x) => x.alive && x.id !== c.id).map((x) => x.id);
    const partners = pool.filter((x) => {
      const X = s.countries[x], xo = X.orient ?? 0;
      if (!X.alive || areAtWar(s, c.id, x) || getRelation(s, c.id, x) < 25) return false;
      // a founding member worth having: a neighbour, or an economy of some weight
      if (fx.finale !== 'found-region' && X.eco.gdp < Math.min(c.eco.gdp * 0.05, 4e11)) return false;
      if (fx.finale === 'found-neutral') return Math.abs(xo) < 0.35;
      if (fx.finale === 'found-camp') return xo * k.dir > 0.2;
      return true;
    }).sort((a, b) => getRelation(s, c.id, b) - getRelation(s, c.id, a)).slice(0, 5);
    if (partners.length >= 2) {
      const kind: Org['kind'] = fx.finale === 'found-region' ? (threatened(s, c) ? 'defence' : 'union') : 'economic';
      if (kind === 'defence' && partners.some((x) => orgsOf(s, x).some((o) => o.kind === 'defence'))) partners.splice(0, partners.length, ...partners.filter((x) => !orgsOf(s, x).some((o) => o.kind === 'defence')));
      if (partners.length >= 2) {
        const n = foundOrg(s, c.id, kind, partners, (name && cleanName(name)) || orgName(s, kind, c.id, partners, camp, 5));
        n.camp = camp;
        notes.push(`founds ${n.name}`);
      }
    } else notes.push('too few countries were ready to join; your relations with the candidates improve instead');
    if (partners.length < 2) for (const x of pool.slice(0, 6)) addRelation(s, c.id, x, 6);
  }
  return notes.join('; ');
}

export function actStartCourse(s: GameState, geo: Geo, id: CourseId) {
  const c = s.countries[s.player];
  if (c.course) return { ok: false, message: 'Finish or abandon your current course first' };
  const k = coursesFor(s, c, geo).find((x) => x.id === id);
  if (!k) return { ok: false, message: 'No such course' };
  if (!k.ok) return { ok: false, message: k.why ?? 'Not available' };
  const since = s.tick - (s.stats[`courseAt:${c.id}:${id}`] ?? -9999);
  if (since < 104) return { ok: false, message: `You ended this course recently; it can be tried again in ${104 - since} weeks` };
  c.course = { id, stage: 0, until: 0, started: s.tick, leaders: k.leaders, old: k.old, neighbors: k.neighbors, org: k.org?.id };
  logEvent(s, `🧭 ${c.name} sets a new course: ${k.title}.`, 'diplo', [c.id], true);
  return actAdvanceCourse(s, geo);
}
/** Begin the next step of the course (pay political capital and money; it then takes weeks). */
export function actAdvanceCourse(s: GameState, geo: Geo, name?: string) {
  const c = s.countries[s.player];
  const cur = currentStage(s, c, geo);
  if (!cur || !c.course) return { ok: false, message: 'No course under way' };
  if (cur.running) return { ok: false, message: `${cur.stage.title} is under way (${c.course.until - s.tick} weeks left)` };
  if (c.politics && c.politics.pc < cur.stage.pc) return { ok: false, message: `This step needs ${cur.stage.pc} political capital` };
  if (cur.stage.cost > 0) { const f = fund(s, c.id, cur.stage.cost * c.eco.gdp, `Course: ${cur.stage.title}`); if (!f.ok) return f; }
  if (c.politics) spendPC(c, cur.stage.pc);
  c.course.until = s.tick + cur.stage.weeks;
  if (name) c.course.name = name;
  pressure(s, c, cur.i, cur.course.dir);
  return { ok: true, message: `${cur.stage.title}: under way for ${cur.stage.weeks} weeks.` };
}
export function actAbandonCourse(s: GameState) {
  const c = s.countries[s.player];
  if (!c.course) return { ok: false, message: 'No course under way' };
  for (const x of c.course.leaders) addRelation(s, c.id, x, -5);
  c.reputation = clamp(c.reputation - 2, 0, 100);
  s.stats[`courseAt:${c.id}:${c.course.id}`] = s.tick;
  c.course = undefined;
  return { ok: true, message: 'You abandon the course. The partners you courted feel misled.' };
}

/** The camp you are leaving pushes back, at the second and fourth step. */
function pressure(s: GameState, c: Country, i: number, dir: number) {
  if ((i !== 1 && i !== 3) || !c.course?.old.length) return;
  const patron = c.course.old.filter((x) => s.countries[x]?.alive).sort((a, b) => strength(s.countries[b]) - strength(s.countries[a]))[0];
  if (patron === undefined || strength(s.countries[patron]) < strength(c) * 0.8) return;
  if (c.isPlayer) {
    if (nextRand(s) < 0.6 && !s.scheduled.some((x) => x.id === 'camp_pressure')) s.scheduled.push({ tick: s.tick + 3 + Math.floor(nextRand(s) * 5), id: 'camp_pressure', data: { p: patron, dir } });
  } else {
    addRelation(s, c.id, patron, -6);
    if (nextRand(s) < 0.2) { logEvent(s, `🧭 Under pressure from ${s.countries[patron].name}, ${c.name} abandons its change of course.`, 'diplo', [c.id, patron], isMajor(s, c.id)); s.stats[`courseAt:${c.id}:${c.course!.id}`] = s.tick; c.course = undefined; }
  }
}

/** Weekly: courses finish their steps; AI countries set out on (and walk) their own courses, rarely and for reasons. */
export function stepCourses(s: GameState, geo: Geo) {
  for (const c of s.countries) {
    if (!c.alive) continue;
    const C = c.course;
    if (C && C.until > 0 && s.tick >= C.until) {
      const k = coursesFor(s, c, geo).find((x) => x.id === C.id);
      const st = k?.stages[C.stage];
      if (!k || !st) { c.course = undefined; continue; }
      const what = applyFx(s, c, st.fx, { leaders: C.leaders, old: C.old, neighbors: C.neighbors, org: C.org, dir: k.dir }, C.name);
      const last = C.stage >= k.stages.length - 1;
      logEvent(s, `🧭 ${c.name}: ${st.title} ${last ? 'completes its course' : 'is done'}${what ? ` (${what})` : ''}.`, 'diplo', [c.id], c.isPlayer || isMajor(s, c.id), { big: last && (c.isPlayer || isMajor(s, c.id)) });
      if (last) { (c.coursesDone ??= []).push(C.id); s.stats[`courseAt:${c.id}:${C.id}`] = s.tick; c.course = undefined; continue; }
      C.stage++; C.until = 0;
      // the AI begins the next step at once
      if (!c.isPlayer) { const nx = k.stages[C.stage]; C.until = s.tick + nx.weeks; pressure(s, c, C.stage, k.dir); }
    }
    if (c.isPlayer || c.course || (s.tick + c.id) % 13 !== 5) continue;
    aiConsider(s, c, geo);
  }
}

/** An AI government sets out on a course only with a motive (a new regime, a dangerous neighbour from the other camp,
 *  a strong pull from its friends), only if it matters in the world, and only a few at a time worldwide. */
function aiConsider(s: GameState, c: Country, geo: Geo) {
  if (isAtWar(s, c.id) || s.tick < 26) return;
  if (s.tick - (s.stats.aiCourseAt ?? -999) < 20) return;
  if (s.countries.filter((x) => x.course && !x.isPlayer).length >= 4) return;
  const big = gdpRank(s, c.id) < 60;
  const o = c.orient ?? 0;
  const regimeAge = s.tick - (s.stats[`regime:${c.id}`] ?? -9999);
  let id: CourseId | null = null;
  if (regimeAge < 40 && c.gov === 'D' && o < 0.3) id = 'west';
  else if (regimeAge < 40 && c.gov === 'A' && o > 0.1) id = o > 0.5 ? 'third' : 'east';
  else if (big) {
    const { target } = orientTarget(s, c);
    // a dangerous, hostile neighbour from one camp pushes a country toward the other camp
    const foe = neighborsOf(s, geo, c.id).map((x) => s.countries[x]).find((x) => getRelation(s, c.id, x.id) < -40 && strength(x) > strength(c) * 0.8 && Math.abs(x.orient ?? 0) > 0.5);
    if (foe && (foe.orient ?? 0) * o <= 0.1) id = (foe.orient ?? 0) < 0 ? 'west' : 'east';
    else if (target - o > 0.45) id = 'west';
    else if (target - o < -0.45) id = 'east';
    else if (isMajor(s, c.id) && nextRand(s) < 0.02) id = nextRand(s) < 0.5 ? 'region' : 'third';
  }
  if (!id || nextRand(s) > 0.15) return;
  if (s.tick - (s.stats[`courseAt:${c.id}:${id}`] ?? -9999) < 520) return; // the same story does not repeat within a decade
  const k = coursesFor(s, c, geo).find((x) => x.id === id);
  if (!k?.ok) return;
  s.stats.aiCourseAt = s.tick;
  c.course = { id, stage: 0, until: s.tick + k.stages[0].weeks, started: s.tick, leaders: k.leaders, old: k.old, neighbors: k.neighbors, org: k.org?.id };
  logEvent(s, `🧭 ${c.name.toUpperCase()} CHANGES COURSE: ${k.title}. ${k.intro}`, 'diplo', [c.id, ...k.leaders.slice(0, 1)], isMajor(s, c.id), { big: isMajor(s, c.id) });
}
let rankCache: { st: GameState; tick: number; r: Map<number, number> } | null = null;
function gdpRank(s: GameState, id: CountryId) {
  if (!rankCache || rankCache.st !== s || rankCache.tick !== s.tick) rankCache = { st: s, tick: s.tick, r: new Map(s.countries.filter((x) => x.alive).sort((a, b) => b.eco.gdp - a.eco.gdp).map((x, i) => [x.id, i])) };
  return rankCache.r.get(id) ?? 999;
}

export const courseCost = (st: CourseStage, c: Country) => `${st.pc} political capital${st.cost > 0 ? ` · ${fmtMoney(st.cost * c.eco.gdp)}` : ''} · ${st.weeks} weeks`;
export { imposeSanction };
