/**
 * War as the main event. A war the player is in is measured on five tiers, from a border clash to a great-power war,
 * by who the enemy is, the balance of strength, nuclear weapons, how many nations are in it and how close it comes to
 * the heartland. The tier decides how much of the game the war takes over:
 *   1 Border clash    a desk item and a light war strip; the game runs on
 *   2 Limited war     the war council opens (the clock stops); chapters every few months
 *   3 Regional war    the war panel leads the Overview; chapters are urgent
 *   4 Major war       the nation rallies or breaks; more chapters, fast-forward slows down
 *   5 Great-power war the world holds its breath; everything else waits
 * At the war council the player sets the war's aim, the level of mobilisation (peacetime footing → total war economy,
 * each with real costs) and the opening strategy. The war then unfolds in chapters (opening battles, the home front,
 * the turning point, peace feelers) and ends with an aftermath (a parade, a memorial, reconstruction).
 */
import { clamp } from './util';
import { logEvent } from './log';
import { strength } from './military';
import { powerRank } from './power';
import { setRegisterPlayerWar, warScore } from './war';
import { fund } from './actions';
import { sway } from './domestic';
import { setWarGoal, goalOf } from './wargoals';
import { MOBILISATION, mobOf, stratById, type MobLevel, type StratId } from './mobdata';
import type { Country, CountryId, GameState, War } from './types';

export interface WarX {
  tier: number; label: string;
  /** the war council is waiting for the player */
  council: boolean;
  phase: 'opening' | 'grind' | 'turning' | 'endgame';
  /** chapters already told (event ids) and when the last one came */
  told: string[]; last: number;
  /** tier at the start (the aftermath is judged on it) */
  tier0: number; name: string; enemy: CountryId; start: number;
  /** news of a great-power war already given */
  big?: boolean;
}
export const TIER_LABEL = ['', 'Border clash', 'Limited war', 'Regional war', 'Major war', 'Great-power war'];
export const TIER_DESC = [
  '',
  'A skirmish on the border. Keep an eye on it; the country goes on as normal.',
  'A real war, but a contained one. It will shape this year.',
  'A war that will define your term: your region is watching.',
  'A war for the nation’s future. Everything else comes second.',
  'A war between great powers. The world holds its breath.',
];

const sideOf = (w: War, c: CountryId) => (w.attackers.includes(c) ? w.attackers : w.defenders);
const otherSide = (w: War, c: CountryId) => (w.attackers.includes(c) ? w.defenders : w.attackers);
const alive = (s: GameState, ids: CountryId[]) => ids.filter((x) => s.countries[x]?.alive);

/** How big a war is for country `me`: a tier 1–5, and the reasons in words. */
export function warScale(s: GameState, w: War, me: CountryId): { tier: number; label: string; reasons: string[] } {
  const mine = alive(s, sideOf(w, me)), theirs = alive(s, otherSide(w, me));
  const sum = (ids: CountryId[]) => ids.reduce((t, x) => t + strength(s.countries[x]), 0);
  const ratio = sum(theirs) / Math.max(1, sum(mine));
  const reasons: string[] = [];
  let pts = 0;
  const top = theirs.length ? Math.min(...theirs.map((x) => powerRank(s, x))) : 999;
  if (top <= 5) { pts += 2; reasons.push(`a top-5 power is on the other side (${s.countries[theirs.find((x) => powerRank(s, x) === top)!].name})`); }
  else if (top <= 15) { pts += 1; reasons.push('a major power is on the other side'); }
  if (ratio > 3) { pts += 2; reasons.push(`they are ${ratio.toFixed(1)}× stronger`); }
  else if (ratio > 1.3) { pts += 1; reasons.push(`they are ${ratio.toFixed(1)}× stronger`); }
  else if (ratio < 0.3 && w.attackers.includes(me)) { pts -= 1; reasons.push('we are far stronger'); }
  const n = mine.length + theirs.length;
  if (n >= 8) { pts += 2; reasons.push(`${n} nations are fighting`); } else if (n >= 4) { pts += 1; reasons.push(`${n} nations are fighting`); }
  if (theirs.some((x) => s.countries[x].mil.nuclear) && !mine.some((x) => s.countries[x].mil.nuclear)) { pts += 1; reasons.push('the enemy has nuclear weapons, we do not'); }
  const M = s.countries[me];
  const onSoil = w.fronts.filter((f) => s.owner[f.prov] === me).length;
  if (onSoil >= 3 || w.fronts.some((f) => f.prov === M.capital)) { pts += 1; reasons.push(w.fronts.some((f) => f.prov === M.capital) ? 'the capital itself is under attack' : 'the fighting is on our soil'); }
  if ((w.lost[me] ?? 0) > 0.15) { pts += 1; reasons.push('we have lost much of our land'); }
  const tier = clamp(1 + pts, 1, 5);
  return { tier, label: TIER_LABEL[tier], reasons };
}

export const warxOf = (s: GameState, id: number) => s.warx?.[id];
/** The player's wars, biggest first. */
export function playerWars(s: GameState): { w: War; x: WarX }[] {
  const out: { w: War; x: WarX }[] = [];
  for (const w of s.wars) { const x = s.warx?.[w.id]; if (x && (w.attackers.includes(s.player) || w.defenders.includes(s.player))) out.push({ w, x }); }
  return out.sort((a, b) => b.x.tier - a.x.tier);
}
/** The biggest war the player is in (its tier sets the priority), or null. */
export const mainWar = (s: GameState) => playerWars(s)[0] ?? null;

/** A new war of the player's: measured, and (from tier 2) the war council is called. */
export function registerPlayerWar(s: GameState, w: War) {
  const me = s.player;
  if (!(w.attackers.includes(me) || w.defenders.includes(me))) return;
  s.warx ??= {};
  if (s.warx[w.id]) return;
  const sc = warScale(s, w, me);
  const enemy = alive(s, otherSide(w, me))[0] ?? otherSide(w, me)[0];
  s.warx[w.id] = { tier: sc.tier, label: sc.label, council: sc.tier >= 2, phase: 'opening', told: [], last: s.tick, tier0: sc.tier, name: w.name, enemy, start: s.tick };
  const c = s.countries[me];
  // rally round the flag: a nation attacked rallies, the bigger the threat the more (it fades with the fighting)
  if (w.defenders.includes(me)) s.stats.apprBoost = (s.stats.apprBoost ?? 0) + Math.min(6, 1.5 * sc.tier);
  if (sc.tier >= 2) {
    // the council replaces the quick "what is this war for?" decision
    s.inbox = s.inbox.filter((x) => !(x.id === 'war_goal' && x.data.w === w.id));
    logEvent(s, `⚔ ${sc.label.toUpperCase()}: ${w.name}. ${TIER_DESC[sc.tier]} The war council meets.`, 'war', [me, enemy], true, sc.tier >= 3 ? { big: true, prov: c.capital } : undefined);
  }
}

/** The council's three decisions. */
export function actWarCouncil(s: GameState, warId: number, o: { goal: 1 | 2 | 3; mob: MobLevel; strat: StratId }) {
  const w = s.wars.find((x) => x.id === warId);
  const x = s.warx?.[warId];
  if (!w || !x) return { ok: false, message: 'The war is over' };
  setWarGoal(s, w, o.goal);
  const r = actMobilise(s, o.mob, true);
  if (!r.ok) return r;
  s.countries[s.player].strat = o.strat;
  x.council = false;
  const st = stratById(o.strat);
  logEvent(s, `🎖 War council: ${MOBILISATION[o.mob].name.toLowerCase()}, ${st.name.toLowerCase()}.`, 'war', [s.player], true);
  return { ok: true, message: `${MOBILISATION[o.mob].name} · ${st.name}` };
}

/** Change the level of mobilisation. Going up costs money now (call-up, equipment); going down is free but slow. */
export function actMobilise(s: GameState, level: MobLevel, quiet = false) {
  const c = s.countries[s.player];
  const cur = c.mob ?? 0;
  if (level === cur) return { ok: true, message: 'No change' };
  if (level > 0 && !s.wars.some((w) => w.attackers.includes(c.id) || w.defenders.includes(c.id))) return { ok: false, message: 'Mobilisation needs a war' };
  if (level > cur) {
    const cost = 0.004 * (level - cur) * c.eco.gdp;
    const f = fund(s, c.id, cost, 'Mobilisation');
    if (!f.ok) return f;
    if (level >= 2) { sway(c, 'liberals', -4 * (level - 1)); sway(c, 'labour', -3 * (level - 1)); sway(c, 'military', 5); sway(c, 'nationalists', 4); }
  }
  c.mob = level;
  c.mil.warEconomy = level === 3;
  if (!quiet) logEvent(s, `${level > cur ? '📯' : '🕊'} ${MOBILISATION[level].name}${level > cur ? ' declared' : ''}.`, 'war', [c.id], true);
  return { ok: true, message: `${MOBILISATION[level].name}${level > cur ? ` (${MOBILISATION[level].pros[0].toLowerCase()})` : ''}` };
}
export function actSetStrategy(s: GameState, id: StratId) {
  const c = s.countries[s.player];
  if (c.strat === id) return { ok: false, message: 'Already the strategy' };
  if (c.politics && c.politics.pc < 5) return { ok: false, message: 'Changing strategy needs 5 political capital' };
  if (c.politics) c.politics.pc -= 5;
  c.strat = id;
  return { ok: true, message: `New strategy: ${stratById(id).name}` };
}

/** Which chapter of the war is due (event id), if any. */
function chapterDue(s: GameState, w: War, x: WarX): string | null {
  const age = s.tick - w.start, gap = s.tick - x.last;
  const score = warScore(s, w, s.player);
  const c = s.countries[s.player];
  const enemy = s.countries[x.enemy];
  const spacing = [99, 26, 16, 12, 10, 8][x.tier];
  if (x.council) return null;
  if (!x.told.includes('war_opening') && age >= 3) return 'war_opening';
  if (gap < spacing) return null;
  if (!x.told.includes('war_turn') && (score >= 0.3 || score <= -0.3) && age >= 8) return 'war_turn';
  if (x.tier >= 2 && !x.told.includes('war_homefront') && age >= 12) return 'war_homefront';
  if (x.tier >= 2 && (c.mil.exhaustion > 0.45 || (enemy && enemy.mil.exhaustion > 0.45)) && !x.told.includes('war_feelers')) return 'war_feelers';
  if (x.tier >= 3 && !x.told.includes('war_losses') && (w.casualties[s.player] ?? 0) > 0.03 * (c.eco.prev.troops0 ?? c.mil.troops)) return 'war_losses';
  return null;
}

/** Weekly: tiers, phases, the cost and the pull of mobilisation, chapters, the aftermath. */
export function stepWarMode(s: GameState) {
  const c = s.countries[s.player];
  if (!c?.alive) return;
  s.warx ??= {};
  const mine = s.wars.filter((w) => w.attackers.includes(c.id) || w.defenders.includes(c.id));
  for (const w of mine) if (!s.warx[w.id]) registerPlayerWar(s, w);
  // wars that ended: the aftermath
  for (const [k, x] of Object.entries(s.warx)) {
    if (s.wars.some((w) => w.id === Number(k))) continue;
    delete s.warx[Number(k)];
    if (x.tier0 >= 2 && s.legacy?.status !== 'opposition') {
      const rec = [...(s.warHistory ?? [])].reverse().find((r) => r.name === x.name);
      const won = rec ? (rec.winner === 'a') === (rec.a === c.id) && rec.winner !== 'draw' : false;
      const draw = rec?.winner === 'draw';
      s.inbox.push({ uid: s.nextInbox++, id: 'war_aftermath', tick: s.tick, expires: s.tick + 12, urgent: false, data: { won: won ? 1 : 0, draw: draw ? 1 : 0, tier: x.tier0, e: x.enemy, weeks: s.tick - x.start } });
    }
  }
  // every month: the scale of each war (it grows when great powers join or the front reaches the capital)
  for (const w of mine) {
    const x = s.warx[w.id];
    if (s.tick % 4 === 0) {
      const sc = warScale(s, w, c.id);
      if (sc.tier > x.tier) logEvent(s, `⚔ The ${w.name} escalates: now a ${sc.label.toLowerCase()}. ${TIER_DESC[sc.tier]}`, 'war', [c.id, x.enemy], true, sc.tier >= 4 ? { big: true, prov: c.capital } : undefined);
      x.tier = sc.tier; x.label = sc.label;
      const score = warScore(s, w, c.id);
      x.phase = c.mil.exhaustion > 0.45 || (s.countries[x.enemy]?.mil.exhaustion ?? 0) > 0.45 ? 'endgame' : Math.abs(score) >= 0.3 ? 'turning' : s.tick - w.start > 10 ? 'grind' : 'opening';
    }
    if (s.legacy?.status === 'opposition') continue;
    const due = chapterDue(s, w, x);
    if (due && !s.inbox.some((it) => it.id === due) && s.inbox.length < 5) {
      x.told.push(due); x.last = s.tick;
      s.inbox.push({ uid: s.nextInbox++, id: due, tick: s.tick, expires: s.tick + (x.tier >= 3 ? 6 : 10), urgent: x.tier >= 3, data: { w: w.id, e: x.enemy, tier: x.tier } });
    }
  }
  // mobilisation: reservists report for duty, the economy and the public pay for it
  const M = mobOf(c);
  if (M.level > 0) {
    const atWar = mine.length > 0;
    if (atWar) {
      const target = c.mil.troops * (1 + M.callUp);
      const n = Math.max(0, (target - c.mil.troops) / 52);
      const cost = n * c.mil.unitCost * c.eco.price * 0.25; // reservists are cheaper than recruits
      if (n > 0 && c.eco.cash + 0.02 * c.eco.gdp > cost) { c.eco.cash -= cost; c.mil.troops += n; }
      c.eco.stability = clamp(c.eco.stability + M.stab / 52, 0, 100);
      if (M.level === 3) c.eco.monetary += 0.0003;
    } else {
      // the war is over: demobilise
      c.mob = 0; c.mil.warEconomy = false;
      logEvent(s, '🕊 The war is over: the reservists go home and the factories return to peacetime work.', 'info', [c.id], true);
    }
  }
  // the strategy wears out one side or the other
  const st = stratById(c.strat);
  if (mine.length && (st.wear[0] || st.wear[1])) {
    c.mil.exhaustion = clamp(c.mil.exhaustion + st.wear[0] / 52, 0, 1);
    for (const w of mine) for (const e of otherSide(w, c.id)) { const E = s.countries[e]; if (E?.alive) E.mil.exhaustion = clamp(E.mil.exhaustion + st.wear[1] / 52, 0, 1); }
    if (st.id === 'attrition' && s.tick % 13 === 0) c.reputation = clamp(c.reputation - 0.5, 0, 100);
  }
  if (!mine.length && c.strat && c.strat !== 'balanced') c.strat = 'balanced';
  // great-power wars elsewhere make the world news
  if (s.tick % 4 === 0) for (const w of s.wars) {
    if (w.attackers.includes(c.id) || w.defenders.includes(c.id) || s.stats[`gpw:${w.id}`]) continue;
    const tops = [...w.attackers, ...w.defenders].filter((x) => powerRank(s, x) <= 6);
    if (tops.some((x) => w.attackers.includes(x)) && tops.some((x) => w.defenders.includes(x))) {
      s.stats[`gpw:${w.id}`] = s.tick;
      logEvent(s, `🌍 GREAT-POWER WAR: the ${w.name} sets ${tops.map((x) => s.countries[x].name).join(' against ')}. Markets fall; every capital recalculates.`, 'war', [c.id, ...tops], true, { big: true });
    }
  }
  void goalOf;
}

setRegisterPlayerWar(registerPlayerWar);
