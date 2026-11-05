/**
 * Situations: stories that unfold over months, not one-off pop-ups. Each one fits a kind of country (a desert state
 * runs out of water, a monarchy's court plots, a country next to a war takes in its refugees, an indebted one fights its
 * creditors over the price of bread), has two or three stages, and what you choose decides what comes next. The
 * director (director.ts) opens one every few weeks, in a different order every game, so no two games tell the same story.
 */
import { clamp } from './util';
import { type EventDef, type D, canPay, pay, rep, stab, money } from './eventkit';
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
];
export const sitById = (id: string) => SITUATIONS.find((x) => x.id === id);

/** Every stage of every situation as an inbox decision (weight 0: only the director opens them). */
export const EVENTS13: EventDef[] = SITUATIONS.flatMap((sit) => sit.stages.map((st, i): EventDef => ({
  id: `sit_${sit.id}_${i}`, icon: sit.icon, title: st.title ?? sit.title, weight: 0, cooldown: 0, ttl: 10, urgent: i === 0 && !!sit.urgent,
  eligible: () => null,
  arc: sit.stages.length > 1 ? { title: sit.title, stage: st.n ?? i + 1, of: Math.max(...sit.stages.map((x, j) => x.n ?? j + 1)) } : undefined,
  text: (s, c, d) => st.text(s, c, d),
  options: st.options.map((o) => ({ label: o.label, hint: o.hint, enabled: o.enabled, apply: (s: GameState, c: Country, d: D) => o.apply(s, c, d) })),
  lapse: (s, c) => { stab(c, -1); return `You let it drift. ${i === 0 ? 'Others decided for you.' : 'It ended without you.'} Stability −1.`; },
})));
void warsOf;
