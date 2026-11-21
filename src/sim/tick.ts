import { stepOngoing } from './ongoing';
import { stepGreat } from './great';
import { stepWarMode } from './warmode';
import { stepPlan } from './plan';
import { stepRivals } from './rivals';
import { stepScenario } from './scenarios';
import { stepFiscalRule } from './levers';
import { stepEpochs } from './epochs';
import { stepLoans, stepTracks } from './detente';
import { stepCoalitions } from './coalitions';
import { stepMinds } from './minds';
import { stepMembership } from './membership';
import { threatLevel } from './ai';
import { stepAlignmentGen } from './alignment';
import { stepCourses } from './courses';
import { stepStoriesGen } from './story';
import { stepProgrammes } from './wargoals';
import { stepWarEvents } from './events6';
import { stepNations } from './nations';
import { stepPolitics as stepDomestic } from './domestic';
import { stepArcs } from './arcs';
import { approval } from './approval';
import { stepResearch } from './research';
import { stepIndustry } from './industry';
import { stepInfluenceGen } from './influence';
import { stepDevelop } from './develop';
import { stepCables } from './cables';
import { setInTick } from './relations';
import type { Geo } from './geo';
import { stepEconomiesGen } from './economy';
import { stepWars, sampleWars, forcePeaceAll, logEvent } from './war';
import { pushInbox } from './events';
import { stepPartisans } from './specops';
import { setTransfer, stepOccupation } from './occupation';
import { stepCampaigns } from './campaigns';
import { stepPeaceDeals } from './peaceterms';
import { stepCharacter } from './character';
import { stepTrade, stepTradeAI, stepTradeEffects } from './trade';
import { stepAutopilot } from './modes';
import { stepLegacy } from './legacy';
import { stepCabinet } from './cabinet';
import { stepArmies } from './armies';
import { stepAIGen } from './ai';
import { nextRand } from './rng';
import { stepProjects } from './projects';
import { stepCrisis } from './crises';
import { stepRival } from './rival';
import { stepDoctrines } from './doctrines';
import { stepLeadersGen } from './leaders';
import { stepCalendar } from './events3';
import { stepReview, stepTrophies } from './trophies';
import { stepUnrest } from './unrest';
import { rollPlayerEvent, stepAssembly, stepWorldEvents } from './events';
import { stepPolitics } from './politics';
import { stepGoals, turningPoint } from './goals';
import { stepRace } from './power';
import { alliesOf } from './relations';
import { START_YEAR, TICKS_PER_YEAR, type GameState } from './types';
import { transferProvince } from './war';

setTransfer(transferProvince);

export function dateOf(tick: number): Date {
  return new Date(Date.UTC(START_YEAR, 0, 1) + tick * 7 * 86400000);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const labels = new Map<number, string>();
/** "5 Jan 2025" (formatted by hand and cached: the locale formatter is slow and this runs in every list). */
export function dateLabel(tick: number): string {
  const key = START_YEAR * 1e6 + tick;
  let l = labels.get(key);
  if (l === undefined) { const d = dateOf(tick); l = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; if (labels.size > 4000) labels.clear(); labels.set(key, l); }
  return l;
}

function checkInstability(s: GameState, geo: Geo) {
  for (const c of s.countries) {
    if (!c.alive || c.eco.stability >= 8) continue;
    // the player is not overthrown by a dice roll: a collapse is a decision they get to make (events10.ts)
    if (c.id === s.player) { if (!s.inbox.some((x) => x.id === 'home_collapse') && s.tick - (s.stats.collapseAsk ?? -999) > 26 && pushInbox(s, 'home_collapse', {}, 4)) s.stats.collapseAsk = s.tick; continue; }
    if (nextRand(s) < 0.02) {
      c.eco.stability = 40;
      c.mil.exhaustion = Math.min(c.mil.exhaustion, 0.3);
      c.eco.inflation = Math.min(c.eco.inflation, 0.1);
      logEvent(s, `Political upheaval in ${c.name}: the government fell and a transitional regime sued for peace in all wars.`, 'danger', [c.id], c.id === s.player, c.id === s.player ? { big: true } : undefined);
      forcePeaceAll(s, geo, c.id, 'its government has fallen');
    }
  }
}

function checkVictory(s: GameState, geo: Geo) {
  const P = s.countries[s.player];
  if (!P.alive) {
    if (!s.victory) s.victory = { achieved: false, text: `${P.name} has been annexed. Game over.` };
    return;
  }
  if (!s.victory && s.settings.endYear && START_YEAR + s.tick / TICKS_PER_YEAR >= s.settings.endYear) {
    s.victory = { achieved: true, text: `The year ${s.settings.endYear} has come. ${P.name} ends the era with a GDP of $${(P.eco.gdp / 1e12).toFixed(2)} trillion and ${P.provinces.length} regions.` };
    logEvent(s, s.victory.text, 'info', [s.player], true);
    return;
  }
  if (s.victory || s.settings.victory === 'none' || s.settings.victory === 'superpower' || s.tick % 13 !== 0) return;
  let worldGdp = 0, worldW = 0, myW = 0;
  for (const c of s.countries) if (c.alive) worldGdp += c.eco.gdp;
  for (const p of geo.provinces) worldW += p.area;
  for (const p of P.provinces) myW += geo.provinces[p].area;
  if (s.settings.victory === 'economic' && P.eco.gdp / worldGdp >= 0.3)
    s.victory = { achieved: true, text: `Economic victory! ${P.name} produces ${(100 * P.eco.gdp / worldGdp).toFixed(0)}% of world GDP.` };
  else if (s.settings.victory === 'conquest' && myW / worldW >= 0.4)
    s.victory = { achieved: true, text: `Conquest victory! ${P.name} controls ${(100 * myW / worldW).toFixed(0)}% of the world's land.` };
  else if (s.settings.victory === 'hegemon') {
    const bloc = [P.id, ...alliesOf(s, P.id)];
    const g = bloc.reduce((t, id) => t + s.countries[id].eco.gdp, 0);
    if (g / worldGdp >= 0.6) s.victory = { achieved: true, text: `Hegemony! Your bloc commands ${(100 * g / worldGdp).toFixed(0)}% of world GDP.` };
  }
  if (s.victory) logEvent(s, s.victory.text, 'info', [s.player], true);
}

/** Advance the world by one week. Deterministic given (state, rng). */
export function tick(s: GameState, geo: Geo) {
  setInTick(true);
  try { for (const _ of tickSlices(s, geo)) { /* run the whole week at once */ } } finally { setInTick(false); }
}
/**
 * One week, in slices. The game loop runs as many slices as fit in a few milliseconds per frame, so even a slow
 * phone keeps drawing smoothly (the world just advances a little slower). The order of work, and therefore the
 * result, is exactly the same as running the week in one go.
 */
/** (profiling aid: names the slice that just ran; costs one assignment) */
const mark = (label: string) => { (globalThis as { __simSlice?: string }).__simSlice = label; };
export function* tickSlices(s: GameState, geo: Geo): Generator<void> {
  s.tick++;
  mark('stepEconomiesGen');
  yield* stepEconomiesGen(s, geo);
  yield;
  mark('stepWars');
  stepWars(s, geo);
  stepOngoing(s);
  stepCampaigns(s, geo);
  stepPeaceDeals(s);
  sampleWars(s);
  yield;
  mark('stepArmies');
  stepArmies(s, geo);
  yield;
  mark('stepPartisans');
  stepPartisans(s);
  stepOccupation(s, geo);
  yield;
  mark('stepAIGen');
  yield* stepAIGen(s, geo);
  yield;
  mark('stepArcs');
  stepAutopilot(s, geo);
  stepCabinet(s);
  stepDomestic(s, approval(s, s.countries[s.player]));
  if (s.stats.apprBoost) s.stats.apprBoost = Math.abs(s.stats.apprBoost) < 0.05 ? 0 : s.stats.apprBoost * 0.96;
  stepFiscalRule(s);
  stepTracks(s);
  stepLoans(s);
  stepArcs(s, geo);
  yield;
  mark('stepCharacter');
  stepNations(s, geo);
  stepCharacter(s);
  yield;
  mark('stepTrade');
  stepTrade(s);
  stepTradeEffects(s);
  stepTradeAI(s);
  yield;
  mark('stepCoalitions');
  stepCoalitions(s, geo);
  yield;
  mark('stepMinds');
  stepMinds(s, geo, (c) => s.stats[`th:${c.id}`] ?? threatLevel(s, geo, c));
  yield;
  mark('stepMembership');
  stepMembership(s);
  yield;
  mark('stepAlignment');
  yield* stepAlignmentGen(s, geo);
  yield;
  mark('stepCourses');
  stepCourses(s, geo);
  stepEpochs(s, geo);
  yield;
  mark('stepStories');
  yield* stepStoriesGen(s, geo);
  yield;
  mark('stepWorldEvents');
  stepProgrammes(s);
  stepWarEvents(s);
  stepCables(s);
  checkInstability(s, geo);
  stepWorldEvents(s, geo);
  yield;
  mark('stepPolitics');
  stepPolitics(s, geo);
  yield;
  mark('stepRival');
  stepProjects(s, geo);
  stepCrisis(s, geo);
  stepRival(s, geo);
  yield;
  mark('stepDoctrines');
  stepDoctrines(s);
  stepResearch(s);
  yield;
  mark('stepIndustry');
  stepIndustry(s);
  stepDevelop(s);
  yield;
  mark('stepInfluence');
  yield* stepInfluenceGen(s);
  yield;
  mark('stepTrophies');
  yield* stepLeadersGen(s, geo);
  stepTrophies(s, geo);
  yield;
  mark('stepUnrest');
  stepReview(s, geo);
  stepUnrest(s, geo);
  yield;
  mark('weekEnd');
  stepAssembly(s, geo);
  stepCalendar(s);
  rollPlayerEvent(s, geo);
  stepGoals(s);
  stepGreat(s);
  stepWarMode(s);
  stepPlan(s);
  stepRace(s);
  stepRivals(s);
  stepScenario(s);
  turningPoint(s, (id) => !!pushInbox(s, id, {}, 20));
  stepLegacy(s, geo);
  checkVictory(s, geo);
}

export const yearOf = (tick: number) => START_YEAR + tick / TICKS_PER_YEAR;
