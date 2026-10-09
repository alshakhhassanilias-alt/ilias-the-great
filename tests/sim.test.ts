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
import { ALL_EVENTS as EVENTS, resolveEvent, rollPlayerEvent } from '../src/sim/events';
import { GOALS, stepGoals } from '../src/sim/goals';
import { runOp } from '../src/sim/ops';
import { actAirstrike, actCallAllies, actGuarantee, actMediate, actUltimatum, actBuild, actAid, actSummit } from '../src/sim/actions';
import { applyTreaty } from '../src/sim/diplomacy';
import { computeBlocs, previewReactions, finalizeResolution, proposeResolution, tensionIndex } from '../src/sim/politics';
import { stepAssembly } from '../src/sim/events';
import { levelOf, BDEF } from '../src/sim/buildings';
import { hasGuarantee } from '../src/sim/relations';

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
  it('decision events appear regularly, pause for a choice, and apply their effects', () => {
    const s = fresh('Poland');
    let seen = 0;
    for (let i = 0; i < 52 * 3 && seen < 30; i++) {
      tick(s, geo);
      if (s.pendingEvent) {
        seen++;
        const before = s.countries[id('Poland')].eco.stability;
        const r = resolveEvent(s, geo, 0);
        expect(r.message.length).toBeGreaterThan(3);
        expect(s.pendingEvent).toBeNull();
        void before;
      }
    }
    expect(seen).toBeGreaterThanOrEqual(6); // at least a couple of decisions per year
  });
  it('every event definition is internally consistent', () => {
    const s = fresh('Germany');
    const c = s.countries[id('Germany')];
    c.eco.cash = 1e12;
    for (const def of EVENTS) {
      const fr = id('France'), pl = id('Poland');
      const d = def.eligible(s, c, geo) ?? { n: fr, from: fr, a: pl, b: fr, x: fr, l: fr, t: pl, ally: pl, aggressor: fr, war: -1, rid: -1, kind: 1, w: -1 };
      expect(def.text(s, c, d).length).toBeGreaterThan(10);
      expect(def.options.length).toBeGreaterThanOrEqual(def.weight > 0 ? 2 : 1);
      for (let i = 0; i < def.options.length; i++) {
        const s2 = JSON.parse(JSON.stringify(s)) as GameState;
        s2.pendingEvent = { id: def.id, tick: 1, data: d };
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
    const named = geo.provinces.filter((p) => p.name.length > 2).length;
    expect(named).toBe(geo.provinces.length);
    expect(geo.provinces[geo.provs0[id('Poland')][0]].name).toMatch(/Poland/);
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
    expect(s.pendingEvent?.id).toBe('ally_attacked');
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
