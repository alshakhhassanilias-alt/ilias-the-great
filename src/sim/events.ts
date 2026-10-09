/**
 * Things that happen. Decision events put a choice in front of the player (the game pauses until
 * answered); world events hit AI countries and appear in the news, shifting the global situation.
 * Everything is driven by the seeded RNG, so a seed + the same choices give the same history.
 */
import type { Geo } from './geo';
import { nextRand } from './rng';
import { clamp, fmtMoney } from './util';
import { logEvent } from './log';
import { fund } from './actions';
import { addRelation, alliesOf, areAtWar, getRelation, isAtWar, partnersOf } from './relations';
import { applyTreaty, neighborsOf } from './diplomacy';
import { declareWar, forcePeaceAll } from './war';
import type { Country, GameState, PendingEvent } from './types';

type D = Record<string, number>;
export interface EventOption { label: string; hint: string; enabled?: (s: GameState, c: Country) => boolean; apply: (s: GameState, c: Country, d: D, geo: Geo) => string }
export interface EventDef {
  id: string; icon: string; title: string; weight: number; cooldown: number;
  eligible: (s: GameState, c: Country, geo: Geo) => D | null;
  text: (s: GameState, c: Country, d: D) => string;
  options: EventOption[];
}

const name = (s: GameState, id: number) => s.countries[id].name;
const pay = (s: GameState, c: Country, pct: number) => fund(s, c.id, pct * c.eco.gdp);
const stab = (c: Country, v: number) => { c.eco.stability = clamp(c.eco.stability + v, 0, 100); };
const rep = (c: Country, v: number) => { c.reputation = clamp(c.reputation + v, 0, 100); };
const money = (c: Country, pct: number) => fmtMoney(pct * c.eco.gdp);
const canPay = (pct: number) => (_s: GameState, c: Country) => (c.eco.debt + pct * c.eco.gdp) / c.eco.gdp < 2.5;

export const EVENTS: EventDef[] = [
  {
    id: 'strike', icon: '✊', title: 'General strike threatened', weight: 1.2, cooldown: 90,
    eligible: (_s, c) => (c.eco.stability < 80 ? {} : null),
    text: (_s, c) => `Trade unions across ${c.name} are threatening a general strike over wages and living costs.`,
    options: [
      { label: 'Grant pay rises', hint: 'Costs 0.6% of GDP · stability +6 · inflation +0.4pt', enabled: canPay(0.006), apply: (s, c) => { pay(s, c, 0.006); stab(c, 6); c.eco.monetary += 0.004; return `Pay rises agreed (${money(c, 0.006)}). Unrest eases.`; } },
      { label: 'Negotiate', hint: 'Free · stability +2, but talks may drag on', apply: (s, c) => { if (nextRand(s) < 0.45) { stab(c, -3); return 'Talks collapsed; protests flare up.'; } stab(c, 2); return 'A compromise was reached.'; } },
      { label: 'Break the strike', hint: 'Stability −7 · reputation −3', apply: (_s, c) => { stab(c, -7); rep(c, -3); return 'Police broke the strike. Resentment simmers.'; } },
    ],
  },
  {
    id: 'oil_spike', icon: '🛢', title: 'Energy price spike', weight: 1, cooldown: 120,
    eligible: (_s, c) => (c.eco.energyCap < c.eco.energyDemand * 0.9 ? {} : null),
    text: () => 'A supply shock has sent energy prices soaring. Households and industry are feeling it.',
    options: [
      { label: 'Subsidise energy', hint: 'Costs 0.8% of GDP · stability +1', enabled: canPay(0.008), apply: (s, c) => { pay(s, c, 0.008); stab(c, 1); return 'Energy subsidies shield households.'; } },
      { label: 'Let prices pass through', hint: 'Inflation +1.5pt · stability −3', apply: (_s, c) => { c.eco.monetary += 0.015; stab(c, -3); return 'Prices rise across the economy.'; } },
      { label: 'Emergency power build-out', hint: 'Costs 0.5% of GDP · energy capacity +2.5%', enabled: canPay(0.005), apply: (s, c) => { pay(s, c, 0.005); c.eco.energyCap *= 1.025; return 'Emergency generation comes online.'; } },
    ],
  },
  {
    id: 'border_incident', icon: '⚠', title: 'Border incident', weight: 1.1, cooldown: 80,
    eligible: (s, c, geo) => {
      const n = neighborsOf(s, geo, c.id).filter((x) => getRelation(s, c.id, x) < 25 && !areAtWar(s, c.id, x));
      return n.length ? { n: n[Math.floor(nextRand(s) * n.length)] } : null;
    },
    text: (s, _c, d) => `Troops from ${name(s, d.n)} clashed with your border guards. Casualties are reported on both sides.`,
    options: [
      { label: 'Formal protest', hint: 'Relations −4', apply: (s, c, d) => { addRelation(s, c.id, d.n, -4); return 'Your protest was lodged.'; } },
      { label: 'Reinforce the border', hint: 'Costs 0.2% of GDP · readiness +5% · relations −10', enabled: canPay(0.002), apply: (s, c, d) => { pay(s, c, 0.002); c.mil.readiness = clamp(c.mil.readiness + 0.05, 0, 1); addRelation(s, c.id, d.n, -10); stab(c, 1); return 'Units were rushed to the frontier.'; } },
      { label: 'Offer talks', hint: 'Relations +8 · stability −1', apply: (s, c, d) => { addRelation(s, c.id, d.n, 8); stab(c, -1); return 'De-escalation talks opened.'; } },
      { label: 'Retaliate — declare war', hint: 'War begins immediately', apply: (s, c, d, geo) => { const r = declareWar(s, geo, c.id, d.n); return r.ok ? `You declared war on ${name(s, d.n)}!` : (r.reason ?? 'Could not declare war'); } },
    ],
  },
  {
    id: 'tech', icon: '🔬', title: 'Research breakthrough', weight: 0.9, cooldown: 150,
    eligible: (_s, c) => (c.eco.tech > 20 ? {} : null),
    text: (_s, c) => `Researchers in ${c.name} have made a promising breakthrough and are asking for funding to commercialise it.`,
    options: [
      { label: 'Fund it fully', hint: 'Costs 1% of GDP · technology +4 · productivity +0.4%', enabled: canPay(0.01), apply: (s, c) => { pay(s, c, 0.01); c.eco.tech = clamp(c.eco.tech + 4, 0, 100); c.eco.tfp *= 1.004; c.mil.milTech += 1.5; return 'The breakthrough is in production.'; } },
      { label: 'License to industry', hint: 'Costs 0.3% of GDP · technology +1.5', enabled: canPay(0.003), apply: (s, c) => { pay(s, c, 0.003); c.eco.tech = clamp(c.eco.tech + 1.5, 0, 100); return 'Industry licenses the technology.'; } },
      { label: 'Let it go abroad', hint: 'Free · nothing happens', apply: () => 'Foreign firms snapped it up.' },
    ],
  },
  {
    id: 'disaster', icon: '🌊', title: 'Natural disaster', weight: 0.8, cooldown: 140,
    eligible: () => ({}),
    text: (_s, c) => `A devastating flood and earthquake swarm has struck ${c.name}. Roads and homes are destroyed.`,
    options: [
      { label: 'Full reconstruction', hint: 'Costs 2% of GDP · infrastructure +1', enabled: canPay(0.02), apply: (s, c) => { pay(s, c, 0.02); c.eco.infra = clamp(c.eco.infra + 1, 5, 100); stab(c, 2); return 'A full rebuilding programme begins.'; } },
      { label: 'Basic relief only', hint: 'Costs 0.8% of GDP · infrastructure −3 · stability −2', enabled: canPay(0.008), apply: (s, c) => { pay(s, c, 0.008); c.eco.infra = clamp(c.eco.infra - 3, 5, 100); stab(c, -2); return 'Relief reaches the worst-hit areas.'; } },
      { label: 'Appeal for foreign aid', hint: 'Gain 0.5% of GDP · stability −4 · reputation +2', apply: (_s, c) => { c.eco.cash += 0.005 * c.eco.gdp; stab(c, -4); rep(c, 2); c.eco.infra = clamp(c.eco.infra - 2, 5, 100); return 'Aid arrives from abroad.'; } },
    ],
  },
  {
    id: 'scandal', icon: '📰', title: 'Corruption scandal', weight: 0.9, cooldown: 120,
    eligible: (_s, c) => (c.eco.stability < 85 ? {} : null),
    text: (_s, c) => `Newspapers expose a corruption scandal reaching deep into the government of ${c.name}.`,
    options: [
      { label: 'Launch real reforms', hint: 'Costs 0.3% of GDP · stability +3 · tax collection +1pt', enabled: canPay(0.003), apply: (s, c) => { pay(s, c, 0.003); stab(c, 3); c.eco.collection = clamp(c.eco.collection + 0.01, 0.4, 0.98); return 'An anti-corruption drive begins.'; } },
      { label: 'Cover it up', hint: 'Stability −4 · reputation −5', apply: (_s, c) => { stab(c, -4); rep(c, -5); return 'The cover-up holds, for now.'; } },
      { label: 'Sacrifice a minister', hint: 'Stability +1, 30% chance of backlash (−6)', apply: (s, c) => { if (nextRand(s) < 0.3) { stab(c, -6); return 'The scapegoat talked. Backlash.'; } stab(c, 1); return 'The minister resigned; the story fades.'; } },
    ],
  },
  {
    id: 'investment', icon: '🏭', title: 'Foreign investment offer', weight: 1, cooldown: 100,
    eligible: (s, c) => { const p = partnersOf(s, c.id, 'trade'); return p.length ? { from: p[Math.floor(nextRand(s) * p.length)] } : null; },
    text: (s, c, d) => `${name(s, d.from)} is offering a large investment package in ${c.name}'s industry — with strings attached.`,
    options: [
      { label: 'Accept the package', hint: 'Industrial capital +1.5% · relations +5 · stability −1', apply: (s, c, d) => { c.eco.capital *= 1.015; addRelation(s, c.id, d.from, 5); stab(c, -1); return 'New factories open.'; } },
      { label: 'Negotiate better terms', hint: 'Capital +0.8% · relations −2', apply: (s, c, d) => { c.eco.capital *= 1.008; addRelation(s, c.id, d.from, -2); return 'A leaner deal was signed.'; } },
      { label: 'Decline', hint: 'Stability +1', apply: (_s, c) => { stab(c, 1); return 'You kept the economy in national hands.'; } },
    ],
  },
  {
    id: 'refugees', icon: '🚸', title: 'Refugee crisis', weight: 1, cooldown: 100,
    eligible: (s, c, geo) => { const n = neighborsOf(s, geo, c.id).find((x) => isAtWar(s, x)); return n !== undefined ? { n } : null; },
    text: (s, _c, d) => `War in ${name(s, d.n)} is driving thousands of refugees towards your border.`,
    options: [
      { label: 'Admit them', hint: 'Costs 0.3% of GDP · population +0.2% · reputation +5 · stability −3', enabled: canPay(0.003), apply: (s, c) => { pay(s, c, 0.003); c.eco.pop *= 1.002; rep(c, 5); stab(c, -3); return 'Refugees are admitted and housed.'; } },
      { label: 'Close the border', hint: 'Stability +2 · reputation −5', apply: (_s, c) => { stab(c, 2); rep(c, -5); return 'The border is sealed.'; } },
      { label: 'Fund camps abroad', hint: 'Costs 0.15% of GDP · reputation +2', enabled: canPay(0.0015), apply: (s, c) => { pay(s, c, 0.0015); rep(c, 2); return 'Camps are funded across the border.'; } },
    ],
  },
  {
    id: 'rates', icon: '🏦', title: 'Central bank decision', weight: 1.2, cooldown: 100,
    eligible: (_s, c) => (c.eco.inflation > 0.05 ? {} : null),
    text: (_s, c) => `Inflation in ${c.name} is running at ${(c.eco.inflation * 100).toFixed(1)}%. The central bank wants your backing for a rate decision.`,
    options: [
      { label: 'Raise interest rates', hint: 'Inflation −2pt · unemployment +0.6pt · stability −1', apply: (_s, c) => { c.eco.monetary = 0; c.eco.inflation = Math.max(0.02, c.eco.inflation - 0.02); c.eco.unemployment += 0.006; stab(c, -1); return 'Rates go up; inflation cools.'; } },
      { label: 'Hold steady', hint: 'Stability −1', apply: (_s, c) => { stab(c, -1); return 'No change; the public grumbles.'; } },
    ],
  },
  {
    id: 'coup_plot', icon: '🪖', title: 'Coup plot uncovered', weight: 1.4, cooldown: 120,
    eligible: (_s, c) => (c.eco.stability < 55 && c.gov !== 'D' ? {} : null),
    text: () => 'Intelligence reports that a group of senior officers is plotting to seize power.',
    options: [
      { label: 'Purge the officer corps', hint: 'Readiness −10% · stability +4 · reputation −3', apply: (_s, c) => { c.mil.readiness = clamp(c.mil.readiness - 0.1, 0.05, 1); stab(c, 4); rep(c, -3); return 'The plotters were arrested.'; } },
      { label: 'Buy their loyalty', hint: 'Costs 0.5% of GDP · stability +5', enabled: canPay(0.005), apply: (s, c) => { pay(s, c, 0.005); stab(c, 5); return 'Bonuses calm the barracks.'; } },
      { label: 'Open political reforms', hint: 'Stability +2 · reputation +3 · tax collection −1pt', apply: (_s, c) => { stab(c, 2); rep(c, 3); c.eco.collection = clamp(c.eco.collection - 0.01, 0.4, 0.98); return 'Concessions defuse the plot.'; } },
    ],
  },
  {
    id: 'trade_offer', icon: '🤝', title: 'Trade delegation', weight: 1.3, cooldown: 60,
    eligible: (s, c) => {
      const cand = s.countries.filter((x) => x.alive && x.id !== c.id && !areAtWar(s, x.id, c.id) && !s.treaties[c.id < x.id ? `${c.id}-${x.id}` : `${x.id}-${c.id}`]?.trade && getRelation(s, c.id, x.id) > -10 && x.eco.gdp > c.eco.gdp * 0.15);
      if (!cand.length) return null;
      cand.sort((a, b) => b.eco.gdp - a.eco.gdp);
      return { from: cand[Math.floor(nextRand(s) * Math.min(6, cand.length))].id };
    },
    text: (s, _c, d) => `A delegation from ${name(s, d.from)} proposes a trade agreement.`,
    options: [
      { label: 'Sign the agreement', hint: 'Trade boost for both economies · relations up', apply: (s, c, d) => { applyTreaty(s, c.id, d.from, 'trade'); return `Trade agreement signed with ${name(s, d.from)}.`; } },
      { label: 'Decline politely', hint: 'No change', apply: () => 'The delegation left empty-handed.' },
    ],
  },
  {
    id: 'arms_deal', icon: '💼', title: 'Arms export deal', weight: 0.7, cooldown: 150,
    eligible: (_s, c) => (c.mil.equipArmy > c.mil.troops * 80_000 ? {} : null),
    text: () => 'A foreign government wants to buy a large batch of your surplus military equipment.',
    options: [
      { label: 'Sell the weapons', hint: 'Gain 0.6% of GDP · readiness −4% · army equipment −3%', apply: (_s, c) => { c.eco.cash += 0.006 * c.eco.gdp; c.mil.readiness = clamp(c.mil.readiness - 0.04, 0.05, 1); c.mil.equipArmy *= 0.97; return `You earned ${money(c, 0.006)} from arms sales.`; } },
      { label: 'Refuse', hint: 'Reputation +1', apply: (_s, c) => { rep(c, 1); return 'You refused the deal.'; } },
    ],
  },
  {
    id: 'harvest', icon: '🌾', title: 'Harvest failure', weight: 0.8, cooldown: 140,
    eligible: () => ({}),
    text: (_s, c) => `Drought has ruined much of this year's harvest in ${c.name}.`,
    options: [
      { label: 'Emergency food imports', hint: 'Costs 0.6% of GDP', enabled: canPay(0.006), apply: (s, c) => { pay(s, c, 0.006); return 'Grain shipments arrive in time.'; } },
      { label: 'Ration supplies', hint: 'Stability −4 · food output −2%', apply: (_s, c) => { stab(c, -4); c.eco.foodCap *= 0.98; return 'Rationing begins.'; } },
      { label: 'Subsidise farmers', hint: 'Costs 0.4% of GDP · food capacity +1.5%', enabled: canPay(0.004), apply: (s, c) => { pay(s, c, 0.004); c.eco.foodCap *= 1.015; return 'Irrigation projects are funded.'; } },
    ],
  },
  {
    id: 'tax_demand', icon: '🗳', title: 'Opposition demands tax cuts', weight: 1, cooldown: 100,
    eligible: (_s, c) => (c.budget.taxVat > 0.12 ? {} : null),
    text: () => 'The opposition is campaigning loudly for lower consumption taxes.',
    options: [
      { label: 'Cut VAT by 2 points', hint: 'Stability +4 · revenue falls', apply: (_s, c) => { c.budget.taxVat = Math.max(0, c.budget.taxVat - 0.02); stab(c, 4); return 'VAT cut by two points.'; } },
      { label: 'Cut income tax by 1 point', hint: 'Stability +2', apply: (_s, c) => { c.budget.taxIncome = Math.max(0, c.budget.taxIncome - 0.01); stab(c, 2); return 'Income tax trimmed.'; } },
      { label: 'Refuse', hint: 'Stability −2', apply: (_s, c) => { stab(c, -2); return 'You held firm.'; } },
    ],
  },
  {
    id: 'ally_aid', icon: '🛡', title: 'Ally asks for help', weight: 1.1, cooldown: 90,
    eligible: (s, c) => { const a = alliesOf(s, c.id).find((x) => isAtWar(s, x)); return a !== undefined ? { a } : null; },
    text: (s, _c, d) => `${name(s, d.a)}, your ally, is at war and asks for arms and ammunition.`,
    options: [
      { label: 'Send equipment', hint: 'Costs 0.5% of GDP · relations +15 · reputation +2', enabled: canPay(0.005), apply: (s, c, d) => { pay(s, c, 0.005); addRelation(s, c.id, d.a, 15); s.countries[d.a].mil.equipArmy += 0.004 * c.eco.gdp; rep(c, 2); return 'A shipment of arms is on its way.'; } },
      { label: 'Decline', hint: 'Relations −8 · reputation −2', apply: (s, c, d) => { addRelation(s, c.id, d.a, -8); rep(c, -2); return 'Your ally was left disappointed.'; } },
    ],
  },
  {
    id: 'deposit', icon: '⛏', title: 'Major resource discovery', weight: 0.5, cooldown: 260,
    eligible: () => ({}),
    text: (_s, c) => `Surveyors have found huge energy and mineral deposits in ${c.name}.`,
    options: [
      { label: 'State-led development', hint: 'Costs 1% of GDP · energy capacity +6%', enabled: canPay(0.01), apply: (s, c) => { pay(s, c, 0.01); c.eco.energyCap *= 1.06; return 'State companies begin drilling.'; } },
      { label: 'Auction licences', hint: 'Gain 0.8% of GDP · energy capacity +3%', apply: (_s, c) => { c.eco.cash += 0.008 * c.eco.gdp; c.eco.energyCap *= 1.03; return `Licences raised ${money(c, 0.008)}.`; } },
    ],
  },
];

export function eventById(id: string) { return EVENTS.find((e) => e.id === id)!; }

/** Roll for a decision event for the player. Called every tick; paces itself. */
export function rollPlayerEvent(s: GameState, geo: Geo) {
  const c = s.countries[s.player];
  if (!c.alive || s.pendingEvent || s.victory) return;
  if (s.tick < 6 || s.tick - s.lastEventTick < 5 || s.tick % 2 !== 0) return;
  if (nextRand(s) > 0.26) return;
  const pool: { def: EventDef; d: D; w: number }[] = [];
  for (const def of EVENTS) {
    if ((s.eventCooldown[def.id] ?? -9999) + def.cooldown > s.tick) continue;
    const d = def.eligible(s, c, geo);
    if (d) pool.push({ def, d, w: def.weight });
  }
  if (!pool.length) return;
  let r = nextRand(s) * pool.reduce((t, x) => t + x.w, 0);
  let pick = pool[0];
  for (const x of pool) { r -= x.w; if (r <= 0) { pick = x; break; } }
  s.pendingEvent = { id: pick.def.id, tick: s.tick, data: pick.d };
  s.eventCooldown[pick.def.id] = s.tick;
  s.lastEventTick = s.tick;
}

export function resolveEvent(s: GameState, geo: Geo, option: number): { ok: boolean; message: string } {
  const pe = s.pendingEvent;
  if (!pe) return { ok: false, message: 'No decision pending' };
  const def = eventById(pe.id);
  const c = s.countries[s.player];
  const opt = def.options[option];
  if (!opt) return { ok: false, message: 'Unknown option' };
  if (opt.enabled && !opt.enabled(s, c)) return { ok: false, message: 'Cannot afford that option' };
  const msg = opt.apply(s, c, pe.data, geo);
  s.pendingEvent = null;
  logEvent(s, `${def.title}: ${msg}`, 'info', [s.player]);
  return { ok: true, message: msg };
}

// ------------------------------------------------------------------ world events (AI countries)
const WORLD: { id: string; w: number; run: (s: GameState, c: Country, geo: Geo) => string | null }[] = [
  { id: 'quake', w: 1, run: (_s, c) => { c.eco.damage = Math.min(1, c.eco.damage + 0.04); c.eco.infra = Math.max(5, c.eco.infra - 3); stab(c, -3); return `A major earthquake devastates ${c.name}`; } },
  { id: 'flood', w: 1, run: (_s, c) => { c.eco.foodCap *= 0.97; c.eco.damage = Math.min(1, c.eco.damage + 0.02); stab(c, -2); return `Severe floods hit ${c.name}, destroying crops and roads`; } },
  { id: 'strike', w: 1.4, run: (_s, c) => { stab(c, -5); return `Nationwide strikes paralyse ${c.name}`; } },
  { id: 'scandal', w: 1, run: (_s, c) => { stab(c, -4); return `Corruption scandal rocks the government of ${c.name}`; } },
  { id: 'boom', w: 1, run: (_s, c) => { c.eco.tfp *= 1.01; stab(c, 3); return `Tech boom lifts ${c.name}'s economy`; } },
  { id: 'deposit', w: 0.7, run: (_s, c) => { c.eco.energyCap *= 1.05; return `${c.name} announces a huge new energy discovery`; } },
  { id: 'coup', w: 0.5, run: (s, c, geo) => { if (c.eco.stability > 45 || c.gov === 'D') return null; c.eco.stability = 40; forcePeaceAll(s, geo, c.id); return `Military coup in ${c.name}: the government is overthrown`; } },
  { id: 'famine', w: 0.6, run: (_s, c) => { if (c.eco.gdp / c.eco.pop > 6000) return null; c.eco.foodCap *= 0.95; stab(c, -6); return `Drought and food shortages push ${c.name} towards famine`; } },
  { id: 'incident', w: 1.6, run: (s, c, geo) => {
    const n = neighborsOf(s, geo, c.id).filter((x) => getRelation(s, c.id, x) < 15 && !areAtWar(s, c.id, x));
    if (!n.length) return null;
    const o = n[Math.floor(nextRand(s) * n.length)];
    addRelation(s, c.id, o, -12);
    return `Border clashes between ${c.name} and ${s.countries[o].name} raise tensions`;
  } },
  { id: 'summit', w: 0.8, run: (s, c, geo) => {
    const n = neighborsOf(s, geo, c.id).filter((x) => getRelation(s, c.id, x) > -20 && !areAtWar(s, c.id, x));
    if (!n.length) return null;
    const o = n[Math.floor(nextRand(s) * n.length)];
    addRelation(s, c.id, o, 10);
    return `${c.name} and ${s.countries[o].name} hold a friendly summit`;
  } },
];

export function stepWorldEvents(s: GameState, geo: Geo) {
  if (s.tick % 2 !== 0 || nextRand(s) > 0.42) return;
  const alive = s.countries.filter((c) => c.alive && c.id !== s.player);
  // larger countries draw more headlines
  let r = nextRand(s) * alive.reduce((t, c) => t + Math.sqrt(c.eco.gdp), 0);
  let c = alive[0];
  for (const x of alive) { r -= Math.sqrt(x.eco.gdp); if (r <= 0) { c = x; break; } }
  const total = WORLD.reduce((t, e) => t + e.w, 0);
  let rr = nextRand(s) * total;
  let ev = WORLD[0];
  for (const e of WORLD) { rr -= e.w; if (rr <= 0) { ev = e; break; } }
  const text = ev.run(s, c, geo);
  if (text) logEvent(s, `${text}.`, 'info', [c.id], false);
}
