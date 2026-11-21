/**
 * Situations: stories that unfold over months, not one-off pop-ups. Each one fits a kind of country (a desert state
 * runs out of water, a monarchy's court plots, a country next to a war takes in its refugees, an indebted one fights its
 * creditors over the price of bread), has two or three stages, and what you choose decides what comes next. The
 * director (director.ts) opens one every few weeks, in a different order every game, so no two games tell the same story.
 */
import { clamp } from './util';
import { type EventDef, type D, canPay as canPayShare, pay as payShare, rep, stab, money } from './eventkit';
/** In this file prices are written the way the player reads them, in percent of GDP ("Costs 0.6% of GDP" is `pay(s, c, 0.6)`). */
const pay = (s: GameState, c: Country, pct: number) => payShare(s, c, pct / 100 / DECISION_COST);
const canPay = (pct: number) => canPayShare(pct / 100 / DECISION_COST);
import { DECISION_COST } from './eventkit';
import { sway } from './domestic';
import { addRelation, getRelation, isAtWar, warsOf } from './relations';
import { logEvent } from './log';
import { nextRand } from './rng';
import { personName } from './leaders';
import type { Country, GameState } from './types';
import type { Geo } from './geo';
import { geoRefGet } from './geoRef';

export interface SitStage { title?: string; /** the stage number shown (branches share one) */ n?: number; text: (s: GameState, c: Country, d: D) => string; options: { label: string; hint: string; enabled?: (s: GameState, c: Country) => boolean; apply: (s: GameState, c: Country, d: D) => string }[] }
export interface Situation {
  id: string; icon: string; title: string;
  /** can it happen to this country now? returns the data it needs (a neighbour, a minister...) */
  pick: (s: GameState, c: Country, geo: Geo) => D | null;
  /** how likely, when it can happen */
  weight: number;
  /** a good way to open a game */
  opener?: boolean;
  /** an emergency: flagged red, and it slows fast-forward down */
  urgent?: boolean;
  stages: SitStage[];
}

const nm = (s: GameState, id: number | undefined) => (id !== undefined && s.countries[id] ? s.countries[id].name : 'a neighbour');
const cash = (c: Country, p: number) => { c.eco.cash += p * c.eco.gdp; };
const appr = (s: GameState, v: number) => { s.stats.apprBoost = (s.stats.apprBoost ?? 0) + v; };
const grow = (c: Country, p: number) => { c.eco.capital += p * c.eco.realGdp; };
const news = (s: GameState, c: Country, text: string) => logEvent(s, text, 'info', [c.id], true, { big: true, prov: c.capital });
/** schedule the next stage of situation `id` in `weeks` */
const then = (s: GameState, id: string, stage: number, weeks: number, d: D, extra: D = {}) => { s.scheduled.push({ tick: s.tick + weeks, id: `sit_${id}_${stage}`, data: { ...d, ...extra } }); };
/** the place it happens: one of the country's own regions, by name */
const at = (d: D) => geoRefGet()?.provinces[d.p]?.name || 'the provinces';
const who = (s: GameState, c: Country, salt: string, d: D) => personName(c, salt, (d.k ?? 0) + s.settings.seed % 89);
/** income per person: the IMF does not come to rich countries */
const rich = (c: Country) => c.eco.realGdp / Math.max(1, c.eco.pop) > 30000;
/** where the earth shakes */
const SEISMIC = new Set(['Turkey', 'Iran', 'Japan', 'Italy', 'Greece', 'Chile', 'Peru', 'Mexico', 'Indonesia', 'Philippines', 'Nepal', 'Pakistan', 'Afghanistan', 'China', 'Taiwan', 'Ecuador', 'Colombia', 'Guatemala', 'Haiti', 'Morocco', 'Algeria', 'New Zealand', 'Syria', 'Jordan', 'Israel', 'Lebanon', 'Armenia', 'Georgia', 'Azerbaijan', 'India', 'Myanmar', 'Papua New Guinea', 'Albania', 'Romania', 'Croatia', 'Iceland', 'United States of America', 'Kyrgyzstan', 'Tajikistan']);
const arid = (c: Country) => ['ME', 'AF', 'SA'].includes(c.region) || c.eco.foodCap < c.eco.foodDemand * 0.8;
const neighbourBy = (s: GameState, c: Country, geo: Geo, ok: (n: Country) => boolean) => {
  const ns = new Set<number>();
  for (const p of c.provinces) for (const q of geo.adj[p] ?? []) { const o = s.owner[q]; if (o >= 0 && o !== c.id) ns.add(o); }
  const list = [...ns].map((i) => s.countries[i]).filter((n) => n?.alive && ok(n));
  return list.length ? list[Math.floor(nextRand(s) * list.length)] : null;
};

export const SITUATIONS: Situation[] = [
  // ------------------------------------------------------------------ the region's troubles
  { id: 'refugees', icon: '⛺', title: 'The refugees', weight: 3, urgent: true, opener: true,
    pick: (s, c, geo) => { const n = neighbourBy(s, c, geo, (x) => isAtWar(s, x.id) || x.eco.stability < 38); return n ? { n: n.id, k: Math.floor(nextRand(s) * 50) } : null; },
    stages: [
      { text: (s, _c, d) => `Columns of families are walking out of ${nm(s, d.n)}, fleeing ${isAtWar(s, d.n) ? 'the war' : 'the chaos'}. Forty thousand are at the border crossings tonight; the UN says ten times as many could follow. Your interior minister wants an answer before morning.`,
        options: [
          { label: 'Open the border', hint: 'Reputation +6 · stability −3 · nationalists angry · Costs 0.6% of GDP', enabled: canPay(0.6), apply: (s, c, d) => { pay(s, c, 0.6); rep(c, 6); stab(c, -3); sway(c, 'nationalists', -6); sway(c, 'liberals', 4); then(s, 'refugees', 1, 14, d, { open: 1 }); return 'The gates open. The world watches, and approves.'; } },
          { label: 'Camps at the border, run with the UN', hint: 'Reputation +3 · Costs 0.3% of GDP · donors may help', enabled: canPay(0.3), apply: (s, c, d) => { pay(s, c, 0.3); rep(c, 3); then(s, 'refugees', 1, 14, d, { open: 0 }); return 'Tents rise in the desert. The UN flag flies over them.'; } },
          { label: 'Close the border', hint: 'Stability +2 · reputation −7 · relations with them −8', apply: (s, c, d) => { stab(c, 2); rep(c, -7); addRelation(s, c.id, d.n, -8); sway(c, 'nationalists', 5); news(s, c, `🚧 ${c.name} closes its border to the refugees of ${nm(s, d.n)}. The images go round the world.`); return 'The border is sealed. Some will not forget the pictures.'; } },
        ] },
      { title: 'The refugees, a year on', text: (s, _c, d) => `${d.open ? 'The refugees are in the cities now' : 'The camps have become towns'}: schools in shifts, rents rising, and a ${d.open ? 'young, hungry workforce' : 'generation growing up behind fences'}. Donors from the West and the Gulf will pay, at a price. ${nm(s, d.n)} is no closer to peace.`,
        options: [
          { label: 'Let them work', hint: 'The labour force grows · growth up · unions and nationalists angry', apply: (_s, c) => { c.eco.laborForce *= 1.01; grow(c, 0.006); sway(c, 'labour', -5); sway(c, 'nationalists', -4); sway(c, 'business', 5); return 'Work permits go out. Bakeries and building sites fill up.'; } },
          { label: 'Ask the donors to pay', hint: 'Treasury +1% of GDP · your hands are tied a little abroad', apply: (s, c) => { cash(c, 0.01); rep(c, 2); news(s, c, `🤝 Donors pledge billions to help ${c.name} carry its refugees.`); return 'A donors’ conference in your capital: the money comes.'; } },
          { label: 'Start sending them home', hint: 'Stability +3 · reputation −6', apply: (_s, c) => { stab(c, 3); rep(c, -6); sway(c, 'nationalists', 6); return 'Buses leave for the border. Not everyone goes willingly.'; } },
        ] },
    ] },
  { id: 'water', icon: '💧', title: 'The wells run dry', weight: 3, opener: true,
    pick: (s, c) => (arid(c) ? { k: Math.floor(nextRand(s) * 50) } : null),
    stages: [
      { text: (s, c, d) => `The aquifer under ${c.name} has dropped another three metres. In ${at(d)} the taps run two days a week. ${who(s, c, 'water', d)}, the water minister, lays out three plans on your desk.`,
        options: [
          { label: 'Build a great desalination plant', hint: 'Costs 1.2% of GDP · in two years: water, jobs, and power for the coast', enabled: canPay(1.2), apply: (s, c, d) => { pay(s, c, 1.2); then(s, 'water', 1, 30, d, { plant: 1 }); return 'Contracts signed: the largest plant in the region.'; } },
          { label: 'Ration water now', hint: 'Stability −4 · approval −3 · nothing to pay', apply: (s, c, d) => { stab(c, -4); appr(s, -3); then(s, 'water', 3, 20, d, { plant: 0 }); return 'Rationing begins. Queues at the water trucks.'; } },
          { label: 'Strike a water deal with a neighbour', hint: 'Relations with a neighbour +10 · cheaper, but you depend on them', apply: (s, c, d) => { const n = s.countries.find((x) => x.alive && x.id !== c.id && x.region === c.region && getRelation(s, c.id, x.id) > 0); if (n) addRelation(s, c.id, n.id, 10); then(s, 'water', 2, 24, d, { plant: 2, n: n?.id ?? -1 }); return n ? `A water-sharing treaty with ${n.name}.` : 'Nobody in the region would sign.'; } },
        ] },
      { title: 'The wells run dry: the plant opens', n: 2, text: () => 'The desalination plant is ready to open. The engineers want a ceremony; the opposition wants to know why it cost so much.',
        options: [
          { label: 'Open it with a national celebration', hint: 'Approval +4 · infrastructure +3 · food production up', apply: (s, c) => { appr(s, 4); c.eco.infra = Math.min(100, c.eco.infra + 3); c.eco.foodCap *= 1.04; news(s, c, `💧 Fresh water flows: ${c.name} opens its great desalination plant.`); return 'Fountains in the main square, for the first time in years.'; } },
          { label: 'Sell the surplus to the neighbours', hint: 'Treasury +0.5% of GDP · relations in the region +4', apply: (s, c) => { cash(c, 0.005); for (const x of s.countries) if (x.alive && x.region === c.region && x.id !== c.id) addRelation(s, c.id, x.id, 2); return 'Pipelines to three neighbours.'; } },
        ] },
      { title: 'The wells run dry: the treaty is tested', n: 2, text: (s, _c, d) => `A dry summer, and ${nm(s, d.n)} wants more for the same water.`,
        options: [
          { label: 'Pay what it takes', hint: 'Costs 0.5% of GDP · stability +3', enabled: canPay(0.5), apply: (s, c) => { pay(s, c, 0.5); stab(c, 3); return 'The water keeps flowing, at a price.'; } },
          { label: 'Refuse and ration', hint: 'Stability −3 · relations with them −8', apply: (s, c, d) => { stab(c, -3); addRelation(s, c.id, d.n, -8); return 'You hold the line. The fields go brown.'; } },
        ] },
      { title: 'The wells run dry: the farmers march', n: 2, text: () => 'Rationing is no longer enough: the farmers are marching on the capital with their dead animals.',
        options: [
          { label: 'Emergency wells and trucks', hint: 'Costs 0.6% of GDP · stability +3 · the regions pleased', enabled: canPay(0.6), apply: (s, c) => { pay(s, c, 0.6); stab(c, 3); sway(c, 'regions', 5); return 'Drilling rigs in every province.'; } },
          { label: 'Stand firm', hint: 'Stability −3 · the farmers and the regions angry', apply: (_s, c) => { stab(c, -3); sway(c, 'regions', -6); return 'The march is stopped at the ring road.'; } },
        ] },
    ] },
  { id: 'patron', icon: '🕌', title: 'A rich friend’s offer', weight: 3, opener: true,
    pick: (s, c) => { const rich = s.countries.filter((x) => x.alive && x.id !== c.id && x.region === c.region && x.eco.gdp > c.eco.gdp * 2 && getRelation(s, c.id, x.id) > -10).sort((a, b) => b.eco.gdp - a.eco.gdp)[0]; return rich ? { n: rich.id } : null; },
    stages: [
      { text: (s, c, d) => `An envoy from ${nm(s, d.n)} arrives with a cheque: ${money(c, 4)} in deposits for your central bank and investment for your cities. In return they want your vote in the World Assembly, and they want you to keep your distance from their rivals. Nothing in writing.`,
        options: [
          { label: 'Take the money', hint: 'Treasury +2% of GDP · relations with them +15 · you owe them', apply: (s, c, d) => { cash(c, 0.02); addRelation(s, c.id, d.n, 15); then(s, 'patron', 1, 22, d, { took: 1 }); return 'The deposits arrive within the week.'; } },
          { label: 'Take half, promise nothing', hint: 'Treasury +0.8% of GDP · relations +5', apply: (s, c, d) => { cash(c, 0.008); addRelation(s, c.id, d.n, 5); return 'A smaller cheque, and no strings, they say.'; } },
          { label: 'Refuse politely', hint: 'Reputation +3 · nationalists pleased · relations −6', apply: (s, c, d) => { rep(c, 3); sway(c, 'nationalists', 4); addRelation(s, c.id, d.n, -6); return 'You send the envoy home with thanks and nothing else.'; } },
        ] },
      { title: 'A rich friend’s offer: the favour', text: (s, _c, d) => `${nm(s, d.n)} calls in the favour. They want ${d.took ? 'your troops for their border, and your vote against their rival next week' : 'your vote'}. Your foreign minister reminds you how much of the money is already spent.`,
        options: [
          { label: 'Do what they ask', hint: 'Relations with them +10 · reputation −4 · the army grumbles', apply: (s, c, d) => { addRelation(s, c.id, d.n, 10); rep(c, -4); sway(c, 'military', -3); cash(c, 0.005); return 'You deliver. Another cheque follows.'; } },
          { label: 'Refuse: we are not for sale', hint: 'Reputation +4 · approval +3 · they pull their deposits (treasury −1.2% of GDP)', apply: (s, c, d) => { rep(c, 4); appr(s, 3); cash(c, -0.012); addRelation(s, c.id, d.n, -15); news(s, c, `✋ ${c.name} refuses ${nm(s, d.n)}'s demands; the deposits are withdrawn.`); return 'The money goes back. The country cheers.'; } },
        ] },
    ] },
  { id: 'smugglers', icon: '🚚', title: 'Smugglers on the border', weight: 2, urgent: true,
    pick: (s, c, geo) => { const n = neighbourBy(s, c, geo, (x) => x.eco.stability < 50 || isAtWar(s, x.id)); return n ? { n: n.id } : null; },
    stages: [
      { text: (s, _c, d) => `Convoys of drugs and guns are crossing from ${nm(s, d.n)} at night. Last week a border guard was killed near ${at(d)}. The army wants permission to shoot first.`,
        options: [
          { label: 'Let the army loose', hint: 'Stability +2 · the military pleased · risk of a clash with them', apply: (s, c, d) => { stab(c, 2); sway(c, 'military', 5); then(s, 'smugglers', 1, 10, d, { hard: 1 }); return 'Drones over the border, orders to stop every convoy.'; } },
          { label: 'Work with them on it', hint: 'Relations with them +6 · slower, quieter', apply: (s, c, d) => { addRelation(s, c.id, d.n, 6); then(s, 'smugglers', 1, 16, d, { hard: 0 }); return 'Joint patrols are agreed.'; } },
          { label: 'Build a wall', hint: 'Costs 0.5% of GDP · stability +3', enabled: canPay(0.5), apply: (s, c) => { pay(s, c, 0.5); stab(c, 3); return 'Concrete and cameras along the border.'; } },
        ] },
      { title: 'Smugglers on the border: the firefight', text: (s, _c, d) => (d.hard ? `Your soldiers ambushed a convoy, and it turned out to be guarded by men from ${nm(s, d.n)}'s own army. Six dead on both sides. Their capital is furious.` : `The joint patrols caught a smuggling ring that leads all the way to a general in ${nm(s, d.n)}. They are embarrassed and want it kept quiet.`),
        options: [
          { label: 'Demand an apology', hint: 'Approval +3 · relations with them −12', apply: (s, c, d) => { appr(s, 3); addRelation(s, c.id, d.n, -12); return 'You go on television. The country stands with you.'; } },
          { label: 'Settle it quietly', hint: 'Relations with them +8 · reputation +2', apply: (s, c, d) => { addRelation(s, c.id, d.n, 8); rep(c, 2); return 'A quiet deal: the border calms down.'; } },
        ] },
    ] },
  { id: 'bread', icon: '🍞', title: 'The price of bread', weight: 3, opener: true,
    pick: (s, c) => (!rich(c) && (c.eco.debt / c.eco.gdp > 0.55 || c.eco.inflation > 0.06) ? { k: Math.floor(nextRand(s) * 40) } : null),
    stages: [
      { text: (_s, c) => `The International Monetary Fund will lend ${c.name} the money to roll over its debts, on one condition: the bread subsidy goes. A loaf would cost twice as much by spring. Every government that tried this before you had riots.`,
        options: [
          { label: 'Cut the subsidy', hint: 'Treasury +1.5% of GDP · cheaper borrowing · riots likely', apply: (s, c, d) => { cash(c, 0.015); c.eco.debt *= 0.98; then(s, 'bread', 1, 5, d, { cut: 2 }); return 'The decree is signed at midnight.'; } },
          { label: 'Phase it out over three years', hint: 'Treasury +0.6% of GDP · smaller protests', apply: (s, c, d) => { cash(c, 0.006); then(s, 'bread', 1, 8, d, { cut: 1 }); return 'The Fund grumbles, but agrees.'; } },
          { label: 'Refuse the Fund', hint: 'Approval +4 · nationalists and unions pleased · borrowing gets dearer', apply: (s, c) => { appr(s, 4); sway(c, 'labour', 5); sway(c, 'nationalists', 4); c.eco.debt *= 1.01; return 'You tell the Fund no, on live television.'; } },
        ] },
      { title: 'The price of bread: the streets', text: (_s, _c, d) => (d.cut === 2 ? 'Bread doubled overnight. Thousands are in the streets of every city; a bakery has been burned and the police are exhausted.' : 'Prices are creeping up and the unions have called a day of protest. It is smaller than feared, so far.'),
        options: [
          { label: 'Send in the riot police', hint: 'Stability +3 now · reputation −5 · liberals furious', apply: (_s, c) => { stab(c, 3); rep(c, -5); sway(c, 'liberals', -7); return 'The squares are cleared by morning.'; } },
          { label: 'Cash for the poorest families', hint: 'Costs 0.6% of GDP · stability +4 · approval +2', enabled: canPay(0.6), apply: (s, c) => { pay(s, c, 0.6); stab(c, 4); appr(s, 2); return 'A monthly payment for every poor household. The anger cools.'; } },
          { label: 'Address the nation', hint: 'Approval +1 to +5 (better if you are trusted)', apply: (s, c) => { const v = 1 + Math.round(4 * clamp(c.reputation / 100, 0, 1)); appr(s, v); return `You speak for twenty minutes, without notes. Approval +${v}.`; } },
        ] },
    ] },
  { id: 'court', icon: '👑', title: 'Whispers at court', weight: 3, opener: true,
    pick: (s, c) => (c.gov === 'M' || c.gov === 'A' ? { k: Math.floor(nextRand(s) * 40) } : null),
    stages: [
      { text: (s, c, d) => `${who(s, c, 'prince', d)}, ${c.gov === 'M' ? 'a cousin of the royal house' : 'the chief of the presidential guard'}, has been meeting tribal elders and army officers at night. Your intelligence chief says it is a plot. Others say it is only ambition.`,
        options: [
          { label: 'Arrest them before dawn', hint: 'Stability +2 · reputation −4 · the army watches', apply: (s, c, d) => { stab(c, 2); rep(c, -4); then(s, 'court', 1, 9, d, { arrest: 1 }); return 'Armoured cars at the palace gates. The arrests are swift.'; } },
          { label: 'Bring them close: a post at your side', hint: 'The army and the tribes pleased · they may still be dangerous', apply: (s, c, d) => { sway(c, 'military', 4); sway(c, 'regions', 4); then(s, 'court', 1, 18, d, { arrest: 0 }); return 'A new title, a new office, and you keep them where you can see them.'; } },
          { label: 'Watch and wait', hint: 'Nothing now', apply: (s, _c, d) => { then(s, 'court', 1, 12, d, { arrest: 2 }); return 'Your spies keep watching.'; } },
        ] },
      { title: 'Whispers at court: the verdict', text: (_s, _c, d) => (d.arrest === 1 ? 'The trial is set. The evidence is thin, and foreign papers call it a purge. The family of the accused begs for mercy.' : d.arrest === 0 ? 'Your new ally has proved loyal, and popular: crowds chant their name. Some say too popular.' : 'The plotters moved first: a battalion refused orders last night, and was disarmed only at dawn.'),
        options: [
          { label: 'Show mercy', hint: 'Reputation +5 · stability −1', apply: (_s, c) => { rep(c, 5); stab(c, -1); return 'A pardon, and an exile abroad. The country exhales.'; } },
          { label: 'Make an example', hint: 'Stability +3 · reputation −6', apply: (s, c) => { stab(c, 3); rep(c, -6); news(s, c, `⚖ ${c.name}: the plotters are sentenced. No one will try again soon.`); return 'The sentences are harsh, and public.'; } },
          { label: 'Share some power', hint: 'Stability +4 · a reform the liberals welcome · political capital −10', apply: (_s, c) => { stab(c, 4); sway(c, 'liberals', 5); if (c.politics) c.politics.pc = Math.max(0, c.politics.pc - 10); return 'A council is formed; voices are heard at last.'; } },
        ] },
    ] },
  { id: 'spillover', icon: '💥', title: 'The war next door', weight: 4, urgent: true,
    pick: (s, c, geo) => { const n = neighbourBy(s, c, geo, (x) => isAtWar(s, x.id) && !isAtWar(s, c.id)); return n ? { n: n.id } : null; },
    stages: [
      { text: (s, _c, d) => `Shells from the fighting in ${nm(s, d.n)} landed in one of your border villages last night: four dead, a school destroyed. Militias on the other side are using your territory to move men.`,
        options: [
          { label: 'Fortify the border and warn both sides', hint: 'Costs 0.4% of GDP · stability +2', enabled: canPay(0.4), apply: (s, c) => { pay(s, c, 0.4); stab(c, 2); return 'Tanks on the border, a stern statement to both capitals.'; } },
          { label: 'Strike the militias', hint: 'Approval +3 · the military pleased · relations with them −10', apply: (s, c, d) => { appr(s, 3); sway(c, 'military', 5); addRelation(s, c.id, d.n, -10); then(s, 'spillover', 1, 10, d); return 'Your jets hit three camps across the border.'; } },
          { label: 'Offer to mediate', hint: 'Reputation +4 · they may refuse', apply: (s, c) => { rep(c, 4); s.stats.mediations = (s.stats.mediations ?? 0) + 1; return 'You invite both sides to your capital.'; } },
        ] },
      { title: 'The war next door: the answer', text: (s, _c, d) => `The militias answered: a rocket hit a market in your border town. ${nm(s, d.n)} denies all knowledge. Your generals want to go in.`,
        options: [
          { label: 'Hold back: no war of ours', hint: 'Approval −2 · reputation +3', apply: (s, c) => { appr(s, -2); rep(c, 3); return 'You bury the dead and keep your army home.'; } },
          { label: 'A buffer zone across the border', hint: 'The military pleased · stability +2 · relations with them −15 · reputation −3', apply: (s, c, d) => { sway(c, 'military', 6); stab(c, 2); addRelation(s, c.id, d.n, -15); rep(c, -3); news(s, c, `🪖 ${c.name} sends troops ten kilometres into ${nm(s, d.n)} to create a buffer zone.`); return 'Your troops dig in on the other side.'; } },
        ] },
    ] },
  // ------------------------------------------------------------------ anywhere
  { id: 'gas', icon: '🔥', title: 'Gas under the sea', weight: 2, opener: true,
    pick: (s, c) => (c.eco.energyCap < c.eco.energyDemand * 1.1 && nextRand(s) < 0.7 ? { k: Math.floor(nextRand(s) * 40) } : null),
    stages: [
      { text: (_s, c) => `Geologists have found a gas field off ${c.name}'s coast, possibly the largest in a generation. Three suitors want to develop it: a Western major, an Eastern state giant, and your own national company, which is slower and poorer.`,
        options: [
          { label: 'The Western major', hint: 'Fast: first gas in 18 months · relations with the West +8 · they keep a big share', apply: (s, c, d) => { for (const x of s.countries) if (x.alive && (x.orient ?? 0) > 0.5 && x.id !== c.id) addRelation(s, c.id, x.id, 3); c.orient = clamp((c.orient ?? 0) + 0.05, -1, 1); then(s, 'gas', 1, 30, d, { who: 1 }); return 'A signing ceremony in your capital, with their ambassador.'; } },
          { label: 'The Eastern giant', hint: 'Fast and cheap · relations with the East +8 · the West uneasy', apply: (s, c, d) => { for (const x of s.countries) if (x.alive && (x.orient ?? 0) < -0.5 && x.id !== c.id) addRelation(s, c.id, x.id, 3); c.orient = clamp((c.orient ?? 0) - 0.05, -1, 1); then(s, 'gas', 1, 30, d, { who: 2 }); return 'The deal is signed in their capital.'; } },
          { label: 'Our own national company', hint: 'Slow (three years) · you keep every dollar · nationalists pleased', apply: (s, c, d) => { sway(c, 'nationalists', 5); then(s, 'gas', 1, 52, d, { who: 0 }); return 'The flag goes on the drilling rig.'; } },
        ] },
      { title: 'Gas under the sea: first gas', text: (_s, c, d) => `First gas flows ashore. ${d.who ? 'Your foreign partner takes its share' : `Every dollar stays in ${c.name}`}. How will you use the windfall?`,
        options: [
          { label: 'A sovereign fund for the future', hint: 'Treasury +2% of GDP · energy production up', apply: (s, c, d) => { cash(c, d.who ? 0.015 : 0.025); c.eco.energyCap *= 1.12; news(s, c, `🔥 First gas: ${c.name} becomes an energy producer.`); return 'A fund for the next generation.'; } },
          { label: 'Cheaper energy for every home', hint: 'Approval +5 · energy production up', apply: (s, c) => { appr(s, 5); c.eco.energyCap *= 1.12; return 'Bills fall by a third. The country notices.'; } },
        ] },
    ] },
  { id: 'scandal', icon: '📰', title: 'The minister’s villa', weight: 3, opener: true,
    pick: (s, c) => { const m = (c.cabinet ?? [])[Math.floor(nextRand(s) * Math.max(1, (c.cabinet ?? []).length))]; return m ? { m: m.id } : { m: -1 }; },
    stages: [
      { text: (s, c, d) => { const m = (c.cabinet ?? []).find((x) => x.id === d.m); return `A newspaper has photographs of the seaside villa of ${m?.name ?? 'one of your ministers'}, bought for cash, worth ten years of a minister's salary. The paper says there is more to come.`; },
        options: [
          { label: 'Sack them today', hint: 'Approval +2 · the cabinet nervous', apply: (s, c, d) => { appr(s, 2); const m = (c.cabinet ?? []).find((x) => x.id === d.m); if (m) m.loyalty = clamp(m.loyalty - 40, 0, 100); return 'The resignation is on your desk by noon.'; } },
          { label: 'Order an independent inquiry', hint: 'Reputation +3 · it may find more', apply: (s, c, d) => { rep(c, 3); then(s, 'scandal', 1, 12, d); return 'A retired judge is appointed. The cameras follow her.'; } },
          { label: 'Defend them: a smear', hint: 'The cabinet loyal · approval −3 · it may come back', apply: (s, _c, d) => { appr(s, -3); if (nextRand(s) < 0.5) then(s, 'scandal', 1, 16, d, { cover: 1 }); return 'You call it a campaign of lies.'; } },
        ] },
      { title: 'The minister’s villa: what the inquiry found', text: (_s, _c, d) => (d.cover ? 'The second batch of photographs is worse: bank transfers, and your own party treasurer in one of them.' : 'The inquiry found a network: contracts for friends, at every level of three ministries.'),
        options: [
          { label: 'Clean house, whatever it costs', hint: 'Reputation +6 · stability −3 · political capital −10', apply: (s, c) => { rep(c, 6); stab(c, -3); if (c.politics) c.politics.pc = Math.max(0, c.politics.pc - 10); news(s, c, `🧹 ${c.name}: a purge of corrupt officials reaches the top of three ministries.`); return 'Dozens arrested. Your approval among the young soars.'; } },
          { label: 'Limit the damage', hint: 'Approval −3 · reputation −2', apply: (s, c) => { appr(s, -3); rep(c, -2); return 'A few names fall; the rest stay.'; } },
        ] },
    ] },
  { id: 'strike', icon: '✊', title: 'The general strike', weight: 2,
    pick: (s, c) => (c.eco.inflation > 0.035 || c.eco.unemployment > 0.07 ? { k: 1 } : null),
    stages: [
      { text: (_s, c) => `The unions have called a general strike: ports, railways and power stations in ${c.name} stop at midnight. They want wages that keep up with prices.`,
        options: [
          { label: 'Meet them halfway', hint: 'Costs 0.5% of GDP · unions pleased · inflation a little higher', enabled: canPay(0.5), apply: (s, c) => { pay(s, c, 0.5); sway(c, 'labour', 7); c.eco.inflation += 0.004; return 'A deal at four in the morning. The trains run again.'; } },
          { label: 'Wait them out', hint: 'Growth suffers for a few weeks · business pleased', apply: (s, c, d) => { grow(c, -0.004); sway(c, 'business', 5); sway(c, 'labour', -6); then(s, 'strike', 1, 4, d); return 'The ports stay shut. The cabinet holds its nerve.'; } },
          { label: 'Declare it illegal', hint: 'Stability −3 · unions furious · the strike ends', apply: (_s, c) => { stab(c, -3); sway(c, 'labour', -12); return 'Soldiers drive the trains.'; } },
        ] },
      { title: 'The general strike: week four', text: () => 'The strike is four weeks old. Shelves are emptying, and both sides are tired.',
        options: [
          { label: 'Settle now', hint: 'Costs 0.3% of GDP · stability +2', enabled: canPay(0.3), apply: (s, c) => { pay(s, c, 0.3); stab(c, 2); return 'A face-saving deal.'; } },
          { label: 'Hold firm to the end', hint: 'The unions break · business pleased · labour bitter', apply: (_s, c) => { sway(c, 'business', 4); sway(c, 'labour', -8); return 'The unions go back with nothing.'; } },
        ] },
    ] },
  { id: 'quake', icon: '🌋', title: 'The earthquake', weight: 2, urgent: true,
    pick: (s, c) => (SEISMIC.has(c.name) && nextRand(s) < 0.7 ? { k: Math.floor(nextRand(s) * 40) } : null),
    stages: [
      { text: (_s, _c, d) => `A magnitude-7 earthquake has struck ${at(d)}. Whole towns are rubble. The first hours decide how many live.`,
        options: [
          { label: 'Everything we have', hint: 'Costs 1% of GDP · approval +4 · stability +2', enabled: canPay(1), apply: (s, c, d) => { pay(s, c, 1); appr(s, 4); stab(c, 2); then(s, 'quake', 1, 10, d, { full: 1 }); return 'The army, the hospitals, every crane in the country.'; } },
          { label: 'Ask the world for help', hint: 'Reputation +3 · relations with your partners +4 · aid arrives', apply: (s, c, d) => { rep(c, 3); cash(c, 0.004); for (const x of s.countries) if (x.alive && getRelation(s, c.id, x.id) > 30) addRelation(s, c.id, x.id, 4); then(s, 'quake', 1, 10, d, { full: 0 }); return 'Rescue teams from thirty countries.'; } },
        ] },
      { title: 'The earthquake: rebuilding', text: () => 'The rescue is over. Now the rebuilding, and the questions about why the new buildings fell first.',
        options: [
          { label: 'Rebuild better', hint: 'Costs 0.8% of GDP · infrastructure +4', enabled: canPay(0.8), apply: (s, c) => { pay(s, c, 0.8); c.eco.infra = Math.min(100, c.eco.infra + 4); return 'New towns, built to last.'; } },
          { label: 'Prosecute the builders', hint: 'Approval +3 · reputation +2', apply: (s, c) => { appr(s, 3); rep(c, 2); news(s, c, `⚖ ${c.name}: the builders whose towers collapsed go on trial.`); return 'Fifty developers in the dock.'; } },
        ] },
    ] },
  { id: 'cyber', icon: '💻', title: 'The blackout', weight: 2,
    pick: (s, c) => { const r = s.countries.filter((x) => x.alive && x.id !== c.id && getRelation(s, c.id, x.id) < -30 && x.eco.tech > c.eco.tech).sort((a, b) => getRelation(s, c.id, a.id) - getRelation(s, c.id, b.id))[0]; return r ? { n: r.id } : null; },
    stages: [
      { text: (s, _c, d) => `The banks are offline and half the capital has no power: a cyberattack. Your security services trace it to hackers working for ${nm(s, d.n)}.`,
        options: [
          { label: 'Hit back in kind', hint: 'Relations with them −10 · approval +2 · a second wave possible', apply: (s, c, d) => { addRelation(s, c.id, d.n, -10); appr(s, 2); then(s, 'cyber', 1, 8, d); return 'Their ministry of finance goes dark for a day.'; } },
          { label: 'Name and shame them', hint: 'Reputation +3 · relations with them −6', apply: (s, c, d) => { rep(c, 3); addRelation(s, c.id, d.n, -6); return 'Evidence laid out before the World Assembly.'; } },
          { label: 'Invest in our defences', hint: 'Costs 0.4% of GDP · technology +0.5', enabled: canPay(0.4), apply: (s, c) => { pay(s, c, 0.4); c.eco.tech += 0.5; return 'A new cyber command.'; } },
        ] },
      { title: 'The blackout: the second wave', text: (s, _c, d) => `${nm(s, d.n)} answered: your air traffic control was down for six hours this morning.`,
        options: [
          { label: 'Talk: a hotline between us', hint: 'Relations with them +8', apply: (s, c, d) => { addRelation(s, c.id, d.n, 8); return 'A quiet agreement: no more.'; } },
          { label: 'Escalate', hint: 'Relations with them −10 · the military pleased', apply: (s, c, d) => { addRelation(s, c.id, d.n, -10); sway(c, 'military', 4); return 'The cyber war goes on.'; } },
        ] },
    ] },
  { id: 'unicorn', icon: '🦄', title: 'The startup', weight: 2, opener: true,
    pick: (s, c) => (c.eco.tech > 40 || nextRand(s) < 0.3 ? { k: Math.floor(nextRand(s) * 40) } : null),
    stages: [
      { text: (s, c, d) => `${who(s, c, 'founder', d)}, twenty-nine, built an app in a garage in ${c.name}'s capital. It is now worth billions, and a foreign giant wants to buy it.`,
        options: [
          { label: 'Back them: a national champion', hint: 'Costs 0.3% of GDP · technology +1 · growth up', enabled: canPay(0.3), apply: (s, c, d) => { pay(s, c, 0.3); c.eco.tech += 1; grow(c, 0.004); then(s, 'unicorn', 1, 26, d); return 'A state fund invests. The founder is on every front page.'; } },
          { label: 'Let them sell', hint: 'Treasury +0.4% of GDP in taxes · business pleased', apply: (_s, c) => { cash(c, 0.004); sway(c, 'business', 4); return 'The sale makes a hundred millionaires.'; } },
        ] },
      { title: 'The startup: grown up', text: () => 'The champion has grown: ten thousand jobs, and an office abroad. Now it wants a lower tax rate, or it will move.',
        options: [
          { label: 'Give it the tax break', hint: 'Growth up · the unions grumble', apply: (_s, c) => { grow(c, 0.004); sway(c, 'labour', -3); return 'It stays.'; } },
          { label: 'Call its bluff', hint: 'Approval +2 · a chance it leaves', apply: (s, c) => { appr(s, 2); if (nextRand(s) < 0.4) { grow(c, -0.003); news(s, c, `✈ ${c.name}'s tech champion moves its headquarters abroad.`); return 'It leaves.'; } return 'It stays, and pays.'; } },
        ] },
    ] },
  { id: 'spies', icon: '🕵', title: 'The spy ring', weight: 2,
    pick: (s, c) => { const r = s.countries.filter((x) => x.alive && x.id !== c.id && x.eco.gdp > c.eco.gdp && getRelation(s, c.id, x.id) < 10).sort(() => nextRand(s) - 0.5)[0]; return r ? { n: r.id } : null; },
    stages: [
      { text: (s, _c, d) => `Your counter-intelligence has caught a spy ring: three officials selling defence secrets to ${nm(s, d.n)}.`,
        options: [
          { label: 'Expel their diplomats', hint: 'Relations with them −10 · approval +2', apply: (s, c, d) => { addRelation(s, c.id, d.n, -10); appr(s, 2); return 'Twelve diplomats on the next plane home.'; } },
          { label: 'Turn the spies', hint: 'Your intelligence improves · it may come out', apply: (_s, c) => { c.mil.intel = clamp((c.mil.intel ?? 0) + 0.1, 0, 2); return 'Now they work for you.'; } },
          { label: 'Trade them quietly', hint: 'Relations with them +4', apply: (s, c, d) => { addRelation(s, c.id, d.n, 4); return 'A swap on a bridge at dawn.'; } },
        ] },
    ] },
  { id: 'movement', icon: '📱', title: 'The young are angry', weight: 2, opener: true,
    pick: (s, c) => (c.eco.unemployment > 0.06 || c.eco.stability < 55 ? { k: 1 } : null),
    stages: [
      { text: (_s, c) => `A hashtag has become a movement: hundreds of thousands of young people in ${c.name} say there is no future for them here. They are organising online, and the squares are filling every evening.`,
        options: [
          { label: 'Meet them: a youth council', hint: 'Liberals pleased · approval +3 · they will want more', apply: (s, c, d) => { sway(c, 'liberals', 6); appr(s, 3); then(s, 'movement', 1, 16, d, { met: 1 }); return 'You sit on the floor with them, on camera.'; } },
          { label: 'A jobs plan for the young', hint: 'Costs 0.6% of GDP · unemployment down', enabled: canPay(0.6), apply: (s, c) => { pay(s, c, 0.6); c.eco.unemployment = Math.max(0.02, c.eco.unemployment - 0.008); return 'Apprenticeships, start-up grants, a first job guaranteed.'; } },
          { label: 'Block the platforms', hint: 'Stability +2 now · reputation −5 · liberals furious', apply: (s, c, d) => { stab(c, 2); rep(c, -5); sway(c, 'liberals', -8); then(s, 'movement', 1, 10, d, { met: 0 }); return 'The internet slows to a crawl.'; } },
        ] },
      { title: 'The young are angry: what they want now', text: (_s, _c, d) => (d.met ? 'The youth council has a list: lower the voting age, a free university, an end to the old guard. The old guard in your party is horrified.' : 'The blackout made them martyrs. The movement is larger than ever, and it has a leader now.'),
        options: [
          { label: 'Give them a real voice', hint: 'Liberals pleased · approval +3 · nationalists unhappy', apply: (s, c) => { sway(c, 'liberals', 5); sway(c, 'nationalists', -3); appr(s, 3); news(s, c, `🗳 ${c.name} lowers the voting age to sixteen after months of youth protests.`); return 'A generation enters politics.'; } },
          { label: 'Wait for it to fade', hint: 'Approval −2', apply: (s) => { appr(s, -2); return 'Summer comes; the squares empty, for now.'; } },
        ] },
    ] },
  { id: 'investor', icon: '🏗', title: 'The giant factory', weight: 2, opener: true,
    pick: (s, c) => { const big = s.countries.filter((x) => x.alive && x.id !== c.id && x.eco.gdp > c.eco.gdp * 3 && getRelation(s, c.id, x.id) > 0).sort((a, b) => b.eco.gdp - a.eco.gdp)[Math.floor(nextRand(s) * 3)]; return big ? { n: big.id } : null; },
    stages: [
      { text: (s, _c, d) => `A car maker from ${nm(s, d.n)} wants to build its biggest factory outside home in your country: twenty thousand jobs. It wants ten years without taxes and the land for free.`,
        options: [
          { label: 'Yes, on their terms', hint: 'Growth up · unemployment down · relations with them +6', apply: (s, c, d) => { grow(c, 0.008); c.eco.unemployment = Math.max(0.02, c.eco.unemployment - 0.006); addRelation(s, c.id, d.n, 6); news(s, c, `🏭 ${nm(s, d.n)}'s car giant will build its new factory in ${c.name}.`); return 'Ground breaks within a month.'; } },
          { label: 'Yes, but local jobs and suppliers', hint: 'Growth up a little · a chance they walk away', apply: (s, c) => { if (nextRand(s) < 0.6) { grow(c, 0.006); sway(c, 'labour', 4); return 'They agree, after a fight.'; } return 'They take the factory to your neighbour instead.'; } },
          { label: 'No: we will not sell our land', hint: 'Nationalists pleased · business disappointed', apply: (_s, c) => { sway(c, 'nationalists', 4); sway(c, 'business', -4); return 'The factory goes elsewhere.'; } },
        ] },
    ] },
  { id: 'cup', icon: '⚽', title: 'The final', weight: 1,
    pick: () => ({ k: 1 }),
    stages: [
      { text: (_s, c) => `Against all odds, ${c.name}'s national team is in the final of the continental championship. The country has stopped working. Your advisers want you in the stadium.`,
        options: [
          { label: 'Go, and wear the shirt', hint: 'Approval +2, more if they win', apply: (s, c) => { const win = nextRand(s) < 0.45; appr(s, win ? 6 : 1); if (win) { stab(c, 3); news(s, c, `🏆 ${c.name} are champions! The streets are full all night.`); } return win ? 'They won! You are in every photograph.' : 'They lost on penalties. You hugged the goalkeeper.'; } },
          { label: 'Bid to host the World Cup', hint: 'Costs 0.8% of GDP · reputation +5 · infrastructure +2', enabled: canPay(0.8), apply: (s, c) => { pay(s, c, 0.8); rep(c, 5); c.eco.infra = Math.min(100, c.eco.infra + 2); return 'The bid goes in.'; } },
        ] },
    ] },
  { id: 'outbreak', icon: '🦠', title: 'The outbreak', weight: 1, urgent: true,
    pick: () => ({ k: 1 }),
    stages: [
      { text: (_s, c, d) => `A new fever is spreading in ${at(d)}, ${c.name}. Twelve dead this week, and the hospitals are filling. It is not yet abroad.`,
        options: [
          { label: 'Seal the city', hint: 'Growth suffers · stability −2 · the outbreak contained', apply: (s, c) => { grow(c, -0.004); stab(c, -2); rep(c, 3); return 'Checkpoints at every road out.'; } },
          { label: 'Test and trace', hint: 'Costs 0.4% of GDP · a chance it spreads', enabled: canPay(0.4), apply: (s, c, d) => { pay(s, c, 0.4); if (nextRand(s) < 0.35) then(s, 'outbreak', 1, 6, d); return 'Mobile labs in every district.'; } },
          { label: 'Play it down', hint: 'Nothing now · a real risk', apply: (s, _c, d) => { if (nextRand(s) < 0.65) then(s, 'outbreak', 1, 6, d); return 'The ministry says the situation is under control.'; } },
        ] },
      { title: 'The outbreak: it spreads', text: () => 'The fever is in the capital. Schools are emptying; the neighbours are closing their borders to your people.',
        options: [
          { label: 'National lockdown', hint: 'Growth suffers more · stability −3 · it ends', apply: (_s, c) => { grow(c, -0.008); stab(c, -3); return 'The country stays home for six weeks.'; } },
          { label: 'Buy vaccines at any price', hint: 'Costs 0.8% of GDP · approval +2', enabled: canPay(0.8), apply: (s, c) => { pay(s, c, 0.8); appr(s, 2); return 'The first planes of vaccine land.'; } },
        ] },
    ] },
  { id: 'currency', icon: '💱', title: 'A run on the currency', weight: 2, urgent: true,
    pick: (_s, c) => (!rich(c) && (c.eco.debt / c.eco.gdp > 0.7 || c.eco.inflation > 0.08) ? { k: 1 } : null),
    stages: [
      { text: (_s, c) => `Speculators are betting against ${c.name}'s currency. It lost eight percent this week; people are queuing to buy dollars.`,
        options: [
          { label: 'Spend the reserves to defend it', hint: 'Treasury −1% of GDP · calm returns', apply: (_s, c) => { cash(c, -0.01); stab(c, 2); return 'The central bank buys and buys. The run stops.'; } },
          { label: 'Raise interest rates sharply', hint: 'Growth suffers · inflation falls', apply: (_s, c) => { grow(c, -0.006); c.eco.inflation = Math.max(0, c.eco.inflation - 0.015); return 'Rates up five points overnight.'; } },
          { label: 'Let it fall', hint: 'Exports cheaper · inflation up · approval −3', apply: (s, c) => { c.eco.inflation += 0.02; appr(s, -3); grow(c, 0.002); return 'It falls a fifth. Holidays abroad are over.'; } },
        ] },
    ] },
  { id: 'plot', icon: '🎯', title: 'The plot against you', weight: 1, urgent: true,
    pick: (s, c) => (c.eco.stability < 60 ? { k: Math.floor(nextRand(s) * 30) } : null),
    stages: [
      { text: () => 'Your security services have foiled a plot to kill you at next week’s parade. The bomb maker is in custody. He will not say who sent him.',
        options: [
          { label: 'A night of arrests', hint: 'Stability +3 · reputation −4', apply: (_s, c) => { stab(c, 3); rep(c, -4); return 'Two hundred detained by morning.'; } },
          { label: 'Go to the parade anyway', hint: 'Approval +5 · the country rallies', apply: (s, c) => { appr(s, 5); stab(c, 2); news(s, c, `🎖 ${c.name}'s leader rides through the parade in an open car, days after a foiled assassination.`); return 'An open car, and the crowd roars.'; } },
          { label: 'Follow the money abroad', hint: 'It may lead to a foreign power', apply: (s, c) => { const f = s.countries.filter((x) => x.alive && x.id !== c.id && getRelation(s, c.id, x.id) < -30)[0]; if (f) { addRelation(s, c.id, f.id, -10); return `The money leads to ${f.name}. You recall your ambassador.`; } return 'The trail goes cold in a bank abroad.'; } },
        ] },
    ] },
  // ------------------------------------------------------------------ more of life
  { id: 'heatwave', icon: '🌡', title: 'The heatwave', weight: 2, urgent: true,
    pick: (s, c) => (['ME', 'AF', 'SA', 'EU', 'NA', 'SEA'].includes(c.region) ? { k: Math.floor(nextRand(s) * 30) } : null),
    stages: [{ text: (_s, _c, d) => `Forty-eight degrees in ${at(d)}. Air conditioners are overloading the grid; the hospitals are full of the old. The grid operator says blackouts are hours away.`,
      options: [
        { label: 'Buy power from abroad at any price', hint: 'Costs 0.4% of GDP · stability +2', enabled: canPay(0.4), apply: (s, c) => { pay(s, c, 0.4); stab(c, 2); return 'Imported power keeps the lights on.'; } },
        { label: 'Rolling blackouts, fairly shared', hint: 'Stability −2 · approval −2', apply: (s, c) => { stab(c, -2); appr(s, -2); return 'Two hours dark in every district, every day.'; } },
        { label: 'Fire up the old coal plants', hint: 'Energy production up · reputation −3 · the liberals unhappy', apply: (_s, c) => { c.eco.energyCap *= 1.03; rep(c, -3); sway(c, 'liberals', -4); return 'Smoke over the capital, but the lights stay on.'; } },
      ] }] },
  { id: 'miners', icon: '⛏', title: 'Trapped underground', weight: 1, urgent: true,
    pick: (s, c) => (c.eco.energyCap > c.eco.energyDemand * 0.6 ? { k: Math.floor(nextRand(s) * 30) } : null),
    stages: [{ text: (_s, _c, d) => `A shaft has collapsed at a mine in ${at(d)}: thirty-three miners trapped 700 metres down, alive. Foreign rescue teams are offering help; your own engineers say they can do it.`,
      options: [
        { label: 'Everything, and the world’s best drill', hint: 'Costs 0.2% of GDP · approval +4 if they live', enabled: canPay(0.2), apply: (s, c, d) => { pay(s, c, 0.2); const ok = nextRand(s) < 0.85; appr(s, ok ? 5 : -2); if (ok) news(s, c, `⛏ All thirty-three miners of ${at(d)} are brought up alive, after nineteen days.`); return ok ? 'All thirty-three come up alive. The nation weeps with joy.' : 'They reached them too late.'; } },
        { label: 'Trust our own engineers', hint: 'Nationalists pleased · a real risk', apply: (s, c) => { const ok = nextRand(s) < 0.6; sway(c, 'nationalists', 3); appr(s, ok ? 4 : -4); return ok ? 'Our own engineers bring them home.' : 'Eleven are lost. The inquiry starts tomorrow.'; } },
      ] }] },
  { id: 'hostages', icon: '🎒', title: 'Kidnapped abroad', weight: 1, urgent: true,
    pick: (s) => { const f = s.countries.filter((x) => x.alive && (x.eco.stability < 35 || isAtWar(s, x.id)) && x.id !== s.player)[0]; return f ? { n: f.id, k: Math.floor(nextRand(s) * 30) } : null; },
    stages: [{ text: (s, _c, d) => `Six aid workers from your country have been kidnapped by militants in ${nm(s, d.n)}. A video demands a ransom and the release of prisoners.`,
      options: [
        { label: 'Pay, quietly', hint: 'Costs 0.1% of GDP · they come home · reputation −2', enabled: canPay(0.1), apply: (s, c) => { pay(s, c, 0.1); rep(c, -2); appr(s, 2); return 'A plane lands at dawn with six people on it.'; } },
        { label: 'Send in the special forces', hint: 'A rescue raid: glory or tragedy', apply: (s, c, d) => { const ok = nextRand(s) < 0.55 + 0.1 * (c.mil.intel ?? 0); appr(s, ok ? 6 : -5); sway(c, 'military', ok ? 6 : -4); if (ok) news(s, c, `🪂 ${c.name}'s special forces free six hostages in a night raid in ${nm(s, d.n)}.`); return ok ? 'All six free. The commandos are heroes.' : 'Two hostages die in the raid.'; } },
        { label: 'We do not negotiate', hint: 'Reputation +2 · approval −2', apply: (s, c) => { rep(c, 2); appr(s, -2); return 'You hold the line. The families are on every channel.'; } },
      ] }] },
  { id: 'preacher', icon: '📿', title: 'The sermon', weight: 2,
    pick: (s, c) => (['ME', 'AF', 'SA', 'SEA'].includes(c.region) || c.gov === 'T' ? { k: Math.floor(nextRand(s) * 30) } : null),
    stages: [{ text: (s, c, d) => `${who(s, c, 'cleric', d)}, the most popular preacher in ${at(d)}, called your reforms an insult to the faith in last Friday’s sermon. Millions watched it online. Crowds gather outside his mosque.`,
      options: [
        { label: 'Visit him and listen', hint: 'Stability +2 · liberals uneasy', apply: (_s, c) => { stab(c, 2); sway(c, 'liberals', -3); return 'Tea, and a long talk. He softens, a little.'; } },
        { label: 'Ignore him', hint: 'Nothing now · his following grows', apply: (_s, c) => { stab(c, -1); return 'You say nothing. He says more.'; } },
        { label: 'Have him detained', hint: 'Stability −3 · reputation −4 · the liberals split', apply: (_s, c) => { stab(c, -3); rep(c, -4); return 'Police at the mosque at dawn. The country is divided.'; } },
      ] }] },
  { id: 'minority', icon: '🗣', title: 'A language of our own', weight: 2,
    pick: (s, c) => (c.provinces.length >= 6 ? { k: Math.floor(nextRand(s) * 30) } : null),
    stages: [
      { text: (_s, _c, d) => `The people of ${at(d)} want their own language in their schools and courts. Half a million signed the petition; their leaders hint at worse if you refuse.`,
        options: [
          { label: 'Grant it', hint: 'The regions pleased · nationalists angry', apply: (s, c, d) => { sway(c, 'regions', 7); sway(c, 'nationalists', -6); then(s, 'minority', 1, 30, d, { yes: 1 }); return 'A law for the language passes.'; } },
          { label: 'Only in the schools', hint: 'A compromise: smaller effects both ways', apply: (_s, c) => { sway(c, 'regions', 3); sway(c, 'nationalists', -2); return 'A half-step. Nobody is happy, nobody marches.'; } },
          { label: 'One nation, one language', hint: 'Nationalists pleased · the region restless', apply: (s, c, d) => { sway(c, 'nationalists', 6); sway(c, 'regions', -7); stab(c, -2); then(s, 'minority', 1, 20, d, { yes: 0 }); return 'The petition is rejected.'; } },
        ] },
      { title: 'A language of our own: a year later', text: (_s, _c, d) => (d.yes ? `${at(d)} is calmer, prouder, and now asks for its own budget.` : `Strikes in ${at(d)}. A radical party wins the local elections there on a separatist ticket.`),
        options: [
          { label: 'Devolve power', hint: 'Stability +3 · the regions pleased · the central budget a little smaller', apply: (_s, c) => { stab(c, 3); sway(c, 'regions', 5); cash(c, -0.003); return 'A regional parliament is opened.'; } },
          { label: 'Hold the centre', hint: 'Nationalists pleased · stability −2', apply: (_s, c) => { sway(c, 'nationalists', 4); stab(c, -2); return 'Not one step further.'; } },
        ] },
    ] },
  { id: 'braindrain', icon: '🩺', title: 'The doctors are leaving', weight: 2,
    pick: (s, c) => (c.eco.realGdp / c.eco.pop < 30000 ? { k: 1 } : null),
    stages: [{ text: (_s, c) => `One in five of ${c.name}'s young doctors has left for richer countries in the last two years. Rural hospitals are closing wards.`,
      options: [
        { label: 'Double their pay', hint: 'Costs 0.5% of GDP · stability +2', enabled: canPay(0.5), apply: (s, c) => { pay(s, c, 0.5); stab(c, 2); return 'The exodus slows.'; } },
        { label: 'Recruit doctors from abroad', hint: 'Cheaper · nationalists grumble', apply: (_s, c) => { sway(c, 'nationalists', -3); stab(c, 1); return 'Doctors arrive from three continents.'; } },
        { label: 'Make them serve five years first', hint: 'Liberals angry · the wards reopen', apply: (_s, c) => { sway(c, 'liberals', -5); stab(c, 2); return 'A new law: train here, serve here.'; } },
      ] }] },
  { id: 'tycoon', icon: '💼', title: 'The tycoon', weight: 2,
    pick: (s, c) => ({ k: Math.floor(nextRand(s) * 40) }),
    stages: [
      { text: (s, c, d) => `${who(s, c, 'tycoon', d)}, ${c.name}'s richest man, has bought the biggest television channel and is said to be building a party. He wants a meeting.`,
        options: [
          { label: 'Make him an ally', hint: 'Business pleased · the channel on your side · approval +2', apply: (s, c, d) => { sway(c, 'business', 5); appr(s, 2); then(s, 'tycoon', 1, 30, d, { ally: 1 }); return 'Dinner at his estate. A friendship of convenience.'; } },
          { label: 'Investigate his taxes', hint: 'Treasury +0.3% of GDP · a powerful enemy', apply: (s, c, d) => { cash(c, 0.003); sway(c, 'business', -4); then(s, 'tycoon', 1, 30, d, { ally: 0 }); return 'The tax inspectors arrive at his office.'; } },
        ] },
      { title: 'The tycoon makes his move', text: (_s, _c, d) => (d.ally ? 'Your friend wants payment: a motorway contract for his company, without a tender.' : 'He has launched his party. Its slogan is your name with a line through it.'),
        options: [
          { label: 'Give him what he wants', hint: 'Business pleased · reputation −4', apply: (_s, c) => { sway(c, 'business', 4); rep(c, -4); return 'The contract is signed.'; } },
          { label: 'Fight him in the open', hint: 'Approval +2 · liberals pleased · business angry', apply: (s, c) => { appr(s, 2); sway(c, 'liberals', 4); sway(c, 'business', -4); return 'You take him on, live, in a televised debate.'; } },
        ] },
    ] },
  { id: 'vendor', icon: '📡', title: 'Whose network?', weight: 2,
    pick: (s, c) => (Math.abs(c.orient ?? 0) < 0.8 ? { k: 1 } : null),
    stages: [{ text: (_s, c) => `${c.name} is building its new mobile network. The cheapest bid is from an Eastern giant; the Western powers say that if you take it, they will stop sharing intelligence.`,
      options: [
        { label: 'The Eastern bid: cheaper and faster', hint: 'Growth up · relations with the East +5 · the West −5', apply: (s, c) => { grow(c, 0.004); for (const x of s.countries) if (x.alive && x.id !== c.id && Math.abs(x.orient ?? 0) > 0.6) addRelation(s, c.id, x.id, (x.orient ?? 0) < 0 ? 5 : -5); return 'The contract goes East.'; } },
        { label: 'The Western bid: dearer, trusted', hint: 'Costs 0.3% of GDP · relations with the West +5 · the East −5', enabled: canPay(0.3), apply: (s, c) => { pay(s, c, 0.3); for (const x of s.countries) if (x.alive && x.id !== c.id && Math.abs(x.orient ?? 0) > 0.6) addRelation(s, c.id, x.id, (x.orient ?? 0) > 0 ? 5 : -5); return 'The contract goes West.'; } },
        { label: 'Build our own, slowly', hint: 'Technology +0.5 · nationalists pleased · growth a little lower', apply: (_s, c) => { c.eco.tech += 0.5; sway(c, 'nationalists', 3); grow(c, -0.002); return 'A national network, three years late.'; } },
      ] }] },
  { id: 'embassy', icon: '🏛', title: 'The embassy', weight: 1, urgent: true,
    pick: (s, c) => { const f = s.countries.filter((x) => x.alive && x.id !== c.id && getRelation(s, c.id, x.id) < -25 && x.eco.stability < 55)[0]; return f ? { n: f.id } : null; },
    stages: [{ text: (s, _c, d) => `A mob has stormed your embassy in ${nm(s, d.n)}. Your diplomats are barricaded on the roof; their police are watching and doing nothing.`,
      options: [
        { label: 'Evacuate and break relations', hint: 'Relations with them −20 · approval +2', apply: (s, c, d) => { addRelation(s, c.id, d.n, -20); appr(s, 2); return 'Helicopters off the roof. The ambassador is home tonight.'; } },
        { label: 'Demand they act, quietly', hint: 'Relations with them −5 · the diplomats safe', apply: (s, c, d) => { addRelation(s, c.id, d.n, -5); return 'A phone call at the top. Their police move in.'; } },
      ] }] },
  { id: 'reporter', icon: '🎙', title: 'The reporter', weight: 2,
    pick: (s) => ({ k: Math.floor(nextRand(s) * 40) }),
    stages: [{ text: (s, c, d) => `${who(s, c, 'reporter', d)}, an investigative reporter, is about to publish a story on the contracts your family's friends have won. Your press secretary has seen a draft.`,
      options: [
        { label: 'Give her the interview she wants', hint: 'Reputation +3 · approval −1 · the truth comes out', apply: (s, c) => { rep(c, 3); appr(s, -1); return 'You answer every question. It is uncomfortable, and respected.'; } },
        { label: 'Have her paper bought', hint: 'The story dies · reputation −4 · a risk it leaks', apply: (s, c) => { rep(c, -4); if (nextRand(s) < 0.4) { appr(s, -4); news(s, c, `🗞 The story ${c.name}'s government tried to bury is published abroad.`); return 'It leaked abroad anyway.'; } return 'A friendly buyer is found.'; } },
        { label: 'Sue for libel', hint: 'Liberals angry · approval −2', apply: (s, c) => { sway(c, 'liberals', -5); appr(s, -2); return 'The case will take years. The story runs anyway.'; } },
      ] }] },
  { id: 'greenbonds', icon: '🌳', title: 'Debt for nature', weight: 2,
    pick: (_s, c) => (!rich(c) && c.eco.debt / c.eco.gdp > 0.5 ? { k: 1 } : null),
    stages: [{ text: (_s, c) => `Your creditors offer to cancel part of ${c.name}'s debt if you protect a tenth of the country's land and coast for nature. The farmers and the builders hate it.`,
      options: [
        { label: 'Sign', hint: 'Public debt −4% of GDP · reputation +5 · the regions unhappy', apply: (s, c) => { c.eco.debt -= 0.04 * c.eco.gdp; rep(c, 5); sway(c, 'regions', -5); news(s, c, `🌳 ${c.name} swaps debt for nature: a tenth of the country becomes protected.`); return 'The parks are drawn on the map.'; } },
        { label: 'Refuse', hint: 'The regions and business pleased', apply: (_s, c) => { sway(c, 'regions', 3); sway(c, 'business', 2); return 'The land stays open.'; } },
      ] }] },
  { id: 'general', icon: '🎖', title: 'The popular general', weight: 1,
    pick: (s, c) => ((s.warHistory ?? []).some((r) => (r.a === c.id || r.b === c.id) && s.tick - r.end < 104) || c.eco.stability < 50 ? { k: Math.floor(nextRand(s) * 30) } : null),
    stages: [{ text: (s, c, d) => `General ${who(s, c, 'gen', d).split(' ').slice(-1)[0]} is the most trusted person in ${c.name}, more than you. Officers toast him; a magazine asks if he should be president.`,
      options: [
        { label: 'Promote him to the top job', hint: 'The military pleased · he is closer to power', apply: (_s, c) => { sway(c, 'military', 6); stab(c, 1); return 'A fourth star, and an office down the corridor from yours.'; } },
        { label: 'Retire him with honours', hint: 'Stability +1 · the military unhappy', apply: (_s, c) => { sway(c, 'military', -5); stab(c, 1); return 'A parade, a medal, a farm in the country.'; } },
        { label: 'Send him abroad as an ambassador', hint: 'A quiet solution', apply: () => 'A posting far away, with a fine residence.' },
      ] }] },
  // ------------------------------------------------------------------ nights when everything is at stake
  { id: 'hijack', icon: '✈', title: 'The hijacking', weight: 2, urgent: true,
    pick: (s) => ({ k: Math.floor(nextRand(s) * 60) }),
    stages: [
      { text: (s, c, d) => `A passenger jet with 164 people on board sits at the end of the runway in ${at(d)}, engines idling, blinds down. Four armed men want a prisoner freed and fuel for a long flight. ${who(s, c, 'police', d)}, the head of the counter-terror unit, says his people can be inside in ninety seconds. He does not say what happens in those ninety seconds.`,
        options: [
          { label: 'Storm the plane at dawn', hint: 'A gamble: a triumph if it works (2 in 3), a massacre if it does not', apply: (s, c, d) => { const ok = nextRand(s) < 0.66; if (ok) { stab(c, 4); rep(c, 4); appr(s, 6); sway(c, 'military', 5); news(s, c, `🎖 ${c.name}'s commandos storm a hijacked jet: every hostage walks out alive.`); return 'Ninety seconds. Four shots. Every hostage walks down the steps into the morning.'; } stab(c, -5); rep(c, -3); appr(s, -7); news(s, c, `🕯 A rescue goes wrong in ${c.name}: 31 hostages die when commandos storm a hijacked jet.`); then(s, 'hijack', 1, 3, d); return 'A grenade in the aisle. Thirty-one do not come out.'; } },
          { label: 'Negotiate, hour by hour', hint: 'Slow and safe: most are freed · you look weak', apply: (_s, c) => { stab(c, 1); sway(c, 'nationalists', -5); sway(c, 'liberals', 3); return 'Two days of talk. The women and children come out first, then the rest. The men fly on.'; } },
          { label: 'Give them what they want', hint: 'Everyone lives · stability −2 · the next ones will try it too', apply: (_s, c) => { stab(c, -2); rep(c, -3); sway(c, 'military', -6); return 'The prisoner walks to the plane. It takes off. Everyone on board is alive, and everyone watching learned something.'; } },
        ] },
      { title: 'The inquiry', text: (s, c, d) => `Thirty-one coffins. The families want to know who gave the order, and the answer is you. ${who(s, c, 'police', d)} has offered to resign.`,
        options: [
          { label: 'Take the blame yourself', hint: 'Approval −4 now · respect later (stability +3)', apply: (s, c) => { appr(s, -4); stab(c, 3); rep(c, 2); return 'You stand in front of the cameras alone. It costs you. People remember that you stood there.'; } },
          { label: 'Accept his resignation', hint: 'The military bitter · the story ends', apply: (_s, c) => { sway(c, 'military', -7); stab(c, 1); return 'He leaves by the back door. The barracks do not forget.'; } },
        ] },
    ] },
  { id: 'ultimatum', icon: '⏳', title: 'Seventy-two hours', weight: 3, urgent: true,
    pick: (s, c, geo) => { const n = neighbourBy(s, c, geo, (x) => getRelation(s, c.id, x.id) < -15 && x.mil.troops > c.mil.troops * 0.8 && !isAtWar(s, x.id)); return n ? { n: n.id, k: Math.floor(nextRand(s) * 40) } : null; },
    stages: [
      { text: (s, _c, d) => `A note from ${nm(s, d.n)}, delivered at midnight: withdraw your border posts from the hills around ${at(d)} within seventy-two hours, "or bear the consequences". Satellite pictures show their armour leaving its barracks. Your generals want orders; your allies want to know what you will do.`,
        options: [
          { label: 'Reject it and mobilise', hint: 'Readiness up · relations −15 · it may come to shooting (1 in 3)', apply: (s, c, d) => { c.mil.readiness = clamp(c.mil.readiness + 0.1, 0, 1); addRelation(s, c.id, d.n, -15); sway(c, 'nationalists', 8); sway(c, 'military', 5); then(s, 'ultimatum', nextRand(s) < 0.34 ? 1 : 2, 3, d); return 'Reservists report to their units. The whole country is listening to the radio.'; } },
          { label: 'Call in the great powers', hint: 'Reputation +2 · the crisis is frozen, not solved', apply: (s, c, d) => { rep(c, 2); addRelation(s, c.id, d.n, -5); then(s, 'ultimatum', 2, 4, d, { med: 1 }); return 'Phones ring in six capitals. An emergency session is called for the morning.'; } },
          { label: 'Pull the posts back', hint: 'Peace · stability −3 · nationalists and the army furious', apply: (s, c, d) => { stab(c, -3); sway(c, 'nationalists', -10); sway(c, 'military', -8); addRelation(s, c.id, d.n, 8); rep(c, -3); return 'The flags come down in the hills. Nobody fires a shot. Nobody cheers either.'; } },
        ] },
      { title: 'Shots in the hills', n: 2, text: (s, _c, d) => `The seventy-two hours ran out at dawn, and ${nm(s, d.n)}'s troops moved. Your border company held for six hours. Eleven of your soldiers are dead; their column has stopped two kilometres inside your line and is digging in.`,
        options: [
          { label: 'Counter-attack tonight', hint: 'A gamble (55%): throw them back, or lose more', apply: (s, c, d) => { if (nextRand(s) < 0.55) { stab(c, 4); appr(s, 8); sway(c, 'military', 8); addRelation(s, c.id, d.n, -10); news(s, c, `⚔ ${c.name} throws ${nm(s, d.n)}'s troops back across the border in a night attack.`); return 'By morning the hills are yours again. The country has not slept, and does not want to.'; } stab(c, -4); appr(s, -5); c.mil.troops = Math.max(1000, c.mil.troops * 0.985); addRelation(s, c.id, d.n, -10); return 'The attack breaks on their guns. The line holds where it was, with more names to read out.'; } },
          { label: 'Hold the line and go to the UN', hint: 'Reputation +4 · the strip stays in their hands for now', apply: (s, c, d) => { rep(c, 4); stab(c, -1); addRelation(s, c.id, d.n, -6); s.stats[`cb:${c.id}>${d.n}`] = 1; return 'The world condemns them. They stay where they are. You now have a cause, and everyone knows it.'; } },
        ] },
      { title: 'The deadline passes', n: 2, text: (s, _c, d) => (d.med ? `Three days of shuttle diplomacy. ${nm(s, d.n)} has not moved, and has not withdrawn the note either. A mediator proposes a joint commission on the border.` : `The seventy-two hours ran out at dawn. Nothing moved. ${nm(s, d.n)}'s armour is back in its barracks, and its foreign ministry says the note was "misunderstood".`),
        options: [
          { label: 'Take the win quietly', hint: 'Stability +2 · relations recover a little', apply: (s, c, d) => { stab(c, 2); addRelation(s, c.id, d.n, 6); return 'No parade, no speech. The posts stay where they are.'; } },
          { label: 'Tell the nation they blinked', hint: 'Approval +6 · relations −8', apply: (s, c, d) => { appr(s, 6); sway(c, 'nationalists', 6); addRelation(s, c.id, d.n, -8); return 'You say it on television, slowly. In their capital, people take note of the tone.'; } },
        ] },
    ] },
  { id: 'border', icon: '🪖', title: 'Shots at the border', weight: 3, urgent: true,
    pick: (s, c, geo) => { const n = neighbourBy(s, c, geo, (x) => getRelation(s, c.id, x.id) < 10 && !isAtWar(s, x.id)); return n ? { n: n.id, k: Math.floor(nextRand(s) * 40) } : null; },
    stages: [{ text: (s, _c, d) => `A patrol of yours and one of ${nm(s, d.n)}'s met in the fog near ${at(d)}. Somebody fired. Three of your soldiers are dead, two of theirs. Each side says the other crossed the line; the bodies are still out there.`,
      options: [
        { label: 'Shell their post in reply', hint: 'Nationalists and army pleased · relations −14 · it could spiral (1 in 4)', apply: (s, c, d) => { sway(c, 'nationalists', 7); sway(c, 'military', 5); addRelation(s, c.id, d.n, -14); if (nextRand(s) < 0.25) { stab(c, -3); c.mil.readiness = clamp(c.mil.readiness + 0.05, 0, 1); news(s, c, `💥 Artillery duels along the border between ${c.name} and ${nm(s, d.n)}: villages are being evacuated.`); return 'They answer with rockets. For a week the border burns, and both capitals pretend to be in control.'; } return 'Twelve rounds, on target. Their post goes silent. So does their embassy.'; } },
        { label: 'A hotline call between the generals', hint: 'Relations +6 · the hawks grumble', apply: (s, c, d) => { addRelation(s, c.id, d.n, 6); sway(c, 'nationalists', -4); rep(c, 2); return 'Two generals who trained at the same academy talk for an hour. The bodies are exchanged at noon.'; } },
        { label: 'Demand a joint inquiry, in public', hint: 'Reputation +3 · relations −4', apply: (s, c, d) => { rep(c, 3); addRelation(s, c.id, d.n, -4); return 'You ask for the truth, on camera. They cannot easily refuse, and do not quite agree.'; } },
      ] }] },
  { id: 'bankrun', icon: '🏦', title: 'Friday night at the bank', weight: 2, urgent: true,
    pick: (s, c) => (c.eco.debt / c.eco.gdp > 0.5 || c.eco.inflation > 0.06 || c.eco.growth < 0 ? { k: Math.floor(nextRand(s) * 40) } : null),
    stages: [
      { text: (s, c, d) => `The second-largest bank in ${c.name} will not open on Monday unless something happens this weekend. One family in five keeps its savings there. ${who(s, c, 'bank', d)}, the central bank governor, is in your office with three sheets of paper and no good news.`,
        options: [
          { label: 'Rescue it with public money', hint: 'Costs 1.2% of GDP · savers safe · the public pays for bankers', enabled: canPay(1.2), apply: (s, c, d) => { pay(s, c, 1.2); stab(c, 1); sway(c, 'labour', -6); sway(c, 'business', 5); then(s, 'bankrun', 1, 12, d, { how: 0 }); return 'The doors open on Monday. The bill arrives later.'; } },
          { label: 'Let it fail, guarantee small savers', hint: 'Costs 0.4% of GDP · a credit crunch · stability −2', enabled: canPay(0.4), apply: (s, c, d) => { pay(s, c, 0.4); stab(c, -2); grow(c, -0.006); sway(c, 'business', -7); sway(c, 'labour', 3); then(s, 'bankrun', 1, 12, d, { how: 1 }); return 'Queues round the block, but the small accounts are paid out. The big ones are not.'; } },
          { label: 'Nationalise it overnight', hint: 'Costs 0.7% of GDP · labour pleased · investors alarmed', enabled: canPay(0.7), apply: (s, c, d) => { pay(s, c, 0.7); sway(c, 'labour', 6); sway(c, 'business', -8); rep(c, -2); then(s, 'bankrun', 1, 12, d, { how: 2 }); return 'By Sunday night the state owns a bank. The shareholders own nothing.'; } },
        ] },
      { title: 'The bankers in court', text: (_s, _c, d) => `Three months on, prosecutors have the bank's books: loans to the directors' own companies, a yacht booked as "IT equipment". ${d.how === 0 ? 'People have noticed that their taxes paid for it.' : d.how === 2 ? 'The state now owns the mess, and the evidence.' : 'The big depositors who lost everything want blood.'}`,
        options: [
          { label: 'Prosecute the board', hint: 'Approval +5 · business uneasy', apply: (s, c) => { appr(s, 5); sway(c, 'business', -4); c.eco.collection = Math.min(0.95, c.eco.collection + 0.01); return 'Handcuffs on the evening news. It does not bring the money back. It helps anyway.'; } },
          { label: 'A settlement and new rules', hint: 'Treasury +0.3% of GDP · quieter', apply: (_s, c) => { cash(c, 0.003); sway(c, 'business', 3); return 'They pay, they sign, they retire. The new rulebook is four hundred pages.'; } },
        ] },
    ] },
  { id: 'shot', icon: '🩸', title: 'A shot in the square', weight: 2, urgent: true,
    pick: (s, c) => (c.eco.stability < 70 ? { k: Math.floor(nextRand(s) * 60) } : null),
    stages: [
      { text: (s, c, d) => `${who(s, c, 'opp', d)}, your loudest critic, was shot leaving a rally in ${at(d)} and died on the way to hospital. The crowd is still in the square. Half the country already believes you gave the order.`,
        options: [
          { label: 'An independent inquiry, with foreign experts', hint: 'Reputation +4 · you do not control what it finds', apply: (s, c, d) => { rep(c, 4); sway(c, 'liberals', 5); then(s, 'shot', 1, 8, d, { open: 1 }); return 'You invite the investigators yourself. The square stays full, but it stays calm.'; } },
          { label: 'Blame a foreign hand', hint: 'Nationalists rally · reputation −4 · few abroad believe it', apply: (s, c, d) => { sway(c, 'nationalists', 6); rep(c, -4); stab(c, -1); then(s, 'shot', 1, 8, d, { open: 0 }); return 'Your spokesman names no country, and everyone hears one.'; } },
          { label: 'Clear the square tonight', hint: 'Order restored · stability −3 · liberals −10', apply: (s, c) => { stab(c, -3); sway(c, 'liberals', -10); sway(c, 'military', 4); rep(c, -5); appr(s, -5); return 'Water cannon at midnight. By morning the square is empty and the funeral has become a movement.'; } },
        ] },
      { title: 'Who fired', text: (_s, _c, d) => (d.open ? 'The investigators have a name: a sergeant in your own security service, acting, he says, on his own. His superiors swear they knew nothing.' : 'The official investigation has found nothing. A newspaper has found a great deal: the gun came from a police armoury.'),
        options: [
          { label: 'Put the service on trial', hint: 'Approval +5 · stability +2 · the security men turn cold', apply: (s, c) => { appr(s, 5); stab(c, 2); sway(c, 'military', -8); rep(c, 3); return 'A colonel in the dock. The country watches every session.'; } },
          { label: 'One man, one trial, case closed', hint: 'It mostly holds (2 in 3) · if not, the street returns', apply: (s, c) => { if (nextRand(s) < 0.66) { stab(c, 1); return 'A quick trial, a long sentence. The questions fade.'; } stab(c, -4); appr(s, -6); sway(c, 'liberals', -8); return 'He talks from his cell. The square fills again.'; } },
        ] },
    ] },
  { id: 'drones', icon: '🛸', title: 'Lights over the capital', weight: 2, urgent: true,
    pick: (s) => ({ k: Math.floor(nextRand(s) * 40) }),
    stages: [{ text: (s, c, d) => `For the third night, unmarked drones are circling over the capital: the ministry quarter, the main power station, your own residence. Nobody claims them. ${who(s, c, 'air', d)}, the air defence chief, can try to shoot them down over the city, or jam them and hope they fall somewhere soft.`,
      options: [
        { label: 'Shoot them down', hint: 'A gamble: wreckage to study (3 in 5), or a missile in a housing block', apply: (s, c) => { if (nextRand(s) < 0.6) { c.mil.intel = clamp(c.mil.intel + 0.04, 0, 1); stab(c, 2); appr(s, 3); return 'Two fall in a park. The circuit boards have a story to tell, and your engineers are reading it.'; } stab(c, -3); appr(s, -5); return 'One missile misses and finds a block of flats. Nine dead, none of them enemies.'; } },
        { label: 'Jam them', hint: 'Safe · you learn little', apply: (_s, c) => { c.mil.intel = clamp(c.mil.intel + 0.01, 0, 1); return 'They drift, lose signal and come down in the river. Divers find very little.'; } },
        { label: 'Say nothing and watch who is watching', hint: 'Intelligence +6% · the rumours grow (stability −1)', apply: (_s, c) => { c.mil.intel = clamp(c.mil.intel + 0.06, 0, 1); stab(c, -1); return 'You let them fly, and trace the signal home. Now you know. They do not know that you know.'; } },
      ] }] },
  { id: 'flood', icon: '🌊', title: 'The river is rising', weight: 2, urgent: true,
    pick: (s) => ({ k: Math.floor(nextRand(s) * 40) }),
    stages: [
      { text: (_s, _c, d) => `Three days of rain in the mountains. The river above ${at(d)} will top its dykes by midnight. The engineers offer a terrible trade: blow the dyke upstream and drown forty villages of farmland, or hold on and hope the city's walls stand.`,
        options: [
          { label: 'Blow the dyke: save the city', hint: 'The city is safe · food production hit · the regions will not forgive quickly', apply: (s, c, d) => { c.eco.foodCap *= 0.97; sway(c, 'regions', -9); stab(c, 1); then(s, 'flood', 1, 6, d, { blew: 1 }); return 'A dull thump in the dark, and the water goes where you sent it. The city sleeps dry.'; } },
          { label: 'Hold the walls and pray', hint: 'A gamble: they hold (1 in 2), or the city floods', apply: (s, c, d) => { if (nextRand(s) < 0.5) { stab(c, 3); appr(s, 5); then(s, 'flood', 1, 6, d, { blew: 0, dry: 1 }); return 'Soldiers and students fill sandbags till dawn. The walls hold by a hand’s breadth.'; } c.eco.damage = Math.min(1, c.eco.damage + 0.012); stab(c, -4); appr(s, -5); news(s, c, `🌊 The river breaks through in ${at(d)}: whole districts of ${c.name} are under water.`); then(s, 'flood', 1, 6, d, { blew: 0, dry: 0 }); return 'At four in the morning the east wall goes. By sunrise the old town is a lake.'; } },
          { label: 'Evacuate everyone, save nothing', hint: 'Costs 0.4% of GDP · nobody dies', enabled: canPay(0.4), apply: (s, c, d) => { pay(s, c, 0.4); c.eco.damage = Math.min(1, c.eco.damage + 0.006); rep(c, 2); then(s, 'flood', 1, 6, d, { blew: 0, dry: 0 }); return 'Two hundred thousand people on buses in one night. The water takes the houses and no one else.'; } },
        ] },
      { title: 'After the water', text: (_s, _c, d) => (d.blew ? 'The villages you drowned are mud and dead livestock. Their people are in school halls, and their mayor is on every channel.' : d.dry ? 'The city is dry and proud of itself. The engineers say the walls will not survive another night like that one.' : 'The water has gone down. What it left behind is black, wet and ruined.'),
        options: [
          { label: 'Rebuild it better: a real flood defence', hint: 'Costs 0.8% of GDP · infrastructure up', enabled: canPay(0.8), apply: (s, c) => { pay(s, c, 0.8); c.eco.infra = Math.min(100, c.eco.infra + 3); c.eco.damage = Math.max(0, c.eco.damage - 0.008); sway(c, 'regions', 6); return 'Concrete, pumps and a plan for the next hundred years.'; } },
          { label: 'Compensation, paid fast', hint: 'Costs 0.3% of GDP · approval +3', enabled: canPay(0.3), apply: (s, c) => { pay(s, c, 0.3); appr(s, 3); sway(c, 'regions', 4); return 'Cheques within the month. Nobody had to beg for them.'; } },
          { label: 'Patch it and move on', hint: 'Free · it will happen again', apply: (_s, c) => { sway(c, 'regions', -4); return 'Sandbags are stacked back in the depot. Until next time.'; } },
        ] },
    ] },
  { id: 'mutiny', icon: '⚓', title: 'The garrison says no', weight: 2, urgent: true,
    pick: (s, c) => (c.eco.cash < 0 || c.eco.stability < 55 || c.mil.exhaustion > 0.2 ? { k: Math.floor(nextRand(s) * 40) } : null),
    stages: [{ text: (s, c, d) => `The garrison at ${at(d)} has locked its officers in the mess and raised a bedsheet over the gate: PAY US. They have not been paid in three months, they say, while colonels build villas. They have the armoury. ${who(s, c, 'gen', d)}, the chief of staff, wants to know whether to talk or to send the paratroopers.`,
      options: [
        { label: 'Pay them, and promise an inquiry', hint: 'Costs 0.2% of GDP · other garrisons take note', enabled: canPay(0.2), apply: (s, c) => { pay(s, c, 0.2); sway(c, 'military', 3); stab(c, -1); return 'Trucks with cash arrive at the gate. The bedsheet comes down. Other barracks are doing sums.'; } },
        { label: 'Send the paratroopers', hint: 'A gamble: they fold (3 in 5), or soldiers shoot soldiers', apply: (s, c) => { if (nextRand(s) < 0.6) { stab(c, 2); sway(c, 'military', -3); return 'Faced with the red berets, they open the gate. The ringleaders are driven away in the night.'; } stab(c, -5); sway(c, 'military', -10); appr(s, -4); news(s, c, `🪖 Soldiers fire on soldiers in ${c.name}: a mutiny over unpaid wages ends in blood.`); return 'Somebody fires first. Forty minutes later the barracks is yours, and the army is not the same army.'; } },
        { label: 'Go there yourself', hint: 'A gamble on your own nerve: a legend if it works (1 in 2)', apply: (s, c) => { if (nextRand(s) < 0.5) { appr(s, 9); stab(c, 3); sway(c, 'military', 8); return 'You walk through the gate alone, and eat in the mess with them. By evening they are cheering you.'; } appr(s, -4); stab(c, -2); return 'They let you in, hear you out, and keep the gate shut. You drive back with nothing, and everyone saw.'; } },
      ] }] },
  { id: 'ransom', icon: '💾', title: 'The hospitals go dark', weight: 2, urgent: true,
    pick: (s) => ({ k: Math.floor(nextRand(s) * 40) }),
    stages: [{ text: (s, c, d) => `Every public hospital in ${c.name} lost its computers at 3 a.m.: records, lab results, the lists of who gets which drug. A message on every screen asks for forty million in cryptocurrency within five days. Surgeons are working from memory and paper. ${who(s, c, 'cyber', d)} thinks she can trace the gang, perhaps hit back.`,
      options: [
        { label: 'Refuse, and rebuild from backups', hint: 'Costs 0.3% of GDP · weeks of chaos · stability −2', enabled: canPay(0.3), apply: (s, c) => { pay(s, c, 0.3); stab(c, -2); c.eco.tech = c.eco.tech * 1.002; return 'Six weeks of paper charts. Then systems that will not fall the same way twice.'; } },
        { label: 'Pay quietly', hint: 'Cheap and fast · if it leaks (1 in 2), you look weak', apply: (s, c) => { c.eco.cash -= 0.0004 * c.eco.gdp; if (nextRand(s) < 0.5) { appr(s, -4); rep(c, -2); return 'The keys arrive. So does a journalist, with the transaction record.'; } return 'The screens come back on Tuesday. Nobody asks how.'; } },
        { label: 'Hack back', hint: 'A gamble (1 in 2): the keys and a scalp, or a second attack', apply: (s, c) => { if (nextRand(s) < 0.5) { c.mil.intel = clamp(c.mil.intel + 0.05, 0, 1); appr(s, 5); rep(c, 2); return 'Her team is inside their server by Thursday. They take the keys, the wallet and the names.'; } stab(c, -3); c.eco.cash -= 0.002 * c.eco.gdp; return 'They notice. The next morning it is the tax office, and the railways.'; } },
      ] }] },
  { id: 'prison', icon: '🔒', title: 'The prison is theirs', weight: 1, urgent: true,
    pick: (s, c) => (c.eco.stability < 65 ? { k: Math.floor(nextRand(s) * 40) } : null),
    stages: [{ text: (_s, _c, d) => `Inmates hold the high-security prison outside ${at(d)}: nineteen guards are hostages, the roof is on fire, and a gang boss is giving interviews on a smuggled phone. He wants transfers, televisions and the governor's head, in that order.`,
      options: [
        { label: 'Storm it', hint: 'A gamble (3 in 5): order restored, or a bloodbath', apply: (s, c) => { if (nextRand(s) < 0.6) { stab(c, 3); sway(c, 'nationalists', 4); return 'Tear gas, ladders, twenty minutes. The guards walk out. The boss is carried.'; } stab(c, -3); rep(c, -5); appr(s, -3); return 'Fifty-eight dead, six of them guards. The pictures are everywhere by noon.'; } },
        { label: 'Negotiate', hint: 'The guards live · the gangs learn what works', apply: (_s, c) => { stab(c, -1); sway(c, 'nationalists', -4); return 'Televisions are delivered. The guards come out. The boss smiles for the cameras.'; } },
        { label: 'Cut the water and wait', hint: 'Slow · reputation −2 · it usually works', apply: (s, c) => { rep(c, -2); if (nextRand(s) < 0.75) { stab(c, 1); return 'On the sixth day they open the gate themselves.'; } stab(c, -2); return 'On the fourth day a guard is thrown from the roof.'; } },
      ] }] },
  // ------------------------------------------------------------------ fortune, and what you make of it
  { id: 'find', icon: '💎', title: 'What lies under the hills', weight: 2, opener: true,
    pick: (s) => ({ k: Math.floor(nextRand(s) * 40) }),
    stages: [
      { text: (_s, c, d) => `Geologists drilling near ${at(d)} have hit something the whole world wants: a deposit of rare earths, the metals inside every battery and missile. Overnight ${c.name} matters to people who could not find it on a map. Two delegations have already asked for meetings.`,
        options: [
          { label: 'A national mining company', hint: 'Costs 0.8% of GDP · slow · the wealth stays home', enabled: canPay(0.8), apply: (s, c, d) => { pay(s, c, 0.8); sway(c, 'nationalists', 6); sway(c, 'labour', 4); then(s, 'find', 1, 30, d, { how: 0 }); return 'The flag goes up over the drill site. The engineers are yours; so is the risk.'; } },
          { label: 'Auction the licence to the highest bidder', hint: 'Treasury +1.5% of GDP now · business pleased', apply: (s, c, d) => { cash(c, 0.015); sway(c, 'business', 7); sway(c, 'nationalists', -5); then(s, 'find', 1, 30, d, { how: 1 }); return 'A sealed-bid auction. The winning number has more zeros than your budget.'; } },
          { label: 'Leave it in the ground for now', hint: 'Nothing changes · the regions and greens approve', apply: (_s, c) => { sway(c, 'regions', 5); sway(c, 'liberals', 3); return 'It has waited two billion years. It can wait for a government that is ready.'; } },
        ] },
      { title: 'The mine, two years on', text: (_s, _c, d) => `${d.how ? 'The foreign operator ships ore day and night' : 'The national mine is finally producing'}. The river below ${at(d)} runs orange, and the villagers have blocked the road with tractors. The mine pays a great many salaries.`,
        options: [
          { label: 'Make the mine clean up', hint: 'Regions +8 · output slows a little', apply: (_s, c, d) => { sway(c, 'regions', 8); sway(c, 'business', -4); grow(c, d.how ? 0.003 : 0.006); return 'Settling ponds, filters, inspectors. The river runs clear by spring.'; } },
          { label: 'Clear the road', hint: 'Growth up · regions −8 · stability −1', apply: (_s, c, d) => { sway(c, 'regions', -8); stab(c, -1); grow(c, d.how ? 0.006 : 0.01); return 'Police lift the tractors off the tarmac. The trucks roll again.'; } },
        ] },
    ] },
  { id: 'launch', icon: '🚀', title: 'Ten, nine, eight', weight: 1, opener: true,
    pick: (s, c) => (c.eco.gdp > 3e10 ? { k: Math.floor(nextRand(s) * 40) } : null),
    stages: [{ text: (s, c, d) => `${c.name}'s first satellite is on the pad, built by engineers who were students five years ago. ${who(s, c, 'space', d)}, the programme's director, admits one valve failed a test last week. Launch now, live on television, or slip six months and replace it.`,
      options: [
        { label: 'Launch, live on every channel', hint: 'A gamble (3 in 5): a national triumph, or a fireball on live TV', apply: (s, c) => { if (nextRand(s) < 0.6) { appr(s, 8); rep(c, 4); stab(c, 2); c.eco.tech *= 1.004; news(s, c, `🚀 ${c.name} is a space nation: its first satellite reaches orbit.`); return 'It climbs on a pillar of fire and is gone into the blue. In the control room they are crying.'; } appr(s, -4); rep(c, -2); return 'Eleven seconds of flight. Then a silence that the whole country hears.'; } },
        { label: 'Wait, fix the valve', hint: 'Costs 0.1% of GDP · it will fly, quietly', enabled: canPay(0.1), apply: (s, c) => { pay(s, c, 0.1); c.eco.tech *= 1.003; rep(c, 2); return 'Six months later it flies on a Tuesday morning. Fewer people watch. It works.'; } },
        { label: 'Cancel it: schools before rockets', hint: 'Treasury +0.2% of GDP · labour pleased · the engineers emigrate', apply: (_s, c) => { cash(c, 0.002); sway(c, 'labour', 4); sway(c, 'business', -3); return 'The rocket goes to a museum. The engineers go to other countries.'; } },
      ] }] },
  { id: 'games', icon: '🏟', title: 'The bid', weight: 1, opener: true,
    pick: (s, c) => (c.eco.gdp > 2e10 ? { k: Math.floor(nextRand(s) * 40) } : null),
    stages: [
      { text: (_s, c) => `The committee will choose the host of the next great Games in eight weeks. ${c.name} is on the shortlist, to general surprise. Winning would put the country on every screen on earth for a month. It would also cost more than anyone will admit.`,
        options: [
          { label: 'Go all in', hint: 'Costs 0.5% of GDP on the bid alone · it is a contest (2 in 5)', enabled: canPay(0.5), apply: (s, c, d) => { pay(s, c, 0.5); then(s, 'games', 1, 8, d, { win: nextRand(s) < 0.4 ? 1 : 0 }); return 'Architects, film-makers, lobbyists. The bid book weighs four kilos.'; } },
          { label: 'A modest, honest bid', hint: 'Costs 0.1% of GDP · a long shot (1 in 6)', enabled: canPay(0.1), apply: (s, c, d) => { pay(s, c, 0.1); then(s, 'games', 1, 8, d, { win: nextRand(s) < 0.17 ? 1 : 0 }); return 'No new stadiums, no promises you cannot keep. Some delegates find it refreshing.'; } },
          { label: 'Withdraw', hint: 'Treasury spared · a little dull', apply: () => 'The letter is polite. The sports pages are not.' },
        ] },
      { title: 'And the host is', text: (_s, c, d) => (d.win ? `The envelope is opened, and the name inside is ${c.name}. In the capital, people are dancing in fountains.` : `The envelope is opened. It is not ${c.name}. The delegation flies home in economy.`),
        options: [
          { label: 'Address the nation', hint: 'Whatever happened, it is yours now', apply: (s, c, d) => { if (d.win) { appr(s, 8); rep(c, 6); stab(c, 2); grow(c, 0.006); c.eco.cash -= 0.006 * c.eco.gdp; news(s, c, `🏟 ${c.name} will host the Games.`); return 'You promise the best Games in history. The builders start on Monday.'; } appr(s, -2); return 'You thank the team and talk about next time. The money is gone.'; } },
        ] },
    ] },
  { id: 'debate', icon: '📺', title: 'The debate', weight: 2,
    pick: (s, c) => (s.legacy && s.settings.mode === 'legacy' && (c.gov === 'D' || c.gov === 'F') ? { k: Math.floor(nextRand(s) * 40) } : null),
    stages: [{ text: (s, c, d) => `${who(s, c, 'opp', d)}, the leader of the opposition, has challenged you to ninety minutes live on television, no notes, no aides. The polls say most people want to see it. Your advisers are split: you are ahead on substance and behind on charm.`,
      options: [
        { label: 'Accept, and go for the throat', hint: 'A gamble: approval +8 if you win (1 in 2), −6 if you lose', apply: (s) => { if (nextRand(s) < 0.5) { appr(s, 8); return 'One line, forty minutes in, and the studio goes quiet. It is on every phone by midnight.'; } appr(s, -6); return 'You were right on every point and lost the room on every one. The clip of you checking your watch is everywhere.'; } },
        { label: 'Accept, and stay calm and dull', hint: 'Safer: approval +3 (3 in 4), −2 otherwise', apply: (s) => { if (nextRand(s) < 0.75) { appr(s, 3); return 'Nobody remembers a word. The polls tick up.'; } appr(s, -2); return 'Calm slid into tired. They looked like the future.'; } },
        { label: 'Decline', hint: 'Approval −2 · no risk', apply: (s) => { appr(s, -2); return 'An empty chair stands in for you. It does not do badly.'; } },
      ] }] },
  { id: 'defector', icon: '🧳', title: 'The man at the embassy gate', weight: 2,
    pick: (s, c, geo) => { const n = neighbourBy(s, c, geo, (x) => x.gov !== 'D' && getRelation(s, c.id, x.id) < 30); return n ? { n: n.id, k: Math.floor(nextRand(s) * 40) } : null; },
    stages: [{ text: (s, _c, d) => `A deputy chief of ${nm(s, d.n)}'s intelligence service walked into your consulate with a suitcase and asked for asylum. He says he can name every agent they run in your country. ${nm(s, d.n)} says he is a thief and wants him back by Friday.`,
      options: [
        { label: 'Take him in', hint: 'Intelligence +8% · relations −15', apply: (s, c, d) => { c.mil.intel = clamp(c.mil.intel + 0.08, 0, 1); addRelation(s, c.id, d.n, -15); return 'He talks for nine days. Arrests follow in three of your ministries.'; } },
        { label: 'Hand him back', hint: 'Relations +10 · reputation −4', apply: (s, c, d) => { addRelation(s, c.id, d.n, 10); rep(c, -4); sway(c, 'liberals', -5); return 'A car to the border at dawn. Nobody hears of him again.'; } },
        { label: 'Pass him to a great power, for a price', hint: 'Treasury +0.3% of GDP · relations −8 · you learn nothing', apply: (s, c, d) => { cash(c, 0.003); addRelation(s, c.id, d.n, -8); return 'A private jet, a grateful ally, and a favour in the bank.'; } },
      ] }] },
  { id: 'talks', icon: '🕊', title: 'A table for two enemies', weight: 2, opener: true,
    pick: (s, c) => { const w = s.wars.find((x) => !x.attackers.includes(c.id) && !x.defenders.includes(c.id)); return w ? { a: w.attackers[0], b: w.defenders[0], k: Math.floor(nextRand(s) * 40) } : null; },
    stages: [{ text: (s, c, d) => `${nm(s, d.a)} and ${nm(s, d.b)} are killing each other, and both have let it be known, through third parties, that they would talk if someone neutral offered a room. ${c.name} has been suggested. Hosting means cameras, prestige and blame if it fails.`,
      options: [
        { label: 'Host the talks, in public', hint: 'Reputation +5 · a triumph if they sign anything (1 in 3)', apply: (s, c, d) => { rep(c, 5); if (nextRand(s) < 0.34) { rep(c, 6); appr(s, 5); addRelation(s, c.id, d.a, 8); addRelation(s, c.id, d.b, 8); news(s, c, `🕊 In ${c.name}'s capital, ${nm(s, d.a)} and ${nm(s, d.b)} agree to a humanitarian truce.`); return 'After six days, a handshake on your lawn. It is only a truce. It has your name on it.'; } return 'They come, they shout, they leave. The photographs were good.'; } },
        { label: 'A secret channel, no cameras', hint: 'Both sides owe you (relations +6 each) · no glory', apply: (s, c, d) => { addRelation(s, c.id, d.a, 6); addRelation(s, c.id, d.b, 6); return 'Two delegations in a hunting lodge, with your people pouring the coffee.'; } },
        { label: 'Stay out of it', hint: 'No risk', apply: () => 'Someone else will get the photograph, or the blame.' },
      ] }] },
  { id: 'trolls', icon: '🧌', title: 'Ten thousand fake friends', weight: 2,
    pick: (s, c) => { const r = s.countries.filter((x) => x.alive && x.id !== c.id && getRelation(s, c.id, x.id) < -10 && x.eco.gdp > c.eco.gdp); return r.length ? { n: r[Math.floor(nextRand(s) * r.length)].id, k: Math.floor(nextRand(s) * 40) } : null; },
    stages: [{ text: (s, _c, d) => `Your security service has mapped a network of ten thousand fake accounts, run from an office block in ${nm(s, d.n)}, feeding rumours into your politics: that the banks are failing, that the vaccine is poison, that you are dying. Some of your own MPs have been sharing them.`,
      options: [
        { label: 'Expose it, with the evidence', hint: 'Reputation +3 · relations −10 · stability +2', apply: (s, c, d) => { rep(c, 3); stab(c, 2); addRelation(s, c.id, d.n, -10); return 'Screenshots, addresses, payslips. Their ambassador is summoned to explain.'; } },
        { label: 'Answer in kind', hint: 'Intelligence +3% · relations −6 · if found out (1 in 3), reputation −5', apply: (s, c, d) => { c.mil.intel = clamp(c.mil.intel + 0.03, 0, 1); addRelation(s, c.id, d.n, -6); if (nextRand(s) < 0.33) { rep(c, -5); return 'Your own farm is exposed within a month. The headline writes itself.'; } return 'Their feeds fill up with stories about their own leaders. Fair is fair.'; } },
        { label: 'Quietly teach people to spot it', hint: 'Costs 0.1% of GDP · slow · stability +1', enabled: canPay(0.1), apply: (s, c) => { pay(s, c, 0.1); stab(c, 1); sway(c, 'liberals', 3); return 'Lessons in schools, a public campaign, no drama.'; } },
      ] }] },
  { id: 'pipeline', icon: '🧯', title: 'Fire on the pipeline', weight: 2, urgent: true,
    pick: (s, c) => (c.eco.energyCap > c.eco.energyDemand * 0.4 ? { k: Math.floor(nextRand(s) * 40) } : null),
    stages: [{ text: (_s, c, d) => `An explosion has cut the main pipeline near ${at(d)}. The flames can be seen from forty kilometres. It was not an accident: the charge was placed by someone who knew the welds. ${c.name} loses a tenth of its energy until it is fixed, and nobody has claimed it.`,
      options: [
        { label: 'Repair it at any price', hint: 'Costs 0.4% of GDP · back in three weeks', enabled: canPay(0.4), apply: (s, c) => { pay(s, c, 0.4); stab(c, 1); return 'Crews work under floodlights. Gas flows again on the nineteenth day.'; } },
        { label: 'Name a culprit and close the border', hint: 'Nationalists rally · reputation −3 · the damage lingers', apply: (_s, c) => { sway(c, 'nationalists', 7); rep(c, -3); c.eco.energyCap *= 0.97; return 'You have no proof and say so, slowly, while looking at a map.'; } },
        { label: 'Put the army on the line', hint: 'Readiness −3% · it will not happen twice', apply: (_s, c) => { c.mil.readiness = clamp(c.mil.readiness - 0.03, 0, 1); c.eco.energyCap *= 0.985; sway(c, 'military', 3); return 'A soldier every five hundred metres. Expensive, and effective.'; } },
      ] }] },
  { id: 'poison', icon: '☣', title: 'The river turned white', weight: 2,
    pick: (s) => ({ k: Math.floor(nextRand(s) * 40) }),
    stages: [{ text: (s, c, d) => `Dead fish for thirty kilometres below ${at(d)}, and children in hospital with burns in their throats. The source is a chemical plant owned by ${who(s, c, 'tycoon', d)}, the largest private employer in the province and a generous friend to several parties, yours included.`,
      options: [
        { label: 'Shut the plant and prosecute', hint: 'Approval +5 · regions +6 · business −8 · jobs lost', apply: (s, c) => { appr(s, 5); sway(c, 'regions', 6); sway(c, 'business', -8); grow(c, -0.002); return 'Seals on the gates. The owner is photographed leaving a courthouse.'; } },
        { label: 'A record fine, and it stays open', hint: 'Treasury +0.2% of GDP · the jobs stay', apply: (_s, c) => { cash(c, 0.002); sway(c, 'business', -2); sway(c, 'regions', -2); return 'He pays without blinking. The filters are fitted by autumn.'; } },
        { label: 'Call it an accident', hint: 'Business +5 · if the truth comes out (1 in 2): approval −7', apply: (s, c) => { sway(c, 'business', 5); if (nextRand(s) < 0.5) { appr(s, -7); stab(c, -2); return 'A foreman has kept the emails. They are on the front page within a month.'; } return 'A valve failed, the report says. The river recovers. The children, mostly.'; } },
      ] }] },
  { id: 'locusts', icon: '🦗', title: 'The swarm', weight: 2, urgent: true,
    pick: (s, c) => (['AF', 'ME', 'SA'].includes(c.region) ? { k: Math.floor(nextRand(s) * 40) } : null),
    stages: [{ text: (_s, _c, d) => `A swarm of locusts forty kilometres long has crossed the border and is settling on the fields around ${at(d)}. It eats in a day what the province eats in a year. The harvest is three weeks away.`,
      options: [
        { label: 'Spray from the air, now', hint: 'Costs 0.3% of GDP · most of the harvest saved', enabled: canPay(0.3), apply: (s, c) => { pay(s, c, 0.3); c.eco.foodCap *= 0.99; sway(c, 'regions', 5); return 'Every crop-duster in the country, and some borrowed ones. The sky turns brown, then clears.'; } },
        { label: 'Ask the neighbours and the UN for help', hint: 'Reputation +2 · slower: some of the harvest is lost', apply: (_s, c) => { rep(c, 2); c.eco.foodCap *= 0.975; return 'Planes arrive from three countries, a week later than the locusts did.'; } },
        { label: 'Ban food exports and ride it out', hint: 'Free · the harvest is lost · relations with buyers suffer', apply: (_s, c) => { c.eco.foodCap *= 0.955; stab(c, -2); rep(c, -2); return 'The fields are stripped to the stalk. The granaries stay closed to foreigners.'; } },
      ] }] },
  { id: 'heir', icon: '🧬', title: 'The doctor’s envelope', weight: 1,
    pick: (s) => (s.legacy && s.settings.mode === 'legacy' ? { k: Math.floor(nextRand(s) * 40) } : null),
    stages: [{ text: (s, c, d) => `${who(s, c, 'doctor', d)}, your physician, closes the door before she speaks. The tests are back. It is treatable, with three months of rest that you do not have and an absence that the country would notice. Nobody else knows yet.`,
      options: [
        { label: 'Tell the country', hint: 'Approval +4 (people like the truth) · your rivals circle', apply: (s, c) => { appr(s, 4); stab(c, -1); sway(c, 'liberals', 3); return 'You say it plainly, from behind your desk. The letters arrive by the sackful.'; } },
        { label: 'Keep it secret and keep working', hint: 'A gamble: nobody notices (2 in 3), or it comes out badly', apply: (s, c) => { if (nextRand(s) < 0.66) return 'Treatments at night, make-up in the morning. You get through it.'; appr(s, -6); stab(c, -2); return 'You falter on a podium, on live television. Then the lies about it come out as well.'; } },
        { label: 'Take the three months', hint: 'Political capital −15 · you come back stronger', apply: (s, c) => { if (c.politics) c.politics.pc = Math.max(0, c.politics.pc - 15); stab(c, 1); appr(s, 2); return 'Your deputy chairs the cabinet. You read novels, and return in the spring.'; } },
      ] }] },
  { id: 'gold', icon: '🪙', title: 'The gold in the vault', weight: 1,
    pick: (s, c) => (c.eco.debt / c.eco.gdp > 0.4 ? { k: Math.floor(nextRand(s) * 40) } : null),
    stages: [{ text: (s, c, d) => `The price of gold has doubled in a year, and ${c.name}'s reserve, bought by a cautious central banker two generations ago, is suddenly worth a fortune. ${who(s, c, 'bank', d)} at the central bank says it is the nation's last line of defence. Your finance minister says a defence you never use is a decoration.`,
      options: [
        { label: 'Sell half and pay down the debt', hint: 'Debt −2% of GDP · reserves fall', apply: (_s, c) => { c.eco.debt = Math.max(0, c.eco.debt - 0.02 * c.eco.gdp); c.eco.reserves *= 0.8; sway(c, 'business', 3); return 'Lorries leave the vault at night. The interest bill shrinks.'; } },
        { label: 'Sell some and build with it', hint: 'Growth up · reserves fall · popular', apply: (s, c) => { grow(c, 0.008); c.eco.reserves *= 0.85; appr(s, 3); return 'Gold becomes railways and clinics. The banker writes a sad memo.'; } },
        { label: 'Keep every bar', hint: 'Nothing changes · the currency is trusted', apply: (_s, c) => { c.eco.inflation = Math.max(0, c.eco.inflation - 0.003); return 'The vault stays shut. Markets like a country that does not need the money.'; } },
      ] }] },
];
export const sitById = (id: string) => SITUATIONS.find((x) => x.id === id);

/** Every stage of every situation as an inbox decision (weight 0: only the director opens them). */
export const situationEvents = (list: Situation[], lapseText?: string): EventDef[] => list.flatMap((sit) => sit.stages.map((st, i): EventDef => ({
  id: `sit_${sit.id}_${i}`, icon: sit.icon, title: st.title ?? sit.title, weight: 0, cooldown: 0, ttl: 10, urgent: i === 0 && !!sit.urgent,
  eligible: () => null,
  arc: sit.stages.length > 1 ? { title: sit.title, stage: st.n ?? i + 1, of: Math.max(...sit.stages.map((x, j) => x.n ?? j + 1)) } : undefined,
  text: (s, c, d) => st.text(s, c, d),
  options: st.options.map((o) => ({ label: o.label, hint: o.hint, enabled: o.enabled, apply: (s: GameState, c: Country, d: D) => o.apply(s, c, d) })),
  lapse: (s, c) => { if (lapseText) return lapseText; stab(c, -1); return `You let it drift. ${i === 0 ? 'Others decided for you.' : 'It ended without you.'} Stability −1.`; },
})));
export const EVENTS13: EventDef[] = situationEvents(SITUATIONS);
void warsOf;
