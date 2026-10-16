/**
 * Consequences. These decisions never come out of the blue: each follows months after something you chose, and
 * says so. Pay off the strikers and other unions want the same; cover up a scandal and the cover-up can unravel;
 * take the foreign investor's money and the strings show up; admit refugees and integration becomes the issue.
 *
 * FOLLOW_UPS (below) says which answer leads where, how likely, and after how long. resolveEvent schedules them.
 */
import { nextRand } from './rng';
import { clamp } from './util';
import { addRelation } from './relations';
import { sway, spendPC } from './domestic';
import { dateLabel } from './tick';
import { type D, type EventDef, name, pay, stab, rep, money, canPay } from './eventkit';
import type { Country, GameState } from './types';

const pcOf = (c: Country) => c.politics?.pc ?? 0;
const hasPC = (n: number) => (_s: GameState, c: Country) => pcOf(c) >= n;
const when = (d: D) => dateLabel(d.t ?? 0);

export const EVENTS7: EventDef[] = [
  {
    id: 'wage_spiral', icon: '💶', title: 'Everyone wants a raise now', weight: 0, cooldown: 0, ttl: 20,
    eligible: () => null,
    text: (_s, c, d) => `In ${when(d)} you bought off the general strike with pay rises. Now teachers, nurses and rail workers want the same deal, and inflation is ${(c.eco.inflation * 100).toFixed(1)}%. The unions say a promise to one worker is a promise to all.`,
    options: [
      { label: 'Extend the raise to the public sector', hint: 'Costs 0.4% of GDP · unions +8 · inflation +0.3pt', enabled: canPay(0.004), apply: (s, c) => { pay(s, c, 0.004); sway(c, 'labour', 8); c.eco.monetary += 0.003; return `The public sector gets its raise (${money(c, 0.004)}).`; } },
      { label: 'Tie future pay to productivity', hint: 'Costs 8 political capital · unions +2 · business +4 · productivity +0.1%', enabled: hasPC(8), apply: (_s, c) => { spendPC(c, 8); sway(c, 'labour', 2); sway(c, 'business', 4); c.eco.tfp *= 1.001; return 'A productivity pact is signed. Nobody is delighted; nobody strikes.'; } },
      { label: 'Hold the line', hint: 'Unions −8 · business +4 · stability −2', apply: (_s, c) => { sway(c, 'labour', -8); sway(c, 'business', 4); stab(c, -2); return 'No more raises. The unions call it a betrayal.'; } },
    ],
    lapse: (_s, c) => { sway(c, 'labour', -5); return 'The unions take your silence as a no.'; },
  },
  {
    id: 'strike_return', icon: '✊', title: 'The strike leaders are back', weight: 0, cooldown: 0, ttl: 16,
    eligible: () => null,
    text: (_s, c, d) => `The union leaders you broke in ${when(d)} are out of jail and touring the country as martyrs. Membership has doubled. They demand an apology and a seat at the table, or "the next strike will not be broken".`,
    options: [
      { label: 'Amnesty and talks', hint: 'Unions +10 · stability +2 · nationalists −3', apply: (_s, c) => { sway(c, 'labour', 10); stab(c, 2); sway(c, 'nationalists', -3); return 'Old enemies shake hands on television.'; } },
      { label: 'Ban the union', hint: 'Stability −4 · unions −12 · liberals −10 · reputation −3', apply: (_s, c) => { stab(c, -4); sway(c, 'labour', -12); sway(c, 'liberals', -10); rep(c, -3); return 'The union is banned. It goes underground.'; } },
      { label: 'Ignore them', hint: 'Unions −6', apply: (_s, c) => { sway(c, 'labour', -6); return 'You refuse to dignify them with an answer.'; } },
    ],
    lapse: (_s, c) => { sway(c, 'labour', -6); return 'They organise without you.'; },
  },
  {
    id: 'coverup_unravels', icon: '🗞', title: 'The cover-up unravels', weight: 0, cooldown: 0, urgent: true, ttl: 12,
    eligible: () => null,
    text: (_s, c, d) => `A journalist has the documents. The corruption scandal you buried in ${when(d)} is about to be front-page news in ${c.name}, together with proof that the government covered it up.`,
    options: [
      { label: 'Come clean before they publish', hint: 'Stability −3 · reputation +4 · costs 10 political capital', enabled: hasPC(10), apply: (_s, c) => { stab(c, -3); rep(c, 4); spendPC(c, 10); sway(c, 'liberals', 6); return 'You tell the country yourself. It hurts, but it is your story, not theirs.'; } },
      { label: 'Blame a minister', hint: 'Costs 6 political capital · 50%: it holds, else stability −6', enabled: hasPC(6), apply: (s, c) => { spendPC(c, 6); if (nextRand(s) < 0.5) { stab(c, -1); return 'The minister falls on the sword. The story moves on.'; } stab(c, -6); rep(c, -3); return 'The minister produces emails. The scandal now has your name on it.'; } },
      { label: 'Deny everything', hint: '60%: it blows over · 40%: stability −8 · reputation −6', apply: (s, c) => { if (nextRand(s) < 0.6) return 'The story fizzles in a week of other news.'; stab(c, -8); rep(c, -6); sway(c, 'liberals', -10); return 'The denial is disproved on live television.'; } },
    ],
    lapse: (_s, c) => { stab(c, -5); rep(c, -4); return 'The story breaks without a word from you.'; },
  },
  {
    id: 'reform_dividend', icon: '⚖', title: 'Recovered millions', weight: 0, cooldown: 0, ttl: 24,
    eligible: () => null,
    text: (_s, c, d) => `The anti-corruption drive you launched in ${when(d)} has recovered ${money(c, 0.004)} in stolen public money. What should happen to it?`,
    options: [
      { label: 'Into hospitals and schools', hint: 'Stability +3 · unions +4', apply: (_s, c) => { stab(c, 3); sway(c, 'labour', 4); return 'New wards open with a plaque: "paid for by the corrupt".'; } },
      { label: 'Into the treasury', hint: 'Gain 0.4% of GDP', apply: (_s, c) => { c.eco.cash += 0.004 * c.eco.gdp; return 'The money closes part of the deficit.'; } },
    ],
  },
  {
    id: 'investor_strings', icon: '🧾', title: 'The strings attached', weight: 0, cooldown: 0, ttl: 16,
    eligible: () => null,
    text: (s, c, d) => `The investors from ${name(s, d.from)} who built factories in ${c.name} in ${when(d)} now want a ten-year tax exemption. Otherwise, they say, they will move production elsewhere.`,
    options: [
      { label: 'Grant the exemption', hint: 'Corporate tax −0.5pt · relations +5 · unions −4', apply: (s, c, d) => { c.budget.taxCorporate = Math.max(0, c.budget.taxCorporate - 0.005); addRelation(s, c.id, d.from, 5); sway(c, 'labour', -4); return 'The factories stay; the tax office grumbles.'; } },
      { label: 'Buy them out', hint: 'Costs 0.5% of GDP · the factories become national · business −4', enabled: canPay(0.005), apply: (s, c, d) => { pay(s, c, 0.005); sway(c, 'business', -4); sway(c, 'nationalists', 5); addRelation(s, c.id, d.from, -4); return 'The state takes over the plants.'; } },
      { label: 'Call their bluff', hint: '50%: they stay · else industrial capital −0.8% and relations −8', apply: (s, c, d) => { if (nextRand(s) < 0.5) return 'They stay. The bluff was a bluff.'; c.eco.capital *= 0.992; addRelation(s, c.id, d.from, -8); return 'Two plants close and move abroad.'; } },
    ],
    lapse: (s, c, d) => { c.eco.capital *= 0.995; addRelation(s, c.id, d.from, -4); return 'One plant closes while you hesitate.'; },
  },
  {
    id: 'refugee_integration', icon: '🏫', title: 'The newcomers', weight: 0, cooldown: 0, ttl: 24,
    eligible: () => null,
    text: (s, c, d) => `The refugees from ${name(s, d.n)} you admitted in ${when(d)} are still in temporary housing. Some towns welcome them; in others, the nationalists are holding rallies. They want to work.`,
    options: [
      { label: 'Fund language courses and jobs', hint: 'Costs 0.3% of GDP · workforce +0.3% · stability +1 · nationalists −3', enabled: canPay(0.003), apply: (s, c) => { pay(s, c, 0.003); c.eco.laborForce *= 1.003; stab(c, 1); sway(c, 'nationalists', -3); sway(c, 'liberals', 4); return 'Within a year most of them have jobs.'; } },
      { label: 'Send them to fill labour shortages', hint: 'Business +6 · unions −5 · workforce +0.2%', apply: (_s, c) => { c.eco.laborForce *= 1.002; sway(c, 'business', 6); sway(c, 'labour', -5); return 'Farms and factories hire them; wages dip.'; } },
      { label: 'Leave it to the towns', hint: 'Stability −2 · nationalists +4', apply: (_s, c) => { stab(c, -2); sway(c, 'nationalists', 4); return 'Some towns cope. Some do not.'; } },
    ],
    lapse: (_s, c) => { stab(c, -2); return 'The camps become permanent.'; },
  },
  {
    id: 'border_camps', icon: '⛺', title: 'Camps at the border', weight: 0, cooldown: 0, ttl: 14,
    eligible: () => null,
    text: (s, c, d) => `Since you sealed the border in ${when(d)}, tens of thousands of people from ${name(s, d.n)} are stuck in camps on the other side. Foreign television is filming children in the mud.`,
    options: [
      { label: 'Open a humanitarian corridor', hint: 'Costs 0.1% of GDP · reputation +3 · nationalists −3', enabled: canPay(0.001), apply: (s, c) => { pay(s, c, 0.001); rep(c, 3); sway(c, 'nationalists', -3); return 'Families with children are let through.'; } },
      { label: 'Hold firm', hint: 'Reputation −3 · nationalists +5', apply: (_s, c) => { rep(c, -3); sway(c, 'nationalists', 5); return 'The border stays shut.'; } },
    ],
    lapse: (_s, c) => { rep(c, -2); return 'The pictures keep coming.'; },
  },
  {
    id: 'reconstruction_audit', icon: '🔍', title: 'The reconstruction audit', weight: 0, cooldown: 0, ttl: 18,
    eligible: () => null,
    text: (_s, c, d) => `Auditors checking the reconstruction you paid for in ${when(d)} found contracts inflated by a third. Some of the firms belong to friends of the ruling party in ${c.name}.`,
    options: [
      { label: 'Prosecute', hint: 'Costs 8 political capital · liberals +8 · business −4 · tax collection +0.5pt', enabled: hasPC(8), apply: (_s, c) => { spendPC(c, 8); sway(c, 'liberals', 8); sway(c, 'business', -4); c.eco.collection = clamp(c.eco.collection + 0.005, 0.4, 0.98); return 'Arrests make the evening news.'; } },
      { label: 'Quietly claw the money back', hint: 'Gain 0.3% of GDP · reputation −1', apply: (_s, c) => { c.eco.cash += 0.003 * c.eco.gdp; rep(c, -1); return 'The firms repay without a trial.'; } },
      { label: 'Bury the report', hint: 'Liberals −6 · 40%: it leaks later', apply: (s, c) => { sway(c, 'liberals', -6); if (nextRand(s) < 0.4) { stab(c, -4); rep(c, -3); return 'It leaked anyway.'; } return 'The report gathers dust.'; } },
    ],
  },
  {
    id: 'border_titfortat', icon: '🪖', title: 'They answer your build-up', weight: 0, cooldown: 0, ttl: 12,
    eligible: () => null,
    text: (s, _c, d) => `After you reinforced the border in ${when(d)}, ${name(s, d.n)} has moved two brigades of its own up to the line. Patrols are now within sight of each other.`,
    options: [
      { label: 'Pull back a little', hint: 'Relations +6 · readiness −2%', apply: (s, c, d) => { addRelation(s, c.id, d.n, 6); c.mil.readiness = clamp(c.mil.readiness - 0.02, 0.05, 1); return 'Both sides step back a kilometre.'; } },
      { label: 'Set up a military hotline', hint: 'Costs 6 political capital · relations +12', enabled: hasPC(6), apply: (s, c, d) => { spendPC(c, 6); addRelation(s, c.id, d.n, 12); return 'The generals can now call each other before anyone shoots.'; } },
      { label: 'Hold your ground', hint: 'Relations −6 · readiness +2% · nationalists +3', apply: (s, c, d) => { addRelation(s, c.id, d.n, -6); c.mil.readiness = clamp(c.mil.readiness + 0.02, 0.05, 1); sway(c, 'nationalists', 3); return 'Nobody blinks.'; } },
    ],
    lapse: (s, c, d) => { addRelation(s, c.id, d.n, -4); return 'The stand-off hardens.'; },
  },
  {
    id: 'border_again', icon: '⚠', title: 'Another border incident', weight: 0, cooldown: 0, ttl: 14,
    eligible: () => null,
    text: (s, _c, d) => `${name(s, d.n)} is testing you again. Your protest after the clash in ${when(d)} changed nothing: this time their troops crossed the line and took photos at one of your border posts.`,
    options: [
      { label: 'Reinforce the border this time', hint: 'Costs 0.2% of GDP · readiness +5% · relations −10', enabled: canPay(0.002), apply: (s, c, d) => { pay(s, c, 0.002); c.mil.readiness = clamp(c.mil.readiness + 0.05, 0, 1); addRelation(s, c.id, d.n, -10); sway(c, 'military', 4); return 'Your units dig in.'; } },
      { label: 'Take it to the World Assembly', hint: 'Reputation +2 · relations −6', apply: (s, c, d) => { rep(c, 2); addRelation(s, c.id, d.n, -6); return 'The Assembly passes a mild statement.'; } },
      { label: 'Let it go', hint: 'Military −6 · nationalists −6', apply: (_s, c) => { sway(c, 'military', -6); sway(c, 'nationalists', -6); return 'The generals call it weakness.'; } },
    ],
  },
];

/** Which answer leads to which consequence: option index (−1 = let it lapse), chance, delay in weeks. */
export const FOLLOW_UPS: { after: string; option: number; next: string; chance: number; delay: [number, number] }[] = [
  { after: 'strike', option: 0, next: 'wage_spiral', chance: 0.7, delay: [26, 52] },
  { after: 'strike', option: 2, next: 'strike_return', chance: 0.65, delay: [20, 40] },
  { after: 'scandal', option: 1, next: 'coverup_unravels', chance: 0.75, delay: [30, 70] },
  { after: 'scandal', option: 0, next: 'reform_dividend', chance: 0.6, delay: [40, 70] },
  { after: 'investment', option: 0, next: 'investor_strings', chance: 0.7, delay: [30, 60] },
  { after: 'refugees', option: 0, next: 'refugee_integration', chance: 0.8, delay: [40, 80] },
  { after: 'refugees', option: 1, next: 'border_camps', chance: 0.6, delay: [8, 20] },
  { after: 'disaster', option: 0, next: 'reconstruction_audit', chance: 0.55, delay: [26, 52] },
  { after: 'border_incident', option: 1, next: 'border_titfortat', chance: 0.6, delay: [8, 20] },
  { after: 'border_incident', option: 0, next: 'border_again', chance: 0.45, delay: [20, 45] },
  { after: 'border_incident', option: -1, next: 'border_again', chance: 0.5, delay: [20, 45] },
];

/** Remember the answer and schedule its consequence, if any. */
export function rememberChoice(s: GameState, id: string, option: number, data: D) {
  s.stats[`mem:${id}`] = option + 1;
  s.stats[`memAt:${id}`] = s.tick;
  for (const f of FOLLOW_UPS) {
    if (f.after !== id || f.option !== option || nextRand(s) > f.chance) continue;
    const at = s.tick + f.delay[0] + Math.floor(nextRand(s) * (f.delay[1] - f.delay[0]));
    s.scheduled.push({ tick: at, id: f.next, data: { ...data, t: s.tick } });
  }
}
