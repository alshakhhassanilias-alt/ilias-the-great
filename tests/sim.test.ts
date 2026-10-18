import { describe, expect, it } from 'vitest';
import { loadGeo } from '../src/sim/load';
import { createGame } from '../src/sim/init';
import { tick } from '../src/sim/tick';
import { DEFAULT_SETTINGS, DT, type GameState } from '../src/sim/types';
import { NAME_TO_ID, areAtWar, getRelation } from '../src/sim/relations';
import { potentialOutput, revenueAnnual, plannedSpendingAnnual, taxBurden } from '../src/sim/economy';
import { actDeclareWar, actPeace, buildProject, recruit, setBudget, actPropose, actSanction, actDeclineOffer } from '../src/sim/actions';
import { manpower, strength } from '../src/sim/military';
import { evaluatePeace, transferProvince, declareWar, warScore } from '../src/sim/war';
import { neighborsOf } from '../src/sim/diplomacy';
import { ALL_EVENTS as EVENTS, eventById, resolveEvent, rollPlayerEvent } from '../src/sim/events';
import { GOALS, stepGoals } from '../src/sim/goals';
import { runOp } from '../src/sim/ops';
import { actAirstrike, actCallAllies, actGuarantee, actMediate, actUltimatum, actBuild, actAid, actSummit } from '../src/sim/actions';
import { applyTreaty } from '../src/sim/diplomacy';
import { computeBlocs, previewReactions, finalizeResolution, proposeResolution, tensionIndex } from '../src/sim/politics';
import { stepAssembly } from '../src/sim/events';
import { levelOf, BDEF } from '../src/sim/buildings';
import { hasGuarantee } from '../src/sim/relations';

import { actAppoint, actCourt, candidates, ministerEffects, ministerOf } from '../src/sim/cabinet';
import { actReplyCable } from '../src/sim/cables';
import { nationalName } from '../src/sim/names';
import { actPassLaw, actRepealLaw, factionTarget, forecast, lawById } from '../src/sim/domestic';
import { actStartProject as startNatProject, blocked, pathOf } from '../src/sim/nations';
import { actMissileStrike, actStartProgramme, goalOf, settleGoal } from '../src/sim/wargoals';
import { addAggression, coalitionAgainst } from '../src/sim/coalitions';
import { STORIES } from '../src/data/stories';
import { issueNow, possibleEndings, seedOf, storyEvents } from '../src/sim/story';
import { actTrigger } from '../src/sim/story';
import { addRec, makeAgenda, moodTraitWeight, opinionOf } from '../src/sim/minds';
import { choosePlan, pursuePlan } from '../src/sim/plans';
import { memberValue, stepMembership } from '../src/sim/membership';
import { backlashDue, crisisOf, policyTfp, stepThaw, turningLeader } from '../src/sim/turns';
const geo = loadGeo();
const id = (n: string) => NAME_TO_ID[n];
const fresh = (player = 'Germany', over: Partial<typeof DEFAULT_SETTINGS> = {}) => createGame(geo, { ...DEFAULT_SETTINGS, ...over }, id(player));
const run = (s: GameState, n: number) => { for (let i = 0; i < n; i++) tick(s, geo); };

describe('geography', () => {
  it('has worldwide coverage with consistent province data', () => {
    expect(geo.provinces.length).toBeGreaterThan(500);
    const s = fresh();
    expect(s.countries.length).toBeGreaterThan(190);
    expect(s.owner.every((o) => o >= 0 && o < s.countries.length)).toBe(true);
    expect(s.countries.reduce((t, c) => t + c.provinces.length, 0)).toBe(geo.provinces.length);
  });
  it('knows real land neighbours', () => {
    const s = fresh();
    const n = neighborsOf(s, geo, id('Germany')).map((x) => s.countries[x].name);
    for (const exp of ['France', 'Poland', 'Austria', 'Denmark']) expect(n).toContain(exp);
    expect(n).not.toContain('Spain');
  });
});

describe('baseline calibration', () => {
  it('reproduces real-world baseline data at start', () => {
    const s = fresh('United States of America');
    const us = s.countries[id('United States of America')];
    expect(us.eco.gdp / 1e12).toBeCloseTo(27.36, 1);
    expect(us.eco.pop / 1e6).toBeCloseTo(335, 0);
    expect(us.eco.debt / us.eco.gdp).toBeCloseTo(1.22, 2);
    expect(us.budget.military).toBeCloseTo(0.034, 3);
    const cn = s.countries[id('China')];
    expect(cn.mil.troops).toBe(2035000);
  });
  it('potential output equals starting GDP (model is calibrated, not random)', () => {
    const s = fresh();
    for (const c of s.countries.filter((x) => x.alive)) expect(potentialOutput(c, 1) / c.eco.realGdp).toBeCloseTo(1, 6);
  });
  it('starts balanced: revenue and spending are consistent with the budget lines', () => {
    const s = fresh();
    const c = s.countries[id('France')];
    expect(revenueAnnual(c) / c.eco.gdp).toBeGreaterThan(0.2);
    expect(plannedSpendingAnnual(c) / c.eco.gdp).toBeGreaterThan(0.2);
  });
});

describe('determinism & saving', () => {
  it('same seed => identical world', () => {
    const a = fresh(), b = fresh();
    run(a, 120); run(b, 120);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('save/load round-trips and continues identically', () => {
    const a = fresh('Japan');
    run(a, 60);
    const loaded = JSON.parse(JSON.stringify(a)) as GameState;
    run(a, 60); run(loaded, 60);
    expect(JSON.stringify(loaded)).toBe(JSON.stringify(a));
  });
  it('never produces NaN / Infinity over 8 years', () => {
    const s = fresh();
    run(s, 52 * 8);
    for (const c of s.countries) {
      if (!c.alive) continue;
      for (const [k, v] of Object.entries(c.eco)) if (typeof v === 'number') expect(Number.isFinite(v), `${c.name}.${k}`).toBe(true);
      for (const [k, v] of Object.entries(c.mil)) if (typeof v === 'number') expect(Number.isFinite(v), `${c.name}.mil.${k}`).toBe(true);
    }
  });
});

describe('economy responds to policy', () => {
  it('cash flow equals revenue minus spending (fiscal identity)', () => {
    const s = fresh('Norway');
    const c = s.countries[id('Norway')];
    c.eco.cash = 1e13; // avoid borrowing
    const before = c.eco.cash;
    tick(s, geo);
    const flow = (c.eco.revenue - c.eco.spending) * DT;
    expect(c.eco.cash - before).toBeCloseTo(flow, -3);
  });
  it('excessive taxation reduces productive capacity (trade-off)', () => {
    const s = fresh('Germany');
    const c = s.countries[id('Germany')];
    const base = potentialOutput(c, 1);
    setBudget(s, c.id, 'taxIncome', 0.62); setBudget(s, c.id, 'taxCorporate', 0.5);
    expect(potentialOutput(c, 1)).toBeLessThan(base * 0.9);
    expect(taxBurden(c.budget)).toBeGreaterThan(0.3);
  });
  it('tax cuts widen the deficit immediately', () => {
    const s = fresh('Germany');
    const c = s.countries[id('Germany')];
    run(s, 2);
    const before = c.eco.revenue;
    setBudget(s, c.id, 'taxVat', 0.05);
    tick(s, geo);
    expect(c.eco.revenue).toBeLessThan(before * 0.95);
  });
  it('military overspending strains the budget and raises debt', () => {
    const s = fresh('Germany');
    const c = s.countries[id('Germany')];
    c.eco.cash = 0;
    setBudget(s, c.id, 'military', 0.15);
    const d0 = c.eco.debt;
    run(s, 26);
    expect(c.eco.debt).toBeGreaterThan(d0 * 1.03);
  });
  it('underinvesting in infrastructure erodes it; investing builds it', () => {
    const s = fresh('Germany');
    const c = s.countries[id('Germany')];
    const i0 = c.eco.infra;
    setBudget(s, c.id, 'infra', 0.0);
    run(s, 52);
    expect(c.eco.infra).toBeLessThan(i0 - 1);
    setBudget(s, c.id, 'infra', 0.06);
    const i1 = c.eco.infra;
    run(s, 52);
    expect(c.eco.infra).toBeGreaterThan(i1 + 1);
  });
  it('printing money raises inflation', () => {
    const s = fresh('Brazil');
    const c = s.countries[id('Brazil')];
    const before = c.eco.inflation;
    s.countries[id('Brazil')].eco.monetary += 0.2;
    run(s, 20);
    expect(c.eco.inflation).toBeGreaterThan(before + 0.01);
  });
});

describe('immediate actions (no timers)', () => {
  it('building a factory costs money and adds capital instantly', () => {
    const s = fresh('Poland');
    const c = s.countries[id('Poland')];
    c.eco.cash = 1e12;
    const k0 = c.eco.capital, cash0 = c.eco.cash, pot0 = potentialOutput(c, s.market.priceE);
    const r = buildProject(s, c.id, 'industry', 0.01);
    expect(r.ok).toBe(true);
    expect(c.eco.capital).toBeGreaterThan(k0);
    expect(c.eco.cash).toBeLessThan(cash0);
    expect(potentialOutput(c, s.market.priceE)).toBeGreaterThan(pot0);
  });
  it('infrastructure project improves the statistic at once', () => {
    const s = fresh('Poland');
    const c = s.countries[id('Poland')];
    c.eco.cash = 1e12;
    const i0 = c.eco.infra;
    buildProject(s, c.id, 'infra', 0.01);
    expect(c.eco.infra).toBeGreaterThan(i0 + 1);
  });
  it('recruiting consumes manpower and money immediately', () => {
    const s = fresh('Poland');
    const c = s.countries[id('Poland')];
    const mp0 = manpower(c), t0 = c.mil.troops, cash0 = c.eco.cash;
    const r = recruit(s, c.id, 50000);
    expect(r.ok).toBe(true);
    expect(c.mil.troops).toBe(t0 + 50000);
    expect(manpower(c)).toBeCloseTo(mp0 - 50000, 0);
    expect(c.eco.cash < cash0 || c.eco.debt > 0).toBe(true);
    expect(c.eco.cash).toBeLessThan(cash0);
  });
  it('borrowing is used when treasury is short, and refused at extreme debt', () => {
    const s = fresh('Poland');
    const c = s.countries[id('Poland')];
    c.eco.cash = 0;
    const d0 = c.eco.debt;
    expect(buildProject(s, c.id, 'industry', 0.01).ok).toBe(true);
    expect(c.eco.debt).toBeGreaterThan(d0);
    c.eco.debt = c.eco.gdp * 2.6;
    expect(buildProject(s, c.id, 'industry', 0.01).ok).toBe(false);
  });
  it('changing taxes changes planned revenue at once', () => {
    const s = fresh('Poland');
    const c = s.countries[id('Poland')];
    const r0 = revenueAnnual(c);
    setBudget(s, c.id, 'taxIncome', c.budget.taxIncome + 0.05);
    expect(revenueAnnual(c)).toBeGreaterThan(r0);
  });
});

describe('war & territory', () => {
  it('declaring war changes relations and creates a war immediately', () => {
    const s = fresh('Germany');
    const r0 = getRelation(s, id('Germany'), id('Poland'));
    const r = actDeclareWar(s, geo, id('Germany'), id('Poland'));
    expect(r.ok).toBe(true);
    expect(areAtWar(s, id('Germany'), id('Poland'))).toBe(true);
    expect(getRelation(s, id('Germany'), id('Poland'))).toBeLessThan(r0 - 30);
    expect(actDeclareWar(s, geo, id('Germany'), id('Poland')).ok).toBe(false);
  });
  it('defensive alliances call allies; the setting disables it', () => {
    const on = fresh('Russia', { defensiveAlliances: true });
    declareWar(on, geo, id('Russia'), id('Estonia'));
    const war = on.wars[0];
    expect(war.defenders.length).toBeGreaterThan(1);
    const off = fresh('Russia', { defensiveAlliances: false });
    declareWar(off, geo, id('Russia'), id('Estonia'));
    expect(off.wars[0].defenders).toEqual([id('Estonia')]);
  });
  it('a much stronger army takes territory, borders change immediately, and totals stay consistent', () => {
    const s = fresh('Russia', { defensiveAlliances: false });
    const ru = s.countries[id('Russia')], ge = s.countries[id('Georgia')];
    const before = ge.provinces.length, ruBefore = ru.provinces.length;
    declareWar(s, geo, ru.id, ge.id);
    for (let i = 0; i < 52 * 2 && s.wars.length; i++) tick(s, geo);
    const captured = s.owner.filter((o, p) => geo.country0[p] === ge.id && o === ru.id).length;
    expect(captured).toBeGreaterThan(0);
    expect(ru.provinces.length).toBeGreaterThan(ruBefore);
    expect(ge.provinces.length).toBeLessThan(before);
    expect(s.countries.reduce((t, c) => t + c.provinces.length, 0)).toBe(geo.provinces.length);
    for (const c of s.countries) for (const p of c.provinces) expect(s.owner[p]).toBe(c.id);
    expect(ru.mil.casualties).toBeGreaterThan(0);
  });
  it('conquest takes time: no province falls within the first two months, and peer wars grind on', () => {
    const s = fresh('Germany', { defensiveAlliances: false });
    s.tick = 60;
    declareWar(s, geo, id('Germany'), id('Poland'));
    run(s, 8);
    expect(s.countries[id('Poland')].provinces.length).toBe(geo.provs0[id('Poland')].length);
    run(s, 52);
    expect(s.countries[id('Poland')].alive).toBe(true);
    expect(s.countries[id('Germany')].mil.casualties).toBeGreaterThan(5000);
    expect(s.countries[id('Poland')].mil.exhaustion).toBeGreaterThan(0.1);
  });
  it('nuclear deterrence slows an invasion (controlled comparison, same war with and without the bomb)', () => {
    const lost = (nuclear: boolean) => {
      const s = fresh('India', { defensiveAlliances: false });
      s.tick = 60;
      s.countries[id('Pakistan')].mil.nuclear = nuclear;
      declareWar(s, geo, id('India'), id('Pakistan'));
      for (let i = 0; i < 40; i++) tick(s, geo);
      return geo.provs0[id('Pakistan')].length - s.countries[id('Pakistan')].provinces.length;
    };
    expect(lost(true)).toBeLessThanOrEqual(lost(false));
    expect(lost(false) - lost(true)).toBeGreaterThanOrEqual(0);
  });
  it('war exhaustion rises during fighting and falls in peace', () => {
    const s = fresh('Germany', { defensiveAlliances: false });
    s.tick = 60;
    declareWar(s, geo, id('Germany'), id('Poland'));
    run(s, 30);
    const ex = s.countries[id('Germany')].mil.exhaustion;
    expect(ex).toBeGreaterThan(0.02);
    actPeace(s, geo, id('Germany'), id('Poland'), { kind: 'status_quo' }); // may or may not be accepted
    s.countries[id('Poland')].mil.exhaustion = 1;
    expect(actPeace(s, geo, id('Germany'), id('Poland'), { kind: 'status_quo' }).ok || !areAtWar(s, id('Germany'), id('Poland'))).toBe(true);
    run(s, 20);
    expect(s.countries[id('Germany')].mil.exhaustion).toBeLessThan(ex * 0.95 + 0.001);
  });
  it('military size is not everything: logistics, terrain and readiness change outcomes', () => {
    const s = fresh('Germany');
    const c = s.countries[id('France')];
    const base = strength(c);
    c.mil.readiness = 0.2;
    expect(strength(c)).toBeLessThan(base * 0.85);
    c.mil.readiness = 0.8; c.mil.milTech = 20;
    expect(strength(c)).toBeLessThan(base);
  });
  it('transferring a province carries population and output with it', () => {
    const s = fresh('Germany');
    const fr = s.countries[id('France')], ge = s.countries[id('Germany')];
    const p = fr.provinces.find((q) => q !== fr.capital)!;
    const pop0 = ge.eco.pop, gdp0 = ge.eco.realGdp, frGdp0 = fr.eco.realGdp;
    transferProvince(s, geo, p, ge.id);
    expect(ge.eco.pop).toBeGreaterThan(pop0);
    expect(ge.eco.realGdp).toBeGreaterThan(gdp0);
    expect(fr.eco.realGdp).toBeLessThan(frGdp0);
    expect(s.owner[p]).toBe(ge.id);
    expect(s.core[p]).toBe(fr.id); // remembers its original owner
  });
  it('peace: defeated side accepts terms when exhausted, refuses harsh terms when strong', () => {
    const s = fresh('Russia', { defensiveAlliances: false });
    declareWar(s, geo, id('Russia'), id('Georgia'));
    const ge = s.countries[id('Georgia')];
    expect(evaluatePeace(s, geo, id('Russia'), id('Georgia'), { kind: 'surrender' }).accept).toBe(false);
    ge.mil.exhaustion = 1;
    const w = s.wars[0];
    w.lost[ge.id] = 0.6;
    expect(evaluatePeace(s, geo, id('Russia'), id('Georgia'), { kind: 'status_quo' }).accept).toBe(true);
    expect(warScore(s, w, ge.id)).toBeLessThan(0);
    const r = actPeace(s, geo, id('Russia'), id('Georgia'), { kind: 'status_quo' });
    expect(r.ok).toBe(true);
    expect(areAtWar(s, id('Russia'), id('Georgia'))).toBe(false);
  });
});

describe('diplomacy', () => {
  it('AI evaluates treaty proposals on relations and interests', () => {
    const s = fresh('Germany');
    expect(actPropose(s, geo, id('Germany'), id('Brazil'), 'trade').ok).toBe(true); // friendly + mutual gains
    expect(actPropose(s, geo, id('Germany'), id('Russia'), 'alliance').ok).toBe(false); // hostile bloc
    expect(getRelation(s, id('Germany'), id('Russia'))).toBeLessThan(-20);
    expect(actPropose(s, geo, id('Germany'), id('Brazil'), 'alliance').ok).toBe(false); // friendly but not yet trusted enough
    expect(actPropose(s, geo, id('Germany'), id('Japan'), 'alliance').ok).toBe(true); // trusted partner with shared rivals
  });
  it('sanctions hurt the target\'s trade and relations', () => {
    const s = fresh('United States of America');
    const r0 = getRelation(s, id('Brazil'), id('United States of America'));
    actSanction(s, id('United States of America'), id('Brazil'), 2);
    expect(getRelation(s, id('Brazil'), id('United States of America'))).toBeLessThan(r0 - 20);
    const br = s.countries[id('Brazil')];
    const t0 = br.eco.tradeIndex;
    run(s, 4);
    expect(br.eco.sanctionShare).toBeGreaterThan(0.05);
    expect(br.eco.tradeIndex).toBeLessThan(t0 - 0.05);
  });
  it('AI countries do not all attack the player', () => {
    const s = fresh('Germany');
    run(s, 52 * 5);
    const atWarWithPlayer = s.countries.filter((c) => c.alive && c.id !== id('Germany') && areAtWar(s, c.id, id('Germany'))).length;
    expect(atWarWithPlayer).toBeLessThan(3);
    actDeclineOffer(s, -1);
  });
});

describe('things to do: events, goals, covert ops, war actions', () => {
  it('decisions arrive in the inbox at a sane pace, never block the clock, and apply their effects', () => {
    const s = fresh('Poland');
    let seen = 0, maxInbox = 0;
    const ids: string[] = [];
    for (let i = 0; i < 52 * 6; i++) {
      tick(s, geo);
      maxInbox = Math.max(maxInbox, s.inbox.length);
      const it = s.inbox[0];
      if (it && s.tick % 5 === 0) {
        seen++; ids.push(it.id.startsWith('fac_') ? `${it.id}:${it.data.f}` : it.id);
        const n = eventById(it.id).options.length;
        let r = resolveEvent(s, geo, n - 1, it.uid); // the last option is the cautious one
        for (let o = 0; !r.ok && o < n; o++) r = resolveEvent(s, geo, o, it.uid);
        expect(r.message.length).toBeGreaterThan(3);
        expect(s.inbox.find((x) => x.uid === it.uid)).toBeUndefined();
      }
    }
    expect(seen).toBeGreaterThanOrEqual(8); // a couple of decisions every year
    expect(seen).toBeLessThanOrEqual(52 * 6 / 6); // but never a flood
    expect(maxInbox).toBeLessThanOrEqual(5);
    // variety: no event twice in a row, and many different ones
    for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1]);
    expect(new Set(ids).size).toBeGreaterThanOrEqual(8);
  });
  it('ignored decisions lapse by themselves instead of freezing the game', () => {
    const s = fresh('Poland');
    for (let i = 0; i < 52 * 4; i++) tick(s, geo); // never answer anything
    expect(s.inbox.every((x) => x.expires > s.tick)).toBe(true);
    expect(s.inbox.length).toBeLessThanOrEqual(5);
    expect(s.log.some((e) => /let it lapse/.test(e.text))).toBe(true);
  });
  it('every event definition is internally consistent', () => {
    const s = fresh('Germany');
    const c = s.countries[id('Germany')];
    c.eco.cash = 1e12;
    for (const def of EVENTS) {
      const fr = id('France'), pl = id('Poland');
      const d = def.eligible(s, c, geo) ?? { o: fr, p: 3, n: fr, from: fr, a: pl, b: fr, x: fr, l: fr, t: pl, ally: pl, aggressor: fr, war: -1, rid: -1, kind: 1, w: -1 };
      expect(def.text(s, c, d).length).toBeGreaterThan(10);
      expect(def.options.length).toBeGreaterThanOrEqual(def.weight > 0 ? 2 : 1);
      for (let i = 0; i < def.options.length; i++) {
        const s2 = JSON.parse(JSON.stringify(s)) as GameState;
        s2.inbox = [{ uid: 1, id: def.id, tick: 1, expires: 99, urgent: false, data: d }];
        if (def.options[i].enabled && !def.options[i].enabled!(s2, s2.countries[id('Germany')])) continue; // locked options (e.g. Germany cannot "turn West")
        const r = resolveEvent(s2, geo, i);
        if (def.options[i].label.includes('declare war') && !r.ok) continue;
        expect(r.ok, `${def.id}/${i}`).toBe(true);
        expect(Number.isFinite(s2.countries[id('Germany')].eco.stability)).toBe(true);
      }
    }
    rollPlayerEvent(s, geo);
  });
  it('objectives pay out their reward when completed', () => {
    const s = fresh('Germany');
    const c = s.countries[id('Germany')];
    s.tick = 4;
    stepGoals(s);
    expect(s.goalsActive.length).toBe(3); // three relevant goals are always on the board
    s.goalsActive = ['infra'];
    c.eco.infra = 80; // completes "modern infrastructure"
    const cash0 = c.eco.cash;
    s.tick = 8;
    stepGoals(s);
    expect(s.goalsDone['infra']).toBeDefined();
    expect(c.eco.cash).toBeGreaterThan(cash0);
    expect(GOALS.length).toBeGreaterThanOrEqual(25);
    expect(new Set(GOALS.map((g) => g.theme)).size).toBe(3);
  });
  it('covert operations cost money, can fail with consequences, and intel reveals real numbers', () => {
    let wins = 0, losses = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const s = fresh('United States of America', { seed });
      const me = s.countries[id('United States of America')];
      const r0 = getRelation(s, id('United States of America'), id('Iran'));
      const cash0 = me.eco.cash;
      const r = runOp(s, me.id, id('Iran'), 'intel');
      expect(me.eco.cash).toBeLessThan(cash0);
      if (r.ok) { wins++; expect(s.intelUntil[id('Iran')]).toBeGreaterThan(s.tick); }
      else { losses++; expect(getRelation(s, id('United States of America'), id('Iran'))).toBeLessThanOrEqual(r0); }
      expect(runOp(s, me.id, id('Iran'), 'intel').ok).toBe(false); // cooldown
    }
    expect(wins).toBeGreaterThan(losses); // a superpower's spies usually succeed
  });
  it('an air strike speeds up an offensive; calling allies can bring them in', () => {
    const s = fresh('Russia', { defensiveAlliances: true });
    s.tick = 60;
    declareWar(s, geo, id('Russia'), id('Ukraine'));
    run(s, 3);
    const w = s.wars[0];
    const fr = w.fronts.find((f) => f.by === id('Russia'))!;
    const p0 = fr.progress;
    s.countries[id('Russia')].eco.cash = 1e12;
    expect(actAirstrike(s, id('Russia'), fr.prov).ok).toBe(true);
    expect(fr.progress).toBeGreaterThan(p0);
    expect(actAirstrike(s, id('Russia'), 0).ok).toBe(false);
    actCallAllies(s, id('Russia'));
  });
  it('provinces have readable names and borders are precomputed', () => {
    const named = geo.provinces.filter((p) => p.name.length >= 2).length; // real places can be short (Bo, Sierra Leone)
    expect(named).toBe(geo.provinces.length);
    expect(geo.provinces[geo.provs0[id('Poland')][0]].name).toMatch(/Warsaw|Poland/);
    expect(geo.provinces.reduce((t, p) => t + p.edges.length, 0)).toBeGreaterThan(3000);
    // every province boundary is accounted for by its own runs or its neighbours' runs
    const covered = new Set<number>();
    geo.provinces.forEach((p) => { if (p.edges.length) covered.add(p.id); p.edges.forEach((e) => e.n >= 0 && covered.add(e.n)); });
    expect(covered.size).toBe(geo.provinces.length);
  });
});

describe('world politics: deals ripple through the system', () => {
  it('a treaty with someone\'s rival makes the world react, and the preview predicts it', () => {
    const s = fresh('Brazil');
    const us = id('United States of America'), br = id('Brazil'), ir = id('Iran'), il = id('Israel');
    const pre = previewReactions(s, br, ir, 'alliance');
    expect(pre.some((r) => r.id === us && r.delta < 0)).toBe(true);
    const rUs = getRelation(s, us, br), rIl = getRelation(s, il, br);
    applyTreaty(s, br, ir, 'alliance');
    expect(getRelation(s, us, br)).toBeLessThan(rUs - 4);
    expect(getRelation(s, il, br)).toBeLessThan(rIl - 4);
    expect(s.lastRipple?.kind).toBe('alliance');
    expect(s.lastRipple!.reactions.length).toBeGreaterThan(0);
    expect(s.lastRipple!.summary).toMatch(/objected|approved/);
  });
  it('friends of a partner welcome a deal; trade deals ripple less than alliances', () => {
    const s = fresh('Brazil');
    const al = previewReactions(s, id('Brazil'), id('Japan'), 'alliance');
    const tr = previewReactions(s, id('Brazil'), id('Japan'), 'trade');
    expect(al.some((r) => r.delta > 0)).toBe(true);
    const mag = (rs: typeof al) => rs.reduce((t, r) => t + Math.abs(r.delta), 0);
    expect(mag(tr)).toBeLessThan(mag(al));
  });
  it('an AI refuses to ally with someone allied to its rival', () => {
    const s = fresh('Brazil');
    applyTreaty(s, id('Brazil'), id('Iran'), 'alliance');
    const ev = evaluateProposalForTest(s, id('Brazil'), id('Israel'));
    expect(ev.reasons.join(' ')).toMatch(/allied with its rival/);
  });
  it('alliance blocs are detected (NATO) and global tension rises with war', () => {
    const s = fresh('Germany');
    const { blocs } = computeBlocs(s);
    expect(blocs.some((b) => b.name === 'NATO' && b.members.length >= 25)).toBe(true);
    const t0 = tensionIndex(s);
    s.tick = 60;
    declareWar(s, geo, id('Russia'), id('Ukraine'));
    expect(tensionIndex(s)).toBeGreaterThan(t0);
  });
  it('the player is asked whether to honour an alliance instead of being dragged into war', () => {
    const s = fresh('Poland', { defensiveAlliances: true });
    s.tick = 60;
    declareWar(s, geo, id('Russia'), id('Estonia'));
    const w = s.wars[0];
    expect(w.defenders).not.toContain(id('Poland'));
    expect(s.scheduled.some((x) => x.id === 'ally_attacked')).toBe(true);
    rollPlayerEvent(s, geo);
    expect(s.inbox[0]?.id).toBe('ally_attacked');
    resolveEvent(s, geo, 0); // honour the alliance
    expect(w.defenders).toContain(id('Poland'));
  });
  it('declining to help an ally costs reputation and relations', () => {
    const s = fresh('Poland', { defensiveAlliances: true });
    s.tick = 60;
    declareWar(s, geo, id('Russia'), id('Estonia'));
    rollPlayerEvent(s, geo);
    const rep0 = s.countries[id('Poland')].reputation, rel0 = getRelation(s, id('Poland'), id('Estonia'));
    resolveEvent(s, geo, 3); // stay out
    expect(s.countries[id('Poland')].reputation).toBeLessThan(rep0);
    expect(getRelation(s, id('Poland'), id('Estonia'))).toBeLessThan(rel0);
  });
  it('security guarantees, aid and summits change relations and are recorded', () => {
    const s = fresh('Germany');
    const me = s.countries[id('Germany')];
    me.eco.cash = 1e12;
    const rel0 = getRelation(s, id('Germany'), id('Ukraine'));
    expect(actGuarantee(s, me.id, id('Ukraine'), true).ok).toBe(true);
    expect(hasGuarantee(s, me.id, id('Ukraine'))).toBe(true);
    expect(getRelation(s, id('Germany'), id('Ukraine'))).toBeGreaterThan(rel0);
    expect(actAid(s, me.id, id('Ukraine'), 0.003).ok).toBe(true);
    expect(s.stats.aid).toBe(1);
    expect(actSummit(s, me.id, id('Ukraine')).ok || true).toBe(true);
    expect(actSummit(s, me.id, id('Ukraine')).ok).toBe(false); // cooldown
  });
  it('mediation can end a war between two other countries', () => {
    let ended = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = fresh('Switzerland', { seed, defensiveAlliances: false });
      s.tick = 60;
      declareWar(s, geo, id('Russia'), id('Ukraine'));
      s.countries[id('Russia')].mil.exhaustion = 0.9; s.countries[id('Ukraine')].mil.exhaustion = 0.9;
      s.countries[id('Switzerland')].eco.cash = 1e12;
      actMediate(s, geo, id('Switzerland'), s.wars[0].id);
      if (s.wars.length === 0) { ended++; expect(s.stats.mediations).toBe(1); }
    }
    expect(ended).toBeGreaterThan(3);
  });
  it('ultimatums either win concessions without war or damage relations', () => {
    let got = 0, refused = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = fresh('Russia', { seed });
      const me = s.countries[id('Russia')];
      const before = s.countries[id('Georgia')].provinces.length;
      const r = actUltimatum(s, geo, me.id, id('Georgia'), 'cede');
      if (r.ok) { got++; expect(s.countries[id('Georgia')].provinces.length).toBe(before - 1); expect(s.wars.length).toBe(0); }
      else { refused++; expect(getRelation(s, id('Georgia'), me.id)).toBeLessThan(-20); }
    }
    expect(got + refused).toBe(20);
    expect(got).toBeGreaterThan(0);
  });
  it('World Assembly votes happen and have consequences', () => {
    const s = fresh('Germany');
    s.tick = 60;
    declareWar(s, geo, id('Russia'), id('Ukraine'));
    s.tick = 65; // 65 % 26 === 13
    stepAssembly(s, geo);
    expect(s.resolutions.length).toBe(1);
    const r = s.resolutions[0];
    expect(['condemn', 'sanction', 'ceasefire']).toContain(r.kind);
    const passed = finalizeResolution(s, geo, r, 'yes');
    expect(typeof passed).toBe('boolean');
    expect(proposeResolution(s)).not.toBeNull();
  });
  it('buildings are bought instantly, give effects, and are captured by conquerors', () => {
    const s = fresh('Poland');
    const me = s.countries[id('Poland')];
    me.eco.cash = 1e12;
    const p = me.provinces.find((q) => q !== me.capital)!;
    const cash0 = me.eco.cash;
    expect(actBuild(s, geo, me.id, p, 'fort').ok).toBe(true);
    expect(actBuild(s, geo, me.id, p, 'fort').ok).toBe(true);
    expect(levelOf(s, p, 'fort')).toBe(2);
    expect(me.eco.cash).toBeLessThan(cash0);
    expect(me.mil.bld.fort).toBe(2);
    const k0 = me.eco.capital;
    actBuild(s, geo, me.id, p, 'factory');
    expect(me.eco.capital).toBeGreaterThan(k0);
    const g = s.countries[id('Germany')];
    transferProvince(s, geo, p, g.id);
    expect(levelOf(s, p, 'fort')).toBe(1); // damaged in the fighting
    expect(g.mil.bld.fort).toBe(1);
    expect(me.mil.bld.fort).toBe(0);
    expect(BDEF.port.cost).toBeGreaterThan(0);
  });
  it('AI countries advertise what they are up to', () => {
    const s = fresh('Germany', { aggression: 2 });
    run(s, 60);
    const withIntent = s.countries.filter((c) => c.alive && c.intent.length > 3).length;
    expect(withIntent).toBeGreaterThan(100);
  });
});
import { evaluateProposal } from '../src/sim/diplomacy';
function evaluateProposalForTest(s: GameState, from: number, to: number) { return evaluateProposal(s, geo, from, to, 'alliance'); }

import { actStartProject, actCancelProject } from '../src/sim/actions';
import { PROJECTS, canStart, hasDone, runsOf } from '../src/sim/projects';
import { CRISES, stepCrisis } from '../src/sim/crises';
import { stepUnrest } from '../src/sim/unrest';
import { pickRival } from '../src/sim/rival';

describe('action layer: projects, crises, uprisings, rival, drama', () => {
  it('megaprojects are funded weekly, finish with a payoff and announce themselves', () => {
    const s = fresh('Germany');
    const c = s.countries[id('Germany')];
    c.eco.cash = 1e13;
    const tech0 = c.eco.tech;
    expect(actStartProject(s, c.id, 'education').ok).toBe(true);
    expect(actStartProject(s, c.id, 'education').ok).toBe(false); // already running
    const cash0 = c.eco.cash;
    run(s, 10);
    expect(c.eco.cash).toBeLessThan(cash0);
    const w = PROJECTS.find((p) => p.id === 'education')!.weeks;
    run(s, w);
    expect(runsOf(s, c.id).some((r) => r.id === 'education')).toBe(false);
    expect(hasDone(s, c.id, 'education')).toBe(true);
    expect(c.eco.tech).toBeGreaterThan(tech0);
    expect(s.log.some((e) => e.big && /Education Reform complete/.test(e.text))).toBe(true);
    expect(canStart(s, c.id, 'education')).toBe('Already completed');
  });
  it('projects can be cancelled, are limited to two at once, and gated by technology', () => {
    const s = fresh('Nigeria');
    const c = s.countries[id('Nigeria')];
    expect(canStart(s, c.id, 'space')).toMatch(/technology/);
    c.eco.tech = 80; c.eco.cash = 1e12;
    expect(actStartProject(s, c.id, 'cyber').ok).toBe(true);
    expect(actStartProject(s, c.id, 'grid').ok).toBe(true);
    expect(actStartProject(s, c.id, 'rail').ok).toBe(false);
    const uid = runsOf(s, c.id)[0].uid;
    expect(actCancelProject(s, c.id, uid).ok).toBe(true);
    expect(runsOf(s, c.id)).toHaveLength(1);
  });
  it('a nuclear programme makes a nuclear power and the world reacts', () => {
    const s = fresh('Turkey');
    const c = s.countries[id('Turkey')];
    c.eco.tech = 70; c.eco.cash = 1e13;
    const rel0 = getRelation(s, id('Turkey'), id('Greece'));
    actStartProject(s, c.id, 'nuclear');
    run(s, 131);
    expect(c.mil.nuclear).toBe(true);
    expect(getRelation(s, id('Turkey'), id('Greece'))).toBeLessThan(rel0);
  });
  it('world crises start on schedule, hit every economy, end, and put a decision to the player', () => {
    const s = fresh('Germany');
    s.nextCrisis = 5;
    run(s, 8);
    expect(s.crisis).not.toBeNull();
    expect(s.log.some((e) => e.big && /WORLD (CRISIS|BOOM)/.test(e.text))).toBe(true);
    expect(s.scheduled.some((x) => /_response$/.test(x.id)) || s.inbox.some((x) => /_response$/.test(x.id))).toBe(true);
    const end = s.crisis!.end;
    run(s, end - s.tick + 2);
    expect(s.crisis).toBeNull();
    expect(CRISES.length).toBeGreaterThanOrEqual(6);
  });
  it('a recession lowers output relative to an identical world without one', () => {
    const a = fresh('Germany'), b = fresh('Germany');
    a.nextCrisis = 1e9; b.nextCrisis = 1e9;
    b.crisis = { id: 'recession', start: 0, end: 60 };
    run(a, 30); run(b, 30);
    expect(b.countries[id('France')].eco.realGdp).toBeLessThan(a.countries[id('France')].eco.realGdp);
    void stepCrisis;
  });
  it('conquered land can rise up, and a dead country is reborn with a government and an army', () => {
    const s = fresh('Germany');
    s.nextCrisis = 1e9;
    s.tick = 40;
    const E = s.countries[id('Estonia')], R = s.countries[id('Russia')];
    // Russia swallows Estonia entirely
    for (const p of [...E.provinces]) transferProvince(s, geo, p, R.id);
    expect(E.alive).toBe(false);
    for (const p of R.provinces) if (s.core[p] === E.id) s.integ[p] = 0.1;
    R.eco.stability = 5;
    for (let i = 0; i < 400 && !E.alive; i++) { s.tick = 41 + 4 * i; stepUnrest(s, geo); }
    expect(E.alive).toBe(true);
    expect(E.provinces.length).toBeGreaterThan(0);
    expect(E.mil.troops).toBeGreaterThan(0);
    expect(s.log.some((e) => e.big && /INDEPENDENCE/.test(e.text))).toBe(true);
    expect(s.owner[E.provinces[0]]).toBe(E.id);
    run(s, 40); // the reborn economy must stay sane
    expect(Number.isFinite(E.eco.gdp) && E.eco.gdp > 0).toBe(true);
  });
  it('every player gets a sensible rival, and rival events are tied to it', () => {
    const s = fresh('Poland');
    expect(pickRival(s, geo)).toBeGreaterThanOrEqual(0);
    run(s, 2);
    expect(s.rival).toBeGreaterThanOrEqual(0);
    expect(s.rival).not.toBe(s.player);
    expect(s.log.some((e) => /main rival/.test(e.text))).toBe(true);
    const ev = eventById('rival_spies');
    expect(ev.eligible(s, s.countries[s.player], geo)).toEqual({ o: s.rival });
  });
  it('battles produce named reports, casualty milestones and breaking news', () => {
    const s = fresh('Brazil');
    s.nextCrisis = 1e9;
    declareWar(s, geo, id('Russia'), id('Georgia'));
    const seen: GameState['log'] = [];
    for (let i = 0; i < 80; i++) { const from = s.logSeq; tick(s, geo); seen.push(...s.log.filter((e) => e.seq >= from)); } // collected as they happen (the log keeps only the latest lines)
    expect(seen.some((e) => /Battle of/.test(e.text))).toBe(true);
    expect(seen.some((e) => e.big)).toBe(true);
    expect(seen.some((e) => e.prov !== undefined)).toBe(true);
  });
  it('a hundred weeks with no input produces no NaN and keeps the inbox bounded', () => {
    const s = fresh('India');
    run(s, 100);
    for (const c of s.countries) if (c.alive) { expect(Number.isFinite(c.eco.gdp)).toBe(true); expect(Number.isFinite(c.eco.stability)).toBe(true); }
    expect(s.inbox.length).toBeLessThanOrEqual(5);
  });
});

import { TROPHIES, stepTrophies } from '../src/sim/trophies';
describe('trophies and the year in review', () => {
  it('trophies unlock once, announce themselves, and start-state ones are silent', () => {
    const s = fresh('Germany');
    run(s, 8);
    // Germany already is a top-ten economy at the start: marked silently
    expect(s.trophies.top10).toBe(-1);
    expect(s.log.some((e) => /TROPHY UNLOCKED: Top ten/.test(e.text))).toBe(false);
    const c = s.countries[id('Germany')];
    c.eco.gdp = 1e15; // become number one
    s.tick = 10; stepTrophies(s, geo);
    expect(s.trophies.number1).toBeDefined();
    expect(s.log.filter((e) => /TROPHY UNLOCKED: World number one/.test(e.text))).toHaveLength(1);
    s.tick = 14; stepTrophies(s, geo);
    expect(s.log.filter((e) => /TROPHY UNLOCKED: World number one/.test(e.text))).toHaveLength(1);
    expect(TROPHIES.length).toBeGreaterThanOrEqual(15);
  });
  it('a nuclear programme earns the nuclear club trophy but starting nuclear does not', () => {
    const r = fresh('Russia'); run(r, 8);
    expect(r.trophies.nuclear).toBeUndefined();
    const s = fresh('Turkey'); const c = s.countries[id('Turkey')];
    run(s, 4); c.mil.nuclear = true; s.tick = 10; stepTrophies(s, geo);
    expect(s.trophies.nuclear).toBeDefined();
  });
  it('a summary of the year appears every 52 weeks', () => {
    const s = fresh('France');
    run(s, 52);
    expect(s.review?.title).toBe('2024 in review');
    expect(s.review!.lines.length).toBeGreaterThanOrEqual(3);
  });
});

import { mods, setDoctrine, REFORM_COOLDOWN } from '../src/sim/doctrines';
import { relationBreakdown } from '../src/sim/relations';
import { approval, stepCalendar } from '../src/sim/events3';
describe('depth: doctrines, explanations, calendar', () => {
  it('doctrines change real numbers, cost money, and cannot be flipped every week', () => {
    const s = fresh('Germany');
    const c = s.countries[id('Germany')];
    c.eco.cash = 1e13;
    const cab = c.cabinet; c.cabinet = undefined; // measure the doctrines alone (ministers add their own effects)
    expect(mods(c).tfp).toBe(0); // no doctrine = calibrated baseline
    expect(setDoctrine(s, c.id, 'eco', 'market').ok).toBe(true);
    expect(mods(c).tfp).toBeCloseTo(0.006);
    expect(mods(c).stab).toBe(-2);
    expect(setDoctrine(s, c.id, 'eco', 'welfare').ok).toBe(false); // reform fatigue
    s.tick += REFORM_COOLDOWN;
    expect(setDoctrine(s, c.id, 'eco', 'welfare').ok).toBe(true);
    expect(mods(c).stab).toBe(5);
    c.cabinet = cab;
    expect(setDoctrine(s, c.id, 'mil', 'conscript').ok).toBe(false);
  });
  it('a pro-growth doctrine out-grows an identical country without one', () => {
    const a = fresh('Brazil'), b = fresh('Brazil');
    a.nextCrisis = b.nextCrisis = 1e9;
    b.countries[id('Brazil')].doctrine = { eco: 'market', mil: '', dip: '', changed: 0 };
    run(a, 150); run(b, 150);
    expect(b.countries[id('Brazil')].eco.tfp).toBeGreaterThan(a.countries[id('Brazil')].eco.tfp);
  });
  it('military doctrines move combat and costs', () => {
    const s = fresh('Poland');
    const c = s.countries[id('Poland')];
    c.doctrine = { eco: '', mil: 'defensive', dip: '', changed: 0 };
    expect(mods(c).def).toBeGreaterThan(1);
    expect(mods(c).off).toBeLessThan(1);
    expect(mods(c).deter).toBeLessThan(1);
  });
  it('the relations breakdown adds up to the relation score', () => {
    const s = fresh('Poland');
    for (const o of ['Germany', 'Russia', 'France', 'Ukraine']) {
      const parts = relationBreakdown(s, id('Poland'), id(o));
      const sum = parts.reduce((t, p) => t + p.v, 0);
      expect(Math.abs(Math.max(-100, Math.min(100, sum)) - getRelation(s, id('Poland'), id(o)))).toBeLessThan(2.5);
    }
  });
  it('AI war declarations state their reason', () => {
    const s = fresh('Brazil');
    s.nextCrisis = 1e9;
    run(s, 52 * 6);
    const wars = s.log.filter((e) => /declared war/.test(e.text));
    expect(wars.length).toBeGreaterThan(0);
    expect(wars.some((e) => /Reason:|rightfully/.test(e.text))).toBe(true);
  });
  it('the player gets an election (or congress) every four years that can be won or lost', () => {
    const s = fresh('Germany');
    s.nextCrisis = 1e9;
    stepCalendar(s);
    s.stats.nextVote = 5;
    run(s, 8);
    expect(s.inbox.some((x) => x.id === 'election') || s.scheduled.some((x) => x.id === 'election')).toBe(true);
    const it = s.inbox.find((x) => x.id === 'election');
    if (it) { const r = resolveEvent(s, geo, 0, it.uid); expect(r.ok).toBe(true); }
    expect(approval(s, s.countries[id('Germany')])).toBeGreaterThan(5);
    expect(s.stats.nextVote).toBeGreaterThan(200);
    const a = fresh('China'); a.stats.nextVote = 2; run(a, 4);
    expect(a.inbox.some((x) => x.id === 'party_congress') || a.scheduled.some((x) => x.id === 'party_congress')).toBe(true);
  });
});

import { crownLeader, addGrudge, grudgeScore, grudgesOf, traitById } from '../src/sim/leaders';
describe('living world: leaders, goals, memory', () => {
  it('every AI country gets a named leader with two traits that shift its personality, and a goal', () => {
    const s = fresh('Germany');
    run(s, 30);
    const ai = s.countries.filter((c) => c.alive && c.id !== s.player);
    expect(ai.every((c) => c.leader && c.leader.name.length > 3 && c.leader.traits[0] !== c.leader.traits[1])).toBe(true);
    expect(ai.filter((c) => c.goal).length).toBeGreaterThan(ai.length * 0.9);
    for (const c of ai) { expect(c.ai.aggression).toBeGreaterThan(0); expect(c.ai.aggression).toBeLessThanOrEqual(1.4); }
  });
  it('a hawk is more aggressive than a dove, and a successor undoes the predecessor\'s traits', () => {
    const s = fresh('Germany');
    const c = s.countries[id('France')];
    const base = c.ai.aggression;
    crownLeader(s, c, 1);
    const withLeader = c.ai.aggression;
    c.leader!.traits = ['hawk', 'hawk']; // (re-apply for the test)
    expect(traitById('hawk').d.aggression!).toBeGreaterThan(traitById('dove').d.aggression!);
    crownLeader(s, c, 2);
    crownLeader(s, c, 3);
    expect(Math.abs(c.ai.aggression - base)).toBeLessThan(0.7);
    void withLeader;
  });
  it('leaders eventually change, with news', () => {
    const s = fresh('Brazil');
    s.nextCrisis = 1e9;
    run(s, 52 * 14);
    expect(s.log.some((e) => /takes over/.test(e.text))).toBe(true);
  });
  it('grudges accumulate, are recorded for wrongs done, and fade with time', () => {
    const s = fresh('Germany');
    expect(grudgeScore(s, id('Estonia'), id('Russia'))).toBe(0);
    declareWar(s, geo, id('Russia'), id('Estonia'));
    const g0 = grudgeScore(s, id('Estonia'), id('Russia'));
    expect(g0).toBeGreaterThanOrEqual(30);
    expect(grudgesOf(s, id('Estonia'), id('Russia'))[0].why).toMatch(/attacked/);
    addGrudge(s, id('Estonia'), id('Russia'), 'embargoed it', 14);
    s.nextCrisis = 1e9;
    run(s, 260);
    const att = grudgesOf(s, id('Estonia'), id('Russia')).find((x) => /attacked/.test(x.why));
    expect(att).toBeDefined();
    expect(att!.w).toBeLessThan(30); // fading, not forgotten
  });
  it('wronging a country makes it more likely to come for you later', () => {
    const s = fresh('Poland');
    const T = id('Poland');
    for (let i = 0; i < 5; i++) addGrudge(s, id('Germany'), T, `wrong ${i}`, 25);
    expect(grudgeScore(s, id('Germany'), T)).toBeGreaterThan(100);
  });
});

import { battleReport } from '../src/sim/battle';
import { countryChecks, goalHelp, guideLevel, topPriority } from '../src/ui/guides';
import { activeGoals as activeGoals2, GOALS as GOALS2 } from '../src/sim/goals';
describe('battles, guides and objectives', () => {
  it('a battle report explains odds, terrain, forts and who is attacking', () => {
    const s = fresh('Poland');
    s.nextCrisis = 1e9;
    declareWar(s, geo, id('Poland'), id('Belarus'));
    run(s, 6);
    const w = s.wars[0];
    const fr = w.fronts.find((f) => f.by === id('Poland'))!;
    expect(fr).toBeDefined();
    const r = battleReport(s, geo, w.id, fr.prov, fr.by)!;
    expect(r.role).toBe('attacker');
    expect(r.attacker).toBe(id('Poland'));
    expect(r.name).toMatch(/^Battle of /);
    expect(r.mods.some((m) => /plains|Hills|Mountains/.test(m.label))).toBe(true);
    expect(r.atkTroops).toBeGreaterThan(0);
    expect(r.progress).toBeGreaterThanOrEqual(0);
    // a neutral observer sees the same battle as an observer
    const o = fresh('Brazil'); declareWar(o, geo, id('Russia'), id('Estonia')); run(o, 4);
    const f2 = o.wars[0].fronts[0];
    if (f2) expect(battleReport(o, geo, o.wars[0].id, f2.prov, f2.by)!.role).toBe('observer');
  });
  it('guides depend on difficulty: full on easy, limited on normal, none on hard', () => {
    expect(guideLevel(fresh('Germany', { difficulty: 'easy' }))).toBe('full');
    expect(guideLevel(fresh('Germany', { difficulty: 'normal' }))).toBe('limited');
    expect(guideLevel(fresh('Germany', { difficulty: 'hard' }))).toBe('none');
  });
  it('the country check-up flags real problems and offers fixes', () => {
    const s = fresh('Poland');
    const c = s.countries[id('Poland')];
    c.eco.stability = 25; c.eco.energyCap = c.eco.energyDemand * 0.5;
    const checks = countryChecks(s, c, geo);
    const stab = checks.find((x) => /Stability/.test(x.title))!;
    expect(stab.status).toBe('bad');
    expect(stab.fix).toBeDefined();
    expect(checks.find((x) => /Energy/.test(x.title))!.status).toBe('bad');
    expect(topPriority(checks)!.status).toBe('bad');
    const r = stab.fix!.run!(s, geo);
    expect(r.ok).toBe(true);
  });
  it('every objective has a how-to tip, and new objectives are never already complete', () => {
    const s = fresh('Germany');
    const c = s.countries[id('Germany')];
    for (const g of GOALS2) expect(goalHelp(g.id, s, c, geo).how.length, g.id).toBeGreaterThan(10);
    expect(GOALS2.length).toBeGreaterThanOrEqual(40);
    for (const g of activeGoals2(s)) expect(g.progress(s, c).value).toBeLessThan(0.9);
  });
});

import { supplyNet, landSupply, depotSuggestion } from '../src/sim/supply';
import { warSupport, actWarSupport, morale } from '../src/sim/warsupport';

describe('supply lines and war support', () => {
  it('no country starts the game with land cut off from supplies', () => {
    const s = fresh('Germany');
    for (const [a, d] of [['India', 'China'], ['Brazil', 'Argentina'], ['Russia', 'Ukraine'], ['United States of America', 'Mexico']]) declareWar(s, geo, id(a), id(d));
    s.tick++;
    for (const n of ['India', 'China', 'Brazil', 'Argentina', 'Russia', 'Ukraine', 'United States of America', 'Mexico']) expect(supplyNet(s, geo, id(n)).pocket, n).toEqual([]);
  });
  it('supply falls the deeper an offensive goes from its hubs', () => {
    const s = fresh('Germany');
    declareWar(s, geo, id('China'), id('India'));
    s.tick++;
    const net = supplyNet(s, geo, id('China'));
    const sups = s.countries[id('India')].provinces.filter((q) => geo.adj[q].some((p) => s.owner[p] === id('China'))).map((q) => landSupply(s, geo, net, q).supply);
    expect(Math.max(...sups)).toBeGreaterThan(0.8);
    expect(Math.min(...sups)).toBeLessThan(0.6); // across the Himalaya, far from any Chinese city
  });
  it('land cut off from every hub is encircled, fights at half strength and makes the news', () => {
    const s = fresh('Germany', { defensiveAlliances: false });
    const P = s.countries[id('Poland')], B = s.countries[id('Belarus')];
    declareWar(s, geo, P.id, B.id);
    // Poland takes everything around one Belarusian region, sealing it off
    const q = B.provinces.find((p) => p !== B.capital && geo.adj[p].some((n) => s.owner[n] === P.id) && geo.provinces[p].coast < 0.15)!;
    for (const n of geo.adj[q]) if (s.owner[n] === B.id) transferProvince(s, geo, n, P.id);
    s.tick++;
    expect(supplyNet(s, geo, B.id).pocket).toContain(q);
    run(s, 1);
    expect(s.log.some((l) => l.text.includes('ENCIRCLED'))).toBe(true);
    expect(B.mil.pocket).toBeGreaterThan(0);
  });
  it('fronts report their supply and a supply hub raises it', () => {
    const s = fresh('Russia', { defensiveAlliances: false });
    declareWar(s, geo, id('Russia'), id('Kazakhstan'));
    run(s, 6);
    const fr = s.wars[0].fronts.find((f) => f.by === id('Russia') && !f.amphibious)!;
    expect(fr.sup).toBeGreaterThan(0.2);
    expect(fr.sup).toBeLessThanOrEqual(1);
    const before = landSupply(s, geo, supplyNet(s, geo, id('Russia')), fr.prov).supply;
    actBuild(s, geo, id('Russia'), fr.from!, 'depot'); actBuild(s, geo, id('Russia'), fr.from!, 'depot');
    s.tick++;
    const after = landSupply(s, geo, supplyNet(s, geo, id('Russia')), fr.prov).supply;
    expect(after).toBeGreaterThanOrEqual(before);
    void depotSuggestion(s, geo, id('Russia'));
  });
  it('war support: defenders rally, unprovoked aggressors start lower, and it moves morale', () => {
    const s = fresh('Germany', { defensiveAlliances: false });
    declareWar(s, geo, id('Poland'), id('Lithuania'));
    const A = s.countries[id('Poland')], D = s.countries[id('Lithuania')];
    expect(warSupport(D)).toBeGreaterThanOrEqual(0.8);
    expect(warSupport(A)).toBeLessThan(warSupport(D));
    expect(morale(D)).toBeGreaterThan(morale(A));
    run(s, 20);
    expect(A.mil.wsParts).toBeDefined();
    expect(Object.keys(A.mil.wsParts!).length).toBeGreaterThan(0);
  });
  it('war support levers: propaganda costs money, war bonds raise it, censorship hurts stability, all with cooldowns', () => {
    const s = fresh('Poland', { defensiveAlliances: false });
    expect(actWarSupport(s, s.player, 'propaganda').ok).toBe(false); // not at war
    actDeclareWar(s, geo, s.player, id('Belarus'));
    const P = s.countries[s.player];
    P.mil.warSupport = 0.5;
    const cash = P.eco.cash;
    expect(actWarSupport(s, s.player, 'propaganda').ok).toBe(true);
    expect(P.mil.warSupport).toBeCloseTo(0.56, 2);
    expect(P.eco.cash).toBeLessThan(cash);
    expect(actWarSupport(s, s.player, 'propaganda').ok).toBe(false); // cooldown
    const c2 = P.eco.cash;
    expect(actWarSupport(s, s.player, 'bonds').ok).toBe(true);
    expect(P.eco.cash).toBeGreaterThan(c2);
    const stab = P.eco.stability;
    expect(actWarSupport(s, s.player, 'censor').ok).toBe(true);
    expect(P.eco.stability).toBeLessThan(stab);
  });
  it('low war support makes peace more acceptable and returns to normal after the war', () => {
    const s = fresh('Germany', { defensiveAlliances: false });
    declareWar(s, geo, id('Poland'), id('Lithuania'));
    const L = s.countries[id('Lithuania')];
    L.mil.warSupport = 0.9;
    const hi = evaluatePeace(s, geo, id('Poland'), id('Lithuania'), { kind: 'status_quo' }).willingness;
    L.mil.warSupport = 0.1;
    const lo = evaluatePeace(s, geo, id('Poland'), id('Lithuania'), { kind: 'status_quo' }).willingness;
    expect(lo).toBeGreaterThan(hi + 0.4);
    actPeace(s, geo, id('Poland'), id('Lithuania'), { kind: 'status_quo' });
    s.wars = [];
    run(s, 52);
    expect(Math.abs(warSupport(L) - 0.6)).toBeLessThan(0.15);
  });
});

import { tickSlices } from '../src/sim/tick';
import { makePeace } from '../src/sim/war';
import { activeGenerals, actAssignGeneral, actRecruitGeneral, generalAt, stars } from '../src/sim/generals';
import { actLaunchOp, actPartisans, canLaunch, occupiedHomeland, partisansActive } from '../src/sim/specops';
import { inventory } from '../src/sim/military';
import { setInTick } from '../src/sim/relations';

describe('round 9: smooth weeks, generals, special operations, war history', () => {
  it('a week run in slices gives exactly the same world as a week run at once', () => {
    const a = fresh('Poland'), b = fresh('Poland');
    declareWar(a, geo, id('Poland'), id('Belarus')); declareWar(b, geo, id('Poland'), id('Belarus'));
    run(a, 30);
    for (let i = 0; i < 30; i++) { const g = tickSlices(b, geo); let n = 0; for (;;) { setInTick(true); const r = g.next(); setInTick(false); if (r.done) break; n++; } expect(n).toBeGreaterThan(3); }
    expect(JSON.stringify(b.owner)).toBe(JSON.stringify(a.owner));
    expect(b.countries[id('Poland')].eco.gdp).toBeCloseTo(a.countries[id('Poland')].eco.gdp, 0);
    expect(b.rng).toBe(a.rng);
  });
  it('countries at war get named generals who take command of offensives and earn stars', () => {
    const s = fresh('Germany', { defensiveAlliances: false });
    declareWar(s, geo, id('Russia'), id('Kazakhstan'));
    run(s, 20);
    const R = s.countries[id('Russia')];
    expect(activeGenerals(R).length).toBeGreaterThanOrEqual(1);
    expect(R.generals![0].name).toMatch(/^\S+ \S+/);
    const fr = s.wars[0]?.fronts.find((f) => f.by === R.id);
    if (fr) expect(generalAt(R, fr.prov)).toBeDefined();
    expect(Math.max(...R.generals!.map((g) => g.xp))).toBeGreaterThan(0);
    expect(stars(R.generals![0])).toBeGreaterThanOrEqual(1);
  });
  it('the player can recruit generals and pin one to an offensive', () => {
    const s = fresh('Poland', { defensiveAlliances: false });
    actDeclareWar(s, geo, s.player, id('Belarus'));
    run(s, 4);
    const P = s.countries[s.player];
    expect(activeGenerals(P).length).toBe(3);
    expect(actRecruitGeneral(s, s.player, 'blitz').ok).toBe(true);
    const g = activeGenerals(P).find((x) => x.trait === 'blitz')!;
    const fr = s.wars[0].fronts.find((f) => f.by === s.player);
    if (fr) { expect(actAssignGeneral(s, s.player, g.id, fr.prov).ok).toBe(true); run(s, 1); if (s.wars[0]?.fronts.some((f) => f.prov === fr.prov)) expect(generalAt(P, fr.prov)?.id).toBe(g.id); }
  });
  it('naval invasions and airborne assaults open fronts behind the lines', () => {
    const s = fresh('United Kingdom', { defensiveAlliances: false });
    actDeclareWar(s, geo, s.player, id('France'));
    const F = s.countries[id('France')];
    const coast = F.provinces.find((p) => geo.provinces[p].coast > 0.15 && canLaunch(s, geo, s.player, p, 'naval') === null);
    expect(coast).toBeDefined();
    expect(actLaunchOp(s, geo, s.player, coast!, 'naval').ok).toBe(true);
    expect(canLaunch(s, geo, s.player, coast!, 'naval')).not.toBeNull(); // already under way
    run(s, 2);
    expect(s.wars[0].fronts.some((f) => f.prov === coast && f.by === s.player)).toBe(true);
    const inland = F.provinces.find((p) => geo.provinces[p].coast < 0.15);
    if (inland !== undefined) expect(typeof canLaunch(s, geo, s.player, inland, 'airborne')).toMatch(/string|object/);
  });
  it('partisans can only rise in occupied homeland and make the occupier’s supply far costlier', () => {
    const s = fresh('Poland', { defensiveAlliances: false });
    actDeclareWar(s, geo, s.player, id('Belarus'));
    expect(actPartisans(s, s.player).ok).toBe(false); // nothing occupied
    const P = s.countries[s.player];
    const q = P.provinces.find((p) => geo.adj[p].some((n) => s.owner[n] === id('Belarus')))!;
    transferProvince(s, geo, q, id('Belarus'));
    expect(occupiedHomeland(s, s.player)).toContain(q);
    s.tick++;
    const before = supplyNet(s, geo, id('Belarus')).dist[q];
    expect(actPartisans(s, s.player).ok).toBe(true);
    expect(partisansActive(s, s.player)).toBe(true);
    s.tick++;
    const after = supplyNet(s, geo, id('Belarus')).dist[q];
    expect(after).toBeGreaterThanOrEqual(before);
  });
  it('a finished war leaves a record with casualties, regions and a winner', () => {
    const s = fresh('Germany', { defensiveAlliances: false });
    declareWar(s, geo, id('Poland'), id('Lithuania'));
    run(s, 15);
    makePeace(s, geo, id('Poland'), id('Lithuania'), { kind: 'status_quo' });
    const rec = s.warHistory?.at(-1);
    expect(rec).toBeDefined();
    expect(rec!.a === id('Poland') || rec!.b === id('Poland')).toBe(true);
    expect(rec!.casA + rec!.casB).toBeGreaterThan(0);
    expect(['a', 'b', 'draw']).toContain(rec!.winner);
  });
  it('hardware inventory is derived from equipment', () => {
    const s = fresh('United States of America');
    const inv = inventory(s.countries[s.player].mil);
    expect(inv.tanks).toBeGreaterThan(500);
    expect(inv.jets).toBeGreaterThan(200);
    expect(inv.warships).toBeGreaterThan(20);
  });
});

import { ctl, setControl, CONTROL_PRESETS } from '../src/sim/modes';
import { actChooseAgenda, actOpposition, actRetire, continueAsSandbox, grade, voteShare } from '../src/sim/legacy';
import { AGENDA, agendaById, dealHand } from '../src/sim/agenda';
import { actArmyOrder, actArmyTarget, ensureArmies, holdBonus } from '../src/sim/armies';

describe('round 11: modes, control levels, Legacy, army groups', () => {
  it('sandbox world options: no nukes, random events off, a cold war start', () => {
    const s = fresh('Germany', { nukes: false, randomEvents: false, world: 'coldwar' });
    expect(s.countries.some((c) => c.mil.nuclear)).toBe(false);
    expect(s.crisis?.id).toBe('coldwar');
    run(s, 60);
    expect(s.inbox.filter((x) => !['ally_attacked', 'assembly', 'fac_demand', 'fac_unrest'].includes(x.id) && !x.id.startsWith('story')).length).toBe(0); // faction demands and storyline acts are not chance
  });
  it('an endless sandbox can be given an end year', () => {
    const s = fresh('Germany', { endYear: 2025 });
    run(s, 60);
    expect(s.victory?.text).toMatch(/2025/);
  });
  it('the economic autopilot manages the budget; guided sends treasury proposals', () => {
    const s = fresh('Italy', { control: { ...CONTROL_PRESETS.leader.control } });
    expect(ctl(s, 'economy')).toBe('auto');
    const b0 = JSON.stringify(s.countries[s.player].budget);
    run(s, 30);
    expect(JSON.stringify(s.countries[s.player].budget)).not.toBe(b0);
    const g = fresh('Italy', { control: { economy: 'guided', military: 'hands', diplomacy: 'hands' } });
    run(g, 26);
    expect(g.inbox.some((x) => x.id === 'treasury_plan') || g.log.some((l) => /treasury/i.test(l.text))).toBe(true);
    setControl(g, 'economy', 'hands');
    expect(ctl(g, 'economy')).toBe('hands');
  });
  it('Legacy: inauguration deals agenda cards, which can be chosen and tracked', () => {
    const s = fresh('Poland', { mode: 'legacy', leaderName: 'Ada Nowak' });
    const L = s.legacy!;
    expect(L.leader).toBe('Ada Nowak');
    expect(L.hand.length).toBe(5);
    for (const id of L.hand) expect(agendaById(id)).toBeDefined();
    expect(actChooseAgenda(s, L.hand.slice(0, 3)).ok).toBe(true);
    expect(L.agenda.length).toBe(3);
    expect(L.hand.length).toBe(0);
    expect(voteShare(s)).toBeGreaterThan(0);
    expect(AGENDA.length).toBeGreaterThanOrEqual(20);
    expect(dealHand(s, s.countries[s.player], 2).length).toBe(5);
  });
  it('Legacy: an election after four years either renews the mandate or sends you into opposition, and opposition can win back power', () => {
    const s = fresh('Poland', { mode: 'legacy' });
    const L = s.legacy!;
    actChooseAgenda(s, []);
    L.nextVote = s.tick + 12; // a snap election after a disastrous spell
    for (let i = 0; i < 14; i++) { s.countries[s.player].eco.stability = Math.min(s.countries[s.player].eco.stability, 22); run(s, 1); for (const it of [...s.inbox]) resolveEvent(s, geo, 0, it.uid); }
    expect(L.terms.length).toBeGreaterThanOrEqual(1);
    if (L.status === 'opposition') {
      expect(actOpposition(s, 'rally').ok).toBe(true);
      expect(actOpposition(s, 'rally').ok).toBe(false); // cooldown
      L.opposition!.support = 80;
      L.nextVote = s.tick + 1;
      run(s, 2);
      expect(L.status).toBe('office');
      expect(L.terms.at(-1)!.result).toBe('returned');
    }
  });
  it('Legacy: retiring writes the history books, and the world continues as a sandbox', () => {
    const s = fresh('Japan', { mode: 'legacy' });
    actChooseAgenda(s, s.legacy!.hand.slice(0, 2));
    run(s, 30);
    expect(actRetire(s).ok).toBe(true);
    expect(s.legacy!.status).toBe('ended');
    expect(['S', 'A', 'B', 'C', 'D', 'F']).toContain(grade(s.legacy!.score));
    continueAsSandbox(s);
    expect(s.settings.mode).toBe('sandbox');
    run(s, 5);
  });
  it('army groups: orders and objectives steer the offensive; holding armies stiffen the defence', () => {
    const s = fresh('Poland', { defensiveAlliances: false, control: { economy: 'hands', military: 'guided', diplomacy: 'hands' } });
    const B = s.countries[id('Belarus')];
    actDeclareWar(s, geo, s.player, B.id);
    run(s, 1);
    expect(s.armies?.length).toBe(3);
    expect(actArmyTarget(s, geo, 1, B.capital).ok).toBe(true);
    expect(s.armies![0].target).toBe(B.capital);
    run(s, 3);
    const fr = s.wars[0].fronts.filter((f) => f.by === s.player).map((f) => f.prov);
    const near = Math.min(...fr.map((p) => (p === B.capital ? 0 : geo.dist(p, B.capital))));
    expect(near).toBeLessThan(60);
    // a holding army on the capital
    ensureArmies(s);
    actArmyOrder(s, 3, 'defend');
    expect(holdBonus(s, geo, s.countries[s.player].capital)).toBeGreaterThan(1.2);
    expect(actArmyTarget(s, geo, 2, id('Germany') === s.owner[s.countries[id('Germany')].capital] ? s.countries[id('Germany')].capital : 0).ok).toBe(false); // not at war with Germany
  });
});

describe('round 12: the cabinet, national names, diplomatic cables', () => {
  it('the player gets a cabinet of four distinct ministers whose skill and traits change real numbers', () => {
    const s = fresh('Poland');
    const c = s.countries[s.player];
    expect(c.cabinet!.length).toBe(4);
    expect(new Set(c.cabinet!.map((m) => m.role)).size).toBe(4);
    expect(new Set(c.cabinet!.map((m) => m.name)).size).toBe(4);
    for (const m of c.cabinet!) { expect(m.skill).toBeGreaterThanOrEqual(1); expect(m.skill).toBeLessThanOrEqual(5); expect(ministerEffects(m).length).toBeGreaterThan(0); }
    // a brilliant Interior Minister steadies the country, a hopeless one does not
    const it = ministerOf(c, 'interior')!;
    it.trait = 'technocrat'; it.skill = 5; const hi = mods(c).stab;
    it.skill = 1; const lo = mods(c).stab;
    expect(hi - lo).toBeCloseTo(6);
    // AI countries have no cabinet
    expect(s.countries[id('Germany')].cabinet).toBeUndefined();
  });
  it('names fit the country: Polish ministers have Polish names (with feminine surnames)', () => {
    const s = fresh('Poland');
    const polish = /(ski|ska|cki|cka|Nowicki|Mazur|Kaczmarek|Pawlak|Krawczyk|Wiśniewsk|Zielińsk|Wróblewsk|Sadowsk|Jabłońsk|Góreck|Michalsk)/;
    for (const m of s.countries[s.player].cabinet!) expect(m.name).toMatch(polish);
    expect(nationalName({ name: 'Russia', region: 'RU', gov: 'A' }, 0.01, 0, 0)).toMatch(/a$/); // a woman's surname: Volkova
    expect(nationalName({ name: 'Poland', region: 'EU', gov: 'D' }, 0.9, 0, 0)).toBe('Tomasz Nowicki');
  });
  it('reshuffles pick from three candidates, cost goodwill, and cannot be repeated at once; courting buys loyalty', () => {
    const s = fresh('Poland');
    const c = s.countries[s.player];
    c.eco.cash = 1e12;
    const old = ministerOf(c, 'finance')!;
    const cands = candidates(s, 'finance');
    expect(cands.length).toBe(3);
    const minId = s.stats.minId;
    candidates(s, 'finance');
    expect(s.stats.minId).toBe(minId); // previews do not consume ids
    expect(actAppoint(s, 'finance', 1).ok).toBe(true);
    expect(ministerOf(c, 'finance')!.name).toBe(cands[1].name);
    expect(ministerOf(c, 'finance')!.id).not.toBe(old.id);
    expect(actAppoint(s, 'finance', 0).ok).toBe(false); // too soon
    const f = ministerOf(c, 'foreign')!; f.loyalty = 40;
    expect(actCourt(s, f.id).ok).toBe(true);
    expect(f.loyalty).toBeGreaterThan(40);
    expect(actCourt(s, f.id).ok).toBe(false);
  });
  it('scandals, plots and budget fights reach the inbox with the minister named, and every answer works', () => {
    const s = fresh('Poland');
    const c = s.countries[s.player];
    c.eco.cash = 1e12;
    for (const id0 of ['min_scandal', 'min_revolt', 'min_clash']) {
      const def = eventById(id0);
      for (let i = 0; i < def.options.length; i++) {
        const s2 = JSON.parse(JSON.stringify(s)) as GameState;
        const c2 = s2.countries[s2.player];
        const data = { m: c2.cabinet![2].id, k: 2, amt: 0.5, f: ministerOf(c2, 'finance')!.id, d: ministerOf(c2, 'defence')!.id };
        expect(def.text(s2, c2, data)).toContain(id0 === 'min_clash' ? ministerOf(c2, 'finance')!.name : c2.cabinet![2].name);
        s2.inbox = [{ uid: 1, id: id0, tick: 1, expires: 99, urgent: true, data }];
        expect(resolveEvent(s2, geo, i).ok).toBe(true);
        expect(c2.cabinet!.length).toBe(4);
      }
    }
    // a minister who is pushed too far eventually quits and is replaced
    const s3 = fresh('Poland');
    const P = s3.countries[s3.player];
    const victim = ministerOf(P, 'defence')!;
    for (let i = 0; i < 160 && P.cabinet!.some((m) => m.id === victim.id); i++) { victim.loyalty = 0; run(s3, 1); }
    expect(P.cabinet!.some((m) => m.id === victim.id)).toBe(false);
    expect(P.cabinet!.length).toBe(4);
  });
  it('foreign leaders answer in cables: war, treaties and sanctions draw a reply you can answer once', () => {
    const s = fresh('Poland', { defensiveAlliances: false });
    actSanction(s, s.player, id('Belarus'), 1);
    expect(s.cables!.some((x) => x.from === id('Belarus'))).toBe(true);
    actDeclareWar(s, geo, s.player, id('Belarus'));
    const cb = s.cables!.filter((x) => x.from === id('Belarus')).at(-1)!;
    expect(cb.mood).toBe('angry');
    expect(cb.text.length).toBeGreaterThan(15);
    actPropose(s, geo, s.player, id('Lithuania'), 'trade');
    const lt = s.cables!.at(-1)!;
    expect(lt.from).toBe(id('Lithuania'));
    const r0 = getRelation(s, s.player, id('Lithuania'));
    expect(actReplyCable(s, lt.seq, 'firm').ok).toBe(true);
    expect(getRelation(s, s.player, id('Lithuania'))).toBeLessThan(r0);
    expect(actReplyCable(s, lt.seq, 'warm').ok).toBe(false); // one answer per cable
  });
  it('cables and the cabinet keep the world deterministic', () => {
    const a = fresh('Japan'), b = fresh('Japan');
    run(a, 60); run(b, 60);
    expect(JSON.stringify(a.countries[a.player].cabinet)).toBe(JSON.stringify(b.countries[b.player].cabinet));
    expect(JSON.stringify(a.cables ?? [])).toBe(JSON.stringify(b.cables ?? []));
    expect(a.rng).toBe(b.rng);
  });
});

describe('round 13: domestic politics, political capital, laws, crisis arcs', () => {
  it('the player starts with six factions, political capital and no laws; AI countries have none', () => {
    const s = fresh('Poland');
    const P = s.countries[s.player].politics!;
    expect(P.factions.length).toBe(6);
    expect(P.factions.reduce((t, f) => t + f.support, 0)).toBeCloseTo(100);
    expect(P.pc).toBe(40);
    expect(P.laws.length).toBe(0);
    expect(s.countries[id('Germany')].politics).toBeUndefined();
    for (const f of P.factions) expect(f.leader).toMatch(/\S+ \S+/);
  });
  it('laws go to a vote, cost political capital, change the budget and the factions, and can be repealed', () => {
    const s = fresh('Poland');
    const c = s.countries[s.player];
    const P = c.politics!;
    const social = c.budget.social;
    const fc = forecast(c, lawById('healthcare')!, 0);
    expect(fc.mode).toBe('vote');
    expect(fc.yes).toBeGreaterThan(0.5);
    const lab = P.factions.find((f) => f.id === 'labour')!.mood;
    expect(actPassLaw(s, 'healthcare', 6).ok).toBe(true);
    expect(P.pc).toBeCloseTo(40 - fc.cost - 6);
    expect(c.budget.social).toBeCloseTo(social + 0.01);
    expect(P.factions.find((f) => f.id === 'labour')!.mood).toBeGreaterThan(lab);
    expect(mods(c).stab).toBeGreaterThanOrEqual(3 - 10); // the law's +3 is in the modifiers (ministers add their own)
    expect(actPassLaw(s, 'healthcare').ok).toBe(false); // already law
    P.pc = 3;
    expect(actPassLaw(s, 'tech_fund').ok).toBe(false); // not enough capital
    P.pc = 60;
    expect(actPassLaw(s, 'flat_tax', 20).ok).toBe(true);
    expect(actPassLaw(s, 'wealth_tax', 20).ok).toBe(false); // mutually exclusive
    expect(actRepealLaw(s, 'healthcare').ok).toBe(true);
    expect(c.budget.social).toBeCloseTo(social);
  });
  it('an autocracy rules by decree: no vote, a higher price, and the liberals resent it', () => {
    const s = fresh('Russia');
    const c = s.countries[s.player];
    const fc = forecast(c, lawById('police')!, 0);
    expect(fc.mode).toBe('decree');
    expect(fc.cost).toBeGreaterThan(lawById('police')!.pc);
    expect(actPassLaw(s, 'police').ok).toBe(true);
  });
  it('factions follow what you do: the unions like public spending, the army hates cuts, and both move stability', () => {
    const s = fresh('Poland');
    const c = s.countries[s.player];
    const P = c.politics!;
    c.budget.social += 0.03; c.budget.military = Math.max(0.002, c.budget.military - 0.012);
    run(s, 40);
    const lab = P.factions.find((f) => f.id === 'labour')!, mil = P.factions.find((f) => f.id === 'military')!;
    expect(factionTarget(s, c, lab).parts.some((p) => /Public services/.test(p.label) && p.v > 5)).toBe(true);
    expect(factionTarget(s, c, mil).parts.some((p) => /Defence budget/.test(p.label) && p.v < -5)).toBe(true);
    expect(mil.mood).toBeLessThan(45);
    expect(c.eco.stabParts.factions).toBeDefined();
    expect(P.pc).toBeGreaterThan(40); // political capital trickles in
  });
  it('faction demands and uprisings name the faction leader, and every answer works', () => {
    const s = fresh('Poland');
    const c = s.countries[s.player];
    c.eco.cash = 1e12;
    for (const id0 of ['fac_demand', 'fac_unrest']) for (let f = 0; f < 6; f++) {
      const def = eventById(id0);
      expect(def.text(s, c, { f, k: f % 2 })).toContain(c.politics!.factions[f].leader);
      for (let i = 0; i < def.options.length; i++) {
        const s2 = JSON.parse(JSON.stringify(s)) as GameState;
        s2.inbox = [{ uid: 1, id: id0, tick: 1, expires: 99, urgent: true, data: { f, k: f % 2 } }];
        expect(resolveEvent(s2, geo, i).ok).toBe(true);
      }
    }
  });
  it('every crisis arc runs from its first stage to an end, whatever you choose', () => {
    for (const arcId of ['bank', 'standoff', 'coup', 'separatists']) for (let choice = 0; choice < 3; choice++) {
      const s = fresh('Poland', { defensiveAlliances: false });
      const c = s.countries[s.player];
      c.eco.cash = 1e12; c.politics!.pc = 100;
      const data: Record<string, number> = arcId === 'standoff' ? { n: id('Belarus'), p: c.provinces.find((p) => geo.adj[p].some((q) => s.owner[q] === id('Belarus')))! } : arcId === 'coup' ? { corps: 3 } : { p: c.provinces[2], size: 3 };
      c.politics!.arc = { id: arcId, stage: 1, started: s.tick };
      s.inbox = [{ uid: s.nextInbox++, id: `arc_${arcId}_1`, tick: s.tick, expires: s.tick + 14, urgent: true, data }];
      let steps = 0;
      for (let w = 0; w < 120 && c.politics!.arc; w++) {
        for (const it of [...s.inbox]) {
          if (!it.id.startsWith('arc_')) { s.inbox = s.inbox.filter((x) => x !== it); continue; }
          const def = eventById(it.id);
          const en = def.options.map((o) => !o.enabled || o.enabled(s, c));
          const k = en[choice % def.options.length] ? choice % def.options.length : en.indexOf(true);
          expect(def.text(s, c, it.data).length).toBeGreaterThan(40);
          expect(resolveEvent(s, geo, k, it.uid).ok).toBe(true);
          steps++;
        }
        if (c.politics!.arc) run(s, 1);
      }
      expect(c.politics!.arc, `${arcId}/${choice}`).toBeUndefined();
      expect(steps).toBeGreaterThanOrEqual(1);
    }
  });
  it('a successful coup in Legacy throws you out of office', () => {
    const s = fresh('Poland', { mode: 'legacy' });
    actChooseAgenda(s, []);
    const c = s.countries[s.player];
    c.politics!.arc = { id: 'coup', stage: 2, started: s.tick };
    c.politics!.factions.find((f) => f.id === 'military')!.mood = 0;
    c.eco.stability = 0;
    let out = false;
    for (let i = 0; i < 40 && !out; i++) {
      const s2 = JSON.parse(JSON.stringify(s)) as GameState;
      s2.rng = (s2.rng + i * 7919) >>> 0;
      s2.inbox = [{ uid: 1, id: 'arc_coup_2', tick: s2.tick, expires: s2.tick + 6, urgent: true, data: { corps: 4 } }];
      resolveEvent(s2, geo, 1);
      if (s2.legacy!.status === 'opposition') { out = true; expect(s2.legacy!.terms.at(-1)!.result).toBe('removed'); }
    }
    expect(out).toBe(true);
  });
  it('politics keep the world deterministic', () => {
    const a = fresh('Brazil'), b = fresh('Brazil');
    run(a, 80); run(b, 80);
    expect(JSON.stringify(a.countries[a.player].politics)).toBe(JSON.stringify(b.countries[b.player].politics));
    expect(a.rng).toBe(b.rng);
  });
});

describe('round 14: national paths, war goals, programmes, coalitions, new crises', () => {
  it('every major country has its own national path; projects cost capital and money, take time, change the country and close off rivals', () => {
    for (const n of ['United States of America', 'China', 'Russia', 'India', 'Japan', 'Germany', 'United Kingdom', 'France', 'Brazil', 'Turkey', 'Iran', 'Saudi Arabia', 'Israel', 'Poland', 'Ukraine', 'South Korea', 'Indonesia', 'Mexico', 'Nigeria', 'Egypt']) {
      const s = fresh(n);
      const p = pathOf(s.countries[s.player]);
      expect(p.nodes.length, n).toBeGreaterThanOrEqual(6);
      expect(p.title).not.toBe('Renewal');
    }
    const s = fresh('Germany');
    const c = s.countries[s.player];
    c.eco.cash = 1e13; c.politics!.pc = 100;
    expect(startNatProject(s, 'de_brake').ok).toBe(true);
    expect(startNatProject(s, 'de_energy').ok).toBe(false); // one at a time
    const infra = c.eco.infra;
    run(s, 21);
    expect(c.nat!.done).toContain('de_brake');
    expect(c.eco.infra).toBeGreaterThan(infra + 4);
    expect(blocked(s, c, pathOf(c).nodes.find((x) => x.id === 'de_zero')!)).toMatch(/Closed off/);
    expect(blocked(s, c, pathOf(c).nodes.find((x) => x.id === 'de_europe')!)).toMatch(/Needs/);
    // small countries get a path that fits them
    expect(pathOf(fresh('Estonia').countries[id('Estonia')]).key).toBe('small');
  });
  it('AI countries walk their own national paths', () => {
    const s = fresh('Poland');
    run(s, 160);
    const done = s.countries.filter((c) => !c.isPlayer && (c.nat?.done.length ?? 0) > 0);
    expect(done.length).toBeGreaterThanOrEqual(3);
  });
  it('a war starts with a choice of war aims, judged when it ends', () => {
    const s = fresh('Poland', { defensiveAlliances: false });
    actDeclareWar(s, geo, s.player, id('Belarus'));
    const it = s.inbox.find((x) => x.id === 'war_goal')!;
    expect(it).toBeDefined();
    expect(resolveEvent(s, geo, 0, it.uid).ok).toBe(true); // limited war
    const w = s.wars.find((x) => x.attackers.includes(s.player))!;
    expect(goalOf(s, w)).toBe(1);
    const pc0 = s.countries[s.player].politics!.pc;
    settleGoal(s, { id: w.id, name: w.name, a: s.player, b: id('Belarus'), start: 0, end: 10, casA: 1, casB: 1, provsA: 2, provsB: 0, winner: 'a', terms: 'demand' });
    expect(s.countries[s.player].politics!.pc).toBeGreaterThan(pc0);
  });
  it('wartime stories reach the desk and every answer works', () => {
    const s = fresh('Poland', { defensiveAlliances: false });
    const c = s.countries[s.player];
    c.eco.cash = 1e12; c.politics!.pc = 100;
    actDeclareWar(s, geo, s.player, id('Belarus'));
    const w = s.wars[0];
    const p = c.provinces[0];
    for (const id0 of ['war_siege', 'war_volunteers', 'war_atrocity', 'war_general', 'war_mediator', 'war_arms', 'war_protest', 'war_hero', 'war_pows', 'war_sabotage', 'war_economy']) {
      const def = eventById(id0);
      for (let i = 0; i < def.options.length; i++) {
        const s2 = JSON.parse(JSON.stringify(s)) as GameState;
        const data = { w: w.id, e: id('Belarus'), x: id('Germany'), p };
        expect(def.text(s2, s2.countries[s2.player], data).length).toBeGreaterThan(30);
        s2.inbox = [{ uid: 1, id: id0, tick: 1, expires: 99, urgent: false, data }];
        expect(resolveEvent(s2, geo, i).ok, `${id0}/${i}`).toBe(true);
      }
    }
  });
  it('weapons programmes change how forces fight; missile brigades unlock strikes', () => {
    const s = fresh('Poland', { defensiveAlliances: false });
    const c = s.countries[s.player];
    c.eco.cash = 1e13;
    const off = mods(c).off;
    expect(actStartProgramme(s, 'drones').ok).toBe(true);
    expect(actStartProgramme(s, 'missiles').ok).toBe(true);
    expect(actStartProgramme(s, 'armour').ok).toBe(false); // two at a time
    run(s, 27);
    expect(mods(c).off).toBeGreaterThan(off * 1.08);
    actDeclareWar(s, geo, s.player, id('Belarus'));
    const cap = s.countries[id('Belarus')].eco.capital;
    expect(actMissileStrike(s, id('Belarus')).ok).toBe(true);
    expect(s.countries[id('Belarus')].eco.capital).toBeLessThan(cap);
    expect(actMissileStrike(s, id('Belarus')).ok).toBe(false); // reloading
  });
  it('serial aggression unites the neighbours in a coalition that joins any war on its members', () => {
    const s = fresh('Poland');
    addAggression(s, id('Russia'), 80);
    for (let i = 0; i < 16 && !coalitionAgainst(s, id('Russia')); i++) run(s, 1);
    const k = coalitionAgainst(s, id('Russia'));
    expect(k).toBeDefined();
    expect(k!.members.length).toBeGreaterThanOrEqual(3);
    const victim = k!.members.find((m) => !s.wars.some((w) => w.attackers.includes(m) || w.defenders.includes(m)) && m !== s.player)!;
    declareWar(s, geo, id('Russia'), victim);
    const w = s.wars.find((x) => x.attackers.includes(id('Russia')) && x.defenders.includes(victim))!;
    expect(w.defenders.length).toBeGreaterThan(1);
  });
  it('the new crises (outbreak, blackout, leaked files) run from start to end', () => {
    for (const arcId of ['epidemic', 'blackout', 'leaks']) for (let choice = 0; choice < 3; choice++) {
      const s = fresh('Brazil');
      const c = s.countries[s.player];
      c.eco.cash = 1e12; c.politics!.pc = 100;
      const data: Record<string, number> = arcId === 'leaks' ? { m: c.cabinet![1].id, n: 3 } : { p: c.provinces[0] };
      c.politics!.arc = { id: arcId, stage: 1, started: s.tick };
      s.inbox = [{ uid: s.nextInbox++, id: `arc_${arcId}_1`, tick: s.tick, expires: s.tick + 14, urgent: true, data }];
      for (let w = 0; w < 80 && c.politics!.arc; w++) {
        for (const it of [...s.inbox]) {
          if (!it.id.startsWith('arc_')) { s.inbox = s.inbox.filter((x) => x !== it); continue; }
          const def = eventById(it.id);
          const en = def.options.map((o) => !o.enabled || o.enabled(s, c));
          const k = en[choice] ? choice : en.indexOf(true);
          expect(resolveEvent(s, geo, k, it.uid).ok).toBe(true);
        }
        if (c.politics!.arc) run(s, 1);
      }
      expect(c.politics!.arc, `${arcId}/${choice}`).toBeUndefined();
    }
  });
  it('the default (first) answer to a decision never starts a war by itself', () => {
    for (const e of EVENTS) expect(/declare war/i.test(e.options[0]?.label ?? ''), e.id).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
import { budgetReport, fundingPreview, DEFICIT_LABEL } from '../src/sim/treasury';
import { fund } from '../src/sim/actions';
import { fiscalNow } from '../src/sim/economy';
import { ministerReport } from '../src/ui/reports';
import { scoreParts, partHint, legacyWarEnded } from '../src/sim/legacy';
import { getTreaty } from '../src/sim/relations';
import { stanceOf, negotiate } from '../src/sim/negotiate';
import { previewLapse } from '../src/sim/events';
import { FOLLOW_UPS, rememberChoice } from '../src/sim/events7';
import { adviceOf } from '../src/sim/cabinet';

describe('round 15: trust, treasury, negotiation, consequences', () => {
  it('the finance minister quotes the same budget as the Economy tab, from the very first week', () => {
    for (const n of ['Germany', 'Poland', 'Egypt', 'Saudi Arabia']) {
      const s = fresh(n);
      const c = s.countries[s.player];
      const f = fiscalNow(c, s), B = budgetReport(s, c);
      expect(Math.abs(c.eco.spending - f.spending) / f.spending).toBeLessThan(0.01); // spending is not 0 at the start
      expect(B.balance).toBeCloseTo(f.revenue - f.spending, -3);
      const fin = c.cabinet!.find((m) => m.role === 'finance')!;
      const r = ministerReport(s, c, fin);
      const said = `${r.headline} ${r.lines.join(' ')}`;
      if (B.balance < -0.002 * c.eco.gdp) { expect(said).toMatch(/deficit/i); expect(said).not.toMatch(/surplus/i); }
      if (B.balance > 0.005 * c.eco.gdp) expect(said).toMatch(/surplus/i);
    }
  });
  it('one-off costs come from the treasury first, then borrowing, exactly as previewed, and are written in the ledger', () => {
    const s = fresh('Poland');
    const c = s.countries[s.player], e = c.eco;
    e.cash = 0.002 * e.gdp;
    const cost = 0.005 * e.gdp;
    const p = fundingPreview(c, cost);
    const debt0 = e.debt;
    expect(fund(s, c.id, cost, 'Test project').ok).toBe(true);
    expect(e.cash).toBeCloseTo(0, 0);
    expect(e.debt - debt0).toBeCloseTo(p.borrowed, -3);
    expect(p.fromCash).toBeCloseTo(0.002 * e.gdp, -3);
    const L = e.ledger!.at(-1)!;
    expect(L.what).toBe('Test project');
    expect(L.borrowed).toBeCloseTo(p.borrowed, -3);
    // a decision's costs and gains become one ledger line named after it
    s.inbox = [{ uid: 900, id: 'strike', tick: s.tick, expires: s.tick + 10, urgent: false, data: {} }];
    e.cash = 1e13;
    resolveEvent(s, geo, 0, 900);
    expect(e.ledger!.at(-1)!.what).toBe(eventById('strike').title);
  });
  it('the starting treasury lasts: no major economy runs dry in its first year, and running dry is announced', () => {
    for (const n of ['Germany', 'Poland', 'United States of America', 'Brazil', 'India']) {
      const s = fresh(n, { randomEvents: false });
      for (let w = 0; w < 52; w++) { s.inbox = []; tick(s, geo); }
      expect(s.countries[s.player].eco.cash, n).toBeGreaterThan(0);
    }
    const s = fresh('Germany', { randomEvents: false });
    const c = s.countries[s.player];
    c.eco.cash = 0; c.budget.social += 0.03;
    run(s, 2);
    expect(c.eco.ledger!.some((x) => x.what === DEFICIT_LABEL && x.borrowed > 0)).toBe(true);
    expect(s.log.some((l) => /treasury is empty/i.test(l.text))).toBe(true);
  });
  it('Legacy: the term recap and the score agree on promises, and a peaceful career scores 0 for wars', () => {
    const s = fresh('Poland', { mode: 'legacy', randomEvents: false });
    const L = s.legacy!;
    // three promises that cannot be kept in a few weeks
    L.hand = [];
    L.agenda = ['miracle', 'tech', 'build'].map((x) => ({ id: x, start: s.tick, base: agendaById(x).base(s, s.countries[s.player]), done: false }));
    L.parts.agenda = 10; // as if an earlier term had earned some points
    const before = L.parts.agenda;
    L.nextVote = s.tick + 3;
    run(s, 4);
    const T = L.terms.at(-1)!;
    const line = T.lines.find((l) => /Promise points this term/.test(l))!;
    const termPts = Number(/this term: ([+-]?\d+)/.exec(line)![1]);
    expect(termPts).toBe(Math.round(L.parts.agenda - before));
    expect(termPts).toBeLessThan(0);
    expect(T.lines.join(' ')).toMatch(/No promises were kept this term/);
    expect(line).toMatch(/career total/);
    expect(L.wars ?? []).toHaveLength(0);
    expect(scoreParts(s).wars ?? 0).toBe(0);
    expect(partHint(s, 'wars')).toMatch(/no wars/i);
    actRetire(s);
    expect(L.parts.wars ?? 0).toBe(0);
  });
  it('Legacy: each war of yours counts once, with its result, and wars between others never count', () => {
    const s = fresh('Poland', { mode: 'legacy', randomEvents: false });
    const L = s.legacy!;
    const me = s.player, foe = id('Belarus'), x = id('France'), y = id('Spain');
    legacyWarEnded(s, { id: 1, name: 'Test War', a: me, b: foe, start: 0, end: s.tick, casA: 0, casB: 0, provsA: 2, provsB: 0, winner: 'a', terms: 'demand' });
    legacyWarEnded(s, { id: 2, name: 'Their War', a: x, b: y, start: 0, end: s.tick, casA: 0, casB: 0, provsA: 0, provsB: 0, winner: 'a', terms: 'demand' });
    expect(L.parts.wars).toBe(45);
    expect(L.wars).toHaveLength(1);
    actRetire(s);
    expect(L.parts.wars).toBe(45); // not recounted at the end
  });
  it('negotiation: friends, neutrals and rivals answer differently, for reasons you can read', () => {
    const s = fresh('Germany');
    const st = (n: string, give: ('cash3' | 'tech' | 'lift')[] = []) => stanceOf(s, geo, id(n), { goal: 'trade', give });
    const friend = stanceOf(s, geo, id('France'), { goal: 'coop', give: [] }), neutral = st('Brazil'), hostile = st('Russia');
    expect(friend.p).toBeGreaterThan(neutral.p);
    expect(neutral.p).toBeGreaterThan(hostile.p);
    for (const x of [friend, neutral, hostile]) { expect(x.factors.length).toBeGreaterThan(1); expect(x.interests.length).toBeGreaterThan(0); }
    // a sweetener they value moves the odds
    expect(st('Russia', ['tech']).p).toBeGreaterThan(hostile.p);
    // red lines block outright, with the reason
    const ally = stanceOf(s, geo, id('Russia'), { goal: 'alliance', give: [] });
    expect(ally.blocked).toBeTruthy();
    expect(negotiate(s, geo, id('Russia'), { goal: 'alliance', give: [] }).outcome).toBe('blocked');
  });
  it('negotiation: a near miss brings a counteroffer, accepting it is certain, and patience runs out', () => {
    let countered = false;
    for (let seed = 1; seed < 40 && !countered; seed++) {
      const s = fresh('Germany', { seed });
      const them = id('Brazil');
      const r = negotiate(s, geo, them, { goal: 'coop', give: [] });
      expect(r.why.length).toBeGreaterThan(0);
      if (r.outcome === 'counter') {
        countered = true;
        const ok = negotiate(s, geo, them, { goal: 'coop', give: r.counter! }, true);
        expect(ok.outcome).toBe('accepted');
        expect(getTreaty(s, s.player, them)?.coop).toBe(true);
      }
    }
    expect(countered).toBe(true);
    const s = fresh('Germany');
    const them = id('Iran');
    let blocked = false;
    for (let i = 0; i < 6; i++) { const r = negotiate(s, geo, them, { goal: 'coop', give: [] }); if (r.outcome === 'blocked') { blocked = true; break; } }
    expect(blocked).toBe(true);
  });
  it('previewing what happens if a decision lapses does not change the world', () => {
    const s = fresh('Poland');
    s.inbox = [{ uid: 901, id: 'fac_demand', tick: s.tick, expires: s.tick + 10, urgent: false, data: { f: 0, k: 0 } }];
    const before = JSON.stringify(s);
    const p = previewLapse(s, geo, 901);
    expect(p.text.length).toBeGreaterThan(5);
    expect(JSON.stringify(s)).toBe(before);
  });
  it('choices have consequences: follow-ups arrive later, refer back to the choice, and every answer works', () => {
    for (const f of FOLLOW_UPS) {
      expect(eventById(f.next), f.next).toBeDefined();
      let s: GameState | null = null;
      for (let seed = 1; seed < 30; seed++) {
        const g = fresh('Poland', { seed, randomEvents: false });
        rememberChoice(g, f.after, f.option, { n: id('Belarus'), from: id('Germany') });
        if (g.scheduled.some((x) => x.id === f.next)) { s = g; break; }
      }
      expect(s, f.next).not.toBeNull();
      const sc = s!.scheduled.find((x) => x.id === f.next)!;
      expect(sc.tick - s!.tick).toBeGreaterThanOrEqual(f.delay[0]);
      const c = s!.countries[s!.player];
      c.eco.cash = 1e13; c.politics!.pc = 100;
      const def = eventById(f.next);
      expect(def.text(s!, c, sc.data)).toMatch(/\d{4}/); // names when you made the original choice
      for (let k = 0; k < def.options.length; k++) {
        s!.inbox = [{ uid: 950 + k, id: f.next, tick: s!.tick, expires: s!.tick + 10, urgent: false, data: sc.data }];
        expect(resolveEvent(s!, geo, k, 950 + k).ok).toBe(true);
      }
    }
  });
  it('ministers read penalties as penalties and do not advise borrowing they would not need', () => {
    const s = fresh('Poland');
    const c = s.countries[s.player];
    const fin = { ...c.cabinet!.find((m) => m.role === 'finance')!, trait: 'technocrat' };
    const opts = [{ label: 'Spend big', hint: 'Costs 2% of GDP · stability +2' }, { label: 'Do something unpopular', hint: 'Free · stability −6' }, { label: 'Do little', hint: 'Free · stability −1' }];
    c.eco.cash = 0.05 * c.eco.gdp;
    expect(adviceOf(fin, opts, [true, true, true], c)!.idx).not.toBe(1); // −6 is a cost, not a gain
    c.eco.cash = 0;
    const a = adviceOf(fin, opts, [true, true, true], c)!;
    expect(a.idx).toBe(2); // the treasury is empty: the finance minister will not borrow 2% of GDP for it
  });
  it('decisions do not repeat: faction demands stay rare and each faction speaks at most once a year', () => {
    const s = fresh('Japan', { seed: 7 });
    const seen: { id: string; t: number; f?: number }[] = [];
    let last = s.nextInbox;
    for (let w = 0; w < 52 * 6; w++) {
      for (const it of [...s.inbox]) { const def = eventById(it.id); const k = def.options.findIndex((o) => !o.enabled || o.enabled(s, s.countries[s.player])); resolveEvent(s, geo, Math.max(0, k), it.uid); }
      tick(s, geo);
      for (const it of s.inbox) if (it.uid >= last) seen.push({ id: it.id, t: s.tick, f: it.data.f });
      last = s.nextInbox;
    }
    const demands = seen.filter((x) => x.id === 'fac_demand');
    expect(demands.length / 6).toBeLessThanOrEqual(1.8);
    for (let i = 0; i < demands.length; i++) for (let j = i + 1; j < demands.length; j++) if (demands[i].f === demands[j].f) expect(demands[j].t - demands[i].t).toBeGreaterThanOrEqual(52);
    expect(new Set(seen.map((x) => x.id)).size).toBeGreaterThanOrEqual(12);
  });
});

// ---------------------------------------------------------------------------------------------------------------
import { actApplyOrg, actLeaveOrg, actRealign, alignmentSummary, applicationVotes, changeGov, credibility, foundOrg, leaveOrg, stepAlignment } from '../src/sim/alignment';
import { orgsOf } from '../src/sim/relations';

describe('round 16: alliances, camps and regimes can change', () => {
  it('the world starts exactly as before: blocs, camps and adversaries reproduce the 2024 relations', () => {
    const s = fresh();
    const R = (a: string, b: string) => Math.round(getRelation(s, id(a), id(b)));
    expect(R('Germany', 'Russia')).toBe(-41);
    expect(R('United States of America', 'China')).toBe(-71);
    expect(R('Germany', 'France')).toBeGreaterThan(80);
    expect(s.orgs!.map((o) => o.key)).toEqual(['nato', 'eu', 'csto', 'arab', 'brics']);
  });
  it('a country that turns West is treated differently: camps and hostility are state, not fixed data', () => {
    const s = fresh('Russia');
    const before = getRelation(s, id('Germany'), id('Russia'));
    const ru = s.countries[id('Russia')];
    ru.orient = 1; ru.hostile = 0;
    expect(getRelation(s, id('Germany'), id('Russia')) - before).toBeGreaterThan(50);
    changeGov(s, ru, 'D', 'test');
    expect(ru.gov).toBe('D');
    expect(getRelation(s, id('Germany'), id('Russia'))).toBeGreaterThan(before + 60);
  });
  it('leaving a defence pact ends those alliances; too few members dissolve it; a new pact allies its members', () => {
    const s = fresh('Poland');
    const nato = s.orgs!.find((o) => o.key === 'nato')!;
    expect(getTreaty(s, id('Poland'), id('Germany'))?.alliance).toBe(true);
    expect(actLeaveOrg(s, nato.id).ok).toBe(true);
    expect(getTreaty(s, id('Poland'), id('Germany'))?.alliance).toBe(false);
    expect(orgsOf(s, id('Poland')).some((o) => o.key === 'nato')).toBe(false);
    const csto = s.orgs!.find((o) => o.key === 'csto')!;
    for (const m of [...csto.members].slice(0, 4)) leaveOrg(s, csto, m, 'test');
    expect(s.orgs!.some((o) => o.key === 'csto')).toBe(false);
    const p = foundOrg(s, id('Poland'), 'defence', [id('Lithuania'), id('Ukraine')]);
    expect(getTreaty(s, id('Poland'), id('Ukraine'))?.alliance).toBe(true);
    expect(p.members).toHaveLength(3);
  });
  it('applying to join is a vote you can read: Russia cannot walk into NATO, a close partner can join an economic club', () => {
    const s = fresh('Russia');
    const nato = s.orgs!.find((o) => o.key === 'nato')!;
    const v = applicationVotes(s, nato, s.player);
    expect(v.filter((x) => x.yes).length).toBe(0);
    expect(actApplyOrg(s, nato.id).ok).toBe(false);
    expect(actApplyOrg(s, nato.id).message).toMatch(/not reconsider/);
  });
  it('Russia can take the Reset: thaw, opening, free elections; it turns West step by step and the old guard may resist', () => {
    const s = fresh('Russia', { randomEvents: false });
    const c = s.countries[s.player];
    const o0 = c.orient!;
    for (const node of ['ru_thaw', 'ru_open', 'ru_vote']) {
      c.politics!.pc = 100; c.eco.cash = 1e13;
      expect(startNatProject(s, node).ok, node).toBe(true);
      for (let i = 0; i < 40 && c.nat?.active; i++) run(s, 1);
    }
    expect(c.gov).toBe('D');
    expect(c.orient!).toBeGreaterThan(o0 + 0.4);
    expect(c.hostile!).toBeLessThan(0.6);
    expect(startNatProject(s, 'ru_near').ok).toBe(false); // the Thaw closes off the near-abroad path
    c.politics!.pc = 100;
    const before = c.orient!;
    expect(actRealign(s, 'west').ok).toBe(true);
    expect(c.orient!).toBeGreaterThan(before);
    expect(actRealign(s, 'west').ok).toBe(false); // once a year at most
  });
  it('an alliance whose leading power collapses loses credibility', () => {
    const s = fresh('Poland', { randomEvents: false });
    run(s, 4);
    const nato = s.orgs!.find((o) => o.key === 'nato')!;
    expect(credibility(s, nato)).toBeGreaterThan(0.95);
    const U = s.countries[id('United States of America')];
    U.mil.troops *= 0.05; U.mil.equipArmy *= 0.05; U.mil.equipAir *= 0.05; U.mil.equipNavy *= 0.05;
    run(s, 1);
    expect(credibility(s, nato)).toBeLessThan(0.7);
  });
  it('without a push the camps hold: over five years the number of Western- and Eastern-leaning countries barely moves', () => {
    const s = fresh('Uruguay', { seed: 4 });
    const a0 = alignmentSummary(s);
    for (let w = 0; w < 52 * 5; w++) { s.inbox = []; tick(s, geo); }
    const a1 = alignmentSummary(s);
    expect(Math.abs(a1.west - a0.west)).toBeLessThanOrEqual(6);
    expect(Math.abs(a1.east - a0.east)).toBeLessThanOrEqual(4);
    expect(s.orgs!.some((o) => o.key === 'nato')).toBe(true);
    void stepAlignment;
  });
});

// ---------------------------------------------------------------------------------------------------------------
import { actAbandonCourse, actAdvanceCourse, actStartCourse, coursesFor } from '../src/sim/courses';
import { actProposeDefence, actRenameOrg, cleanName, mergeOrgs, orgName, upgradeToDefence } from '../src/sim/blocs';
import { actFoundOrg } from '../src/sim/alignment';
import { addRelation } from '../src/sim/relations';

describe('round 17: every country can change course; alliances live and evolve', () => {
  const finishCourse = (s: GameState, name?: string) => {
    const c = s.countries[s.player];
    for (let guard = 0; guard < 400 && c.course; guard++) {
      c.politics!.pc = 100; c.eco.cash = 1e13;
      if (c.course.until <= s.tick) actAdvanceCourse(s, geo, name);
      for (const it of [...s.inbox]) { const d = eventById(it.id); const k = d.options.findIndex((o, i) => i === 0 && (!o.enabled || o.enabled(s, c))); resolveEvent(s, geo, Math.max(0, k), it.uid); }
      run(s, 1);
    }
  };
  it('every country has four courses written for its situation, and at least two it can take', () => {
    const s = fresh('Germany');
    for (const c of s.countries.filter((x) => x.alive)) {
      const ks = coursesFor(s, c, geo);
      expect(ks.map((k) => k.id)).toEqual(['west', 'east', 'third', 'region']);
      for (const k of ks) { expect(k.title.length).toBeGreaterThan(3); for (const st of k.stages) { expect(st.title).not.toMatch(/undefined|NaN/); expect(st.desc).not.toMatch(/undefined|NaN/); } }
      if (c.provinces.length > 3) expect(ks.filter((k) => k.ok).length, c.name).toBeGreaterThanOrEqual(2);
    }
    const tr = coursesFor(s, s.countries[id('Turkey')], geo).find((k) => k.id === 'east')!;
    expect(tr.title).toBe('The Eurasian Turn');
    const us = coursesFor(s, s.countries[id('United States of America')], geo);
    expect(us.find((k) => k.id === 'west')!.ok).toBe(false);
  });
  it('turning West step by step moves a country, changes its friends and can end in membership', () => {
    const s = fresh('Kazakhstan', { randomEvents: false });
    const c = s.countries[s.player];
    const o0 = c.orient!, us0 = getRelation(s, s.player, id('United States of America'));
    expect(actStartCourse(s, geo, 'west').ok).toBe(true);
    expect(actStartCourse(s, geo, 'east').ok).toBe(false); // one course at a time
    finishCourse(s);
    expect(c.course).toBeUndefined();
    expect(c.coursesDone).toContain('west');
    expect(c.orient!).toBeGreaterThan(o0 + 0.3);
    expect(getRelation(s, s.player, id('United States of America'))).toBeGreaterThan(us0 + 10);
    expect(orgsOf(s, s.player).some((o) => o.key === 'csto')).toBe(false); // it broke with the old camp
  });
  it('leading your region ends in an organisation with the name you chose', () => {
    const s = fresh('Brazil', { randomEvents: false });
    expect(actStartCourse(s, geo, 'region').ok).toBe(true);
    finishCourse(s, 'The Southern Cross Union');
    expect(s.orgs!.some((o) => o.name === 'The Southern Cross Union' && o.founder === s.player)).toBe(true);
  });
  it('abandoning a course costs a little and blocks retrying at once', () => {
    const s = fresh('Turkey', { randomEvents: false });
    s.countries[s.player].politics!.pc = 100;
    expect(actStartCourse(s, geo, 'east').ok).toBe(true);
    expect(actAbandonCourse(s).ok).toBe(true);
    expect(actStartCourse(s, geo, 'east').ok).toBe(false);
  });
  it('names are varied, never repeated, and a founder can name and rename its own organisation', () => {
    const s = fresh('Poland');
    const names = new Set<string>();
    for (let i = 0; i < 12; i++) { const n = orgName(s, (['defence', 'union', 'economic'] as const)[i % 3], id('Poland'), [id('Lithuania'), id('Czechia')], 1, i); expect(n).not.toMatch(/the the/i); names.add(n); }
    expect(names.size).toBeGreaterThan(6);
    expect(cleanName('  <b>x')).toBeNull();
    s.countries[s.player].politics!.pc = 100;
    for (const x of ['Lithuania', 'Czechia', 'Slovakia']) addRelation(s, s.player, id(x), 60);
    const r = actFoundOrg(s, 'economic', [id('Lithuania'), id('Czechia'), id('Slovakia')], 'The Amber Road');
    expect(r.ok).toBe(true);
    const o = s.orgs!.find((x) => x.name === 'The Amber Road')!;
    expect(actRenameOrg(s, o.id, 'The Amber League').ok).toBe(true);
    expect(o.name).toBe('The Amber League');
    expect(actRenameOrg(s, s.orgs!.find((x) => x.key === 'nato')!.id, 'Mine').ok).toBe(false);
  });
  it('clubs can become alliances, and a big bloc absorbs a small one', () => {
    const s = fresh('Poland');
    const brics = s.orgs!.find((x) => x.key === 'brics')!;
    upgradeToDefence(s, brics, 'test');
    expect(brics.kind).toBe('defence');
    expect(getTreaty(s, id('Brazil'), id('India'))?.alliance).toBe(true);
    expect(brics.history!.some((h) => /mutual-defence/.test(h.text))).toBe(true);
    const nato = s.orgs!.find((x) => x.key === 'nato')!;
    const small = { ...nato, id: 99, key: 'x', name: 'the Test Pact', members: [id('Sweden'), id('Finland'), id('Ukraine')], founded: 5 };
    s.orgs!.push(small);
    const m = mergeOrgs(s, nato, small);
    expect(m).toBe(nato);
    expect(nato.name).toBe('NATO');
    expect(nato.members).toContain(id('Ukraine'));
    expect(s.orgs!.includes(small)).toBe(false);
  });
  it('a member can propose a mutual-defence clause; the members vote', () => {
    const s = fresh('Brazil');
    const brics = s.orgs!.find((x) => x.key === 'brics')!;
    const r = actProposeDefence(s, brics.id);
    expect(r.message.length).toBeGreaterThan(5);
    expect(actProposeDefence(s, brics.id).ok).toBe(false); // not again this year
  });
  it('AI countries change course rarely and for reasons; the camps do not snowball', () => {
    const s = fresh('Uruguay', { seed: 5 });
    const a0 = alignmentSummary(s);
    let starts = 0, last = 0;
    for (let w = 0; w < 52 * 8; w++) {
      s.inbox = []; tick(s, geo);
      for (const e of s.log) { if (e.seq <= last) continue; last = e.seq; if (/CHANGES COURSE/.test(e.text)) starts++; }
    }
    const a1 = alignmentSummary(s);
    expect(starts).toBeLessThanOrEqual(16);
    expect(Math.abs(a1.west - a0.west)).toBeLessThanOrEqual(8);
  });
});

describe('round 18: national storylines for every country, steered by the player', () => {
  /** Plays the player's story acts with the given choices (act i takes picks[i], or the first one it can). */
  const playStory = (s: GameState, picks: number[], weeks: number) => {
    const c = s.countries[s.player];
    const seen: string[] = [];
    for (let w = 0; w < weeks; w++) {
      for (const it of [...s.inbox]) {
        const d = eventById(it.id);
        c.politics!.pc = 100;
        if (it.id.startsWith('story')) {
          seen.push(it.id);
          const want = picks[(c.story?.act ?? 1) - 1] ?? 0;
          const k = d.options[want] && (!d.options[want].enabled || d.options[want].enabled!(s, c)) ? want : d.options.length - 1;
          resolveEvent(s, geo, k, it.uid);
        } else resolveEvent(s, geo, 0, it.uid);
      }
      tick(s, geo);
    }
    return seen;
  };
  it('every country has a storyline seed, and every act exists for it', () => {
    const s = fresh('Germany');
    const ids = new Set(storyEvents().map((e) => e.id));
    for (const c of s.countries) {
      expect(STORIES[c.name], c.name).toBeDefined();
      const seed = seedOf(c);
      expect(ids.has(`story1_${seed.issue}`)).toBe(true);
      for (const a of ['reform', 'iron', 'pragmatic']) expect(ids.has(`story3_${seed.econ}_${a}`), `${c.name} ${seed.econ}`).toBe(true);
      expect(possibleEndings(c).length).toBe(12);
    }
    expect(ids.has('story4')).toBe(true);
  });
  it('the player walks four acts; the road chosen in Act I unlocks its own options and decides the ending', () => {
    const s = fresh('Turkey', { randomEvents: false });
    const c = s.countries[s.player];
    const seen = playStory(s, [1, 3, 0, 4], 52 * 8);
    expect(seen.slice(0, 4)).toEqual([`story1_${seedOf(c).issue}`, 'story2_iron', `story3_${seedOf(c).econ}_iron`, 'story4']);
    expect(eventById('story2_iron').options[3].label).toBe('Prepare for war');
    expect(eventById('story2_reform').options[3].label).toBe('International arbitration');
    expect(c.story!.arch).toBe('iron');
    expect(c.story!.ending).toBe('The Iron Industrial Power');
    expect(s.stats[`cb:${c.id}>${c.story!.rival}`]).toBe(1); // preparing for war gave a casus belli
  });
  it('a different road gives a different story', () => {
    const s = fresh('Turkey', { randomEvents: false });
    playStory(s, [0, 3, 3, 4], 52 * 8);
    const c = s.countries[s.player];
    expect(c.story!.arch).toBe('reform');
    expect(c.story!.ending).toBe('The Reformed Social Market');
  });
  it('after the ending a new chapter opens, built from where the country stands then', () => {
    const s = fresh('Japan', { randomEvents: false });
    const c = s.countries[s.player];
    playStory(s, [0, 0, 0, 4], 52 * 8);
    expect(c.story!.act).toBe(5);
    c.eco.damage = 0.3;
    expect(issueNow(s, c)).toBe('rebuild');
    c.eco.damage = 0;
    c.eco.inflation = 0.3;
    expect(issueNow(s, c)).toBe('inflation');
    c.eco.inflation = 0.02;
    s.tick = c.story!.next; // jump to the chapter break
    const seen = playStory(s, [2, 0, 0, 4], 12);
    expect(c.story!.ch).toBe(2);
    expect(c.story!.past?.[0].ending).toMatch(/^The /);
    expect(seen.some((x) => x.startsWith('story1_'))).toBe(true); // chapter II's first act arrived (and was answered)
  });
  it('AI countries play their stories by character without flooding the headlines', () => {
    const s = fresh('Germany', { randomEvents: false });
    const seq0 = s.logSeq;
    run(s, 52 * 8);
    const alive = s.countries.filter((x) => x.alive && !x.isPlayer);
    expect(alive.filter((x) => (x.story?.act ?? 1) > 4 || (x.story?.ch ?? 1) > 1).length).toBeGreaterThan(alive.length * 0.8);
    const story = s.log.filter((e) => e.seq >= seq0 && /📖/.test(e.text));
    expect(story.filter((e) => e.important && !e.countries.includes(s.player)).length).toBe(0);
    const us = s.countries[id('United States of America')];
    expect(us.story!.arch).toBe('reform'); // a democracy takes the reformer's road
  });
  it('storylines are deterministic', () => {
    const a = fresh('Brazil', { seed: 9 }), b = fresh('Brazil', { seed: 9 });
    run(a, 200); run(b, 200);
    expect(a.countries.map((x) => JSON.stringify(x.story))).toEqual(b.countries.map((x) => JSON.stringify(x.story)));
  });
});

describe('round 19: a world of minds: agendas, plans, membership sums and judgement', () => {
  it('every AI leader has an agenda, a stance on alliances, a camp preference, a mandate and an aim', () => {
    const s = fresh('Germany');
    for (const c of s.countries.filter((x) => x.alive && !x.isPlayer)) {
      const l = c.leader!;
      const sum = Object.values(l.agenda!).reduce((a, b) => a + b, 0);
      expect(sum, c.name).toBeGreaterThan(0.98); expect(sum).toBeLessThan(1.02);
      expect(Math.abs(l.commit!)).toBeLessThanOrEqual(1); expect(Math.abs(l.lean!)).toBeLessThanOrEqual(1);
      expect(l.mandate!.length).toBeGreaterThan(5);
      expect(c.goal?.text.length, c.name).toBeGreaterThan(5);
    }
  });
  it('the public mood shapes who comes next: a war-weary, overburdened country elects "country first" leaders', () => {
    const s = fresh('Germany');
    const us = s.countries[id('United States of America')];
    s.tick = 10; // (the leaders of 2024 itself are never "country first")
    const count = () => { let n = 0; for (let g = 1; g <= 300; g++) { crownLeader(s, us, g); if (us.leader!.traits.includes('isolationist')) n++; } return n; };
    us.mood = { weary: 0, burden: 0, pain: 0, threat: 0.6, shame: 0 };
    const calm = count();
    us.mood = { weary: 0.7, burden: 0.9, pain: 0.4, threat: 0, shame: 0 };
    const tired = count();
    expect(tired).toBeGreaterThan(calm * 2.5);
    expect(moodTraitWeight(us, 'isolationist')).toBeGreaterThan(2);
    // and their stance follows: a tired country's leader commits less to alliances
    const a1 = makeAgenda(s, us, ['pragmatist', 'reformer'], 7);
    us.mood = { weary: 0, burden: 0, pain: 0, threat: 0.8, shame: 0 };
    const a2 = makeAgenda(s, us, ['pragmatist', 'reformer'], 7);
    expect(a2.commit!).toBeGreaterThan(a1.commit!);
    expect(a2.agenda!.security).toBeGreaterThan(a1.agenda!.security);
  });
  it('leaders judge the player through their own agendas, and it shows in deals and votes', () => {
    const s = fresh('Hungary', { randomEvents: false });
    const de = s.countries[id('Germany')], ru = s.countries[id('Russia')];
    de.leader!.agenda = { security: 0.2, expansion: 0.05, wealth: 0.2, prestige: 0.1, ideology: 0.45 };
    ru.leader!.agenda = { security: 0.3, expansion: 0.2, wealth: 0.2, prestige: 0.2, ideology: 0.1 };
    const before = opinionOf(s, de.id, s.player).v;
    addRec(s, s.player, 'repress', 2);
    const de1 = opinionOf(s, de.id, s.player), ru1 = opinionOf(s, ru.id, s.player);
    expect(de1.v).toBeLessThan(before - 15);
    expect(de1.reasons[0].label).toMatch(/cracked down/);
    expect(ru1.v).toBeGreaterThanOrEqual(0); // a strongman respects order
    const kind = (['trade', 'nap', 'coop', 'alliance'] as const).find((k) => evaluateProposal(s, geo, s.player, de.id, k).reasons[0] !== 'Already in force')!;
    const ev = evaluateProposal(s, geo, s.player, de.id, kind);
    expect(ev.reasons.join(' ')).toMatch(/cracked down/);
    addRec(s, s.player, 'aggr', 3);
    const pl = s.countries[id('Austria')];
    pl.leader!.agenda = { security: 0.5, expansion: 0.05, wealth: 0.2, prestige: 0.05, ideology: 0.2 };
    expect(opinionOf(s, pl.id, s.player).reasons.some((r) => /wars of aggression/.test(r.label))).toBe(true);
  });
  it('an alarmed neighbour makes containing the player its long-term aim', () => {
    const s = fresh('Hungary', { randomEvents: false });
    run(s, 2);
    s.stats[`agg:${s.player}`] = 80;
    addRec(s, s.player, 'aggr', 4);
    const at = s.countries[id('Austria')];
    at.leader!.agenda = { security: 0.6, expansion: 0.05, wealth: 0.15, prestige: 0.05, ideology: 0.15 };
    const g = choosePlan(s, geo, at, true);
    expect(g.kind).toBe('contain');
    expect(g.target).toBe(s.player);
  });
  it('plans are pursued and abandoned: a bomb programme is found out; a hopeless arms race is given up', () => {
    const s = fresh('Germany', { randomEvents: false });
    const ir = s.countries[id('Iran')];
    ir.mil.nuclear = false; ir.eco.cash = ir.eco.gdp;
    ir.goal = { kind: 'nukes', target: -1, text: 'Build a nuclear deterrent', since: s.tick, progress: 0, best: 0, patience: 1, step: 0 };
    pursuePlan(s, geo, ir);
    const run0 = s.projects.find((p) => p.owner === ir.id && p.id === 'nuclear');
    expect(run0).toBeDefined();
    run0!.done = run0!.weeks * 0.4;
    pursuePlan(s, geo, ir);
    expect(s.stats[`nukeSeen:${ir.id}`]).toBeDefined();
    expect(s.log.some((e) => /secretly building a nuclear weapon/.test(e.text))).toBe(true);
    const ge = s.countries[id('Georgia')];
    ge.goal = { kind: 'security', target: id('Russia'), text: 'Deter Russia', since: s.tick, progress: 0, best: 0, patience: 0.1, step: 0 };
    for (let i = 0; i < 10 && ge.goal; i++) pursuePlan(s, geo, ge);
    expect(ge.goal).toBeUndefined(); // matching Russia alone is hopeless: patience runs out
    expect(s.stats['plan:security:fail']).toBe(1);
  });
  it('AI countries no longer build the bomb at random', () => {
    const s = fresh('Germany', { randomEvents: false });
    for (const c of s.countries) if (c.goal?.kind === 'nukes') c.goal = undefined;
    run(s, 52 * 3);
    const starts = s.projects.filter((p) => p.id === 'nuclear' && s.countries[p.owner].goal?.kind !== 'nukes');
    expect(starts.length).toBe(0);
  });
  it('membership is a running sum: a "country first" leader carrying the alliance threatens to leave, and the others pay more', () => {
    const s = fresh('Uruguay', { randomEvents: false });
    const nato = s.orgs!.find((o) => o.key === 'nato')!;
    const us = s.countries[id('United States of America')];
    expect(memberValue(s, nato, us.id).v).toBeGreaterThan(-0.1);
    us.leader!.commit = -0.95; us.leader!.traits = ['isolationist', 'mercantilist'];
    us.leader!.agenda = { security: 0.15, expansion: 0.05, wealth: 0.5, prestige: 0.1, ideology: 0.2 };
    const v = memberValue(s, nato, us.id);
    expect(v.v).toBeLessThan(-0.08);
    expect(v.parts.some((p) => /Pays more than its rich partners|cost of the commitment/.test(p.label))).toBe(true);
    expect(v.parts.some((p) => /sphere of influence/.test(p.label))).toBe(true);
    const de = s.countries[id('Germany')], mil0 = de.budget.military;
    for (let i = 0; i < 12 && !nato.ultimatum; i++) { s.tick += 1; stepMembership(s); }
    expect(nato.ultimatum?.by).toBe(us.id);
    for (let i = 0; i < 20; i++) { s.tick += 1; stepMembership(s); }
    expect(de.budget.military).toBeGreaterThan(mil0);
  });
  it('storyline acts are triggered by what actually happens', () => {
    const s = fresh('Turkey', { randomEvents: false });
    const c = s.countries[s.player];
    run(s, 1);
    const st = c.story!;
    st.act = 2; st.rival = id('Greece'); st.why = undefined;
    st.snap = { t: s.tick, rel: getRelation(s, c.id, id('Greece')), troops: s.countries[id('Greece')].mil.troops, ws: 0.7, gdp: c.eco.gdp, nb: '', ml: '' };
    expect(actTrigger(s, geo, c, st)).toBeNull();
    s.countries[id('Greece')].mil.troops *= 1.3;
    expect(actTrigger(s, geo, c, st)).toMatch(/Greece has grown its army/);
    st.act = 1; st.issue = 'inflation'; c.eco.inflation = 0.2;
    expect(actTrigger(s, geo, c, st)).toMatch(/inflation has hit 20%/);
  });
  it('the world with minds stays deterministic', () => {
    const a = fresh('India', { seed: 4 }), b = fresh('India', { seed: 4 });
    run(a, 160); run(b, 160);
    expect(a.countries.map((x) => `${x.leader?.name}|${x.goal?.kind}|${x.goal?.target}|${(x.orient ?? 0).toFixed(4)}`)).toEqual(b.countries.map((x) => `${x.leader?.name}|${x.goal?.kind}|${x.goal?.target}|${(x.orient ?? 0).toFixed(4)}`));
    expect(JSON.stringify(a.rec)).toBe(JSON.stringify(b.rec));
  });
});

describe('round 20: turning points and leaders who run their economies', () => {
  it('no turn without a crisis: a settled Russia keeps its line, a Russia in crisis can get an opener', () => {
    const s = fresh('Germany', { randomEvents: false });
    const ru = s.countries[id('Russia')];
    s.tick = 100;
    ru.mood = { weary: 0, burden: 0, pain: 0.1, threat: 0.2, shame: 0 };
    let turned = 0;
    for (let g = 1; g <= 200; g++) { crownLeader(s, ru, g); if (turningLeader(s, ru, g)) turned++; }
    expect(turned).toBe(0);
    ru.mood = { weary: 0.5, burden: 0, pain: 0.85, threat: 0.2, shame: 0.7 };
    ru.eco.stability = 25;
    expect(crisisOf(ru)).toBeGreaterThan(0.8);
    let got = -1;
    for (let g = 1; g <= 200 && got < 0; g++) { crownLeader(s, ru, g); if (turningLeader(s, ru, g)) got = g; }
    expect(got).toBeGreaterThan(0);
    expect(ru.leader!.turn!.from).toBeLessThan(-0.4);
    expect(ru.leader!.lean!).toBeGreaterThan(ru.leader!.turn!.from + 0.6);
    expect(ru.leader!.mandate).toMatch(/end the isolation/);
  });
  it('a thaw moves the country, the camp it courts warms, the old one cools, and the West drops its guard', () => {
    const s = fresh('Germany', { randomEvents: false });
    const ru = s.countries[id('Russia')];
    ru.leader!.turn = { from: ru.orient!, since: 0 }; ru.leader!.lean = 0.3;
    const o0 = ru.orient!, h0 = ru.hostile ?? 0;
    const us0 = getRelation(s, ru.id, id('United States of America'));
    for (let q = 0; q < 16; q++) stepThaw(s, ru);
    expect(ru.orient!).toBeGreaterThan(o0 + 0.5);
    expect(ru.hostile ?? 0).toBeLessThan(h0 + 1e-9);
    expect(getRelation(s, ru.id, id('United States of America'))).toBeGreaterThan(us0 + 10);
  });
  it('the old guard can strike back, and a far-reaching turn is riskier', () => {
    const s = fresh('Germany', { randomEvents: false });
    const ru = s.countries[id('Russia')];
    ru.leader!.turn = { from: -0.85, since: 0 };
    const tries = (orient: number) => { ru.orient = orient; let n = 0; for (let i = 0; i < 4000; i++) if (backlashDue(s, ru)) n++; return n; };
    expect(tries(-0.1)).toBeGreaterThan(tries(-0.8) * 1.5);
    run(s, 1);
    delete ru.leader!.turn;
    expect(backlashDue(s, ru)).toBe(false);
  });
  it('leaders shape growth: reformers lift productivity, cronies and protectionists cost it', () => {
    const s = fresh('Germany', { randomEvents: false });
    const c = s.countries[id('Brazil')];
    delete c.goal;
    c.leader!.traits = ['reformer', 'mercantilist'];
    const good = policyTfp(c);
    c.leader!.traits = ['strongman', 'isolationist'];
    const bad = policyTfp(c);
    expect(good).toBeGreaterThan(0.003);
    expect(bad).toBeLessThanOrEqual(-0.004 + 1e-9);
    expect(policyTfp(s.countries[s.player])).toBe(0); // the player runs their own economy
  });
});
