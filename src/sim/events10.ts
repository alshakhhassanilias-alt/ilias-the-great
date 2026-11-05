/**
 * Turning points: when the way you govern settles into a path (conqueror, strongman, reformer, trader, peacemaker),
 * the story notices and asks what kind of nation you are making. Each answer has real effects and steers the
 * objectives that follow (goals2.ts reads the record they leave).
 */
import type { EventDef } from './eventkit';
import { rep, stab } from './eventkit';
import { sway, spendPC } from './domestic';
import { addRec } from './minds';
import { addRelation, alliesOf, getRelation } from './relations';
import { clamp } from './util';
import type { Country, GameState } from './types';
import { forcePeaceAll } from './war';
import { geoRefGet } from './geoRef';
import { isAtWar } from './relations';

const pcOf = (c: Country) => c.politics?.pc ?? 0;
const toWest = (s: GameState, c: Country, v: number) => { for (const x of s.countries) if (x.alive && x.id !== c.id && (x.orient ?? 0) > 0.4) addRelation(s, c.id, x.id, v); };
const toNeighbours = (s: GameState, c: Country, v: number) => { for (const x of s.countries) if (x.alive && x.id !== c.id && x.region === c.region) addRelation(s, c.id, x.id, v); };

export const EVENTS10: EventDef[] = [
  {
    id: 'path_conqueror', icon: '⚔', title: 'A nation of conquerors?', weight: 0, cooldown: 0, ttl: 20, eligible: () => null,
    text: (s, c) => `Our flag flies over land that was not ours a few years ago. The generals speak of a greater ${c.name}; the neighbours speak of us in fear. Every capital in ${c.region === 'EU' ? 'Europe' : 'the region'} is waiting to see what we do next.`,
    options: [
      { label: 'Proclaim a greater nation', hint: 'Army readiness +10% · nationalists +12 · reputation −8 · neighbours −10 · conquest objectives follow', apply: (s, c) => { c.mil.readiness = clamp(c.mil.readiness + 0.1, 0, 1); sway(c, 'nationalists', 12); sway(c, 'liberals', -8); rep(c, -8); toNeighbours(s, c, -10); addRec(s, c.id, 'aggr', 0.6); return 'Maps of a greater nation hang in every school. The neighbours arm.'; } },
      { label: 'Consolidate what we hold', hint: 'Stability +6 · occupied regions settle faster · the army rests', apply: (s, c) => { stab(c, 6); for (const p of c.provinces) if (s.core[p] !== c.id) s.integ[p] = clamp(s.integ[p] + 0.15, 0, 1); c.mil.exhaustion = Math.max(0, c.mil.exhaustion - 0.15); return 'Roads, schools and governors for the new regions. The army goes home.'; } },
      { label: 'Offer a grand peace', hint: 'Costs 10 political capital · reputation +8 · relations with neighbours +12 · the path turns to peace', enabled: (_s, c) => pcOf(c) >= 10, why: () => 'Needs 10 political capital', apply: (s, c) => { spendPC(c, 10); rep(c, 8); toNeighbours(s, c, 12); addRec(s, c.id, 'aid', 0.6); return 'A conference of the region in our capital. The guns fall silent.'; } },
    ],
  },
  {
    id: 'path_strongman', icon: '🚨', title: 'The firm hand', weight: 0, cooldown: 0, ttl: 20, eligible: () => null,
    text: (_s, c) => `Order holds in ${c.name}, but at a price: the opposition is quiet because it is afraid. The security chiefs want more powers; the last free newspapers warn of a point of no return.`,
    options: [
      { label: 'Give the security services more powers', hint: 'Stability +8 · military +8 · liberals −15 · Western relations −8', apply: (s, c) => { stab(c, 8); sway(c, 'military', 8); sway(c, 'liberals', -15); toWest(s, c, -8); addRec(s, c.id, 'repress', 0.5); return 'Curfews, cameras, informers. The streets are quiet.'; } },
      { label: 'Loosen the grip a little', hint: 'Liberals +10 · reputation +5 · stability −3', apply: (_s, c) => { sway(c, 'liberals', 10); rep(c, 5); stab(c, -3); return 'Some prisoners walk free. The country breathes.'; } },
      { label: 'Call free elections', hint: 'Costs 15 political capital · reputation +12 · Western relations +10 · the path turns to reform', enabled: (_s, c) => pcOf(c) >= 15, why: () => 'Needs 15 political capital', apply: (s, c) => { spendPC(c, 15); rep(c, 12); toWest(s, c, 10); addRec(s, c.id, 'reform', 1); return 'Election day is set. Nobody knows who will win, and that is the point.'; } },
    ],
  },
  {
    id: 'path_reformer', icon: '🗳', title: 'The reform era', weight: 0, cooldown: 0, ttl: 20, eligible: () => null,
    text: (_s, c) => `Cleaner courts, a freer press, honest tenders: foreign papers call it "the ${c.name} miracle". Investors are curious; the old networks that lost their privileges are furious and waiting for a mistake.`,
    options: [
      { label: 'Go further: a new constitution', hint: 'Costs 12 political capital · reputation +8 · tax collection +3% · business +6 · old guard (nationalists) −8', enabled: (_s, c) => pcOf(c) >= 12, why: () => 'Needs 12 political capital', apply: (_s, c) => { spendPC(c, 12); rep(c, 8); c.eco.collection = clamp(c.eco.collection + 0.03, 0.3, 1); sway(c, 'business', 6); sway(c, 'nationalists', -8); return 'A convention drafts the new constitution in public, line by line.'; } },
      { label: 'Invite the world to invest', hint: 'Industrial capital +2% · Western relations +6 · unions −6', apply: (s, c) => { c.eco.capital *= 1.02; toWest(s, c, 6); sway(c, 'labour', -6); return 'Roadshows in London, New York and Singapore.'; } },
      { label: 'Slow down and bring the old guard along', hint: 'Stability +5 · nationalists +6 · reputation −2', apply: (_s, c) => { stab(c, 5); sway(c, 'nationalists', 6); rep(c, -2); return 'A pause, and a seat at the table for the old networks.'; } },
    ],
  },
  {
    id: 'path_trader', icon: '💱', title: 'A trading nation', weight: 0, cooldown: 0, ttl: 20, eligible: () => null,
    text: (_s, c) => `Our ports and border posts have never been busier. ${c.name} sells to half the world, and half the world's money flows through our banks. Some say we should lead a trading bloc of our own; others warn we depend on everyone and control nothing.`,
    options: [
      { label: 'Build a free-trade bloc around us', hint: 'Relations with trade partners +8 · business +8 · reputation +3', apply: (s, c) => { for (const k of Object.keys(s.treaties)) { const [a, b] = k.split('-').map(Number); if (s.treaties[k].trade && (a === c.id || b === c.id)) addRelation(s, a, b, 8); } sway(c, 'business', 8); rep(c, 3); return 'Our trade ministers tour the partners: a common market, under our lead.'; } },
      { label: 'Secure the supply chains at home', hint: 'Energy and food capacity +4% · unions +6 · business −4', apply: (_s, c) => { c.eco.energyCap *= 1.04; c.eco.foodCap *= 1.04; sway(c, 'labour', 6); sway(c, 'business', -4); return 'Strategic reserves, home factories for what matters most.'; } },
      { label: 'A sovereign wealth fund', hint: 'Treasury +1% of GDP now · stability +2', apply: (_s, c) => { c.eco.cash += 0.01 * c.eco.gdp; stab(c, 2); return 'The fund opens with a first deposit from the trade surplus.'; } },
    ],
  },
  {
    id: 'path_peacemaker', icon: '🕊', title: 'The honest broker', weight: 0, cooldown: 0, ttl: 20, eligible: () => null,
    text: (s, c) => `${c.name}'s diplomats are asked to every negotiation now; ${alliesOf(s, c.id).length ? 'our allies trust our word' : 'even rivals take our calls'}. Some want a seat among the great powers; some fear we are everybody's friend and nobody's ally.`,
    options: [
      { label: 'Seek a permanent role in world diplomacy', hint: 'Reputation +10 · costs 0.3% of GDP a year in missions (one-off 0.3% now)', apply: (_s, c) => { rep(c, 10); c.eco.cash -= 0.003 * c.eco.gdp; return 'A new academy of diplomacy, and envoys in every crisis.'; } },
      { label: 'Turn goodwill into alliances', hint: 'Relations with friends (above +40) +8', apply: (s, c) => { for (const x of s.countries) if (x.alive && x.id !== c.id && getRelation(s, c.id, x.id) > 40) addRelation(s, c.id, x.id, 8); return 'Friendships become treaties.'; } },
      { label: 'Keep out of everyone\'s quarrels', hint: 'Stability +4 · liberals +4', apply: (_s, c) => { stab(c, 4); sway(c, 'liberals', 4); return 'Neutral, prosperous, and quiet.'; } },
    ],
  },
  {
    id: 'home_collapse', icon: '🔥', title: 'The government is collapsing', weight: 0, cooldown: 0, ttl: 4, urgent: true, eligible: () => null,
    text: (s, c) => `Stability has fallen to ${Math.round(c.eco.stability)}. Ministers are resigning, crowds fill the squares and the army is restless.${isAtWar(s, c.id) ? ' Everyone says the war is the cause.' : ''} Without a decision this week the government falls.`,
    options: [
      { label: 'Sue for peace on every front', hint: 'Every war ends on current lines · stability +25', enabled: (s, c) => isAtWar(s, c.id), why: () => 'You are at peace', apply: (s, c) => { const g = geoRefGet(); if (g) forcePeaceAll(s, g, c.id, 'the government chose peace'); stab(c, 25); return 'Ceasefires on every front. The crowds go home.'; } },
      { label: 'Martial law', hint: 'Stability +20 · liberals −20 · reputation −10 · the world condemns it', apply: (s, c) => { stab(c, 20); sway(c, 'liberals', -20); sway(c, 'military', 8); rep(c, -10); addRec(s, c.id, 'repress', 1); return 'Tanks at the crossroads, a curfew at nine. The country holds, for now.'; } },
      { label: 'A government of national unity', hint: 'Costs 20 political capital · stability +15 · war support +10%', enabled: (_s, c) => pcOf(c) >= 20, why: () => 'Needs 20 political capital', apply: (_s, c) => { spendPC(c, 20); stab(c, 15); c.mil.warSupport = clamp((c.mil.warSupport ?? 0.6) + 0.1, 0, 1); return 'The opposition joins the cabinet. The country closes ranks.'; } },
    ],
    lapse: (s, c) => { const g = geoRefGet(); if (g) forcePeaceAll(s, g, c.id, 'the government has fallen'); c.eco.stability = Math.max(c.eco.stability, 40); return 'The government fell; a caretaker cabinet signed ceasefires on every front.'; },
  },
];
