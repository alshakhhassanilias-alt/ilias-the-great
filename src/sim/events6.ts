/**
 * War stories: what a war feels like from the leader's desk. The war goal you declare, sieges of real cities,
 * foreign volunteers, a massacre report, a general begging for reserves, a mediator, an arms dealer with
 * conditions, anti-war marches, a hero, a prisoner exchange, saboteurs and a strained war economy.
 */
import { clamp, fmtMoney } from './util';
import { hash01, nextRand } from './rng';
import { type EventDef, type D, canPay, pay, rep, stab } from './eventkit';
import { setWarGoal } from './wargoals';
import { GOALS_META, type WarGoal } from './goalmeta';
import { pcOf, spendPC, sway } from './domestic';
import { placeName } from './places';
import { nationalName } from './names';
import { addRelation, alliesOf, getRelation, warsOf } from './relations';
import { bumpSupport, warSupport } from './warsupport';
import { strength } from './military';
import { isMajor } from './drama';
import { logEvent } from './log';
import type { Country, GameState, InboxItem, War } from './types';

const nm = (s: GameState, id: number) => s.countries[id]?.name ?? 'the enemy';
const warOf = (s: GameState, d: D): War | undefined => s.wars.find((w) => w.id === d.w);
const hasPC = (n: number) => (_s: GameState, c: Country) => pcOf(c) >= n;
const ws = (c: Country, v: number, why = 'events') => bumpSupport(c, v, why);
const soldier = (c: Country, n: number) => nationalName(c, hash01('sol', c.id, n), hash01('sol', c.id, n, 2), hash01('sol', c.id, n, 3), 'general');
const genName = (c: Country) => c.generals?.find((g) => g.status === 'active')?.name ?? nationalName(c, 0.9, hash01('g', c.id), hash01('g2', c.id), 'general');

export const EVENTS6: EventDef[] = [
  {
    id: 'war_goal', icon: '🎯', title: 'What is this war for?', weight: 0, cooldown: 0, urgent: true, ttl: 6,
    eligible: () => null,
    lapse: (s, _c, d) => { const w = warOf(s, d); if (w) setWarGoal(s, w, w.defenders.includes(s.player) ? 3 : 1); return 'Your generals chose for you.'; },
    text: (s, c, d) => `The war with ${nm(s, d.e)} has begun. The nation, the army and the world want to know what it is for. What you promise now is what you will be judged on when it ends. War support: ${Math.round(warSupport(c) * 100)}%.`,
    options: ([1, 2, 3] as WarGoal[]).map((g) => ({
      label: `${GOALS_META[g].icon} ${GOALS_META[g].title}`, hint: `${GOALS_META[g].desc} Success: ${GOALS_META[g].success}.`,
      apply: (s: GameState, _c: Country, d: D) => { const w = warOf(s, d); if (!w) return 'The war is already over.'; setWarGoal(s, w, g); return `War aims declared: ${GOALS_META[g].title.toLowerCase()}.`; },
    })),
  },
  {
    id: 'war_siege', icon: '🏰', title: 'A city under siege', weight: 0, cooldown: 0, ttl: 8,
    eligible: () => null,
    text: (s, _c, d) => `Our troops have surrounded ${placeName(d.p)}. Inside are ${Math.round(8 + (d.p % 30))},000 soldiers of ${nm(s, d.e)} and ${Math.round(150 + (d.p * 37) % 600)},000 civilians. The garrison commander refuses to surrender.`,
    options: [
      { label: 'Storm the city', hint: 'The offensive there jumps forward · heavy casualties · war support +2', apply: (s, c, d) => { const f = frontAt(s, d.p); if (f) f.progress = Math.min(0.98, f.progress + 0.35); c.mil.troops *= 0.985; ws(c, 0.02, 'victories'); return `Street by street, ${placeName(d.p)} is being taken.`; } },
      { label: 'Starve them out', hint: 'Slow but cheap · reputation −2', apply: (s, c, d) => { const f = frontAt(s, d.p); if (f) f.progress = Math.min(0.98, f.progress + 0.15); rep(c, -2); return 'The siege tightens.'; } },
      { label: 'Offer the garrison safe passage', hint: 'Reputation +2 · they leave in a few weeks', apply: (s, c, d) => { const f = frontAt(s, d.p); if (f) f.progress = Math.min(0.98, f.progress + 0.25); rep(c, 2); return 'The garrison marches out under a white flag.'; } },
    ],
  },
  {
    id: 'war_volunteers', icon: '🙋', title: 'Foreign volunteers', weight: 0, cooldown: 0, ttl: 10,
    eligible: () => null,
    text: (s, _c, d) => `${Math.round(4 + (d.x % 12))},000 volunteers from ${nm(s, d.x)} have arrived at the border asking to fight for us against ${nm(s, d.e)}. Their government says it "cannot stop its citizens".`,
    options: [
      { label: 'Welcome them into the army', hint: 'Troops +2% · relations with their government +6 · the enemy calls it foreign intervention', apply: (s, c, d) => { c.mil.troops *= 1.02; addRelation(s, c.id, d.x, 6); addRelation(s, d.e, d.x, -10); ws(c, 0.01); return 'A foreign legion is formed.'; } },
      { label: 'Send them home', hint: 'Nationalists +3 · no foreign entanglements', apply: (_s, c) => { sway(c, 'nationalists', 3); return 'We fight our own wars.'; } },
    ],
  },
  {
    id: 'war_atrocity', icon: '📸', title: 'A massacre is reported', weight: 0, cooldown: 0, urgent: true, ttl: 8,
    eligible: () => null,
    text: (s, _c, d) => `Foreign journalists have published photographs from a village outside ${placeName(d.p)}: ${12 + (d.p % 40)} civilians shot, allegedly by our soldiers. ${nm(s, d.e)} calls it a war crime; the World Assembly wants an inquiry.`,
    options: [
      { label: 'Investigate and punish the guilty', hint: 'Reputation +3 · military −8 · war support −2', apply: (_s, c) => { rep(c, 3); sway(c, 'military', -8); sway(c, 'liberals', 6); ws(c, -0.02, 'events'); return 'A court-martial is convened.'; } },
      { label: 'Deny everything', hint: 'Reputation −6 · liberals −10 · nationalists +4', apply: (_s, c) => { rep(c, -6); sway(c, 'liberals', -10); sway(c, 'nationalists', 4); return 'The government calls the photos fake.'; } },
      { label: 'Blame the enemy', hint: 'Reputation −2 · may be exposed later (40%)', apply: (s, c) => { rep(c, -2); if (nextRand(s) < 0.4) { rep(c, -6); stab(c, -2); return 'The cover story fell apart within days.'; } return 'The story muddies; nobody is sure.'; } },
    ],
  },
  {
    id: 'war_general', icon: '🎖', title: 'The general wants reserves', weight: 0, cooldown: 0, ttl: 8,
    eligible: () => null,
    text: (_s, c, d) => `General ${genName(c)} reports that the enemy line near ${placeName(d.p)} is "one push from breaking". The general wants every reserve battalion sent forward now.`,
    options: [
      { label: 'Send the reserves', hint: 'More troops on offensives · that front jumps forward · readiness −5%', apply: (s, c, d) => { c.mil.commit = Math.min(1, c.mil.commit + 0.12); c.mil.readiness = Math.max(0.2, c.mil.readiness - 0.05); const f = frontAt(s, d.p); if (f) f.progress = Math.min(0.98, f.progress + 0.2); sway(c, 'military', 4); return 'The reserves move up.'; } },
      { label: 'Keep them back', hint: 'Military −4 · the home front stays safe', apply: (_s, c) => { sway(c, 'military', -4); return 'The general is not pleased.'; } },
    ],
  },
  {
    id: 'war_mediator', icon: '🕊', title: 'A mediator steps in', weight: 0, cooldown: 0, ttl: 10,
    eligible: () => null,
    text: (s, _c, d) => `${nm(s, d.x)} offers to host talks between us and ${nm(s, d.e)} in its capital. Both sides would send delegations; the world is watching.`,
    options: [
      { label: 'Accept the talks', hint: 'Reputation +2 · they will likely offer a ceasefire', apply: (s, c, d) => { rep(c, 2); addRelation(s, c.id, d.x, 6); if (!s.offers.some((o) => o.from === d.e && o.kind === 'peace')) s.offers.push({ id: s.nextOfferId++, from: d.e, kind: 'peace', terms: { kind: 'status_quo' }, tick: s.tick }); return 'Delegations are on their way.'; } },
      { label: 'Refuse: we will finish this on the battlefield', hint: 'Nationalists +5 · relations with the mediator −6', apply: (s, c, d) => { sway(c, 'nationalists', 5); addRelation(s, c.id, d.x, -6); return 'No talks.'; } },
    ],
  },
  {
    id: 'war_arms', icon: '📦', title: 'An arms offer, with conditions', weight: 0, cooldown: 0, ttl: 10,
    eligible: () => null,
    text: (s, c, d) => `${nm(s, d.x)} will send ${fmtMoney(0.006 * c.eco.gdp)} worth of tanks, artillery shells and air-defence missiles. In return it wants a long-term trade deal on its terms and our vote at the World Assembly.`,
    options: [
      { label: 'Accept the weapons', hint: 'Army and air equipment ↑ · relations +10 · reputation −1', apply: (s, c, d) => { c.mil.equipArmy += 0.004 * c.eco.gdp; c.mil.equipAir += 0.002 * c.eco.gdp; addRelation(s, c.id, d.x, 10); rep(c, -1); return 'The first convoys cross the border.'; } },
      { label: 'Pay for them ourselves instead', hint: 'Costs 0.5% of GDP · no strings', enabled: canPay(0.005), apply: (s, c) => { pay(s, c, 0.005); c.mil.equipArmy += 0.004 * c.eco.gdp; return 'We buy them on the open market.'; } },
      { label: 'Refuse', hint: 'Nothing changes', apply: () => 'We decline.' },
    ],
  },
  {
    id: 'war_protest', icon: '✊', title: 'Anti-war marches', weight: 0, cooldown: 0, ttl: 8,
    eligible: () => null,
    text: (_s, c) => `${Math.round(30 + (c.id % 7) * 15)},000 people marched through ${placeName(c.capital)} demanding an end to the war. Mothers of soldiers carried photographs of their sons. War support is ${Math.round(warSupport(c) * 100)}%.`,
    options: [
      { label: 'Let them march', hint: 'War support −3 · liberals +6', apply: (_s, c) => { ws(c, -0.03, 'events'); sway(c, 'liberals', 6); return 'The march ends peacefully.'; } },
      { label: 'Ban the protests', hint: 'War support +2 · stability −2 · liberals −12', apply: (_s, c) => { ws(c, 0.02, 'events'); stab(c, -2); sway(c, 'liberals', -12); return 'Riot police disperse the crowd.'; } },
      { label: 'Address the nation', hint: 'Costs 8 political capital · war support +4', enabled: hasPC(8), apply: (_s, c) => { spendPC(c, 8); ws(c, 0.04, 'propaganda'); return 'A televised address steadies the country.'; } },
    ],
  },
  {
    id: 'war_hero', icon: '🎗', title: 'A hero is born', weight: 0, cooldown: 0, ttl: 8,
    eligible: () => null,
    text: (_s, c, d) => `Sergeant ${soldier(c, d.p)} held a bridge near ${placeName(d.p)} for two days with eleven soldiers against an entire battalion. The video is everywhere.`,
    options: [
      { label: 'A medal and a national tour', hint: 'War support +5 · political capital +4', apply: (_s, c) => { ws(c, 0.05, 'propaganda'); if (c.politics) c.politics.pc = Math.min(100, c.politics.pc + 4); return 'The whole country knows the name.'; } },
      { label: 'A quiet medal', hint: 'Military +4', apply: (_s, c) => { sway(c, 'military', 4); return 'The army honours its own.'; } },
    ],
  },
  {
    id: 'war_pows', icon: '🤝', title: 'A prisoner exchange', weight: 0, cooldown: 0, ttl: 10,
    eligible: () => null,
    text: (s, _c, d) => `${nm(s, d.e)} proposes to exchange ${Math.round(200 + (d.e * 53) % 1800)} prisoners of war, through ${nm(s, d.x)} as go-between.`,
    options: [
      { label: 'Agree to the exchange', hint: 'War support +2 · relations with them +5', apply: (s, c, d) => { ws(c, 0.02, 'events'); addRelation(s, c.id, d.e, 5); return 'Buses cross the front line under the Red Cross flag.'; } },
      { label: 'Refuse', hint: 'Nationalists +4 · war support −1', apply: (_s, c) => { sway(c, 'nationalists', 4); ws(c, -0.01, 'events'); return 'No deals with the enemy.'; } },
    ],
  },
  {
    id: 'war_sabotage', icon: '💥', title: 'Sabotage behind the lines', weight: 0, cooldown: 0, ttl: 8,
    eligible: () => null,
    text: (s, _c, d) => `Saboteurs working for ${nm(s, d.e)} blew up a railway junction and a fuel depot near ${placeName(d.p)}. Supplies to the front are delayed.`,
    options: [
      { label: 'Hunt them down', hint: 'Stability −1 · liberals −4 · it stops', apply: (_s, c) => { stab(c, -1); sway(c, 'liberals', -4); return 'Security sweeps begin.'; } },
      { label: 'Guard every line', hint: 'Costs 0.1% of GDP · readiness +3%', enabled: canPay(0.001), apply: (s, c) => { pay(s, c, 0.001); c.mil.readiness = Math.min(1, c.mil.readiness + 0.03); return 'Guards on every bridge.'; } },
    ],
  },
  {
    id: 'war_economy', icon: '🏭', title: 'The war economy strains', weight: 0, cooldown: 0, ttl: 10,
    eligible: () => null,
    text: (_s, c) => `Arms factories are running 60-hour weeks and still cannot keep up. Prices are rising (inflation ${(c.eco.inflation * 100).toFixed(1)}%) and the Treasury wants a decision on how to pay for the war.`,
    options: [
      { label: 'Ration consumer goods', hint: 'Equipment ↑ · stability −2 · unions −6', apply: (_s, c) => { c.mil.equipArmy += 0.003 * c.eco.gdp; stab(c, -2); sway(c, 'labour', -6); return 'Ration books are printed.'; } },
      { label: 'Borrow', hint: 'Debt +1% of GDP · cash +1%', apply: (_s, c) => { c.eco.debt += 0.01 * c.eco.gdp; c.eco.cash += 0.01 * c.eco.gdp; return 'War bonds and loans.'; } },
      { label: 'A war tax on profits', hint: 'Corporate tax +2 points · business −8', apply: (_s, c) => { c.budget.taxCorporate = Math.min(0.6, c.budget.taxCorporate + 0.02); sway(c, 'business', -8); return 'Profits will pay for the war.'; } },
    ],
  },
];

function frontAt(s: GameState, p: number) {
  for (const w of s.wars) { const f = w.fronts.find((x) => x.prov === p && x.by === s.player); if (f) return f; }
  return undefined;
}

/** Weekly while the player is at war: sometimes a war story lands on the desk. */
export function stepWarEvents(s: GameState) {
  const c = s.countries[s.player];
  if (!c?.alive || s.legacy?.status === 'opposition') return;
  const wars = warsOf(s, c.id);
  if (!wars.length || s.inbox.length >= 4 || s.tick - (s.stats.warEvt ?? -999) < 7 || nextRand(s) > 0.12) return;
  const w = wars[0];
  const e = (w.attackers.includes(c.id) ? w.defenders : w.attackers).find((x) => s.countries[x]?.alive) ?? -1;
  if (e < 0) return;
  const myFronts = w.fronts.filter((f) => f.by === c.id);
  const theirFronts = w.fronts.filter((f) => f.by !== c.id && s.owner[f.prov] === c.id);
  const others = s.countries.filter((x) => x.alive && x.id !== c.id && x.id !== e && !w.attackers.includes(x.id) && !w.defenders.includes(x.id));
  const friend = others.filter((x) => getRelation(s, c.id, x.id) > 30).sort((a, b) => strength(b) - strength(a))[0];
  const neutral = others.filter((x) => isMajor(s, x.id) && Math.abs(getRelation(s, c.id, x.id)) < 40 && Math.abs(getRelation(s, e, x.id)) < 40)[0] ?? others.filter((x) => isMajor(s, x.id))[0];
  const opts: { id: string; data: Record<string, number> }[] = [];
  const p = myFronts[0]?.prov ?? -1;
  if (myFronts.some((f) => f.progress > 0.4)) opts.push({ id: 'war_siege', data: { w: w.id, e, p: myFronts.sort((a, b) => b.progress - a.progress)[0].prov } });
  if (friend) opts.push({ id: 'war_volunteers', data: { w: w.id, e, x: friend.id } });
  if (p >= 0) opts.push({ id: 'war_atrocity', data: { w: w.id, e, p } }, { id: 'war_general', data: { w: w.id, e, p } }, { id: 'war_hero', data: { w: w.id, e, p } });
  if (theirFronts.length) opts.push({ id: 'war_sabotage', data: { w: w.id, e, p: theirFronts[0].prov } });
  if (neutral && s.tick - w.start > 20) opts.push({ id: 'war_mediator', data: { w: w.id, e, x: neutral.id } });
  if (friend && isMajor(s, friend.id)) opts.push({ id: 'war_arms', data: { w: w.id, e, x: friend.id } });
  if (warSupport(c) < 0.55) opts.push({ id: 'war_protest', data: { w: w.id, e } });
  if (neutral) opts.push({ id: 'war_pows', data: { w: w.id, e, x: neutral.id } });
  if (c.eco.inflation > 0.05 || c.mil.warEconomy) opts.push({ id: 'war_economy', data: { w: w.id, e } });
  const fresh = opts.filter((o) => s.tick - (s.stats[`we:${o.id}`] ?? -999) > 40);
  if (!fresh.length) return;
  const pick = fresh[Math.floor(nextRand(s) * fresh.length)];
  s.stats.warEvt = s.tick;
  s.stats[`we:${pick.id}`] = s.tick;
  const it: InboxItem = { uid: s.nextInbox++, id: pick.id, tick: s.tick, expires: s.tick + 8, urgent: pick.id === 'war_atrocity', data: pick.data };
  s.inbox.push(it);
  s.lastEventTick = s.tick;
  void alliesOf; void clamp; void logEvent;
}
