/**
 * Contextual events with teeth: a named rival that schemes against you, neighbours in turmoil, hostage
 * crises, separatists in your own provinces, military hawks, standoffs at sea. Each one is tied to real
 * countries and regions and changes the world, not just a number.
 */
import { nextRand } from './rng';
import { clamp } from './util';
import { logEvent } from './log';
import { type EventDef, type D, canPay, money, name, pay, rep, stab } from './eventkit';
import { addRelation, alliesOf, getRelation, isAtWar, partnersOf } from './relations';
import { applyTreaty, imposeSanction, neighborsOf } from './diplomacy';
import { canDeclareWar, declareWar } from './war';
import { runOp } from './ops';
import { levelOf, recount, setLevel } from './buildings';
import { canStart, startProject } from './projects';
import type { Country, GameState } from './types';
import type { Geo } from './geo';

const rival = (s: GameState): Country | null => (s.rival >= 0 && s.countries[s.rival]?.alive ? s.countries[s.rival] : null);
const pickOf = <T>(s: GameState, a: T[]): T => a[Math.floor(nextRand(s) * a.length)];
const provName = (geo: Geo, p: number) => geo.provinces[p]?.name || 'the region';

/** Give a hostile neighbour a reason to press harder if the player stays passive. */
function escalate(s: GameState, from: number, c: Country): string {
  addRelation(s, c.id, from, -10);
  if (nextRand(s) < 0.3 && !isAtWar(s, from)) { s.scheduled.push({ tick: s.tick + 2, id: 'ultimatum', data: { from, kind: nextRand(s) < 0.5 ? 1 : 2 } }); return `${name(s, from)} saw weakness and sent an ultimatum!`; }
  return `${name(s, from)} took your silence as weakness.`;
}

export const EVENTS3: EventDef[] = [
  // ------------------------------------------------------------------ the rival
  {
    id: 'rival_spies', icon: '🕵', title: 'Rival spy ring uncovered', weight: 1.3, cooldown: 140,
    eligible: (s) => { const r = rival(s); return r ? { o: r.id } : null; },
    text: (s, _c, d) => `Counter-intelligence has rounded up a spy ring run by ${name(s, d.o)}, your rival. The agents were mapping your power grid and your army bases.`,
    options: [
      { label: 'Expel their diplomats', hint: 'Relations −10 · stability +1 · public approval', apply: (s, c, d) => { addRelation(s, c.id, d.o, -10); stab(c, 1); return `${name(s, d.o)}'s embassy staff were sent home.`; } },
      { label: 'Turn the agents', hint: 'Costs 0.1% of GDP · you see their true strength for a year', enabled: canPay(0.001), apply: (s, c, d) => { pay(s, c, 0.001); s.intelUntil[d.o] = s.tick + 52; return `The turned agents now feed you ${name(s, d.o)}'s secrets.`; } },
      { label: 'Retaliate in kind', hint: 'Launches sabotage against them · may be exposed', apply: (s, c, d) => runOp(s, c.id, d.o, 'sabotage').message },
    ],
    lapse: (s, c, d) => { c.eco.infra = Math.max(5, c.eco.infra - 1); return `Their plans were stolen. ${escalate(s, d.o, c)}`; },
  },
  {
    id: 'rival_buildup', icon: '🪖', title: 'Rival masses troops on the border', weight: 1.4, cooldown: 150, ttl: 28,
    eligible: (s, c, geo) => { const r = rival(s); return r && neighborsOf(s, geo, c.id).includes(r.id) && getRelation(s, c.id, r.id) < 35 && !isAtWar(s, r.id) ? { o: r.id } : null; },
    text: (s, _c, d) => `Satellite photos show ${name(s, d.o)} moving armour and artillery up to your frontier. They call it an exercise. Your generals are not convinced.`,
    options: [
      { label: 'Fortify the border', hint: 'Costs 0.6% of GDP · +1 fortress level in up to 4 border regions facing them', enabled: canPay(0.006), apply: (s, c, d, geo) => {
        pay(s, c, 0.006);
        const facing = c.provinces.filter((p) => geo.adj[p].some((q) => s.owner[q] === d.o)).slice(0, 4);
        for (const p of facing) setLevel(s, p, 'fort', levelOf(s, p, 'fort') + 1);
        recount(s, [c.id]);
        return `${facing.length} border regions were reinforced.`;
      } },
      { label: 'Mobilise reserves', hint: 'Costs 0.3% of GDP · readiness +8% · stability −1', enabled: canPay(0.003), apply: (s, c) => { pay(s, c, 0.003); c.mil.readiness = clamp(c.mil.readiness + 0.08, 0, 1); stab(c, -1); return 'Reservists are called up.'; } },
      { label: 'Open the hotline', hint: 'Relations +8 · 50% chance they pull back', apply: (s, c, d) => { addRelation(s, c.id, d.o, 8); return nextRand(s) < 0.5 ? `${name(s, d.o)} withdrew its forces. Crisis over.` : `${name(s, d.o)} stayed put but talks continue.`; } },
    ],
    lapse: (s, c, d) => escalate(s, d.o, c),
  },
  {
    id: 'rival_prestige', icon: '🏆', title: 'Rival grabs the headlines', weight: 1, cooldown: 160,
    eligible: (s, c) => { const r = rival(s); return r && r.eco.gdp > c.eco.gdp * 0.4 && (r.mil.nuclear || r.eco.tech > c.eco.tech) ? { o: r.id } : null; },
    text: (s, _c, d) => `${name(s, d.o)} is celebrating a national triumph and the whole world is watching. Back home, newspapers ask why your country is falling behind.`,
    options: [
      { label: 'Answer with a national project', hint: 'Starts the best megaproject you can currently run', apply: (s, c) => {
        for (const id of ['space', 'ai', 'carriers', 'cyber', 'education', 'rail']) if (!canStart(s, c.id, id)) { stab(c, 2); return startProject(s, c.id, id).message; }
        return 'You had nothing to launch right now.';
      } },
      { label: 'Patriotic parade', hint: 'Costs 0.3% of GDP · stability +4', enabled: canPay(0.003), apply: (s, c) => { pay(s, c, 0.003); stab(c, 4); return 'Flags and fireworks lift national mood.'; } },
      { label: 'Ignore it', hint: 'Stability −2', apply: (_s, c) => { stab(c, -2); return 'You shrugged it off. The press did not.'; } },
    ],
    lapse: (_s, c) => { stab(c, -2); return 'The public noticed.'; },
  },
  {
    id: 'rival_courts_ally', icon: '🤝', title: 'Rival courts your ally', weight: 1, cooldown: 140,
    eligible: (s, c) => { const r = rival(s); const a = r ? alliesOf(s, c.id).find((x) => x !== r.id && getRelation(s, x, r.id) > -20) : undefined; return r && a !== undefined ? { o: r.id, a } : null; },
    text: (s, _c, d) => `${name(s, d.o)} has invited your ally ${name(s, d.a)} to a lavish state visit and is offering cheap loans. ${name(s, d.a)} is wavering.`,
    options: [
      { label: 'Counter with an aid package', hint: 'Costs 0.3% of GDP · ally relations +14 · rival relations with them −6', enabled: canPay(0.003), apply: (s, c, d) => { pay(s, c, 0.003); addRelation(s, c.id, d.a, 14); addRelation(s, d.o, d.a, -6); return `${name(s, d.a)} remembers who its friends are.`; } },
      { label: 'Invite them to a summit', hint: 'Free · ally relations +8', apply: (s, c, d) => { addRelation(s, c.id, d.a, 8); return `You hosted ${name(s, d.a)}'s leaders.`; } },
      { label: 'Let it play out', hint: 'Ally relations −6 · rival gains +8', apply: (s, c, d) => { addRelation(s, c.id, d.a, -6); addRelation(s, d.o, d.a, 8); return `${name(s, d.a)} drifted toward ${name(s, d.o)}.`; } },
    ],
    lapse: (s, c, d) => { addRelation(s, c.id, d.a, -8); addRelation(s, d.o, d.a, 8); return `${name(s, d.a)} drifted toward ${name(s, d.o)}.`; },
  },
  {
    id: 'rival_sabotage', icon: '💥', title: 'Mysterious blast at a power plant', weight: 1, cooldown: 170,
    eligible: (s) => { const r = rival(s); return r && getRelation(s, s.player, r.id) < 15 ? { o: r.id } : null; },
    text: (s, _c, d) => `An explosion has knocked out a major power plant. Investigators found traces pointing to ${name(s, d.o)}. Nobody has claimed responsibility.`,
    options: [
      { label: 'Publicly blame them', hint: 'Relations −12 · stability +2 (nationalism) · reputation +1', apply: (s, c, d) => { addRelation(s, c.id, d.o, -12); stab(c, 2); rep(c, 1); return `You pointed the finger at ${name(s, d.o)}.`; } },
      { label: 'Investigate quietly', hint: 'Costs 0.1% of GDP · 60% to find proof: rival reputation falls', enabled: canPay(0.001), apply: (s, c, d) => {
        pay(s, c, 0.001);
        if (nextRand(s) < 0.6) { const R = s.countries[d.o]; R.reputation = clamp(R.reputation - 8, 0, 100); imposeSanction(s, c.id, d.o, 1); return `Proof leaked. ${R.name}'s reputation plunged and you imposed sanctions.`; }
        return 'Investigators found nothing conclusive.';
      } },
      { label: 'Repair and move on', hint: 'Costs 0.2% of GDP · infrastructure restored', enabled: canPay(0.002), apply: (s, c) => { pay(s, c, 0.002); return 'Engineers restored power within weeks.'; } },
    ],
    lapse: (_s, c) => { c.eco.infra = Math.max(5, c.eco.infra - 2); stab(c, -1); return 'Blackouts dragged on for weeks.'; },
  },
  {
    id: 'rival_summit', icon: '🕊', title: 'Rival offers talks', weight: 0.9, cooldown: 180,
    eligible: (s, c) => { const r = rival(s); return r && getRelation(s, c.id, r.id) < 5 && !isAtWar(s, r.id) ? { o: r.id } : null; },
    text: (s, _c, d) => `Out of the blue, ${name(s, d.o)} proposes a summit to "reset relations". Your advisers are split on whether it is sincere.`,
    options: [
      { label: 'Accept in good faith', hint: 'Relations +15 · trade agreement · reputation +2', apply: (s, c, d) => { addRelation(s, c.id, d.o, 15); rep(c, 2); applyTreaty(s, c.id, d.o, 'trade', true); return `You and ${name(s, d.o)} agreed to trade freely.`; } },
      { label: 'Demand concessions first', hint: '50%: they pay 0.5% of your GDP and relations +5 · else relations −12', apply: (s, c, d) => { if (nextRand(s) < 0.5) { c.eco.cash += 0.005 * c.eco.gdp; addRelation(s, c.id, d.o, 5); return `${name(s, d.o)} agreed to a payment of ${money(c, 0.005)}.`; } addRelation(s, c.id, d.o, -12); return 'They walked out of the talks.'; } },
      { label: 'Refuse', hint: 'Relations −3', apply: (s, c, d) => { addRelation(s, c.id, d.o, -3); return 'You turned the offer down.'; } },
    ],
  },

  // ------------------------------------------------------------------ neighbours in turmoil
  {
    id: 'neighbor_collapse', icon: '🔥', title: 'A neighbour is falling apart', weight: 1.5, cooldown: 120,
    eligible: (s, c, geo) => { const n = neighborsOf(s, geo, c.id).filter((x) => s.countries[x].eco.stability < 30 && s.countries[x].alive && !isAtWar(s, x)).sort((a, b) => s.countries[a].eco.stability - s.countries[b].eco.stability)[0]; return n !== undefined ? { o: n } : null; },
    text: (s, _c, d) => `The government of ${name(s, d.o)} is on the brink as unrest sweeps the country. Whoever is on the ground now will shape what comes next.`,
    options: [
      { label: 'Back the government', hint: 'Costs 0.4% of GDP · their stability +8 · relations +20', enabled: canPay(0.004), apply: (s, c, d) => { pay(s, c, 0.004); s.countries[d.o].eco.stability = clamp(s.countries[d.o].eco.stability + 8, 0, 100); addRelation(s, c.id, d.o, 20); return `Your support steadied ${name(s, d.o)}.`; } },
      { label: 'Back the opposition', hint: 'Covert · their stability −9 · relations fall if exposed', apply: (s, c, d) => runOp(s, c.id, d.o, 'unrest').message },
      { label: 'Send troops to "restore order"', hint: 'Declares war · reputation −8', enabled: (s, c) => c.mil.troops > 20000, apply: (s, c, d, geo) => { const r = declareWar(s, geo, c.id, d.o); rep(c, -8); return r.ok ? `Your army crossed the border into ${name(s, d.o)}!` : `Could not intervene: ${r.reason}`; } },
      { label: 'Stay out', hint: 'Nothing happens', apply: () => 'You watched from a distance.' },
    ],
  },
  {
    id: 'neighbor_hunger', icon: '🍞', title: 'Neighbour begs for food', weight: 1, cooldown: 140,
    eligible: (s, c, geo) => { const n = neighborsOf(s, geo, c.id).find((x) => s.countries[x].eco.foodUnmet > 0.08 && s.countries[x].alive); return n !== undefined && c.eco.foodCap > c.eco.foodDemand * 1.0 ? { o: n } : null; },
    text: (s, _c, d) => `${name(s, d.o)} is short of food and asks you for grain. Your own silos are full enough to help.`,
    options: [
      { label: 'Send food aid', hint: 'Costs 0.3% of GDP · relations +25 · reputation +3', enabled: canPay(0.003), apply: (s, c, d) => { pay(s, c, 0.003); addRelation(s, c.id, d.o, 25); rep(c, 3); s.countries[d.o].eco.stability = clamp(s.countries[d.o].eco.stability + 4, 0, 100); return `Convoys of grain rolled into ${name(s, d.o)}.`; } },
      { label: 'Sell at a profit', hint: 'Gain 0.15% of GDP · relations +5', apply: (s, c, d) => { c.eco.cash += 0.0015 * c.eco.gdp; addRelation(s, c.id, d.o, 5); return `You sold grain for ${money(c, 0.0015)}.`; } },
      { label: 'Refuse', hint: 'Relations −5', apply: (s, c, d) => { addRelation(s, c.id, d.o, -5); return 'You kept your grain.'; } },
    ],
  },
  {
    id: 'hostage_crisis', icon: '⛓', title: 'Citizens taken hostage', weight: 1.1, cooldown: 200, ttl: 30,
    eligible: (s, c, geo) => { const n = neighborsOf(s, geo, c.id).concat([s.rival]).filter((x) => x >= 0 && s.countries[x]?.alive && getRelation(s, c.id, x) < 10 && !isAtWar(s, x)); return n.length ? { o: pickOf(s, n) } : null; },
    text: (s, _c, d) => `A group of your citizens has been detained in ${name(s, d.o)} on trumped-up charges. Their families are on every news channel and the public wants action.`,
    options: [
      { label: 'Pay a quiet ransom', hint: 'Costs 1% of GDP · stability +3 · reputation −2', enabled: canPay(0.01), apply: (s, c) => { pay(s, c, 0.01); stab(c, 3); rep(c, -2); return 'The hostages came home.'; } },
      { label: 'Send in a commando team', hint: 'Success depends on military tech and intelligence · failure sours relations', apply: (s, c, d) => {
        const p = clamp(0.3 + c.mil.milTech / 220 + (c.mil.intel - s.countries[d.o].mil.intel) * 0.4, 0.15, 0.85);
        if (nextRand(s) < p) { stab(c, 8); rep(c, 2); return 'A daring raid freed every hostage. The nation erupts in celebration.'; }
        addRelation(s, c.id, d.o, -15); stab(c, -4); c.mil.readiness = clamp(c.mil.readiness - 0.03, 0, 1); return 'The raid failed. Casualties and humiliation.';
      } },
      { label: 'Impose sanctions', hint: 'Relations −10 · they lose trade', apply: (s, c, d) => { imposeSanction(s, c.id, d.o, 1); addRelation(s, c.id, d.o, -10); return `Sanctions on ${name(s, d.o)} are in force.`; } },
    ],
    lapse: (_s, c) => { stab(c, -4); rep(c, -2); return 'The hostage families blamed the government.'; },
  },
  {
    id: 'airspace_incident', icon: '✈', title: 'Airspace violation', weight: 1.2, cooldown: 110,
    eligible: (s, c, geo) => { const n = neighborsOf(s, geo, c.id).filter((x) => getRelation(s, c.id, x) < 30 && !isAtWar(s, x) && s.countries[x].alive); return n.length ? { o: pickOf(s, n) } : null; },
    text: (s, _c, d) => `Fighter jets from ${name(s, d.o)} have crossed deep into your airspace. Air defence asks for orders.`,
    options: [
      { label: 'Scramble jets and warn them off', hint: 'Relations −5 · stability +1', apply: (s, c, d) => { addRelation(s, c.id, d.o, -5); stab(c, 1); return 'Your jets escorted theirs out.'; } },
      { label: 'Shoot one down', hint: 'Relations −20 · stability +4 · 30% they retaliate', apply: (s, c, d) => { addRelation(s, c.id, d.o, -20); stab(c, 4); return nextRand(s) < 0.3 ? escalate(s, d.o, c) : 'The message was received.'; } },
      { label: 'File a formal protest', hint: 'Relations −2 · reputation +1', apply: (s, c, d) => { addRelation(s, c.id, d.o, -2); rep(c, 1); return 'A strongly worded note was delivered.'; } },
    ],
  },
  {
    id: 'naval_standoff', icon: '⚓', title: 'Standoff at sea', weight: 1.1, cooldown: 170,
    eligible: (s, c, geo) => { const n = neighborsOf(s, geo, c.id).filter((x) => getRelation(s, c.id, x) < 25 && !isAtWar(s, x) && s.countries[x].alive && s.countries[x].mil.equipNavy > 0); return c.mil.equipNavy > 0 && n.length ? { o: pickOf(s, n) } : null; },
    text: (s, _c, d) => `Warships of ${name(s, d.o)} and your own fleet are circling each other over a disputed gas field. One wrong move and shots will be fired.`,
    options: [
      { label: 'Hold the line with the fleet', hint: 'Relations −10 · 50%: you win the field (+3% energy) · else reputation −3', apply: (s, c, d) => { addRelation(s, c.id, d.o, -10); const win = c.mil.equipNavy * (1 + c.mil.milTech / 100) > s.countries[d.o].mil.equipNavy * (0.8 + s.countries[d.o].mil.milTech / 100) * (0.7 + nextRand(s) * 0.6); if (win) { c.eco.energyCap *= 1.03; stab(c, 3); return `${name(s, d.o)}'s ships backed off. The gas field is yours.`; } rep(c, -3); return 'Your fleet had to withdraw.'; } },
      { label: 'Joint development deal', hint: 'Relations +10 · energy +1.5% · trade agreement', apply: (s, c, d) => { addRelation(s, c.id, d.o, 10); c.eco.energyCap *= 1.015; applyTreaty(s, c.id, d.o, 'trade', true); return `You agreed to share the field with ${name(s, d.o)}.`; } },
      { label: 'Take it to the Assembly', hint: 'Reputation +3 · relations −2', apply: (s, c, d) => { rep(c, 3); addRelation(s, c.id, d.o, -2); return 'The case was filed. It will take years.'; } },
    ],
  },

  // ------------------------------------------------------------------ home front
  {
    id: 'separatists', icon: '🏴', title: 'Separatists rally', weight: 1.5, cooldown: 130,
    eligible: (s, c) => {
      const occ = c.provinces.filter((p) => s.core[p] !== c.id && s.integ[p] < 0.85 && p !== c.capital);
      const pool = occ.length ? occ : c.provinces.filter((p) => p !== c.capital && c.eco.stability < 55);
      return pool.length ? { p: pickOf(s, pool) } : null;
    },
    text: (s, _c, d) => `Thousands march in the streets of ${provName(geoRef(s), d.p)}, demanding autonomy or independence. Flags are burning and police are overwhelmed.`,
    options: [
      { label: 'Grant autonomy', hint: 'Integration +25% · stability +2 · some revenue lost', apply: (s, c, d) => { s.integ[d.p] = clamp(s.integ[d.p] + 0.25, 0, 1); stab(c, 2); c.eco.cash -= 0.001 * c.eco.gdp; return 'Local self-government calmed the region.'; } },
      { label: 'Crack down', hint: 'Integration +15% · stability −4 · reputation −4', apply: (s, c, d) => { s.integ[d.p] = clamp(s.integ[d.p] + 0.15, 0, 1); stab(c, -4); rep(c, -4); return 'Riot police cleared the streets.'; } },
      { label: 'Invest in the region', hint: 'Costs 0.6% of GDP · integration +35% · stability +3', enabled: canPay(0.006), apply: (s, c, d) => { pay(s, c, 0.006); s.integ[d.p] = clamp(s.integ[d.p] + 0.35, 0, 1); stab(c, 3); return 'New schools and roads won over many.'; } },
    ],
    lapse: (s, c, d) => { s.integ[d.p] = clamp(s.integ[d.p] - 0.1, 0, 1); stab(c, -2); return 'The movement grew bolder.'; },
  },
  {
    id: 'oil_province', icon: '🛢', title: 'Oil strike in the provinces', weight: 0.8, cooldown: 240,
    eligible: (s, c) => (c.provinces.length >= 2 ? { p: pickOf(s, c.provinces) } : null),
    text: (s, _c, d) => `Drillers in ${provName(geoRef(s), d.p)} have struck oil. The region could become the country's new economic engine, if you can fund it.`,
    options: [
      { label: 'State-led development', hint: 'Costs 0.8% of GDP · energy +5%', enabled: canPay(0.008), apply: (s, c) => { pay(s, c, 0.008); c.eco.energyCap *= 1.05; return 'State rigs went up across the region.'; } },
      { label: 'Invite a foreign consortium', hint: 'Gain 0.6% of GDP · energy +2% · relations with a major power +8', apply: (s, c) => { c.eco.cash += 0.006 * c.eco.gdp; c.eco.energyCap *= 1.02; const o = s.countries.filter((x) => x.alive && x.id !== c.id).sort((a, b) => b.eco.gdp - a.eco.gdp)[Math.floor(nextRand(s) * 5)]; addRelation(s, c.id, o.id, 8); return `A ${o.name}-led consortium won the licence.`; } },
    ],
  },
  {
    id: 'generals_hawks', icon: '🎖', title: 'Generals demand action', weight: 1.2, cooldown: 160,
    eligible: (s, c) => { const r = rival(s); const targets = s.countries.filter((o) => o.alive && o.id !== c.id && getRelation(s, c.id, o.id) < -20 && !isAtWar(s, o.id)); const o = r && getRelation(s, c.id, r.id) < 0 ? r : targets[0]; return o && c.mil.troops > 20000 ? { o: o.id } : null; },
    text: (s, _c, d) => `Your top generals tell the cabinet that ${name(s, d.o)} is weak and that a short, decisive campaign would settle the old score. The hawks in parliament agree.`,
    options: [
      { label: 'Declare war', hint: `Take the initiative · reputation and relations suffer`, enabled: (s, c) => { const d = s.inbox.find((x) => x.id === 'generals_hawks'); return d ? canDeclareWar(s, c.id, d.data.o).ok : false; }, apply: (s, c, d, geo) => { const r = declareWar(s, geo, c.id, d.o); return r.ok ? `You declared war on ${name(s, d.o)}!` : `Could not declare war: ${r.reason}`; } },
      { label: 'Boost the defence budget', hint: 'Costs 0.5% of GDP · army equipment up · stability +2', enabled: canPay(0.005), apply: (s, c) => { pay(s, c, 0.005); c.mil.equipArmy += 0.004 * c.eco.gdp; stab(c, 2); return 'The generals got their new tanks.'; } },
      { label: 'Rein them in', hint: 'Readiness −5% · stability −2', apply: (_s, c) => { c.mil.readiness = clamp(c.mil.readiness - 0.05, 0, 1); stab(c, -2); return 'The army grumbled but obeyed.'; } },
    ],
    lapse: (_s, c) => { c.mil.readiness = clamp(c.mil.readiness - 0.03, 0, 1); return 'The generals sulked.'; },
  },
  {
    id: 'mutiny', icon: '🚩', title: 'Troops on the verge of mutiny', weight: 1.4, cooldown: 120, urgent: true, ttl: 12,
    eligible: (s, c) => (isAtWar(s, c.id) && c.mil.exhaustion > 0.45 ? {} : null),
    text: () => 'Months of fighting and losses have left your soldiers exhausted. Whole units are refusing orders and desertions are climbing.',
    options: [
      { label: 'Pay a war bonus', hint: 'Costs 0.4% of GDP · exhaustion −0.12 · readiness +6%', enabled: canPay(0.004), apply: (s, c) => { pay(s, c, 0.004); c.mil.exhaustion = clamp(c.mil.exhaustion - 0.12, 0, 1); c.mil.readiness = clamp(c.mil.readiness + 0.06, 0, 1); return 'The bonus restored morale, for now.'; } },
      { label: 'Court-martial the ringleaders', hint: 'Stability −4 · reputation −3 · exhaustion −0.05', apply: (_s, c) => { stab(c, -4); rep(c, -3); c.mil.exhaustion = clamp(c.mil.exhaustion - 0.05, 0, 1); return 'Discipline was restored by force.'; } },
      { label: 'Rotate units to rest', hint: 'Readiness −6% · exhaustion −0.1', apply: (_s, c) => { c.mil.readiness = clamp(c.mil.readiness - 0.06, 0, 1); c.mil.exhaustion = clamp(c.mil.exhaustion - 0.1, 0, 1); return 'Exhausted units were pulled back from the front.'; } },
    ],
    lapse: (_s, c) => { c.mil.readiness = clamp(c.mil.readiness - 0.08, 0, 1); c.mil.exhaustion = clamp(c.mil.exhaustion + 0.05, 0, 1); return 'Units deserted en masse.'; },
  },
  {
    id: 'mercenaries', icon: '🪖', title: 'Private army for hire', weight: 1, cooldown: 140,
    eligible: (s, c) => (isAtWar(s, c.id) ? {} : null),
    text: () => 'A private military company, famous for its brutal efficiency, offers you a contract. They are expensive, deniable and entirely without scruples.',
    options: [
      { label: 'Hire them', hint: 'Costs 0.4% of GDP · +3% troops · readiness +5% · reputation −4', enabled: canPay(0.004), apply: (s, c) => { pay(s, c, 0.004); c.mil.troops *= 1.03; c.mil.readiness = clamp(c.mil.readiness + 0.05, 0, 1); rep(c, -4); return 'Contractors joined the front.'; } },
      { label: 'Decline', hint: 'Nothing happens', apply: () => 'You turned them away.' },
    ],
  },
  {
    id: 'allied_exercise', icon: '🎯', title: 'Joint war games', weight: 1, cooldown: 150,
    eligible: (s, c) => { const a = alliesOf(s, c.id).filter((x) => s.countries[x].alive && !isAtWar(s, x)); return a.length ? { a: pickOf(s, a) } : null; },
    text: (s, _c, d) => `${name(s, d.a)} proposes a major joint exercise. It would sharpen both armies and send a message to your rivals.`,
    options: [
      { label: 'Host the exercise', hint: 'Costs 0.2% of GDP · readiness +5% · military tech +1 · ally relations +10', enabled: canPay(0.002), apply: (s, c, d) => { pay(s, c, 0.002); c.mil.readiness = clamp(c.mil.readiness + 0.05, 0, 1); c.mil.milTech += 1; addRelation(s, c.id, d.a, 10); const r = rival(s); if (r) addRelation(s, c.id, r.id, -4); return 'Thousands of troops trained together.'; } },
      { label: 'Send a token force', hint: 'Costs 0.05% of GDP · ally relations +4', enabled: canPay(0.0005), apply: (s, c, d) => { pay(s, c, 0.0005); addRelation(s, c.id, d.a, 4); return 'A small contingent took part.'; } },
      { label: 'Decline politely', hint: 'Ally relations −3', apply: (s, c, d) => { addRelation(s, c.id, d.a, -3); return 'Your ally was a little disappointed.'; } },
    ],
  },
  {
    id: 'tech_licence', icon: '📡', title: 'Foreign firm offers technology', weight: 1, cooldown: 190,
    eligible: (s, c) => { const o = s.countries.filter((x) => x.alive && x.id !== c.id && x.eco.tech > c.eco.tech + 8 && getRelation(s, c.id, x.id) > 0 && !isAtWar(s, x.id)).sort((a, b) => getRelation(s, c.id, b.id) - getRelation(s, c.id, a.id))[0]; return o ? { o: o.id } : null; },
    text: (s, _c, d) => `Industry leaders from ${name(s, d.o)} are offering a licensing deal for their most advanced production methods. It is not cheap.`,
    options: [
      { label: 'Buy the licence', hint: 'Costs 0.8% of GDP · technology +3 · relations +10', enabled: canPay(0.008), apply: (s, c, d) => { pay(s, c, 0.008); c.eco.tech = clamp(c.eco.tech + 3, 0, 100); addRelation(s, c.id, d.o, 10); return 'New factories came online with imported know-how.'; } },
      { label: 'Steal it instead', hint: 'Covert operation · may be exposed', apply: (s, c, d) => runOp(s, c.id, d.o, 'steal').message },
      { label: 'Decline', hint: 'Nothing happens', apply: () => 'You passed.' },
    ],
  },
  {
    id: 'free_zone', icon: '🏭', title: 'Border trade zone proposed', weight: 1, cooldown: 190,
    eligible: (s, c, geo) => { const n = neighborsOf(s, geo, c.id).filter((x) => s.countries[x].alive && getRelation(s, c.id, x) > 10 && !partnersOf(s, c.id, 'trade').includes(x)); return n.length ? { o: pickOf(s, n) } : null; },
    text: (s, _c, d) => `${name(s, d.o)} proposes a joint free-trade zone along your common border. Local businesses are keen; unions are nervous.`,
    options: [
      { label: 'Sign the agreement', hint: 'Costs 0.2% of GDP · trade agreement · relations +8', enabled: canPay(0.002), apply: (s, c, d) => { pay(s, c, 0.002); applyTreaty(s, c.id, d.o, 'trade', true); addRelation(s, c.id, d.o, 8); return `Trade with ${name(s, d.o)} is now duty-free.`; } },
      { label: 'Stall for better terms', hint: 'Relations −2', apply: (s, c, d) => { addRelation(s, c.id, d.o, -2); return 'Talks dragged on.'; } },
    ],
  },
  {
    id: 'world_cup', icon: '⚽', title: 'National team wins the world cup', weight: 0.7, cooldown: 300,
    eligible: (_s, c) => (c.eco.stability < 90 ? {} : null),
    text: (_s, c) => `${c.name} has won the world cup! Millions are dancing in the streets and the president wants to capitalise on the mood.`,
    options: [
      { label: 'Declare a national holiday', hint: 'Costs 0.1% of GDP · stability +6', enabled: canPay(0.001), apply: (s, c) => { pay(s, c, 0.001); stab(c, 6); return 'The country partied for three days.'; } },
      { label: 'Cash in on tourism', hint: 'Gain 0.25% of GDP · stability +2', apply: (_s, c) => { c.eco.cash += 0.0025 * c.eco.gdp; stab(c, 2); return `Visitors spent ${money(c, 0.0025)}.`; } },
    ],
  },
  {
    id: 'cyber_blackout', icon: '🖥', title: 'Cyberattack on banks', weight: 1, cooldown: 150,
    eligible: (s, c) => (c.eco.tech > 25 && s.tick > 40 ? {} : null),
    text: () => 'Hackers have frozen the banking system. Cash machines are dead, shops accept nothing but notes, and nobody knows who is behind it.',
    options: [
      { label: 'Emergency response team', hint: 'Costs 0.25% of GDP · restored in days', enabled: canPay(0.0025), apply: (s, c) => { pay(s, c, 0.0025); return 'Engineers rebuilt the systems quickly.'; } },
      { label: 'Blame a rival', hint: 'Relations with your rival −10 · stability +1', apply: (s, c) => { const r = rival(s); if (r) addRelation(s, c.id, r.id, -10); stab(c, 1); return r ? `You accused ${r.name}.` : 'You accused unknown actors.'; } },
      { label: 'Wait it out', hint: 'GDP and stability take a hit', apply: (_s, c) => { stab(c, -3); c.eco.tfp *= 0.998; return 'The economy limped on for weeks.'; } },
    ],
  },
];

import { geoRefGet } from './geoRef';
function geoRef(_s: GameState): Geo { return geoRefGet(); }
void logEvent;
