/**
 * Situational events: they only appear when the world state calls for them, name the real countries
 * involved, and their outcomes change relations, treaties, wars and territory — not just numbers.
 */
import { nextRand } from './rng';
import { clamp } from './util';
import { type EventDef, canPay, money, name, pay, rep, stab, type D } from './eventkit';
import {
  addRelation, alliesOf, areAtWar, enemiesOf, getRelation, isAtWar, partnersOf, sanctionLevel, warsOf,
} from './relations';
import { applyTreaty, imposeSanction, neighborsOf } from './diplomacy';
import { declareWar, makePeace, transferProvince, logEvent } from './war';
import { computeBlocs, finalizeResolution, tally } from './politics';
import { strength } from './military';
import type { GameState } from './types';

const top = (s: GameState, n: number) => [...s.countries].filter((c) => c.alive).sort((a, b) => b.eco.gdp - a.eco.gdp).slice(0, n);
const pick = <T>(s: GameState, a: T[]): T => a[Math.floor(nextRand(s) * a.length)];

export const EVENTS2: EventDef[] = [
  // ---------------------------------------------------------------- alliance & war
  {
    id: 'ally_attacked', icon: '🛡', title: 'Your ally is under attack', weight: 0, cooldown: 0,
    eligible: () => null,
    text: (s, _c, d) => `${name(s, d.aggressor)} has attacked your ally ${name(s, d.ally)}. Under your alliance you are expected to respond, and the whole world is watching what you do.`,
    options: [
      { label: 'Honour the alliance: join the war', hint: 'You enter the war on their side · relations with the ally +15 · reputation +3', apply: (s, c, d) => {
        const w = s.wars.find((x) => x.id === d.war);
        if (!w) return 'The war ended before you could act.';
        if (!w.defenders.includes(c.id) && !w.attackers.includes(c.id)) { w.defenders.push(c.id); w.startProvs[c.id] = c.provinces.length; }
        addRelation(s, c.id, d.ally, 15); addRelation(s, c.id, d.aggressor, -30); rep(c, 3);
        logEvent(s, `${c.name} joins the war on ${name(s, d.ally)}'s side against ${name(s, d.aggressor)}.`, 'war', [c.id, d.ally, d.aggressor], true);
        return `You joined the war against ${name(s, d.aggressor)}.`;
      } },
      { label: 'Send arms and diplomatic support', hint: 'Costs 0.5% of GDP · ally relations +10 · aggressor relations −10', enabled: canPay(0.005), apply: (s, c, d) => {
        pay(s, c, 0.005); addRelation(s, c.id, d.ally, 10); addRelation(s, c.id, d.aggressor, -10);
        s.countries[d.ally].mil.equipArmy += 0.004 * c.eco.gdp; return 'Shipments of arms reach your ally.';
      } },
      { label: 'Call for mediation', hint: 'Reputation +2 · relations with both sides +2', apply: (s, c, d) => { rep(c, 2); addRelation(s, c.id, d.ally, 2); addRelation(s, c.id, d.aggressor, 2); return 'You called for talks. Few listened.'; } },
      { label: 'Stay out of it', hint: 'Reputation −10 · ally relations −25 · they may cancel the alliance', apply: (s, c, d) => {
        rep(c, -10); addRelation(s, c.id, d.ally, -25);
        if (nextRand(s) < 0.3) { const t = s.treaties[c.id < d.ally ? `${c.id}-${d.ally}` : `${d.ally}-${c.id}`]; if (t) t.alliance = false; return `${name(s, d.ally)} cancelled the alliance, calling you an unreliable partner.`; }
        return `${name(s, d.ally)} will remember that you stood aside.`;
      } },
    ],
  },
  {
    id: 'ultimatum', icon: '📜', title: 'Ultimatum', weight: 0, cooldown: 0,
    eligible: () => null,
    text: (s, c, d) => d.kind === 1
      ? `${name(s, d.from)} demands that ${c.name} hand over a border region within days, or face war. Its army is massing on the frontier.`
      : `${name(s, d.from)} demands a "security payment" of 1.5% of GDP from ${c.name}, or face war. Its army is on high alert.`,
    options: [
      { label: 'Concede to the demand', hint: 'Avoid war · stability −6 · reputation −4', apply: (s, c, d, geo) => {
        if (d.kind === 1) {
          const from = new Set(s.countries[d.from].provinces);
          const cand = c.provinces.filter((p) => p !== c.capital && geo.adj[p].some((q) => from.has(q))).sort((a, b) => geo.provinces[a].w - geo.provinces[b].w)[0];
          if (cand === undefined) return 'There was no region they could reach; the demand lapsed.';
          const nm = geo.provinces[cand].name;
          transferProvince(s, geo, cand, d.from);
          stab(c, -6); rep(c, -4); addRelation(s, c.id, d.from, 10);
          return `${nm} was ceded to ${name(s, d.from)}.`;
        }
        pay(s, c, 0.015); stab(c, -3); rep(c, -2); addRelation(s, c.id, d.from, 8); return 'The payment was made.';
      } },
      { label: 'Refuse and stand firm', hint: '35% chance they back down; otherwise they declare war', apply: (s, c, d, geo) => {
        if (nextRand(s) < 0.35) { rep(c, 4); stab(c, 2); return `${name(s, d.from)} backed down. It was a bluff.`; }
        const r = declareWar(s, geo, d.from, c.id);
        return r.ok ? `${name(s, d.from)} declared war!` : 'They did not follow through.';
      } },
      { label: 'Rally allies and partners', hint: 'Costs 0.1% of GDP · each ally raises the chance they back down', enabled: canPay(0.001), apply: (s, c, d, geo) => {
        pay(s, c, 0.001);
        const allies = alliesOf(s, c.id).length;
        const p = clamp(0.3 + 0.1 * Math.min(6, allies) + (c.mil.nuclear ? 0.2 : 0), 0.3, 0.9);
        for (const a of alliesOf(s, c.id)) addRelation(s, a, d.from, -8);
        if (nextRand(s) < p) { rep(c, 3); addRelation(s, c.id, d.from, -10); return `${name(s, d.from)} backed down when your allies stood with you.`; }
        const r = declareWar(s, geo, d.from, c.id);
        return r.ok ? `${name(s, d.from)} called your bluff and attacked!` : 'The crisis passed.';
      } },
    ],
  },
  {
    id: 'peace_conference', icon: '🕊', title: 'Offer to host peace talks', weight: 1.6, cooldown: 90,
    eligible: (s, c) => {
      if (c.reputation < 40) return null;
      const w = s.wars.find((x) => x.attackers[0] !== c.id && x.defenders[0] !== c.id && !x.attackers.includes(c.id) && !x.defenders.includes(c.id) && s.tick - x.start > 36 && s.countries[x.attackers[0]]?.alive && s.countries[x.defenders[0]]?.alive);
      return w ? { w: w.id, a: w.attackers[0], b: w.defenders[0] } : null;
    },
    text: (s, _c, d) => `The war between ${name(s, d.a)} and ${name(s, d.b)} grinds on. Both sides signal they might talk if a neutral country offers to host.`,
    options: [
      { label: 'Host peace talks', hint: 'Costs 0.25% of GDP · chance of ceasefire depends on exhaustion and your reputation', enabled: canPay(0.0025), apply: (s, c, d, geo) => {
        pay(s, c, 0.0025);
        const A = s.countries[d.a], B = s.countries[d.b];
        const p = clamp(0.25 + c.reputation / 250 + (A.mil.exhaustion + B.mil.exhaustion) * 0.4, 0.1, 0.9);
        if (nextRand(s) < p && s.wars.some((w) => w.id === d.w)) {
          makePeace(s, geo, d.a, d.b, { kind: 'status_quo' }); rep(c, 6); addRelation(s, c.id, d.a, 12); addRelation(s, c.id, d.b, 12);
          return `Your mediation succeeded: ${A.name} and ${B.name} agreed a ceasefire!`;
        }
        addRelation(s, c.id, d.a, -2); addRelation(s, c.id, d.b, -2);
        return 'The talks collapsed without agreement.';
      } },
      { label: 'Back the weaker side publicly', hint: 'Relations +10 with the victim, −10 with the aggressor', apply: (s, c, d) => { addRelation(s, c.id, d.b, 10); addRelation(s, c.id, d.a, -10); return `You publicly sided with ${name(s, d.b)}.`; } },
      { label: 'Stay out', hint: 'No change', apply: () => 'You left the diplomacy to others.' },
    ],
  },
  {
    id: 'sanction_pressure', icon: '🧾', title: 'Pressure to join sanctions', weight: 1.4, cooldown: 100,
    eligible: (s, c) => {
      const { blocs } = computeBlocs(s);
      for (const b of blocs) {
        const L = b.leader;
        if (L === c.id || getRelation(s, c.id, L) < 15) continue;
        const t = s.countries.find((x) => x.alive && x.id !== c.id && sanctionLevel(s, L, x.id) > 0 && sanctionLevel(s, c.id, x.id) === 0);
        if (t) return { l: L, t: t.id };
      }
      return null;
    },
    text: (s, _c, d) => `${name(s, d.l)}, who leads a major bloc, is asking you to join its sanctions against ${name(s, d.t)}. Refusing would strain the relationship.`,
    options: [
      { label: 'Join the sanctions', hint: `Relations with ${'the leader'} +10 · trade with the target is cut · the target resents you`, apply: (s, c, d) => { imposeSanction(s, c.id, d.t, 1); addRelation(s, c.id, d.l, 10); return `You joined the sanctions on ${name(s, d.t)}.`; } },
      { label: 'Refuse politely', hint: 'Relations with the leader −8', apply: (s, c, d) => { addRelation(s, c.id, d.l, -8); return 'You kept your trade open.'; } },
      { label: 'Offer a compromise', hint: 'Reputation +2 · relations with the leader −2', apply: (s, c, d) => { rep(c, 2); addRelation(s, c.id, d.l, -2); return 'A watered-down statement was issued instead.'; } },
    ],
  },
  {
    id: 'arms_race', icon: '🚀', title: 'Neighbour is arming fast', weight: 1.3, cooldown: 100,
    eligible: (s, c, geo) => {
      const n = neighborsOf(s, geo, c.id).filter((x) => getRelation(s, c.id, x) < 20 && strength(s.countries[x]) > 1.4 * strength(c));
      return n.length ? { n: pick(s, n) } : null;
    },
    text: (s, c, d) => `Intelligence shows ${name(s, d.n)}'s military is now far stronger than ${c.name}'s, and relations are cold. Your generals warn of a dangerous imbalance.`,
    options: [
      { label: 'Match the buildup', hint: 'Defence budget +0.4% of GDP · readiness +5% · the rival may escalate', apply: (s, c, d) => { c.budget.military = Math.min(0.25, c.budget.military + 0.004); c.mil.readiness = clamp(c.mil.readiness + 0.05, 0, 1); addRelation(s, c.id, d.n, -5); return 'The defence budget was raised.'; } },
      { label: 'Seek a defensive alliance', hint: 'Looks for the best willing partner', apply: (s, c, d, geo) => {
        const cand = s.countries.filter((x) => x.alive && x.id !== c.id && x.id !== d.n && getRelation(s, c.id, x.id) > 25 && strength(x) > strength(c)).sort((a, b) => getRelation(s, c.id, b.id) - getRelation(s, c.id, a.id))[0];
        if (!cand) return 'No suitable partner was willing to commit.';
        const t = s.treaties[c.id < cand.id ? `${c.id}-${cand.id}` : `${cand.id}-${c.id}`];
        if (t?.alliance) return `You already share an alliance with ${cand.name}.`;
        if (getRelation(s, cand.id, d.n) < 0 || nextRand(s) < 0.6) { applyTreaty(s, c.id, cand.id, 'alliance'); return `${cand.name} agreed to a defensive alliance.`; }
        void geo; return `${cand.name} declined, not wishing to provoke ${name(s, d.n)}.`;
      } },
      { label: 'Propose détente talks', hint: `Relations +8 · stability −1`, apply: (s, c, d) => { addRelation(s, c.id, d.n, 8); stab(c, -1); return 'Quiet talks lowered the temperature.'; } },
      { label: 'Ignore it', hint: 'Risk: they may feel emboldened', apply: (s, c, d) => { addRelation(s, c.id, d.n, -2); return 'You ignored the warning.'; } },
    ],
  },
  {
    id: 'energy_deal', icon: '⛽', title: 'Long-term energy deal', weight: 1.2, cooldown: 220,
    eligible: (s, c) => {
      if (c.eco.energyCap > c.eco.energyDemand * 0.95) return null;
      const exp = partnersOf(s, c.id, 'trade').filter((x) => s.countries[x].eco.energyCap > s.countries[x].eco.energyDemand * 1.3 && getRelation(s, c.id, x) > 0);
      return exp.length ? { from: pick(s, exp) } : null;
    },
    text: (s, c, d) => `${name(s, d.from)} offers ${c.name} a 10-year gas and oil supply contract at a discount. It would solve your energy shortfall, but it makes you dependent on them.`,
    options: [
      { label: 'Sign the long-term deal', hint: 'Energy supply +4% · relations +10 · but a later dispute could cut you off', apply: (s, c, d) => {
        c.eco.energyCap *= 1.04; addRelation(s, c.id, d.from, 10);
        s.scheduled.push({ tick: s.tick + 70 + Math.floor(nextRand(s) * 60), id: 'pipeline', data: { from: d.from } });
        return `A supply contract with ${name(s, d.from)} was signed.`;
      } },
      { label: 'Diversify suppliers', hint: 'Costs 0.6% of GDP · energy capacity +2.5%', enabled: canPay(0.006), apply: (s, c) => { pay(s, c, 0.006); c.eco.energyCap *= 1.025; return 'New supply routes were opened.'; } },
      { label: 'Decline', hint: 'No change', apply: () => 'You declined the offer.' },
    ],
  },
  {
    id: 'pipeline_cutoff', icon: '🔧', title: 'Energy supplier threatens to cut you off', weight: 0, cooldown: 0,
    eligible: () => null,
    text: (s, c, d) => `Amid a political dispute, ${name(s, d.from)} is threatening to cut the oil and gas it supplies to ${c.name} unless you change course. Your reliance on them has become a lever against you.`,
    options: [
      { label: 'Pay a premium', hint: 'Costs 0.8% of GDP · relations +4', enabled: canPay(0.008), apply: (s, c, d) => { pay(s, c, 0.008); addRelation(s, c.id, d.from, 4); return 'You paid more to keep the gas flowing.'; } },
      { label: 'Impose sanctions in return', hint: 'Energy supply −5% · the world takes notice', apply: (s, c, d) => { c.eco.energyCap *= 0.95; imposeSanction(s, c.id, d.from, 1); stab(c, -2); return `You hit back with sanctions on ${name(s, d.from)}.`; } },
      { label: 'Appeal to your allies', hint: 'Relations with allies +3 · supply partly restored', apply: (s, c, d) => { for (const a of alliesOf(s, c.id)) addRelation(s, c.id, a, 3); c.eco.energyCap *= 1.01; addRelation(s, c.id, d.from, -6); return 'Allies promised emergency supplies.'; } },
      { label: 'Accept the cutoff', hint: 'Energy supply −4% · stability −3', apply: (_s, c) => { c.eco.energyCap *= 0.96; stab(c, -3); return 'Winter will be hard.'; } },
    ],
  },
  {
    id: 'pipeline_bonus', icon: '🔧', title: 'Energy partner expands supplies', weight: 0, cooldown: 0,
    eligible: () => null,
    text: (s, c, d) => `Relations with ${name(s, d.from)} are warm, and it offers to double the energy it sends to ${c.name} at a fixed price.`,
    options: [
      { label: 'Accept', hint: 'Energy supply +3% · relations +5', apply: (s, c, d) => { c.eco.energyCap *= 1.03; addRelation(s, c.id, d.from, 5); return 'Supplies expand.'; } },
      { label: 'Decline', hint: 'No change', apply: () => 'You did not need more.' },
    ],
  },
  {
    id: 'spy_scandal', icon: '🕵', title: 'Foreign spies caught', weight: 1.1, cooldown: 110,
    eligible: (s, c) => {
      const c2 = s.countries.filter((x) => x.alive && x.id !== c.id && getRelation(s, c.id, x.id) < 15 && x.eco.gdp > c.eco.gdp * 0.1);
      return c2.length ? { x: pick(s, c2).id } : null;
    },
    text: (s, c, d) => `${c.name}'s counter-intelligence has caught a spy ring working for ${name(s, d.x)} inside your ministries.`,
    options: [
      { label: 'Expel their diplomats', hint: 'Relations −12 · stability +1', apply: (s, c, d) => { addRelation(s, c.id, d.x, -12); stab(c, 1); return `Diplomats of ${name(s, d.x)} were expelled.`; } },
      { label: 'Go public', hint: `Relations −20 · reputation +3 · their rivals approve`, apply: (s, c, d) => { addRelation(s, c.id, d.x, -20); rep(c, 3); for (const z of s.countries) if (z.alive && z.id !== c.id && z.id !== d.x && getRelation(s, z.id, d.x) < -25) addRelation(s, z.id, c.id, 3); return 'The scandal embarrassed them abroad.'; } },
      { label: 'Turn the agents', hint: 'Intelligence +3 points · relations −3', apply: (s, c, d) => { c.mil.intel = clamp(c.mil.intel + 0.03, 0, 1); addRelation(s, c.id, d.x, -3); return 'Double agents now feed them false reports.'; } },
      { label: 'Quiet protest', hint: 'Relations −3', apply: (s, c, d) => { addRelation(s, c.id, d.x, -3); return 'The matter was handled discreetly.'; } },
    ],
  },
  {
    id: 'summit_invite', icon: '🏛', title: 'Great powers court your vote', weight: 1, cooldown: 140,
    eligible: (s, c) => {
      const t = top(s, 10).filter((x) => x.id !== c.id);
      for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) if (getRelation(s, t[i].id, t[j].id) < -10) return { a: t[i].id, b: t[j].id };
      return null;
    },
    text: (s, _c, d) => `Rivals ${name(s, d.a)} and ${name(s, d.b)} are each lobbying smaller countries for support at a summit. Both want to know where you stand.`,
    options: [
      { label: 'Side with the first', hint: `Relations +10 with them, −10 with their rival`, apply: (s, c, d) => { addRelation(s, c.id, d.a, 10); addRelation(s, c.id, d.b, -10); return `You backed ${name(s, d.a)}.`; } },
      { label: 'Side with the second', hint: `Relations +10 with them, −10 with their rival`, apply: (s, c, d) => { addRelation(s, c.id, d.b, 10); addRelation(s, c.id, d.a, -10); return `You backed ${name(s, d.b)}.`; } },
      { label: 'Stay neutral and mediate', hint: 'Reputation +4 · relations with both +3', apply: (s, c, d) => { rep(c, 4); addRelation(s, c.id, d.a, 3); addRelation(s, c.id, d.b, 3); return 'You earned a reputation as an honest broker.'; } },
    ],
  },
  {
    id: 'coup_in_ally', icon: '🪖', title: 'Coup attempt in an allied country', weight: 1, cooldown: 140,
    eligible: (s, c) => { const a = alliesOf(s, c.id).find((x) => s.countries[x].eco.stability < 38); return a !== undefined ? { a } : null; },
    text: (s, _c, d) => `Soldiers have seized government buildings in your ally ${name(s, d.a)}. The government is asking for your help.`,
    options: [
      { label: 'Back the government', hint: 'Costs 0.3% of GDP · their stability +8 · relations +12', enabled: canPay(0.003), apply: (s, c, d) => { pay(s, c, 0.003); s.countries[d.a].eco.stability = Math.min(100, s.countries[d.a].eco.stability + 8); addRelation(s, c.id, d.a, 12); return 'Your support helped the government hold on.'; } },
      { label: 'Recognise the new regime', hint: 'Relations −15 · reputation −3', apply: (s, c, d) => { addRelation(s, c.id, d.a, -15); rep(c, -3); return 'You dealt with whoever holds power.'; } },
      { label: 'Cut the alliance', hint: 'Alliance cancelled · reputation −4', apply: (s, c, d) => { const t = s.treaties[c.id < d.a ? `${c.id}-${d.a}` : `${d.a}-${c.id}`]; if (t) t.alliance = false; rep(c, -4); return 'You ended the alliance.'; } },
    ],
  },
  {
    id: 'defector', icon: '🧳', title: 'General defects with war plans', weight: 0.9, cooldown: 180,
    eligible: (s, c) => { const x = s.countries.filter((y) => y.alive && y.id !== c.id && getRelation(s, c.id, y.id) < 0 && y.mil.troops > 20000); return x.length ? { x: pick(s, x).id } : null; },
    text: (s, _c, d) => `A senior general from ${name(s, d.x)} has crossed your border with their war plans and asks for asylum.`,
    options: [
      { label: 'Grant asylum and study the plans', hint: 'Intelligence +5 points · relations −15', apply: (s, c, d) => { c.mil.intel = clamp(c.mil.intel + 0.05, 0, 1); addRelation(s, c.id, d.x, -15); return 'The plans exposed their weaknesses.'; } },
      { label: 'Share the intelligence with allies', hint: 'Allies +5 relations · theirs −10 · reputation +1', apply: (s, c, d) => { for (const a of alliesOf(s, c.id)) addRelation(s, c.id, a, 5); addRelation(s, c.id, d.x, -10); rep(c, 1); return 'Your allies were grateful.'; } },
      { label: 'Return him to his country', hint: 'Relations +8 · reputation −2', apply: (s, c, d) => { addRelation(s, c.id, d.x, 8); rep(c, -2); return 'He was handed back. His fate is unknown.'; } },
    ],
  },
  {
    id: 'trade_war', icon: '📦', title: 'Tariff threat from a trade partner', weight: 1.2, cooldown: 120,
    eligible: (s, c) => { const p = partnersOf(s, c.id, 'trade').filter((x) => s.countries[x].eco.gdp > c.eco.gdp * 0.8); return p.length ? { x: pick(s, p) } : null; },
    text: (s, c, d) => `${name(s, d.x)} threatens heavy tariffs on ${c.name}'s exports unless you open your own markets wider.`,
    options: [
      { label: 'Open your markets', hint: 'Relations +6 · stability −1 · industry −0.3% capital', apply: (s, c, d) => { addRelation(s, c.id, d.x, 6); stab(c, -1); c.eco.capital *= 0.997; return 'A new trade understanding was reached.'; } },
      { label: 'Retaliate with tariffs', hint: 'Relations −10 · exports hurt both sides', apply: (s, c, d) => { addRelation(s, c.id, d.x, -10); c.eco.tradeBase *= 1.01; return `A tit-for-tat tariff war with ${name(s, d.x)} begins.`; } },
      { label: 'Negotiate quietly', hint: 'Costs 0.1% of GDP · 50% success', enabled: canPay(0.001), apply: (s, c, d) => { pay(s, c, 0.001); if (nextRand(s) < 0.5) { addRelation(s, c.id, d.x, 4); return 'A compromise averted the tariffs.'; } addRelation(s, c.id, d.x, -4); return 'The talks failed.'; } },
    ],
  },
  {
    id: 'nuclear_scare', icon: '☢', title: 'Missile test shakes the region', weight: 0.8, cooldown: 200,
    eligible: (s, c) => { const x = s.countries.filter((y) => y.alive && y.id !== c.id && y.mil.nuclear && getRelation(s, c.id, y.id) < 10); return x.length ? { x: pick(s, x).id } : null; },
    text: (s, _c, d) => `${name(s, d.x)} has test-fired a long-range missile. Markets fall and the public is anxious.`,
    options: [
      { label: 'Call for arms-control talks', hint: 'Reputation +3 · relations with them +3', apply: (s, c, d) => { rep(c, 3); addRelation(s, c.id, d.x, 3); return 'You proposed arms-control talks.'; } },
      { label: 'Strengthen air defences', hint: 'Costs 0.4% of GDP · readiness +5%', enabled: canPay(0.004), apply: (s, c) => { pay(s, c, 0.004); c.mil.readiness = clamp(c.mil.readiness + 0.05, 0, 1); c.mil.equipAir *= 1.01; return 'New air defences were deployed.'; } },
      { label: 'Ask a superpower for protection', hint: 'Relations +8 with the top ally', apply: (s, c) => { const a = alliesOf(s, c.id).sort((x, y) => s.countries[y].eco.gdp - s.countries[x].eco.gdp)[0]; if (a === undefined) { stab(c, -1); return 'You had no strong ally to call on.'; } addRelation(s, c.id, a, 8); return `${name(s, a)} promised its protection.`; } },
    ],
  },
  {
    id: 'proxy_support', icon: '🎯', title: 'Rebels ask for your help', weight: 0.8, cooldown: 200,
    eligible: (s, c) => { const x = s.countries.filter((y) => y.alive && y.id !== c.id && getRelation(s, c.id, y.id) < -25 && y.eco.stability < 55); return x.length ? { x: pick(s, x).id } : null; },
    text: (s, _c, d) => `An armed opposition movement inside ${name(s, d.x)}, your rival, is asking for money and weapons.`,
    options: [
      { label: 'Support them secretly', hint: 'Costs 0.3% of GDP · their stability −10 · relations −20 · reputation −3', enabled: canPay(0.003), apply: (s, c, d) => { pay(s, c, 0.003); s.countries[d.x].eco.stability = Math.max(0, s.countries[d.x].eco.stability - 10); addRelation(s, c.id, d.x, -20); rep(c, -3); return 'Weapons began to flow across the border.'; } },
      { label: 'Refuse', hint: 'Reputation +1', apply: (_s, c) => { rep(c, 1); return 'You refused to interfere.'; } },
    ],
  },
  {
    id: 'humanitarian', icon: '🏥', title: 'Humanitarian appeal', weight: 1, cooldown: 100,
    eligible: (s, c) => { const x = s.countries.filter((y) => y.alive && y.id !== c.id && (isAtWar(s, y.id) || y.eco.foodUnmet > 0.08) && y.eco.gdp < c.eco.gdp); return x.length ? { x: pick(s, x).id } : null; },
    text: (s, _c, d) => `${name(s, d.x)} appeals to the world for emergency aid as civilians suffer.`,
    options: [
      { label: 'Send a large aid package', hint: 'Costs 0.4% of GDP · relations +12 · reputation +4', enabled: canPay(0.004), apply: (s, c, d) => { pay(s, c, 0.004); s.countries[d.x].eco.cash += 0.004 * c.eco.gdp; s.countries[d.x].eco.stability += 3; addRelation(s, c.id, d.x, 12); rep(c, 4); return 'Your aid convoys arrived.'; } },
      { label: 'Small contribution', hint: 'Costs 0.1% of GDP · relations +4 · reputation +1', enabled: canPay(0.001), apply: (s, c, d) => { pay(s, c, 0.001); addRelation(s, c.id, d.x, 4); rep(c, 1); return 'A modest contribution was sent.'; } },
      { label: 'Decline', hint: 'No change', apply: () => 'You did not answer the appeal.' },
    ],
  },
  // ---------------------------------------------------------------- domestic variety
  {
    id: 'pandemic', icon: '🦠', title: 'New disease outbreak', weight: 0.6, cooldown: 400,
    eligible: () => ({}),
    text: (_s, c) => `A fast-spreading infectious disease has reached ${c.name}. Hospitals are filling up.`,
    options: [
      { label: 'Strict lockdown', hint: 'Costs 0.8% of GDP · output −1.5% for a while · stability −2 · population saved', enabled: canPay(0.008), apply: (s, c) => { pay(s, c, 0.008); c.eco.damage = Math.min(1, c.eco.damage + 0.03); stab(c, -2); return 'The lockdown slowed the spread.'; } },
      { label: 'Targeted measures', hint: 'Costs 0.3% of GDP · population −0.1% · stability −1', enabled: canPay(0.003), apply: (s, c) => { pay(s, c, 0.003); c.eco.pop *= 0.999; stab(c, -1); return 'Targeted measures contained the outbreak.'; } },
      { label: 'Keep the economy open', hint: 'Population −0.4% · stability −4 · reputation −2', apply: (_s, c) => { c.eco.pop *= 0.996; stab(c, -4); rep(c, -2); return 'The disease spread widely.'; } },
    ],
  },
  {
    id: 'cyberattack', icon: '💻', title: 'Major cyberattack', weight: 0.9, cooldown: 160,
    eligible: (s, c) => { const x = s.countries.filter((y) => y.alive && y.id !== c.id && getRelation(s, c.id, y.id) < 0 && y.mil.intel > 0.4); return x.length ? { x: pick(s, x).id } : null; },
    text: (s, c, d) => `A cyberattack has crippled parts of ${c.name}'s power grid and banks. Evidence points to hackers linked to ${name(s, d.x)}.`,
    options: [
      { label: 'Harden infrastructure', hint: 'Costs 0.5% of GDP · infrastructure +1 · intelligence +2 points', enabled: canPay(0.005), apply: (s, c) => { pay(s, c, 0.005); c.eco.infra = clamp(c.eco.infra + 1, 5, 100); c.mil.intel = clamp(c.mil.intel + 0.02, 0, 1); return 'Systems were rebuilt and secured.'; } },
      { label: 'Name and shame', hint: 'Relations −15 · reputation +2 · their rivals approve', apply: (s, c, d) => { addRelation(s, c.id, d.x, -15); rep(c, 2); return `You publicly blamed ${name(s, d.x)}.`; } },
      { label: 'Retaliate in kind', hint: 'Their infrastructure −3 · relations −10', apply: (s, c, d) => { s.countries[d.x].eco.infra = Math.max(5, s.countries[d.x].eco.infra - 3); addRelation(s, c.id, d.x, -10); return 'Your cyber units struck back.'; } },
    ],
  },
  {
    id: 'housing', icon: '🏠', title: 'Housing crisis', weight: 0.9, cooldown: 200,
    eligible: (_s, c) => (c.eco.gdp / c.eco.pop > 8000 ? {} : null),
    text: (_s, c) => `Rents and house prices in ${c.name}'s cities have soared. Young people cannot afford homes and are angry.`,
    options: [
      { label: 'Fund large-scale construction', hint: 'Costs 1% of GDP · stability +4 · industrial capital +0.3%', enabled: canPay(0.01), apply: (s, c) => { pay(s, c, 0.01); stab(c, 4); c.eco.capital *= 1.003; return 'Cranes went up across the cities.'; } },
      { label: 'Impose rent controls', hint: 'Stability +3 · investment confidence −', apply: (_s, c) => { stab(c, 3); c.eco.tfp *= 0.999; return 'Rent controls were introduced.'; } },
      { label: 'Let the market adjust', hint: 'Stability −3', apply: (_s, c) => { stab(c, -3); return 'You trusted the market.'; } },
    ],
  },
  {
    id: 'pension', icon: '👴', title: 'Pension funds under strain', weight: 0.9, cooldown: 220,
    eligible: (_s, c) => (c.eco.gdp / c.eco.pop > 6000 ? {} : null),
    text: (_s, c) => `An ageing population is straining ${c.name}'s pension system. Economists demand reform.`,
    options: [
      { label: 'Raise the retirement age', hint: 'Stability −5 · workforce +0.4% · budget relief', apply: (_s, c) => { stab(c, -5); c.eco.laborForce *= 1.004; c.budget.social = Math.max(0, c.budget.social - 0.004); return 'The retirement age was raised.'; } },
      { label: 'Raise payroll taxes', hint: 'Income tax +1.5 points · stability −2', apply: (_s, c) => { c.budget.taxIncome = Math.min(0.7, c.budget.taxIncome + 0.015); stab(c, -2); return 'Contributions were raised.'; } },
      { label: 'Borrow to cover the gap', hint: 'Debt +1.5% of GDP · stability +1', apply: (_s, c) => { c.eco.debt += 0.015 * c.eco.gdp; stab(c, 1); return 'The problem was pushed down the road.'; } },
    ],
  },
  {
    id: 'bank_run', icon: '🏦', title: 'Banking panic', weight: 0.7, cooldown: 260,
    eligible: (_s, c) => (c.eco.debt / c.eco.gdp > 0.8 || c.eco.inflation > 0.1 ? {} : null),
    text: (_s, c) => `Depositors are queuing outside the banks of ${c.name}. Two large lenders are on the verge of collapse.`,
    options: [
      { label: 'Bail the banks out', hint: 'Costs 2% of GDP · stability +3', enabled: canPay(0.02), apply: (s, c) => { pay(s, c, 0.02); stab(c, 3); return 'The state rescued the banking system.'; } },
      { label: 'Guarantee deposits only', hint: 'Costs 0.7% of GDP · output −1% for a while', enabled: canPay(0.007), apply: (s, c) => { pay(s, c, 0.007); c.eco.damage = Math.min(1, c.eco.damage + 0.02); return 'Savers were protected; shareholders were not.'; } },
      { label: 'Let them fail', hint: 'Stability −6 · unemployment +1.5 points', apply: (_s, c) => { stab(c, -6); c.eco.unemployment += 0.015; return 'Two banks collapsed.'; } },
    ],
  },
  {
    id: 'olympics', icon: '🏟', title: 'Offer to host a global event', weight: 0.5, cooldown: 600,
    eligible: (s, c) => (c.eco.gdp > 1e11 && c.reputation > 45 ? {} : null),
    text: (_s, c) => `${c.name} has been offered the chance to host a major international sports festival.`,
    options: [
      { label: 'Host it', hint: 'Costs 1.2% of GDP · stability +5 · reputation +4 · tourism income later', enabled: canPay(0.012), apply: (s, c) => { pay(s, c, 0.012); stab(c, 5); rep(c, 4); s.scheduled.push({ tick: s.tick + 60, id: 'olympics_payoff', data: {} }); return 'The world will come to your country.'; } },
      { label: 'Decline', hint: 'No change', apply: () => 'The honour went elsewhere.' },
    ],
  },
  {
    id: 'olympics_payoff', icon: '🏟', title: 'The games were a success', weight: 0, cooldown: 0,
    eligible: () => null,
    text: (_s, c) => `Visitors poured into ${c.name} and global media praised the organisation.`,
    options: [{ label: 'Celebrate', hint: 'Gain 0.9% of GDP · stability +2', apply: (_s, c) => { c.eco.cash += 0.009 * c.eco.gdp; stab(c, 2); return 'Tourism receipts boosted the budget.'; } }],
  },
  {
    id: 'green_transition', icon: '🌱', title: 'Energy transition proposal', weight: 0.9, cooldown: 220,
    eligible: (_s, c) => (c.eco.tech > 35 ? {} : null),
    text: (_s, c) => `Industry and environment groups urge ${c.name} to launch a big renewable-energy programme.`,
    options: [
      { label: 'Launch a full programme', hint: 'Costs 1.5% of GDP · energy capacity +5% · technology +2 · reputation +2', enabled: canPay(0.015), apply: (s, c) => { pay(s, c, 0.015); c.eco.energyCap *= 1.05; c.eco.tech = clamp(c.eco.tech + 2, 0, 100); rep(c, 2); return 'Wind and solar farms begin to rise.'; } },
      { label: 'Gradual, subsidised shift', hint: 'Costs 0.5% of GDP · energy capacity +1.5%', enabled: canPay(0.005), apply: (s, c) => { pay(s, c, 0.005); c.eco.energyCap *= 1.015; return 'A modest subsidy scheme began.'; } },
      { label: 'Not now', hint: 'Stability −1', apply: (_s, c) => { stab(c, -1); return 'The proposal was shelved.'; } },
    ],
  },
  {
    id: 'brain_drain', icon: '🎓', title: 'Brain drain warning', weight: 0.8, cooldown: 220,
    eligible: (_s, c) => (c.eco.gdp / c.eco.pop < 20000 && c.eco.tech > 20 ? {} : null),
    text: (_s, c) => `Skilled graduates are leaving ${c.name} for better-paid jobs abroad.`,
    options: [
      { label: 'Fund universities and research', hint: 'Costs 0.8% of GDP · technology +2', enabled: canPay(0.008), apply: (s, c) => { pay(s, c, 0.008); c.eco.tech = clamp(c.eco.tech + 2, 0, 100); return 'New labs and scholarships keep talent at home.'; } },
      { label: 'Tax breaks for returnees', hint: 'Revenue −0.2% of GDP/yr · productivity +0.2%', apply: (_s, c) => { c.eco.tfp *= 1.002; c.budget.taxIncome = Math.max(0, c.budget.taxIncome - 0.004); return 'Tax breaks were introduced.'; } },
      { label: 'Do nothing', hint: 'Productivity −0.3%', apply: (_s, c) => { c.eco.tfp *= 0.997; return 'The exodus continued.'; } },
    ],
  },
  {
    id: 'tech_giant', icon: '🖥', title: 'Tech giant dispute', weight: 0.8, cooldown: 220,
    eligible: (_s, c) => (c.eco.tech > 45 ? {} : null),
    text: (_s, c) => `A dominant technology company in ${c.name} is accused of crushing competitors and avoiding taxes.`,
    options: [
      { label: 'Break it up', hint: 'Productivity +0.3% · investment confidence −1 · stability +2', apply: (_s, c) => { c.eco.tfp *= 1.003; stab(c, 2); return 'Regulators forced a split.'; } },
      { label: 'Fine it and tax it', hint: 'Gain 0.4% of GDP · stability +1', apply: (_s, c) => { c.eco.cash += 0.004 * c.eco.gdp; stab(c, 1); return 'A record fine was paid.'; } },
      { label: 'Back the national champion', hint: 'Technology +1.5 · reputation −2', apply: (_s, c) => { c.eco.tech = clamp(c.eco.tech + 1.5, 0, 100); rep(c, -2); return 'You shielded the company.'; } },
    ],
  },
  {
    id: 'skilled_migration', icon: '🧑‍🔬', title: 'Wave of skilled migrants', weight: 0.8, cooldown: 200,
    eligible: (_s, c) => (c.eco.gdp / c.eco.pop > 7000 ? {} : null),
    text: (_s, c) => `Skilled workers from crisis-hit countries want to settle in ${c.name}.`,
    options: [
      { label: 'Fast-track visas', hint: 'Workforce +0.5% · technology +1 · stability −2 · reputation +2', apply: (_s, c) => { c.eco.laborForce *= 1.005; c.eco.pop *= 1.003; c.eco.tech = clamp(c.eco.tech + 1, 0, 100); stab(c, -2); rep(c, 2); return 'Thousands of skilled migrants arrived.'; } },
      { label: 'Keep quotas', hint: 'Stability +1', apply: (_s, c) => { stab(c, 1); return 'Quotas were kept.'; } },
    ],
  },
  {
    id: 'assembly', icon: '🌐', title: 'World Assembly vote', weight: 0, cooldown: 0,
    eligible: () => null,
    text: (s, _c, d) => {
      const r = s.resolutions.find((x) => x.id === d.rid);
      if (!r) return 'The Assembly is voting.';
      const t = tally(s, r);
      const label = ({ condemn: 'condemn', sanction: 'impose sanctions on', ceasefire: 'demand a ceasefire from', aid: 'send emergency aid to' } as const)[r.kind];
      return `The World Assembly is voting on a resolution to ${label} ${name(s, r.target)}${r.victim >= 0 ? ` (victim: ${name(s, r.victim)})` : ''}. Current count without you: ${t.yes} yes, ${t.no} no, ${t.abstain} abstain. Your vote shapes relations with both camps.`;
    },
    options: [
      { label: 'Vote YES', hint: 'Supports the resolution · relations with the target fall', apply: (s, c, d, geo) => assemblyVote(s, c, d, geo, 'yes') },
      { label: 'Vote NO', hint: 'Opposes it · the target is grateful', apply: (s, c, d, geo) => assemblyVote(s, c, d, geo, 'no') },
      { label: 'Abstain', hint: 'No stance · no relations change', apply: (s, c, d, geo) => assemblyVote(s, c, d, geo, 'abstain') },
      { label: 'Lobby for YES', hint: 'Costs 0.15% of GDP · swings several undecided votes', enabled: canPay(0.0015), apply: (s, c, d, geo) => { pay(s, c, 0.0015); return assemblyVote(s, c, d, geo, 'yes', 4); } },
    ],
  },
];

function assemblyVote(s: GameState, c: import('./types').Country, d: D, geo: import('./geo').Geo, vote: 'yes' | 'no' | 'abstain', bonus = 0): string {
  const r = s.resolutions.find((x) => x.id === d.rid);
  if (!r) return 'The vote was cancelled.';
  const T = s.countries[r.target];
  if (vote === 'yes') { addRelation(s, c.id, r.target, -8); for (const a of alliesOf(s, r.target)) addRelation(s, c.id, a, -3); if (r.victim >= 0) addRelation(s, c.id, r.victim, 6); }
  if (vote === 'no') { addRelation(s, c.id, r.target, 8); for (const a of alliesOf(s, r.target)) addRelation(s, c.id, a, 3); if (r.victim >= 0) addRelation(s, c.id, r.victim, -6); }
  const passed = finalizeResolution(s, geo, r, vote, bonus);
  if (vote !== 'abstain' && (vote === 'yes') === passed) s.stats.assemblyWins = (s.stats.assemblyWins ?? 0) + 1;
  void T; void enemiesOf; void warsOf; void areAtWar; void money;
  return `The resolution ${passed ? 'passed' : 'failed'} (${r.yes}–${r.no}).`;
}
