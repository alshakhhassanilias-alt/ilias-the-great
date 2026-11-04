/**
 * War chapters: the decisions that come at each stage of a war of the player's (warmode.ts schedules them, more often
 * the bigger the war): the first battles, the home front, the butcher's bill, the turning point (for better or worse),
 * peace feelers, and the aftermath when the guns fall silent.
 */
import { clamp } from './util';
import { type EventDef, type D, canPay, pay, rep, stab, money } from './eventkit';
import { sway } from './domestic';
import { bumpSupport, warSupport } from './warsupport';
import { warScore } from './war';
import { actPeace, setBudget } from './actions';
import { actMobilise } from './warmode';
import { linesAgainst, nuclearWarning, protectorsOf } from './redlines';
import { addRelation } from './relations';
import { strength } from './military';
import { isMajor } from './drama';
import type { Country, GameState, War } from './types';

const nm = (s: GameState, id: number) => s.countries[id]?.name ?? 'the enemy';
const warOf = (s: GameState, d: D): War | undefined => s.wars.find((w) => w.id === d.w);
const ws = (c: Country, v: number) => bumpSupport(c, v, 'events');
const big = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)} million` : v >= 1000 ? `${Math.round(v / 1000)},000` : String(Math.round(v)));
const myFronts = (s: GameState, w: War | undefined) => (w ? w.fronts.filter((f) => f.by === s.player) : []);
const push = (s: GameState, w: War | undefined, by: number) => { for (const f of myFronts(s, w)) f.progress = Math.min(0.97, f.progress + by); };
const tierWord = (d: D) => ['', 'border clash', 'limited war', 'regional war', 'major war', 'great-power war'][d.tier ?? 2] ?? 'war';

export const EVENTS12: EventDef[] = [
  {
    id: 'war_opening', icon: '⚔', title: 'The first battles', weight: 0, cooldown: 0, ttl: 8,
    eligible: () => null,
    text: (s, c, d) => {
      const w = warOf(s, d);
      const mine = myFronts(s, w).length, theirs = w ? w.fronts.filter((f) => f.by !== s.player && s.owner[f.prov] === c.id).length : 0;
      return `Three weeks into the ${tierWord(d)} with ${nm(s, d.e)}. We are attacking on ${mine} front${mine === 1 ? '' : 's'}; they are pushing into our territory on ${theirs}. Our losses so far: ${big(w?.casualties[c.id] ?? 0)}. The chief of the general staff wants a decision on how to fight the next months. War support: ${Math.round(warSupport(c) * 100)}%.`;
    },
    options: [
      { label: 'Throw in the reserves', hint: 'Costs 0.8% of GDP · troops +4% · every attack of ours jumps forward', enabled: canPay(0.008), apply: (s, c, d) => { pay(s, c, 0.008); c.mil.troops *= 1.04; push(s, warOf(s, d), 0.12); ws(c, 0.02); return 'The reserves move up to the front.'; } },
      { label: 'An air campaign', hint: 'Costs 0.5% of GDP · our attacks advance · the enemy tires faster', enabled: canPay(0.005), apply: (s, c, d) => { pay(s, c, 0.005); push(s, warOf(s, d), 0.07); const E = s.countries[d.e]; if (E) E.mil.exhaustion = clamp(E.mil.exhaustion + 0.05, 0, 1); return 'Our aircraft strike their depots and bridges.'; } },
      { label: 'Dig in and hold', hint: 'Switch to defence in depth (defence +18%) · war support +3', apply: (s, c) => { c.strat = 'depth'; ws(c, 0.03); return 'The army digs in along the line.'; } },
    ],
  },
  {
    id: 'war_homefront', icon: '🏭', title: 'The home front', weight: 0, cooldown: 0, ttl: 10,
    eligible: () => null,
    text: (s, c, d) => `The ${tierWord(d)} with ${nm(s, d.e)} is in its ${Math.max(1, Math.round((s.tick - (warOf(s, d)?.start ?? s.tick)) / 4.33))}th month. Factories run double shifts, prices creep up (inflation ${(c.eco.inflation * 100).toFixed(1)}%) and families wait for letters from the front. The cabinet must decide how the country carries the war.`,
    options: [
      { label: 'Sell war bonds', hint: `The treasury receives ${'1%'} of GDP now (it becomes debt) · war support +2`, apply: (_s, c) => { c.eco.cash += 0.01 * c.eco.gdp; c.eco.debt += 0.01 * c.eco.gdp; ws(c, 0.02); return 'Citizens queue to lend to the nation.'; } },
      { label: 'Rationing', hint: 'Inflation −1.5 points · stability −2 · war support +3', apply: (_s, c) => { c.eco.inflation = Math.max(0, c.eco.inflation - 0.015); stab(c, -2); ws(c, 0.03); return 'Ration books are printed.'; } },
      { label: 'A propaganda drive', hint: 'War support +6 · reputation −2 · liberals −4', apply: (_s, c) => { ws(c, 0.06); rep(c, -2); sway(c, 'liberals', -4); return 'Posters on every wall, heroes on every screen.'; } },
      { label: 'Keep life as normal as we can', hint: 'Approval +1 · no change to the war effort', apply: (s) => { s.stats.apprBoost = (s.stats.apprBoost ?? 0) + 1; return 'Schools stay open, the football league plays on.'; } },
    ],
  },
  {
    id: 'war_losses', icon: '🕯', title: 'The butcher’s bill', weight: 0, cooldown: 0, ttl: 8,
    eligible: () => null,
    text: (s, c, d) => `${big(warOf(s, d)?.casualties[c.id] ?? 0)} of our soldiers have been killed or wounded in the war with ${nm(s, d.e)}. Every town has its funerals. The army needs replacements; the families want answers.`,
    options: [
      { label: 'Widen conscription', hint: 'Troops +6% · stability −3 · unions −4', apply: (_s, c) => { c.mil.troops *= 1.06; stab(c, -3); sway(c, 'labour', -4); return 'The call-up age is lowered.'; } },
      { label: 'Volunteers and bonuses', hint: 'Costs 0.6% of GDP · troops +3% · war support +3', enabled: canPay(0.006), apply: (s, c) => { pay(s, c, 0.006); c.mil.troops *= 1.03; ws(c, 0.03); return 'Recruiting offices fill up.'; } },
      { label: 'Tell the truth, honour the dead', hint: 'Stability +2 · war support −2 · approval +2', apply: (s, c) => { stab(c, 2); ws(c, -0.02); s.stats.apprBoost = (s.stats.apprBoost ?? 0) + 2; return 'A national day of mourning.'; } },
    ],
  },
  {
    id: 'war_turn', icon: '🌊', title: 'The tide turns', weight: 0, cooldown: 0, ttl: 8,
    eligible: () => null,
    text: (s, c, d) => {
      const w = warOf(s, d);
      const sc = w ? warScore(s, w, c.id) : 0;
      return sc >= 0
        ? `Our armies are winning the war with ${nm(s, d.e)} (war score ${Math.round(sc * 100)}). Their lines are breaking. The generals want to press on; the diplomats say a good peace is possible now.`
        : `Our darkest hour. The war with ${nm(s, d.e)} is going badly (war score ${Math.round(sc * 100)}). Their armies are deep in our land. What we decide now decides the war.`;
    },
    options: [
      { label: 'Press the advantage / stand firm', hint: 'Lightning offensive (offence +15%) · war support +3', apply: (_s, c) => { c.strat = 'blitz'; ws(c, 0.03); return 'Everything forward.'; } },
      { label: 'Total war economy', hint: 'Mobilise everything: troops grow 60% over a year, output −7%, stability falls', apply: (s) => { const r = actMobilise(s, 3, true); return r.ok ? 'The whole nation goes to war.' : r.message; } },
      { label: 'Seek a negotiated peace', hint: 'Offer peace on the current lines (they may refuse)', apply: (s, _c, d, geo) => { const r = actPeace(s, geo, s.player, d.e, { kind: 'status_quo' }); return r.ok ? 'Peace on the current lines.' : `They refuse: ${r.message.toLowerCase()}`; } },
    ],
  },
  {
    id: 'war_feelers', icon: '🕊', title: 'Peace feelers', weight: 0, cooldown: 0, ttl: 8,
    eligible: () => null,
    text: (s, c, d) => `Through a neutral embassy, ${nm(s, d.e)} sends word: both countries are exhausted (ours ${Math.round(c.mil.exhaustion * 100)}%, theirs ${Math.round((s.countries[d.e]?.mil.exhaustion ?? 0) * 100)}%). They hint at talks.`,
    options: [
      { label: 'Agree to an armistice', hint: 'Peace on the current lines, if they accept', apply: (s, _c, d, geo) => { const r = actPeace(s, geo, s.player, d.e, { kind: 'status_quo' }); return r.ok ? 'The guns fall silent.' : `The talks collapse: ${r.message.toLowerCase()}`; } },
      { label: 'Fight on to victory', hint: 'War of attrition: they tire faster than we do · war support +3 · liberals −3', apply: (_s, c) => { c.strat = 'attrition'; ws(c, 0.03); sway(c, 'liberals', -3); return 'No talks while they hold our land.'; } },
      { label: 'Keep the channel open', hint: 'Nothing changes yet · reputation +1', apply: (_s, c) => { rep(c, 1); return 'The embassy keeps talking.'; } },
    ],
  },
  {
    id: 'war_aftermath', icon: '🎖', title: 'When the guns fall silent', weight: 0, cooldown: 0, ttl: 12,
    eligible: () => null,
    text: (s, _c, d) => `${d.won ? 'Victory.' : d.draw ? 'It is over, and nobody won.' : 'Defeat.'} After ${d.weeks >= 52 ? `${(d.weeks / 52).toFixed(1)} years` : `${Math.round(d.weeks / 4.33)} months`}, the ${tierWord(d)} with ${nm(s, d.e)} has ended. The country waits to hear from you.`,
    options: [
      { label: 'A victory parade / a day of national unity', hint: 'Costs 0.2% of GDP · approval +4 · nationalists and the army pleased', enabled: canPay(0.002), apply: (s, c) => { pay(s, c, 0.002); s.stats.apprBoost = (s.stats.apprBoost ?? 0) + 4; sway(c, 'nationalists', 5); sway(c, 'military', 5); return 'Crowds line the avenues.'; } },
      { label: 'Rebuild what was destroyed', hint: 'Costs 1% of GDP · war damage repaired faster · stability +3', enabled: canPay(0.01), apply: (s, c) => { pay(s, c, 0.01); c.eco.damage = Math.max(0, c.eco.damage - 0.1); stab(c, 3); return 'Cranes over the ruined towns.'; } },
      { label: 'Never again: rearm', hint: 'Defence budget +0.5% of GDP · the army pleased · liberals uneasy', apply: (s, c) => { setBudget(s, c.id, 'military', c.budget.military + 0.005); sway(c, 'military', 6); sway(c, 'liberals', -3); return `Never again (${money(c, 0.01)} a year more for defence).`; } },
      { label: 'A memorial to the fallen', hint: 'Stability +4 · approval +2', apply: (s, c) => { stab(c, 4); s.stats.apprBoost = (s.stats.apprBoost ?? 0) + 2; return 'A memorial is unveiled in the capital.'; } },
    ],
  },
  {
    id: 'war_redline', icon: '⚠', title: 'A red line', weight: 0, cooldown: 0, urgent: true, ttl: 6,
    eligible: () => null,
    lapse: (s, _c, d) => { for (const r of linesAgainst(s, d.war)) r.answer = 'bluff'; return 'We said nothing and pressed on: they take it as defiance.'; },
    text: (s, c, d) => {
      const ls = linesAgainst(s, d.war);
      const who = ls.length ? [...new Set(ls.map((r) => r.f))] : s.countries[d.f] ? [d.f] : [];
      const names = who.map((f) => nm(s, f));
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? 'Its friends';
      const st = who.reduce((t, f) => t + strength(s.countries[f]), 0), ratio = st / Math.max(1, strength(c));
      return `${list} ${who.length > 1 ? 'have' : 'has'} drawn a red line over ${nm(s, d.x)}: one step further into its homeland and ${who.length > 1 ? 'they enter' : `${list} enters`} the war. ${who.length > 1 ? 'Together they are' : `${list} is`} ${ratio >= 1.5 ? `${ratio.toFixed(1)} times as strong as we are` : ratio >= 0.7 ? 'about as strong as we are' : 'weaker than we are, but not alone'}. Our generals want to know: do we stop?`;
    },
    options: [
      { label: 'Halt at the line', hint: 'We stop advancing into their homeland · they stand down unless the war spreads · war support −3 · reputation +2', apply: (s, c, d) => {
        for (const r of linesAgainst(s, d.war)) r.answer = 'halt';
        s.stats[`rlb:${d.war}:${d.x}`] = 0.1; ws(c, -0.03); rep(c, 2);
        return 'We hold our lines. They stand down, for now.';
      } },
      { label: 'Call their bluff', hint: 'We press on. If they mean it they fight; if not, they lose face · relations with them −10 · war support +2', apply: (s, c, d) => {
        for (const r of linesAgainst(s, d.war)) { r.answer = 'bluff'; addRelation(s, c.id, r.f, -10); }
        ws(c, 0.02);
        return 'We will not be told where our armies may go. Now they must choose.';
      } },
      { label: 'Seek a ceasefire on the current lines', hint: 'Peace with what we hold, if they accept', apply: (s, _c, d, geo) => {
        for (const r of linesAgainst(s, d.war)) r.answer = 'talks';
        const r = actPeace(s, geo, s.player, d.x, { kind: 'status_quo' });
        return r.ok ? 'A ceasefire on the current lines. We keep what we hold.' : `They refuse: ${r.message.toLowerCase()}`;
      } },
    ],
  },
  {
    id: 'war_existential', icon: '☢', title: 'The survival of the nation', weight: 0, cooldown: 0, urgent: true, ttl: 4,
    eligible: () => null,
    text: (s, c, d) => {
      const w = s.wars.find((x) => x.id === d.war);
      const foes = w ? (w.attackers.includes(c.id) ? w.defenders : w.attackers) : [];
      const friends = w ? protectorsOf(s, w, c.id).filter((p) => p.rung < 3).map((p) => nm(s, p.f)) : [];
      return `${foes.map((e) => nm(s, e)).slice(0, 3).join(', ')} ${foes.length > 1 ? 'are' : 'is'} deep in our homeland${c.provinces.includes(c.capital) ? '' : ' and the capital has fallen'}. We are a nuclear power. Our generals ask what you are prepared to do.${friends.length ? ` ${friends.join(' and ')} could still come to our side.` : ' No one else is coming.'}`;
    },
    options: [
      { label: 'Warn the world: every weapon we have', hint: 'Their advance on our homeland all but stops and they will want peace · reputation −4 · relations with every great power −5', apply: (s, c, d) => {
        const w = s.wars.find((x) => x.id === d.war); if (!w) return 'The war is over.';
        nuclearWarning(s, w, c.id);
        for (const g of s.countries) if (g.alive && g.id !== c.id && isMajor(s, g.id)) addRelation(s, g.id, c.id, -5);
        return 'The warning is heard in every capital.';
      } },
      { label: 'Appeal to our friends', hint: 'Every country that cares about us decides now whether to fight for us', apply: (s, c, d) => {
        const w = s.wars.find((x) => x.id === d.war); if (!w) return 'The war is over.';
        const ps = protectorsOf(s, w, c.id).filter((p) => p.rung < 3);
        for (const p of ps) { const r = s.react?.[`${w.id}:${c.id}:${p.f}`]; if (r) { r.rung = Math.max(2, r.rung) as 2; r.line = 0; } }
        return ps.length ? `Envoys leave for ${ps.map((p) => nm(s, p.f)).join(' and ')}.` : 'There is no one left to ask.';
      } },
      { label: 'Seek terms', hint: 'Give up some land to save the rest, if they accept', apply: (s, c, d, geo) => {
        const w = s.wars.find((x) => x.id === d.war); if (!w) return 'The war is over.';
        const lead = (w.attackers.includes(c.id) ? w.defenders : w.attackers)[0];
        const r = actPeace(s, geo, s.player, lead, { kind: 'concede', share: 0.15 });
        return r.ok ? 'A bitter peace. The nation survives.' : `They refuse: ${r.message.toLowerCase()}`;
      } },
    ],
  },
];
