/**
 * Operations: the war as you would run it from a bunker. Instead of the fronts simply grinding on, you plan named
 * operations against real objectives on your fronts, and they decide where the war turns.
 *
 *   The objective  seize a region, crush an encircled pocket, march on their capital, land behind their lines, or
 *                  hold a region of yours under attack.
 *   The plan       a commander (their speciality fits some jobs: an Encircler for a pocket, a Logistician for a
 *                  landing, a Fortress general to hold), how much of the army to commit (the rest of the front thins
 *                  out), how long to prepare (stronger, but the longer you wait the likelier the enemy finds out),
 *                  deception (a feint, radio deception), and support (air cover where you rule the skies, a barrage).
 *   The estimate   your staff's odds, as a range: the better your intelligence, the narrower it is.
 *   The battle     while it runs, the target sector gets your concentrated forces and the plan's bonuses in the real
 *                  battle engine (war.ts): the map moves. A week or two in, a crisis comes to your desk (a bridge
 *                  under fire, a storm over the beaches, a counterattack) and your call changes the odds.
 *   The end        taken before the deadline, or a last push decided by the odds and how far the front has come.
 *                  Success: the prize (a pocket destroyed, a beachhead, a capital), war support, a famous general.
 *                  Failure: losses, war support, and a general who may not survive it.
 */
import type { Geo } from './geo';
import { clamp } from './util';
import { nextRand, hash01 } from './rng';
import { logEvent } from './log';
import { fund } from './actions';
import { strength } from './military';
import { airSuperiority, attackCandidates, transferProvince } from './war';
import { supplyNet } from './supply';
import { bumpSupport } from './warsupport';
import { gtrait, stars } from './generals';
import { warSideOf } from './relations';
import { pushInbox } from './events';
import { geoRefGet } from './geoRef';
import type { EventDef } from './eventkit';
import type { CountryId, GameState, General, War } from './types';

export type OpKind = 'seize' | 'encircle' | 'capital' | 'landing' | 'hold';
export type Force = 'light' | 'standard' | 'allin';
export type Deception = 'none' | 'feint' | 'radio';
export type Support = 'air' | 'guns';
export interface Operation {
  id: number; name: string; kind: OpKind; war: number; target: number; enemy: CountryId; general: number;
  force: Force; prep: number; deception: Deception; support: Support[];
  planned: number; launch: number; until: number; status: 'preparing' | 'running' | 'won' | 'failed' | 'cancelled';
  surprise: number; boost: number; est: number; beats: { tick: number; text: string; tone: 'good' | 'bad' | 'info' }[];
  crisis?: boolean;
}
export const OP_KIND: Record<OpKind, { icon: string; name: string; weeks: number; desc: string }> = {
  seize: { icon: '🎯', name: 'Seize', weeks: 8, desc: 'Take the region.' },
  encircle: { icon: '⭕', name: 'Crush the pocket', weeks: 6, desc: 'The enemy here is cut off: destroy them before they break out. Taking it wipes out part of their army.' },
  capital: { icon: '🏛', name: 'March on the capital', weeks: 12, desc: 'The heart of their state. Fortified and defended to the last, but its fall can end the war.' },
  landing: { icon: '⚓', name: 'Landing', weeks: 6, desc: 'From the sea, behind their lines. Needs control of the sea; a beachhead changes everything.' },
  hold: { icon: '🛡', name: 'Hold the line', weeks: 10, desc: 'One of your regions under attack: stop them, then make them pay for it.' },
};
export const FORCE: Record<Force, { name: string; share: number; desc: string }> = {
  light: { name: 'A spearhead', share: 0.2, desc: 'A fifth of your attacking army. The rest of the front barely notices.' },
  standard: { name: 'A full army', share: 0.35, desc: 'A third of your attacking army. Other sectors are thinner for a while.' },
  allin: { name: 'Everything we have', share: 0.55, desc: 'More than half your attacking army. A hammer blow, and a risk everywhere else.' },
};
const WORDS_A = ['Iron', 'Silent', 'Northern', 'Granite', 'Thunder', 'Crimson', 'Winter', 'Falcon', 'Steel', 'Dawn', 'Eagle', 'Black', 'Golden', 'Storm', 'Arrow'];
const WORDS_B = ['Dawn', 'Hammer', 'Tide', 'Lance', 'Gate', 'Spear', 'Shield', 'Harvest', 'Wind', 'Anvil', 'Bridge', 'Fist', 'River', 'Crown', 'Torch'];
const nameOp = (s: GameState, seq: number) => `Operation ${WORDS_A[Math.floor(hash01('opa', seq, s.settings.seed) * WORDS_A.length)]} ${WORDS_B[Math.floor(hash01('opb', seq, s.settings.seed) * WORDS_B.length)]}`;
const provName = (p: number) => geoRefGet()?.provinces[p]?.name || 'the region';

export const activeOp = (s: GameState) => (s.operations ?? []).find((o) => o.status === 'preparing' || o.status === 'running');
const warOf = (s: GameState, o: Operation) => s.wars.find((w) => w.id === o.war);

/** What the player could aim an operation at, on every front they fight. */
export function opTargets(s: GameState, geo: Geo): { prov: number; name: string; kind: OpKind; war: War; enemy: CountryId; progress: number }[] {
  const P = s.countries[s.player];
  const out: { prov: number; name: string; kind: OpKind; war: War; enemy: CountryId; progress: number }[] = [];
  const seen = new Set<number>();
  for (const w of s.wars) {
    if (warSideOf(w, P.id) < 0) continue;
    for (const cd of attackCandidates(s, geo, P, w)) {
      if (seen.has(cd.prov)) continue;
      seen.add(cd.prov);
      const e = s.owner[cd.prov], E = s.countries[e];
      const pocket = supplyNet(s, geo, e).dist[cd.prov] === Infinity;
      const kind: OpKind = cd.prov === E.capital ? 'capital' : cd.amphibious ? 'landing' : pocket ? 'encircle' : 'seize';
      const f = w.fronts.find((x) => x.prov === cd.prov && x.by === P.id);
      out.push({ prov: cd.prov, name: provName(cd.prov), kind, war: w, enemy: e, progress: f?.progress ?? 0 });
    }
    // regions of yours under attack
    for (const f of w.fronts) if (s.owner[f.prov] === P.id && f.by !== P.id && !seen.has(f.prov)) { seen.add(f.prov); out.push({ prov: f.prov, name: provName(f.prov), kind: 'hold', war: w, enemy: f.by, progress: f.progress }); }
  }
  const order: Record<OpKind, number> = { capital: 0, encircle: 1, hold: 2, landing: 3, seize: 4 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || b.progress - a.progress).slice(0, 14);
}

/** How well a general fits the job (a multiplier on the plan). */
export function generalFit(g: General | undefined, kind: OpKind): { mult: number; why: string } {
  if (!g) return { mult: 1, why: 'no commander' };
  const st = stars(g);
  let m = 1 + 0.03 * st, why = `${'★'.repeat(st)} ${gtrait(g.trait).title}`;
  const fit = (k: OpKind[], v: number, txt: string) => { if (k.includes(kind)) { m += v; why += ` · ${txt}`; } };
  if (g.trait === 'blitz') fit(['seize', 'capital'], 0.12, 'made for a breakthrough');
  if (g.trait === 'encircler') fit(['encircle'], 0.22, 'the right general for a pocket');
  if (g.trait === 'logistics') fit(['landing', 'capital'], 0.14, 'keeps a long push supplied');
  if (g.trait === 'artillery') fit(['seize', 'hold', 'encircle'], 0.08, 'the guns do the work');
  if (g.trait === 'fortress') fit(['hold'], 0.2, 'a wall in defence');
  if (g.trait === 'inspiring') { m += 0.06; why += ' · the troops follow them anywhere'; }
  return { mult: m, why };
}

export interface Plan { kind: OpKind; target: number; war: number; enemy: CountryId; general: number; force: Force; prep: number; deception: Deception; support: Support[] }
/** The plan's strength in battle (a multiplier on attack, or defence for a hold) and its cost. */
export function planPower(s: GameState, pl: Plan): { mult: number; cost: number; leak: number; surprise: number; notes: string[] } {
  const P = s.countries[s.player], E = s.countries[pl.enemy];
  const g = P.generals?.find((x) => x.id === pl.general);
  const notes: string[] = [];
  let m = generalFit(g, pl.kind).mult;
  m *= 1 + 0.055 * pl.prep;
  let cost = 0, surprise = pl.prep === 0 ? 0.35 : 0.5;
  if (pl.deception === 'feint') { cost += 0.0005 * P.eco.gdp; surprise += 0.3; }
  if (pl.deception === 'radio') surprise += P.mil.intel >= 0.45 ? 0.2 : 0.05;
  const leak = pl.prep === 0 ? 0 : clamp(0.035 * pl.prep * (1 - 0.6 * P.mil.intel) * (pl.deception === 'none' ? 1 : 0.5) * (1 + E.mil.intel), 0, 0.6);
  if (pl.support.includes('air')) { const a = airSuperiority(P, E); m *= 1 + (a > 0 ? 0.08 + 0.17 * Math.min(1, a) : -0.04); notes.push(a > 0 ? 'air cover: you own the sky' : 'air cover: they own the sky, it costs you planes'); }
  if (pl.support.includes('guns')) { cost += 0.0005 * P.eco.gdp; m *= 1.12; }
  if (pl.kind === 'landing') m *= 0.85; // the sea is the hardest place to start a battle
  if (pl.kind === 'capital') m *= 0.9;
  m *= 1 + 0.3 * clamp(surprise, 0, 1) - 0.1;
  return { mult: Math.round(m * 100) / 100, cost, leak: Math.round(leak * 100) / 100, surprise: clamp(surprise, 0, 1), notes };
}

/** Your staff's odds of success, and how sure they are (the range narrows with intelligence). */
export function opEstimate(s: GameState, geo: Geo, pl: Plan): { p: number; lo: number; hi: number } {
  const P = s.countries[s.player], E = s.countries[pl.enemy];
  const w = s.wars.find((x) => x.id === pl.war);
  const f = w?.fronts.find((x) => x.prov === pl.target && (pl.kind === 'hold' ? x.by !== P.id : x.by === P.id));
  const pw = planPower(s, pl).mult;
  // how the sector stands today: the last battle there if there was one, else the balance of the two armies
  const ratio0 = f?.atk && f.def ? f.atk / f.def : clamp((strength(P) / Math.max(1, strength(E))) * 0.7, 0.2, 5);
  const conc = 1 + FORCE[pl.force].share * 1.5;
  const terrain = 1 + 0.6 * (geo.provinces[pl.target]?.terrain ?? 0);
  const r = pl.kind === 'hold' ? (pw * conc) / Math.max(0.2, ratio0) : (ratio0 * pw * conc) / terrain / (pl.kind === 'capital' ? 1.6 : 1);
  const progress = f?.progress ?? 0;
  // (calibrated against simulated operations: a quick spearhead lands about half to four in five of the time, a fully
  // prepared all-in assault about nine in ten)
  const p = clamp(1 / (1 + Math.exp(-(Math.log(r) * 1.3 + (pl.kind === 'hold' ? -progress * 1.5 : progress * 2) - 0.6))), 0.04, 0.92);
  // a quick, light operation is a gamble whatever the numbers say: the less you commit and prepare, the nearer an even bet
  const ready = clamp(((FORCE[pl.force].share - 0.2) / 0.35) * 0.6 + (pl.prep / 8) * 0.4, 0, 1);
  const pe = 0.5 + (p - 0.5) * (0.6 + 0.4 * ready);
  const spread = 0.06 + 0.22 * (1 - P.mil.intel);
  return { p: pe, lo: clamp(pe - spread, 0.01, 0.99), hi: clamp(pe + spread, 0.01, 0.99) };
}

export function actPlanOperation(s: GameState, geo: Geo, pl: Plan) {
  if (activeOp(s)) return { ok: false, message: 'One operation at a time: finish or call off the one under way' };
  const P = s.countries[s.player];
  const w = s.wars.find((x) => x.id === pl.war);
  if (!w || warSideOf(w, P.id) < 0) return { ok: false, message: 'That war is over' };
  if (!opTargets(s, geo).some((t) => t.prov === pl.target)) return { ok: false, message: 'That objective is out of reach now' };
  const g = P.generals?.find((x) => x.id === pl.general && x.status === 'active');
  if (!g) return { ok: false, message: 'Choose a commander' };
  if (pl.support.includes('air') && P.mil.equipAir <= 0) return { ok: false, message: 'You have no air force' };
  const pp = planPower(s, pl);
  if (pp.cost > 0) { const f = fund(s, P.id, pp.cost, 'Operation: preparations'); if (!f.ok) return f; }
  const seq = (s.stats.opSeq = (s.stats.opSeq ?? 0) + 1);
  const est = opEstimate(s, geo, pl).p;
  const op: Operation = { id: seq, name: nameOp(s, seq), kind: pl.kind, war: pl.war, target: pl.target, enemy: pl.enemy, general: pl.general, force: pl.force, prep: pl.prep, deception: pl.deception, support: pl.support,
    planned: s.tick, launch: s.tick + pl.prep, until: s.tick + pl.prep + OP_KIND[pl.kind].weeks - (g.trait === 'blitz' && pl.kind !== 'hold' ? 1 : 0), status: pl.prep ? 'preparing' : 'running', surprise: pp.surprise, boost: pp.mult, est, beats: [] };
  g.front = pl.target; g.pinned = true;
  (s.operations ??= []).push(op);
  if (s.operations.length > 16) s.operations.splice(0, s.operations.length - 16);
  op.beats.push({ tick: s.tick, text: pl.prep ? `${op.name} is approved. ${g.name} has ${pl.prep} weeks to prepare.` : `${op.name}: ${g.name} attacks at once, before the enemy can react.`, tone: 'info' });
  if (!pl.prep) launch(s, op);
  return { ok: true, message: `${OP_KIND[op.kind].icon} ${op.name} against ${provName(op.target)}: ${pl.prep ? `launch in ${pl.prep} weeks` : 'launched'}. Staff estimate ${Math.round(est * 100)}%.` };
}
export function actCancelOperation(s: GameState) {
  const o = activeOp(s);
  if (!o) return { ok: false, message: 'No operation under way' };
  o.status = 'cancelled';
  unpin(s, o);
  if (o.launch <= s.tick) bumpSupport(s.countries[s.player], -0.015, 'setbacks');
  o.beats.push({ tick: s.tick, text: 'Called off.', tone: 'bad' });
  return { ok: true, message: `${o.name} is called off.` };
}
function unpin(s: GameState, o: Operation) { const g = s.countries[s.player].generals?.find((x) => x.id === o.general); if (g) { g.pinned = false; } }

function launch(s: GameState, o: Operation) {
  o.status = 'running';
  const E = s.countries[o.enemy];
  // did the enemy find out while you prepared?
  const leak = planPower(s, { ...o }).leak;
  if (o.prep > 0 && nextRand(s) < leak) {
    o.surprise = 0; o.boost = Math.round(o.boost * 0.8 * 100) / 100;
    o.beats.push({ tick: s.tick, text: `${E.name} knew it was coming: their reserves are waiting at ${provName(o.target)}.`, tone: 'bad' });
  } else o.beats.push({ tick: s.tick, text: o.kind === 'hold' ? `${o.name}: the line at ${provName(o.target)} is reinforced.` : `H-hour. ${o.name} begins: ${o.surprise > 0.6 ? 'they are caught completely by surprise' : 'the guns open up at dawn'}.`, tone: 'good' });
  logEvent(s, `${OP_KIND[o.kind].icon} ${o.name.toUpperCase()} BEGINS: ${o.kind === 'hold' ? 'the defence of' : 'the attack on'} ${provName(o.target)}.`, 'war', [s.player, o.enemy], true, { big: true, prov: o.target });
}

/** The attack multiplier an operation gives the player's troops on a province this week (war.ts). */
export function opAttackMult(s: GameState, p: number): number {
  const o = activeOp(s);
  return o && o.status === 'running' && o.kind !== 'hold' && o.target === p ? o.boost : 1;
}
/** How much faster the front moves on an operation's objective (an operation is about tempo: weeks, not months). */
export function opTempo(s: GameState, p: number): number {
  const o = activeOp(s);
  return o && o.status === 'running' && o.kind !== 'hold' && o.target === p ? 2.6 : 1;
}
/** The defence multiplier on a province the player holds (a "hold the line" operation). */
export function opDefenceMult(s: GameState, p: number): number {
  const o = activeOp(s);
  return o && o.status === 'running' && o.kind === 'hold' && o.target === p ? o.boost * (1 + FORCE[o.force].share) : 1;
}
/** The share of the player's offensive concentrated on the target (the rest of the front gets the remainder). */
export function opFocus(s: GameState): { target: number; share: number; war: number } | null {
  const o = activeOp(s);
  return o && o.status === 'running' && o.kind !== 'hold' ? { target: o.target, share: FORCE[o.force].share, war: o.war } : null;
}

/** Weekly: launch what is ready, bring the crisis, and decide what has run its course. */
export function stepOperations(s: GameState, geo: Geo) {
  const o = activeOp(s);
  if (!o) return;
  const P = s.countries[s.player], E = s.countries[o.enemy];
  const w = warOf(s, o);
  if (!w || !P.alive || !E?.alive) { o.status = 'cancelled'; o.beats.push({ tick: s.tick, text: 'The war ended before it was decided.', tone: 'info' }); unpin(s, o); return; }
  if (o.status === 'preparing') { if (s.tick >= o.launch) launch(s, o); return; }
  const mine = o.kind === 'hold' ? s.owner[o.target] === P.id : s.owner[o.target] === P.id || w.attackers.concat(w.defenders).some((x) => x === s.owner[o.target] && warSideOf(w, x) === warSideOf(w, P.id));
  // the crisis: a couple of weeks in
  if (!o.crisis && s.tick >= o.launch + 2 && s.tick < o.until - 1 && (o.kind === 'hold' || !mine)) { o.crisis = true; pushInbox(s, `op_${o.kind}`, { op: o.id }, 3); }
  const f = w.fronts.find((x) => x.prov === o.target && (o.kind === 'hold' ? x.by !== P.id : x.by === P.id));
  if (o.kind !== 'hold' && mine) return finish(s, o, true);
  if (o.kind === 'hold' && !mine) return finish(s, o, false);
  if (s.tick < o.until) {
    if (f && (s.tick - o.launch) % 2 === 1) o.beats.push({ tick: s.tick, text: o.kind === 'hold' ? (f.progress < 0.3 ? 'The line holds. Their attacks break against it.' : 'They are gaining ground. Every street is contested.') : (f.progress > 0.5 ? `The front is moving: ${Math.round(f.progress * 100)}% of the way.` : `Hard going: ${Math.round(f.progress * 100)}% of the way, and the enemy fights for every hill.`), tone: (o.kind === 'hold' ? f.progress < 0.3 : f.progress > 0.5) ? 'good' : 'info' });
    return;
  }
  // the deadline: a last push, decided by the odds and how far the front came
  const prog = f?.progress ?? 0;
  const p = o.kind === 'hold' ? clamp(1 - prog * 0.9, 0.1, 0.95) : clamp(o.est * 0.55 + prog * 0.6, 0.03, 0.92);
  const won = nextRand(s) < p;
  if (won && o.kind !== 'hold' && w.attackers.concat(w.defenders).includes(s.owner[o.target]) && warSideOf(w, s.owner[o.target]) !== warSideOf(w, P.id) && warSideOf(w, P.id) >= 0) transferProvince(s, geo, o.target, P.id);
  finish(s, o, won);
}

function finish(s: GameState, o: Operation, won: boolean) {
  const P = s.countries[s.player], E = s.countries[o.enemy];
  const g = P.generals?.find((x) => x.id === o.general);
  o.status = won ? 'won' : 'failed';
  unpin(s, o);
  const place = provName(o.target);
  if (won) {
    bumpSupport(P, o.kind === 'capital' ? 0.08 : o.kind === 'landing' ? 0.05 : 0.04);
    if (o.kind === 'encircle') { const kill = E.mil.troops * 0.08; E.mil.troops -= kill; E.mil.casualties += kill; }
    if (o.kind === 'hold') { const kill = E.mil.troops * 0.04; E.mil.troops -= kill; E.mil.casualties += kill; const w = warOf(s, o); if (w) for (const f of w.fronts) if (f.prov === o.target && f.by !== P.id) f.progress = 0; }
    if (g) { g.xp += 20; g.wins++; }
    const what = o.kind === 'encircle' ? `the pocket at ${place} is destroyed` : o.kind === 'hold' ? `the line at ${place} held, and the enemy bled for it` : o.kind === 'landing' ? `a beachhead at ${place}` : o.kind === 'capital' ? `${place} has fallen` : `${place} is taken`;
    o.beats.push({ tick: s.tick, text: `Success: ${what}.`, tone: 'good' });
    logEvent(s, `🎖 ${o.name.toUpperCase()} SUCCEEDS: ${what}. ${g ? `${g.name} is the hero of the hour.` : ''}`, 'war', [s.player, o.enemy], true, { big: true, prov: o.target });
  } else {
    bumpSupport(P, o.kind === 'capital' ? -0.06 : -0.04, 'setbacks');
    const lost = P.mil.troops * 0.02 * (1 + FORCE[o.force].share);
    P.mil.troops -= lost; P.mil.casualties += lost;
    if (g) g.xp = Math.max(0, g.xp - 10);
    o.beats.push({ tick: s.tick, text: o.kind === 'hold' ? `${place} has fallen.` : `It failed: the attack on ${place} is spent, and the losses are heavy.`, tone: 'bad' });
    logEvent(s, `💀 ${o.name.toUpperCase()} FAILS: ${o.kind === 'hold' ? `${place} falls` : `the attack on ${place} breaks down`}. ${Math.round(lost / 1000)},000 soldiers lost. ${g ? `Questions are asked about ${g.name}.` : ''}`, 'danger', [s.player, o.enemy], true, { big: true, prov: o.target });
  }
}

// ------------------------------------------------------------------ the crisis in the middle of an operation
const opNow = (s: GameState, d: Record<string, number>) => (s.operations ?? []).find((o) => o.id === d.op && o.status === 'running');
const tweak = (s: GameState, d: Record<string, number>, boost: number, weeks = 0, lossPct = 0) => {
  const o = opNow(s, d);
  if (!o) return 'The moment has passed.';
  o.boost = Math.round(Math.max(0.5, o.boost * boost) * 100) / 100; o.until += weeks;
  if (lossPct) { const P = s.countries[s.player]; const l = P.mil.troops * lossPct; P.mil.troops -= l; P.mil.casualties += l; }
  o.beats.push({ tick: s.tick, text: `Your order: ${boost >= 1.1 ? 'push hard' : boost >= 1 ? 'steady' : 'caution'}${weeks ? `, ${weeks > 0 ? '+' : ''}${weeks} week${Math.abs(weeks) > 1 ? 's' : ''}` : ''}.`, tone: boost >= 1 ? 'good' : 'info' });
  return '';
};
const gamble = (s: GameState, d: Record<string, number>, p: number, good: number, bad: number, lossBad: number, okText: string, badText: string) => { if (nextRand(s) < p) { tweak(s, d, good); return okText; } tweak(s, d, bad, 0, lossBad); return badText; };
const opName = (s: GameState, d: Record<string, number>) => opNow(s, d)?.name ?? 'The operation';
const opPlace = (s: GameState, d: Record<string, number>) => { const o = opNow(s, d); return o ? provName(o.target) : 'the front'; };
const gen = (s: GameState, d: Record<string, number>) => { const o = opNow(s, d); return s.countries[s.player].generals?.find((g) => g.id === o?.general)?.name ?? 'Your commander'; };

export const OP_EVENTS: EventDef[] = [
  { id: 'op_seize', icon: '🌉', title: 'The bridge', weight: 0, cooldown: 0, ttl: 3, urgent: true, eligible: () => null,
    text: (s, _c, d) => `${opName(s, d)}: ${gen(s, d)} reports the last bridge before ${opPlace(s, d)} is still standing, under fire, and wired with explosives. The tanks can rush it now, or wait two days for the engineers.`,
    options: [
      { label: 'Rush the bridge', hint: 'A gamble (3 in 5): the attack surges (+25%), or the bridge goes up with tanks on it (−15%, losses)', apply: (s, _c, d) => gamble(s, d, 0.6, 1.25, 0.85, 0.004, 'The first tanks cross as the charges fail to fire. The road to the city is open.', 'The bridge goes up with the third tank on it.') },
      { label: 'Wait for the engineers', hint: 'Safe: +8%, but a week longer', apply: (s, _c, d) => tweak(s, d, 1.08, 1) || 'The engineers clear the charges at dawn. Slower, but the bridge is yours.' },
      { label: 'Go around through the hills', hint: '+5%, the enemy is caught off balance', apply: (s, _c, d) => tweak(s, d, 1.05) || 'A long night march through the hills. They were not expecting you there.' },
    ] },
  { id: 'op_encircle', icon: '⭕', title: 'They are trying to break out', weight: 0, cooldown: 0, ttl: 3, urgent: true, eligible: () => null,
    text: (s, _c, d) => `${opName(s, d)}: the trapped enemy at ${opPlace(s, d)} is massing for a breakout. ${gen(s, d)} can tighten the ring and attack, or offer them terms.`,
    options: [
      { label: 'Close the ring and attack', hint: 'Attack +20% · more losses', apply: (s, _c, d) => tweak(s, d, 1.2, 0, 0.003) || 'The ring closes. Nobody gets out.' },
      { label: 'Offer them surrender terms', hint: 'A gamble (1 in 2): they surrender (+40%), or they fight on, angrier (−5%)', apply: (s, _c, d) => gamble(s, d, 0.5, 1.4, 0.95, 0, 'White flags at dawn: thousands lay down their arms.', 'They tear up the leaflets. They will fight to the end.') },
      { label: 'Starve them out', hint: '+10%, two weeks longer', apply: (s, _c, d) => tweak(s, d, 1.1, 2) || 'No food, no fuel, no ammunition gets through. Time is on your side.' },
    ] },
  { id: 'op_capital', icon: '🏛', title: 'At the gates', weight: 0, cooldown: 0, ttl: 3, urgent: true, eligible: () => null,
    text: (s, _c, d) => `${opName(s, d)}: your lead units can see the towers of ${opPlace(s, d)}. The city is fortified street by street. ${gen(s, d)} asks how you want it taken.`,
    options: [
      { label: 'Storm it', hint: 'Attack +25% · heavy losses · the world watches the ruins', apply: (s, c, d) => { c.reputation = clamp(c.reputation - 3, 0, 100); return tweak(s, d, 1.25, 0, 0.006) || 'Street by street, block by block.'; } },
      { label: 'Encircle it and wait', hint: '+12%, three weeks longer', apply: (s, _c, d) => tweak(s, d, 1.12, 3) || 'The roads are cut. Inside, the bread runs out.' },
      { label: 'Call on the garrison to surrender', hint: 'A gamble (2 in 5): the gates open (+45%), or a propaganda gift for them (−8%)', apply: (s, _c, d) => gamble(s, d, 0.4, 1.45, 0.92, 0, 'The garrison commander walks out under a white flag.', 'Their radio plays your message, then laughs at it.') },
    ] },
  { id: 'op_landing', icon: '🌊', title: 'Storm over the beaches', weight: 0, cooldown: 0, ttl: 3, urgent: true, eligible: () => null,
    text: (s, _c, d) => `${opName(s, d)}: a storm is building over the beaches at ${opPlace(s, d)}. The meteorologists give a narrow window tomorrow. ${gen(s, d)} wants your decision tonight.`,
    options: [
      { label: 'Go tomorrow, in the window', hint: 'A gamble (3 in 5): +30%, or the storm wrecks the landing craft (−20%, losses)', apply: (s, _c, d) => gamble(s, d, 0.6, 1.3, 0.8, 0.004, 'The window holds. By noon the beach is yours.', 'The storm comes early. Landing craft are lost in the surf.') },
      { label: 'Wait for clear weather', hint: '+6%, two weeks longer', apply: (s, _c, d) => tweak(s, d, 1.06, 2) || 'Two weeks of rain, then a flat calm.' },
      { label: 'Land at a quieter beach further on', hint: '+12%, a week longer', apply: (s, _c, d) => tweak(s, d, 1.12, 1) || 'A smaller beach, no defenders. A long walk, but you are ashore.' },
    ] },
  { id: 'op_hold', icon: '🛡', title: 'The line bends', weight: 0, cooldown: 0, ttl: 3, urgent: true, eligible: () => null,
    text: (s, _c, d) => `${opName(s, d)}: the enemy has broken into the outskirts of ${opPlace(s, d)}. ${gen(s, d)} can throw in the last reserves, pull back to a shorter line, or counterattack now.`,
    options: [
      { label: 'Throw in the last reserves', hint: 'Defence +20% · losses', apply: (s, _c, d) => tweak(s, d, 1.2, 0, 0.003) || 'The reserves arrive in buses and lorries, straight into the fight.' },
      { label: 'Pull back to a shorter line', hint: '+10% and a week more to hold', apply: (s, _c, d) => tweak(s, d, 1.1, 1) || 'A painful step back; the new line is strong.' },
      { label: 'Counterattack now', hint: 'A gamble (1 in 2): +35%, or the reserves are lost (−15%)', apply: (s, _c, d) => gamble(s, d, 0.5, 1.35, 0.85, 0.003, 'The counterattack hits them in the flank. They fall back in disorder.', 'The counterattack runs into their guns.') },
    ] },
];
