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
