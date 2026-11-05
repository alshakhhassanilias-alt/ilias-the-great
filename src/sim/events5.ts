/**
 * Politics events: what the factions demand, what they do when they are furious, and every stage of the crisis
 * arcs (banking crisis, border standoff, coup plot, separatist movement). Each names the people, the places and
 * the sums involved, and each answer changes what happens next.
 */
import { clamp, fmtMoney } from './util';
import { hash01, nextRand } from './rng';
import { type EventDef, type D, canPay, pay, rep, stab } from './eventkit';
import { actPassLaw, factionMeta, hasLaw, lawById, moodLabel, pcOf, spendPC, sway } from './domestic';
import { arcEnd, arcNext } from './arcs';
import { ensureCabinet, ministerOf, replaceMinister, roleTitle } from './cabinet';
import { isFemaleName, nationalName } from './names';
import { placeName } from './places';
import { addRelation, isAtWar } from './relations';
import { imposeSanction } from './diplomacy';
import { declareWar } from './war';
import { overthrow } from './legacy';
import { approval } from './approval';
import { logEvent } from './log';
import type { Country, Faction, FactionId, GameState } from './types';

const prov = (p: number) => placeName(p);
const camp = (s: GameState, v: number) => { if (s.legacy) s.stats.campaign = (s.stats.campaign ?? 0) + v; };
const fac = (c: Country, d: D): Faction | undefined => c.politics?.factions[d.f | 0];
const hasPC = (n: number) => (_s: GameState, c: Country) => pcOf(c) >= n;
const capName = (c: Country) => prov(c.capital);
const youTitle = (s: GameState, c: Country) => (s.legacy?.leader ? `${s.legacy.title} ${s.legacy.leader}` : `the government of ${c.name}`);
const person = (c: Country, salt: string, n: number, role: 'politician' | 'general' = 'politician') => nationalName(c, hash01(salt, c.id, n, 1), hash01(salt, c.id, n, 2), hash01(salt, c.id, n, 3), role);
const minSpeaker = (role: 'finance' | 'foreign' | 'defence' | 'interior') => (_s: GameState, c: Country) => { const m = ministerOf(c, role); return m ? { name: m.name, role: roleTitle(role), cid: c.id, kind: 'minister' as const } : null; };
const setBudgetDelta = (c: Country, k: 'social' | 'taxCorporate' | 'military' | 'infra', v: number) => { c.budget[k] = clamp(c.budget[k] + v, 0, k === 'military' ? 0.12 : 0.6); };
/** pass a law as part of a deal (no vote, no political capital) */
const grantLaw = (s: GameState, c: Country, id: string) => {
  if (hasLaw(c, id)) return false;
  const P = c.politics!;
  const keep = P.pc; P.pc = 100;
  const r = actPassLaw(s, id, 60);
  P.pc = keep;
  return r.ok;
};

// ------------------------------------------------------------------ faction demands
interface Demand { text: (s: GameState, c: Country) => string; hint: string; apply: (s: GameState, c: Country) => string; ok?: (c: Country) => boolean }
const DEMANDS: Record<FactionId, Demand[]> = {
  labour: [
    { text: () => 'an extra 1% of GDP for hospitals, schools and pensions', hint: 'Public spending +1% of GDP', apply: (_s, c) => { setBudgetDelta(c, 'social', 0.01); return 'Spending on public services rises.'; } },
    { text: () => 'a rise in the minimum wage', hint: 'The Minimum Wage Rise becomes law', apply: (s, c) => (grantLaw(s, c, 'min_wage') ? 'The minimum wage goes up.' : 'Wages were already up; a bonus for public workers instead.'), ok: (c) => !hasLaw(c, 'min_wage') },
  ],
  business: [
    { text: () => 'a cut in corporate tax of 3 points', hint: 'Corporate tax −3 points', apply: (_s, c) => { setBudgetDelta(c, 'taxCorporate', -0.03); return 'Corporate tax is cut.'; } },
    { text: () => 'a free trade act', hint: 'The Free Trade Act becomes law', apply: (s, c) => (grantLaw(s, c, 'free_trade') ? 'Tariffs are scrapped.' : 'Trade was already free.'), ok: (c) => !hasLaw(c, 'free_trade') },
  ],
  military: [
    { text: () => 'a rise in the defence budget of 0.5% of GDP', hint: 'Military budget +0.5% of GDP', apply: (_s, c) => { setBudgetDelta(c, 'military', 0.005); return 'The defence budget rises.'; } },
    { text: () => 'universal conscription', hint: 'Universal Conscription becomes law', apply: (s, c) => (grantLaw(s, c, 'conscription') ? 'Conscription is introduced.' : 'Conscription was already law.'), ok: (c) => !hasLaw(c, 'conscription') },
  ],
  nationalists: [
    { text: () => 'a border fortification act', hint: 'The Border Fortification Act becomes law', apply: (s, c) => (grantLaw(s, c, 'border_wall') ? 'Work on the border defences begins.' : 'The border was already fortified.'), ok: (c) => !hasLaw(c, 'border_wall') },
    { text: (s) => `a hard line toward ${s.rival >= 0 ? s.countries[s.rival].name : 'our enemies'}`, hint: 'Sanctions on your rival · relations −15 · reputation −1', apply: (s, c) => { if (s.rival >= 0 && s.countries[s.rival].alive) { imposeSanction(s, c.id, s.rival, 1); addRelation(s, c.id, s.rival, -15); } rep(c, -1); return 'You take a hard line.'; }, ok: () => true },
  ],
  liberals: [
    { text: () => 'an independent anti-corruption agency', hint: 'The Anti-Corruption Agency becomes law', apply: (s, c) => (grantLaw(s, c, 'anti_graft') ? 'The agency opens its doors.' : 'It already exists.'), ok: (c) => !hasLaw(c, 'anti_graft') },
    { text: (_s, c) => (hasLaw(c, 'press_law') ? 'the repeal of the media control law' : hasLaw(c, 'police') ? 'the repeal of the police powers act' : 'a foreign aid programme'), hint: 'A freedom or aid law changes', apply: (s, c) => {
      const P = c.politics!;
      const kill = hasLaw(c, 'press_law') ? 'press_law' : hasLaw(c, 'police') ? 'police' : null;
      if (kill) { P.laws = P.laws.filter((l) => l.id !== kill); return `The ${lawById(kill)!.title} is repealed.`; }
      return grantLaw(s, c, 'foreign_aid') ? 'A foreign aid programme begins.' : 'Aid was already flowing.';
    } },
  ],
  regions: [
    { text: () => 'an extra 0.5% of GDP for regional roads and railways', hint: 'Infrastructure spending +0.5% of GDP', apply: (_s, c) => { setBudgetDelta(c, 'infra', 0.005); return 'Money flows to the regions.'; } },
    { text: () => 'support for farmers', hint: 'The Farm Support Act becomes law', apply: (s, c) => (grantLaw(s, c, 'farm_aid') ? 'Farm support is passed.' : 'Farmers already get support.'), ok: (c) => !hasLaw(c, 'farm_aid') },
  ],
};
const demandOf = (c: Country, d: D) => { const f = fac(c, d); if (!f) return null; const list = DEMANDS[f.id]; const k = (d.k | 0) % list.length; return list[k].ok && !list[k].ok!(c) ? list[(k + 1) % list.length] : list[k]; };
const RIVALS: Record<FactionId, FactionId[]> = { labour: ['business'], business: ['labour'], military: ['liberals'], nationalists: ['liberals'], liberals: ['nationalists', 'military'], regions: ['business'] };
const QUOTES: Record<FactionId, string> = {
  labour: 'Working people built this country. They will not pay for your mistakes.',
  business: 'Capital goes where it is welcome. Right now, that is not here.',
  military: 'The army has served loyally. Loyalty runs both ways.',
  nationalists: 'Our people are tired of a government that apologises for existing.',
  liberals: 'A free country does not fear its own citizens.',
  regions: 'The capital has forgotten that the country does not end at its city limits.',
};

const facSpeaker = (_s: GameState, c: Country, d: D) => { const f = fac(c, d); return f ? { name: f.leader, role: `${factionMeta(f.id).people} · ${factionMeta(f.id).name}`, cid: c.id, kind: (f.id === 'military' ? 'general' : 'leader') as 'general' | 'leader' } : null; };

export const EVENTS5: EventDef[] = [
  {
    id: 'fac_demand', icon: '✊', title: 'A faction makes demands', weight: 0, cooldown: 0, ttl: 16,
    eligible: () => null, speaker: facSpeaker,
    lapse: (s, c, d) => { const f = fac(c, d); if (f) { sway(c, f.id, d.prev === 0 || d.prev === 3 ? -12 : -8); s.stats[`facAns:${f.id}`] = 0; } return d.prev === 0 || d.prev === 3 ? 'Ignored again. They stop asking politely.' : 'Ignored, they feel betrayed.'; },
    text: (s, c, d) => {
      const f = fac(c, d), dm = demandOf(c, d);
      if (!f || !dm) return 'A faction is unhappy with the government.';
      // they remember your last answer
      const past = d.prev === 3 ? 'You turned them down last time, and they have not forgotten. ' : d.prev === 0 ? 'Last time you did not even answer them. ' : d.prev === 1 ? 'You gave them what they asked for last time; now they want more. ' : d.prev === 2 ? 'Your compromise last time bought a year of quiet. ' : '';
      return `${past}${f.leader}, ${factionMeta(f.id).people} for the ${factionMeta(f.id).name} (${f.support.toFixed(0)}% of the country, mood: ${moodLabel(f.mood).toLowerCase()}), demands ${dm.text(s, c)}. "${QUOTES[f.id]}"`;
    },
    options: [
      { label: 'Give them what they want', hint: 'The demand is met · their mood +16 · their rivals grumble', apply: (s, c, d) => {
        const f = fac(c, d), dm = demandOf(c, d); if (!f || !dm) return 'Too late.';
        const r = dm.apply(s, c); sway(c, f.id, 16); for (const x of RIVALS[f.id]) sway(c, x, -4); s.stats[`facAns:${f.id}`] = 1; return r;
      } },
      { label: 'Offer a smaller deal', hint: 'Costs 8 political capital · their mood +6', enabled: hasPC(8), apply: (s, c, d) => { const f = fac(c, d); if (!f) return ''; spendPC(c, 8); sway(c, f.id, d.prev === 3 ? 3 : 6); s.stats[`facAns:${f.id}`] = 2; return d.prev === 3 ? 'After last time, they take the crumbs grudgingly.' : 'A compromise buys you time.'; } },
      { label: 'Refuse', hint: 'Their mood −10 (−14 if you refused them last time too) · their rivals approve (+3)', apply: (s, c, d) => { const f = fac(c, d); if (!f) return ''; sway(c, f.id, d.prev === 3 ? -14 : -10); for (const x of RIVALS[f.id]) sway(c, x, 3); s.stats[`facAns:${f.id}`] = 3; return f.mood < 30 ? 'They are furious. Expect trouble.' : 'You refuse. They will remember.'; } },
    ],
  },
  {
    id: 'fac_unrest', icon: '🔥', title: 'A faction rises up', weight: 0, cooldown: 0, urgent: true, ttl: 10,
    eligible: () => null, speaker: facSpeaker,
    lapse: (s, c, d) => { const f = fac(c, d); if (f && c.politics) c.politics.unrest = { f: f.id, until: s.tick + 8 }; return 'The unrest runs its course.'; },
    text: (s, c, d) => {
      const f = fac(c, d); if (!f) return 'Unrest.';
      const big = prov(c.provinces[0] ?? c.capital), cap = capName(c);
      const t: Record<FactionId, string> = {
        labour: `General strike. ${f.leader} has called out ${Math.max(1, Math.round(c.eco.laborForce * 0.12 / 1e5) / 10)} million workers. The ports and railways around ${big} have stopped, and every week costs the economy.`,
        business: `Capital flight. ${fmtMoney(0.015 * c.eco.gdp)} left the country in a single week as companies moved their money abroad. ${f.leader} says investors "have lost faith in this government".`,
        military: `Officers are refusing orders. ${f.leader} has told the press that the army "will not be humiliated by politicians". Readiness is falling, and there is talk of worse.`,
        nationalists: `Riots in ${cap}. Nationalist crowds led by ${f.leader} have attacked government buildings and burned cars, demanding a government "with a spine".`,
        liberals: `Mass protests. ${Math.round(2 + nextRand(s) * 6)}00,000 people have filled the streets of ${cap}, led by ${f.leader}. Foreign television is broadcasting it live.`,
        regions: `Tractor blockades. Farmers and mayors led by ${f.leader} have sealed the highways around ${big} and stopped paying regional taxes.`,
      };
      return t[f.id];
    },
    options: [
      { label: 'Concede: meet them halfway', hint: 'Costs 0.5% of GDP · their mood +20 · the unrest ends', enabled: canPay(0.005), apply: (s, c, d) => { const f = fac(c, d); if (!f) return ''; pay(s, c, 0.005); sway(c, f.id, 20); for (const x of RIVALS[f.id]) sway(c, x, -5); return 'A deal is struck. The streets go quiet.'; } },
      { label: 'Send in the police', hint: 'Stability −3 · liberals −12 · their mood −8 · usually ends it', apply: (s, c, d) => {
        const f = fac(c, d); if (!f) return '';
        stab(c, -3); sway(c, 'liberals', -12); sway(c, f.id, -8); sway(c, 'military', 3);
        if (nextRand(s) < 0.3 && c.politics) { c.politics.unrest = { f: f.id, until: s.tick + 6 }; return 'The crackdown backfired: the unrest goes on.'; }
        return 'The police cleared the streets.';
      } },
      { label: 'Wait it out', hint: 'It costs you every week for two months', apply: (s, c, d) => { const f = fac(c, d); if (f && c.politics) c.politics.unrest = { f: f.id, until: s.tick + 8 }; return 'You wait.'; } },
    ],
  },

  // ---------------------------------------------------------------- banking crisis
  {
    id: 'arc_bank_1', icon: '🏦', title: 'Trouble at a bank', weight: 0, cooldown: 0, urgent: true, ttl: 14, arc: { title: 'Banking Crisis', stage: 1, of: 3 },
    eligible: () => null, speaker: minSpeaker('finance'),
    lapse: (s, _c, d) => { arcNext(s, 'arc_bank_2a', 3, d, 2); return 'You did nothing. The bank failed.'; },
    text: (_s, c, d) => `Queues are forming outside ${bankName(d)}, the country's ${['', '', 'second', 'third', 'fourth', 'fifth'][d.size | 0] || 'third'}-largest lender, after a leaked audit found ${fmtMoney(0.012 * c.eco.gdp)} in loans that will never be repaid. Its chief executive, ${ceo(c, d)}, insists the bank is sound. The central bank gives it two weeks.`,
    options: [
      { label: 'Guarantee every deposit', hint: 'Costs 0.6% of GDP · business +6 · the run stops, but others may want the same', enabled: canPay(0.006), apply: (s, c, d) => { pay(s, c, 0.006); sway(c, 'business', 6); sway(c, 'labour', 3); arcNext(s, 'arc_bank_2b', 9, d, 2); return 'The guarantee calms the depositors.'; } },
      { label: 'Arrange a quiet takeover', hint: 'Costs 12 political capital · works 60% of the time', enabled: hasPC(12), apply: (s, c, d) => {
        spendPC(c, 12);
        if (nextRand(s) < 0.6) { sway(c, 'business', 4); arcEnd(s, `a rival bank absorbed ${bankName(d)} overnight. Nobody lost a cent.`); return 'Done over a weekend. Nobody noticed.'; }
        arcNext(s, 'arc_bank_2a', 4, d, 2); return 'The deal leaked before it was signed.';
      } },
      { label: 'Let it fail: no bailouts', hint: 'Business −10 · unions −8 · the panic may spread', apply: (s, c, d) => { sway(c, 'business', -10); sway(c, 'labour', -8); arcNext(s, 'arc_bank_2a', 4, d, 2); return `${bankName(d)} closes its doors.`; } },
    ],
  },
  {
    id: 'arc_bank_2a', icon: '🏧', title: 'The bank run spreads', weight: 0, cooldown: 0, urgent: true, ttl: 12, arc: { title: 'Banking Crisis', stage: 2, of: 3 },
    eligible: () => null, speaker: minSpeaker('finance'),
    lapse: (s, c, d) => { c.eco.tfp *= 0.99; stab(c, -5); arcNext(s, 'arc_bank_3', 10, d, 3); return 'The panic burned itself out, at a terrible cost.'; },
    text: (_s, c, d) => `Panic. Depositors pulled ${fmtMoney(0.02 * c.eco.gdp)} out of banks across the country in five days. Cash machines in ${prov(d.p)} are empty and two more banks have shut. Whatever we do now, growth will take a hit.`,
    options: [
      { label: 'Nationalise the failing banks', hint: 'Costs 1.5% of GDP · unions +8 · business −14', enabled: canPay(0.015), apply: (s, c, d) => { c.eco.tfp *= 0.996; stab(c, -2); pay(s, c, 0.015); sway(c, 'labour', 8); sway(c, 'business', -14); arcNext(s, 'arc_bank_3', 10, d, 3); return 'The state now owns a third of the banking system.'; } },
      { label: 'Take an emergency IMF loan', hint: 'Debt +3% of GDP (cash +3%) · nationalists −12 · business +6', apply: (s, c, d) => { c.eco.tfp *= 0.996; stab(c, -2); c.eco.debt += 0.03 * c.eco.gdp; c.eco.cash += 0.03 * c.eco.gdp; sway(c, 'nationalists', -12); sway(c, 'business', 6); arcNext(s, 'arc_bank_3', 10, d, 3); return 'Foreign money props up the banks, on foreign terms.'; } },
      { label: 'Freeze withdrawals for a month', hint: 'Costs 8 political capital · stability −4 · unions −10', enabled: hasPC(8), apply: (s, c, d) => { spendPC(c, 8); c.eco.tfp *= 0.997; stab(c, -4); sway(c, 'labour', -10); sway(c, 'business', -4); arcNext(s, 'arc_bank_3', 10, d, 3); return 'The banks are closed. The anger is not.'; } },
    ],
  },
  {
    id: 'arc_bank_2b', icon: '🏦', title: 'A second bank wants the same', weight: 0, cooldown: 0, ttl: 14, arc: { title: 'Banking Crisis', stage: 2, of: 3 },
    eligible: () => null, speaker: minSpeaker('finance'),
    lapse: (s, _c, d) => { arcNext(s, 'arc_bank_3', 8, d, 3); return 'The second bank muddled through.'; },
    text: (_s, c, d) => `${bankName({ ...d, size: (d.size | 0) + 1, p: d.p })} says it holds the same toxic loans and wants the guarantee you gave ${bankName(d)}, about ${fmtMoney(0.008 * c.eco.gdp)}. The opposition calls it "socialism for bankers".`,
    options: [
      { label: 'Guarantee it too', hint: 'Costs 0.8% of GDP · liberals −6 · unions −6 · business +5', enabled: canPay(0.008), apply: (s, c, d) => { pay(s, c, 0.008); sway(c, 'liberals', -6); sway(c, 'labour', -6); sway(c, 'business', 5); arcNext(s, 'arc_bank_3', 10, d, 3); return 'Another rescue.'; } },
      { label: 'Refuse: one rescue was enough', hint: 'Business −6 · half the time it fails (stability −2, a small hit to growth)', apply: (s, c, d) => { sway(c, 'business', -6); if (nextRand(s) < 0.5) { stab(c, -2); c.eco.tfp *= 0.997; } arcNext(s, 'arc_bank_3', 10, d, 3); return 'You hold the line.'; } },
    ],
  },
  {
    id: 'arc_bank_3', icon: '⚖', title: 'The reckoning', weight: 0, cooldown: 0, ttl: 16, arc: { title: 'Banking Crisis', stage: 3, of: 3 },
    eligible: () => null, speaker: minSpeaker('interior'),
    lapse: (s) => { arcEnd(s, 'nobody was ever held responsible.'); return 'The inquiry report gathers dust.'; },
    text: (_s, c, d) => `A parliamentary inquiry has found that ${ceo(c, d)} hid the losses at ${bankName(d)} for three years and paid ${isFemaleCeo(c, d) ? 'herself' : 'himself'} a ${fmtMoney(3e6 + (d.size | 0) * 2.5e6)} bonus the month before it collapsed. The country wants someone to pay.`,
    options: [
      { label: `Prosecute the bank's chief`, hint: 'Unions +8 · liberals +8 · business −6 · political capital +6', apply: (s, c, d) => { sway(c, 'labour', 8); sway(c, 'liberals', 8); sway(c, 'business', -6); if (c.politics) c.politics.pc = Math.min(100, c.politics.pc + 6); arcEnd(s, `${ceo(c, d)} was charged with fraud, and the public cheered.`); return 'Charges are filed.'; } },
      { label: 'Pass a banking reform', hint: 'Costs 10 political capital · productivity +0.2% for good · liberals +4', enabled: hasPC(10), apply: (s, c) => { spendPC(c, 10); c.eco.tfp *= 1.002; sway(c, 'liberals', 4); sway(c, 'business', -3); arcEnd(s, 'new rules make the banks safer.'); return 'Reform passed.'; } },
      { label: 'Let it go quietly', hint: 'Business +6 · liberals −10 · unions −8', apply: (s, c) => { sway(c, 'business', 6); sway(c, 'liberals', -10); sway(c, 'labour', -8); arcEnd(s, 'the bankers walked away.'); return 'Life goes on.'; } },
    ],
  },

  // ---------------------------------------------------------------- border standoff
  {
    id: 'arc_standoff_1', icon: '🪖', title: 'Troops on the border', weight: 0, cooldown: 0, urgent: true, ttl: 12, arc: { title: 'Border Standoff', stage: 1, of: 3 },
    eligible: () => null, speaker: minSpeaker('defence'),
    lapse: (s, _c, d) => { arcNext(s, 'arc_standoff_2', 4, d, 2); return 'You did nothing. They took note.'; },
    text: (s, _c, d) => { const N = s.countries[d.n]; return `${N.leader ? `${N.leader.name} of ` : ''}${N.name} has moved ${Math.max(5, Math.round(N.mil.troops * 0.25 / 1000))},000 troops to within sight of ${prov(d.p)}. Satellite photos show field hospitals, fuel depots and bridging equipment. Our ambassador was not received.`; },
    options: [
      { label: 'Mobilise the reserves', hint: 'Costs 0.3% of GDP · readiness +8% · military +8 · shows you are ready', enabled: canPay(0.003), apply: (s, c, d) => { pay(s, c, 0.003); c.mil.readiness = Math.min(1, c.mil.readiness + 0.08); sway(c, 'military', 8); sway(c, 'liberals', -3); arcNext(s, 'arc_standoff_2', 6, { ...d, firm: 1 }, 2); return 'Reservists report to their barracks.'; } },
      { label: 'Rally your allies', hint: 'Costs 10 political capital · reputation +2 · they will think twice', enabled: hasPC(10), apply: (s, c, d) => { spendPC(c, 10); rep(c, 2); addRelation(s, c.id, d.n, -5); arcNext(s, 'arc_standoff_2', 6, { ...d, allies: 1 }, 2); return 'Your allies issue a joint warning.'; } },
      { label: 'Open a secret back channel', hint: 'Costs 6 political capital · nationalists −6 · may end it quietly (40%)', enabled: hasPC(6), apply: (s, c, d) => {
        spendPC(c, 6); sway(c, 'nationalists', -6);
        if (nextRand(s) < 0.4) { addRelation(s, c.id, d.n, 8); arcEnd(s, `${s.countries[d.n].name} pulled back after secret talks.`); return 'The troops are going home.'; }
        arcNext(s, 'arc_standoff_2', 6, d, 2); return 'The talks went nowhere.';
      } },
    ],
  },
  {
    id: 'arc_standoff_2', icon: '💥', title: 'Shots at the border', weight: 0, cooldown: 0, urgent: true, ttl: 10, arc: { title: 'Border Standoff', stage: 2, of: 3 },
    eligible: () => null, speaker: (s, _c, d) => { const N = s.countries[d.n]; return N?.leader ? { name: N.leader.name, role: `Leader of ${N.name}`, cid: N.id, kind: 'leader' } : null; },
    lapse: (s, _c, d) => { arcNext(s, 'arc_standoff_3', 5, d, 3); return 'Silence from the capital. They push on.'; },
    text: (s, c, d) => `Before dawn a patrol from ${s.countries[d.n].name} crossed into ${prov(d.p)}. In the firefight that followed, ${3 + (d.p % 9)} of our border guards were killed. ${s.countries[d.n].name}'s state television calls it "a provocation by ${youTitle(s, c)}".`,
    options: [
      { label: 'Protest and impose sanctions', hint: 'Sanctions on them · nationalists −4 · the crisis goes on', apply: (s, c, d) => { imposeSanction(s, c.id, d.n, 1); sway(c, 'nationalists', -4); arcNext(s, 'arc_standoff_3', 8, d, 3); return 'Sanctions are imposed.'; } },
      { label: 'De-escalate quietly', hint: 'Costs 10 political capital · nationalists −12 · military −6 · relations +12', enabled: hasPC(10), apply: (s, c, d) => { spendPC(c, 10); sway(c, 'nationalists', -12); sway(c, 'military', -6); addRelation(s, c.id, d.n, 12); arcEnd(s, 'both armies stood down. Some called it wisdom, others weakness.'); return 'The guns fall silent.'; } },
      { label: 'Strike back at their positions', hint: `Military +10 · nationalists +12 · liberals −8 · risk of war`, apply: (s, c, d, geo) => {
        sway(c, 'military', 10); sway(c, 'nationalists', 12); sway(c, 'liberals', -8);
        const p = 0.35 - 0.15 * (d.firm | 0) - 0.1 * (d.allies | 0);
        if (nextRand(s) < p && !isAtWar(s, d.n)) { declareWar(s, geo, d.n, c.id, 'border clash'); arcEnd(s, 'it ended in war.'); return 'They answered with an invasion.'; }
        rep(c, 2); addRelation(s, c.id, d.n, -10); arcEnd(s, `${s.countries[d.n].name} pulled its troops back. Our deterrent held.`); return 'They blinked.';
      } },
    ],
  },
  {
    id: 'arc_standoff_3', icon: '📜', title: 'The ultimatum', weight: 0, cooldown: 0, urgent: true, ttl: 10, arc: { title: 'Border Standoff', stage: 3, of: 3 },
    eligible: () => null, speaker: (s, _c, d) => { const N = s.countries[d.n]; return N?.leader ? { name: N.leader.name, role: `Leader of ${N.name}`, cid: N.id, kind: 'leader' } : null; },
    lapse: (s, c, d, geo) => { if (nextRand(s) < 0.5 && !isAtWar(s, d.n)) { declareWar(s, geo, d.n, c.id, 'ultimatum ignored'); arcEnd(s, 'the deadline passed, and the tanks rolled.'); return 'War.'; } arcEnd(s, 'the deadline passed and nothing happened.'); return 'A bluff.'; },
    text: (s, _c, d) => `${s.countries[d.n].leader?.name ?? s.countries[d.n].name} has issued an ultimatum: ${prov(d.p)} must be demilitarised within 30 days, or ${s.countries[d.n].name} "will act to protect its security".`,
    options: [
      { label: 'Accept demilitarisation', hint: 'Nationalists −20 · military −12 · stability −2 · relations +20', apply: (s, c, d) => { sway(c, 'nationalists', -20); sway(c, 'military', -12); stab(c, -2); addRelation(s, c.id, d.n, 20); arcEnd(s, `our troops left ${prov(d.p)}. Peace, at a price.`); return 'You give way.'; } },
      { label: 'Ask the World Assembly to mediate', hint: 'Costs 12 political capital · reputation +3 · works 70% of the time', enabled: hasPC(12), apply: (s, c, d, geo) => {
        spendPC(c, 12); rep(c, 3);
        if (nextRand(s) < 0.7) { addRelation(s, c.id, d.n, 10); arcEnd(s, 'the World Assembly brokered a deal.'); return 'Mediators step in.'; }
        if (!isAtWar(s, d.n)) declareWar(s, geo, d.n, c.id, 'mediation failed');
        arcEnd(s, 'mediation failed and war broke out.'); return 'Talks collapse.';
      } },
      { label: 'Refuse and dig in', hint: 'Military +6 · nationalists +8 · a real risk of war', apply: (s, c, d, geo) => {
        sway(c, 'military', 6); sway(c, 'nationalists', 8);
        if (nextRand(s) < 0.32 - 0.12 * (d.firm | 0) - 0.12 * (d.allies | 0) && !isAtWar(s, d.n)) { declareWar(s, geo, d.n, c.id, 'ultimatum refused'); arcEnd(s, 'it ended in war.'); return 'They attacked.'; }
        rep(c, 3); arcEnd(s, `${s.countries[d.n].name} blinked first.`); return 'They backed down.';
      } },
    ],
  },

  // ---------------------------------------------------------------- coup plot
  {
    id: 'arc_coup_1', icon: '🗡', title: 'Whispers in the officers\' mess', weight: 0, cooldown: 0, urgent: true, ttl: 12, arc: { title: 'Coup Plot', stage: 1, of: 2 },
    eligible: () => null, speaker: minSpeaker('interior'),
    lapse: (s, _c, d) => { arcNext(s, 'arc_coup_2', 4, d, 2); return 'You waited.'; },
    text: (_s, c, d) => `Our security service has recordings. General ${plotter(c, d)}, commander of the ${ord(d.corps | 0)} Corps, has met opposition figures and two other generals three times this month. The talk is of "saving the nation" from your government.`,
    options: [
      { label: 'Arrest the plotters', hint: 'Military −12 · readiness −5% · liberals −3 · may be too late if the army is furious', apply: (s, c, d) => {
        sway(c, 'military', -12); sway(c, 'liberals', -3); c.mil.readiness = Math.max(0.2, c.mil.readiness - 0.05);
        const m = c.politics?.factions.find((f) => f.id === 'military');
        if (m && m.mood < 20) { arcNext(s, 'arc_coup_2', 3, d, 2); return 'The arrests came too late: the plotters struck first.'; }
        arcEnd(s, `General ${plotter(c, d)} and four officers were arrested before dawn.`); return 'The plot is broken.';
      } },
      { label: 'Buy the army\'s loyalty', hint: 'Costs 0.4% of GDP · military +14', enabled: canPay(0.004), apply: (s, c) => { pay(s, c, 0.004); sway(c, 'military', 14); arcEnd(s, 'a generous pay rise for officers ended the grumbling.'); return 'Money talks.'; } },
      { label: 'Watch and wait', hint: 'Nothing, for now', apply: (s, _c, d) => { arcNext(s, 'arc_coup_2', 5, d, 2); return 'You keep watching.'; } },
    ],
  },
  {
    id: 'arc_coup_2', icon: '🚨', title: 'Tanks in the capital', weight: 0, cooldown: 0, urgent: true, ttl: 6, arc: { title: 'Coup Plot', stage: 2, of: 2 },
    eligible: () => null, speaker: (_s, c, d) => ({ name: plotter(c, d), role: `Commander, ${ord(d.corps | 0)} Corps`, cid: c.id, kind: 'general' }),
    lapse: (s, c, d) => { sway(c, 'military', 10); sway(c, 'liberals', -20); stab(c, -8); arcEnd(s, `General ${plotter(c, d)} now calls the shots behind the scenes.`); return 'You did nothing, and the generals took what they wanted.'; },
    text: (_s, c, d) => `Tanks of the ${ord(d.corps | 0)} Corps are rolling into ${capName(c)}. General ${plotter(c, d)} is on state television announcing a "Committee of National Salvation". Your guards are still loyal, for now. You have hours, not days.`,
    options: [
      { label: 'Call the people into the streets', hint: 'Works if the public is with you (approval matters)', apply: (s, c, d) => {
        if (nextRand(s) < 0.2 + approval(s, c) / 110) { stab(c, 4); sway(c, 'military', -15); sway(c, 'liberals', 10); arcEnd(s, 'hundreds of thousands surrounded the tanks, and the coup collapsed.'); return 'The people saved you.'; }
        return ousted(s, c, d);
      } },
      { label: 'Order loyal units to fight', hint: 'Works if your Defence Minister is able and the army not too angry', apply: (s, c, d) => {
        const dm = ministerOf(c, 'defence'); const m = c.politics?.factions.find((f) => f.id === 'military');
        if (nextRand(s) < 0.42 + 0.06 * (dm?.skill ?? 3) + (m?.mood ?? 40) / 250) { sway(c, 'military', -20); stab(c, -6); arcEnd(s, 'after a night of fighting the rebels surrendered.'); return 'The coup is crushed.'; }
        return ousted(s, c, d);
      } },
      { label: 'Negotiate: give the generals a seat at the table', hint: 'Costs 15 political capital · military +18 · liberals −18 · defence budget +1% of GDP', enabled: hasPC(15), apply: (s, c, d) => {
        spendPC(c, 15); sway(c, 'military', 18); sway(c, 'liberals', -18); setBudgetDelta(c, 'military', 0.01);
        const dm = ministerOf(c, 'defence'); if (dm) replaceMinister(s, dm.id, 'makes way for the army\'s candidate');
        arcEnd(s, `you survived by giving General ${plotter(c, d)}'s friends what they wanted.`); return 'A deal with the generals.';
      } },
    ],
  },

  // ---------------------------------------------------------------- separatists
  {
    id: 'arc_separatists_1', icon: '🏴', title: 'A region wants out', weight: 0, cooldown: 0, urgent: true, ttl: 14, arc: { title: 'Separatist Movement', stage: 1, of: 3 },
    eligible: () => null, speaker: (_s, c, d) => ({ name: sepLeader(c, d), role: `${prov(d.p)} People's Front`, cid: c.id, kind: 'leader' }),
    lapse: (s, _c, d) => { arcNext(s, 'arc_separatists_2', 6, { ...d, path: 2 }, 2); return 'Ignored, the movement grows.'; },
    text: (_s, c, d) => `${sepLeader(c, d)}'s ${prov(d.p)} People's Front filled the main square of ${prov(d.p)} with ${3 + (d.p % 7)}0,000 people waving the region's old flag. They want a referendum on independence within a year. The regional police chief says his officers will not use force against their neighbours.`,
    options: [
      { label: 'Offer autonomy talks', hint: 'Costs 10 political capital · regions +8 · nationalists −8', enabled: hasPC(10), apply: (s, c, d) => { spendPC(c, 10); sway(c, 'regions', 8); sway(c, 'nationalists', -8); arcNext(s, 'arc_separatists_2', 10, { ...d, path: 0 }, 2); return 'Talks begin.'; } },
      { label: 'Ban the Front and arrest its leaders', hint: 'Liberals −10 · nationalists +8 · stability −2', apply: (s, c, d) => { sway(c, 'liberals', -10); sway(c, 'nationalists', 8); stab(c, -2); arcNext(s, 'arc_separatists_2', 8, { ...d, path: 1 }, 2); return `${sepLeader(c, d)} is arrested.`; } },
      { label: 'Ignore them', hint: 'Nothing now. They will not go away.', apply: (s, _c, d) => { arcNext(s, 'arc_separatists_2', 8, { ...d, path: 2 }, 2); return 'You ignore them.'; } },
    ],
  },
  {
    id: 'arc_separatists_2', icon: '🏴', title: 'The region decides', weight: 0, cooldown: 0, urgent: true, ttl: 14, arc: { title: 'Separatist Movement', stage: 2, of: 3 },
    eligible: () => null, speaker: (_s, c, d) => ({ name: sepLeader(c, d), role: `${prov(d.p)} People's Front`, cid: c.id, kind: 'leader' }),
    lapse: (s, _c, d) => { arcNext(s, 'arc_separatists_3', 6, d, 3); return 'The standoff hardens.'; },
    text: (_s, _c, d) => (d.path | 0) === 0
      ? `Talks in ${prov(d.p)} have produced a draft statute: a regional parliament, control of schools and police, and half the taxes raised there. Nationalists call it "the first step to breaking up the country".`
      : (d.path | 0) === 1
        ? `Bombs. A police station and a railway bridge near ${prov(d.p)} were blown up overnight. The banned Front denies it; a new armed group has claimed responsibility.`
        : `The Front has held its own referendum in ${prov(d.p)}. Turnout was ${55 + (d.p % 25)}%, and ${60 + (d.p % 30)}% voted to leave. The result has no legal force, but the whole world is watching.`,
    options: [
      { label: 'Sign / recognise a wide autonomy', hint: 'Regions +12 · nationalists −12 · the region calms down', apply: (s, c, d) => { sway(c, 'regions', 12); sway(c, 'nationalists', -12); s.integ[d.p] = clamp((s.integ[d.p] ?? 1) + 0.3, 0, 1); grantLaw(s, c, 'autonomy'); arcEnd(s, `${prov(d.p)} has its own parliament now, and stays.`); return 'Autonomy is granted.'; } },
      { label: 'Send in the army', hint: 'Military +5 · liberals −10 · stability −3 · reputation −2', apply: (s, c, d) => { sway(c, 'military', 5); sway(c, 'liberals', -10); stab(c, -3); rep(c, -2); s.integ[d.p] = clamp((s.integ[d.p] ?? 1) + 0.15, 0, 1); if ((d.path | 0) === 1) { arcEnd(s, 'the insurgency was crushed, at a price.'); return 'The army moves in.'; } arcNext(s, 'arc_separatists_3', 8, d, 3); return 'Troops patrol the streets.'; } },
      { label: 'Hold an official referendum', hint: 'A gamble: win it (55%) and the issue is settled; lose and the region is in uproar', apply: (s, c, d) => {
        if (nextRand(s) < 0.55) { stab(c, 4); sway(c, 'nationalists', 6); sway(c, 'regions', 4); rep(c, 3); arcEnd(s, `${prov(d.p)} voted to stay. The movement is finished for a generation.`); return 'They voted to stay!'; }
        stab(c, -6); s.integ[d.p] = 0.2; sway(c, 'nationalists', -15); arcNext(s, 'arc_separatists_3', 6, d, 3); return 'They voted to leave.';
      } },
    ],
  },
  {
    id: 'arc_separatists_3', icon: '🔥', title: 'Showdown in the region', weight: 0, cooldown: 0, urgent: true, ttl: 12, arc: { title: 'Separatist Movement', stage: 3, of: 3 },
    eligible: () => null, speaker: (_s, c, d) => ({ name: sepLeader(c, d), role: `${prov(d.p)} People's Front`, cid: c.id, kind: 'leader' }),
    lapse: (s, c, d) => { if (c.politics) c.politics.unrest = { f: 'regions', until: s.tick + 10 }; arcEnd(s, `${prov(d.p)} smoulders.`); return 'The region is ungovernable for months.'; },
    text: (_s, _c, d) => `A general strike has shut down ${prov(d.p)}. Roads are blocked, the regional government has stopped sending taxes to the capital, and foreign journalists are arriving by the hundred.`,
    options: [
      { label: 'A grand compromise', hint: 'Costs 12 political capital · regions +12 · nationalists −8', enabled: hasPC(12), apply: (s, c, d) => { spendPC(c, 12); sway(c, 'regions', 12); sway(c, 'nationalists', -8); s.integ[d.p] = clamp((s.integ[d.p] ?? 1) + 0.3, 0, 1); arcEnd(s, `a deal in ${prov(d.p)} ended the strike.`); return 'A deal is struck.'; } },
      { label: 'Declare martial law', hint: 'Stability −5 · liberals −15 · military +6 · reputation −3', apply: (s, c, d) => { stab(c, -5); sway(c, 'liberals', -15); sway(c, 'military', 6); rep(c, -3); s.integ[d.p] = clamp((s.integ[d.p] ?? 1) + 0.2, 0, 1); arcEnd(s, `soldiers restored order in ${prov(d.p)}.`); return 'Martial law.'; } },
      { label: 'Wait for them to tire', hint: 'Regions −10 · months of unrest', apply: (s, c, d) => { sway(c, 'regions', -10); if (c.politics) c.politics.unrest = { f: 'regions', until: s.tick + 10 }; arcEnd(s, `${prov(d.p)} slowly went back to work.`); return 'You wait.'; } },
    ],
  },
  // ---------------------------------------------------------------- outbreak
  {
    id: 'arc_epidemic_1', icon: '🦠', title: 'A new virus', weight: 0, cooldown: 0, urgent: true, ttl: 10, arc: { title: 'Outbreak', stage: 1, of: 3 },
    eligible: () => null, speaker: minSpeaker('interior'),
    lapse: (s, _c, d) => { arcNext(s, 'arc_epidemic_2', 4, { ...d, path: 2 }, 2); return 'You waited. The virus did not.'; },
    text: (_s, _c, d) => `Hospitals in ${prov(d.p)} report ${180 + (d.p % 400)} cases of a new respiratory virus in a week, and ${4 + (d.p % 17)} deaths. Doctors fear it spreads before anyone shows symptoms.`,
    options: [
      { label: `Lock down the city`, hint: 'A small hit to growth · stability −2 · business −8 · slows the virus', apply: (s, c, d) => { c.eco.tfp *= 0.997; stab(c, -2); sway(c, 'business', -8); arcNext(s, 'arc_epidemic_2', 6, { ...d, path: 0 }, 2); return `${prov(d.p)} is sealed off.`; } },
      { label: 'Mass testing and tracing', hint: 'Costs 0.3% of GDP and 6 political capital', enabled: (s, c) => canPay(0.003)(s, c) && pcOf(c) >= 6, apply: (s, c, d) => { pay(s, c, 0.003); spendPC(c, 6); arcNext(s, 'arc_epidemic_2', 6, { ...d, path: 1 }, 2); return 'Testing centres open in every district.'; } },
      { label: 'Keep the country open', hint: 'Business +4 · a gamble', apply: (s, c, d) => { sway(c, 'business', 4); arcNext(s, 'arc_epidemic_2', 4, { ...d, path: 2 }, 2); return 'Life goes on, for now.'; } },
    ],
  },
  {
    id: 'arc_epidemic_2', icon: '🏥', title: 'The outbreak spreads', weight: 0, cooldown: 0, urgent: true, ttl: 10, arc: { title: 'Outbreak', stage: 2, of: 3 },
    eligible: () => null, speaker: minSpeaker('interior'),
    lapse: (s, c, d) => { stab(c, -4); c.eco.laborForce *= 0.997; arcNext(s, 'arc_epidemic_3', 8, d, 3); return 'The country muddled through. Many did not.'; },
    text: (_s, _c, d) => (d.path | 0) === 0
      ? `The lockdown slowed the virus, but ${prov(d.p)} is suffocating: half its restaurants have closed and the unions want wages paid.`
      : (d.path | 0) === 1
        ? `Testing caught most clusters, but the virus has reached three other cities. The health service is stretched but holding.`
        : `The virus is everywhere. ${2 + (d.p % 9)},000 people are in hospital and the intensive-care units in ${prov(d.p)} are full. Doctors are choosing who gets a ventilator.`,
    options: [
      { label: 'Pay wages and rent while it lasts', hint: 'Costs 0.8% of GDP · unions +8 · stability +2', enabled: canPay(0.008), apply: (s, c, d) => { pay(s, c, 0.008); sway(c, 'labour', 8); stab(c, 2); arcNext(s, 'arc_epidemic_3', 10, d, 3); return 'The state pays the bills.'; } },
      { label: 'A national lockdown', hint: 'A hit to growth · stability −3 · business −10 · the virus is contained', apply: (s, c, d) => { c.eco.tfp *= 0.995; stab(c, -3); sway(c, 'business', -10); arcNext(s, 'arc_epidemic_3', 10, d, 3); return 'The whole country stays home.'; } },
      { label: 'Field hospitals and the army', hint: 'Costs 0.5% of GDP · military +4 · stability +1', enabled: canPay(0.005), apply: (s, c, d) => { pay(s, c, 0.005); sway(c, 'military', 4); stab(c, 1); arcNext(s, 'arc_epidemic_3', 10, d, 3); return 'Army tents rise outside the hospitals.'; } },
    ],
  },
  {
    id: 'arc_epidemic_3', icon: '💉', title: 'The vaccine race', weight: 0, cooldown: 0, ttl: 14, arc: { title: 'Outbreak', stage: 3, of: 3 },
    eligible: () => null, speaker: minSpeaker('finance'),
    lapse: (s) => { arcEnd(s, 'the virus faded on its own, slowly.'); return 'The virus fades.'; },
    text: (_s, c) => `Vaccines are ready, but the world is scrambling for them. Rich countries are buying up supplies; ${c.name}'s scientists say they could make their own in a year.`,
    options: [
      { label: 'Buy enough for everyone', hint: 'Costs 0.6% of GDP · stability +4', enabled: canPay(0.006), apply: (s, c) => { pay(s, c, 0.006); stab(c, 4); arcEnd(s, 'everyone who wanted a vaccine got one.'); return 'Mass vaccination begins.'; } },
      { label: 'Develop our own', hint: 'Costs 12 political capital · technology +2 · stability +2', enabled: (_s, c) => pcOf(c) >= 12, apply: (s, c) => { spendPC(c, 12); c.eco.tech += 2; stab(c, 2); arcEnd(s, `${c.name}'s own vaccine saved the day.`); return 'National pride, in a syringe.'; } },
      { label: 'Share doses with poorer countries', hint: 'Costs 0.3% of GDP · reputation +5 · liberals +8', enabled: canPay(0.003), apply: (s, c) => { pay(s, c, 0.003); rep(c, 5); sway(c, 'liberals', 8); arcEnd(s, 'the world noticed our generosity.'); return 'Planes full of vaccines take off.'; } },
    ],
  },

  // ---------------------------------------------------------------- blackout
  {
    id: 'arc_blackout_1', icon: '🌡', title: 'A record heatwave', weight: 0, cooldown: 0, urgent: true, ttl: 8, arc: { title: 'The Great Blackout', stage: 1, of: 3 },
    eligible: () => null, speaker: minSpeaker('finance'),
    lapse: (s, _c, d) => { arcNext(s, 'arc_blackout_2', 2, { ...d, path: 2 }, 2); return 'Nobody acted.'; },
    text: (_s, _c, d) => `${prov(d.p)} has hit ${41 + (d.p % 6)}°C for nine days. Air conditioners are overloading the grid and the operator warns of rolling blackouts within days.`,
    options: [
      { label: 'Emergency power imports', hint: 'Costs 0.3% of GDP · keeps the lights on', enabled: canPay(0.003), apply: (s, c, d) => { pay(s, c, 0.003); arcNext(s, 'arc_blackout_2', 6, { ...d, path: 0 }, 2); return 'Power flows in from abroad.'; } },
      { label: 'Ration power to industry', hint: 'Business −8 · a small hit to output', apply: (s, c, d) => { sway(c, 'business', -8); c.eco.tfp *= 0.998; arcNext(s, 'arc_blackout_2', 6, { ...d, path: 1 }, 2); return 'Factories go dark so homes stay cool.'; } },
      { label: 'Trust the grid', hint: 'Nothing now', apply: (s, _c, d) => { arcNext(s, 'arc_blackout_2', 2, { ...d, path: 2 }, 2); return 'You hope for the best.'; } },
    ],
  },
  {
    id: 'arc_blackout_2', icon: '🔌', title: 'The lights go out', weight: 0, cooldown: 0, urgent: true, ttl: 10, arc: { title: 'The Great Blackout', stage: 2, of: 3 },
    eligible: () => null, speaker: minSpeaker('interior'),
    lapse: (s, c, d) => { stab(c, -3); arcNext(s, 'arc_blackout_3', 8, d, 3); return 'The anger lingers.'; },
    text: (_s, c, d) => (d.path | 0) === 0
      ? `The imports kept the lights on, but suppliers have tripled their prices and want a five-year contract. Our grid is clearly not ready for summers like this.`
      : `The lights went out across ${prov(d.p)} for ${(d.path | 0) === 1 ? 14 : 36} hours. Hospitals ran on generators, traffic lights died, and ${(d.path | 0) === 1 ? 3 : 11 + (c.id % 20)} people died in the heat.`,
    options: [
      { label: 'Fire the grid operator\'s chief', hint: 'Stability +1 · regions +4', apply: (s, c, d) => { stab(c, 1); sway(c, 'regions', 4); if ((d.path | 0) > 0) stab(c, -2); arcNext(s, 'arc_blackout_3', 10, d, 3); return 'Heads roll.'; } },
      { label: 'Nationalise the grid', hint: 'Unions +6 · business −8 · energy +2%', apply: (s, c, d) => { sway(c, 'labour', 6); sway(c, 'business', -8); c.eco.energyCap *= 1.02; arcNext(s, 'arc_blackout_3', 10, d, 3); return 'The grid belongs to the state now.'; } },
      { label: 'Promise a new grid', hint: 'Costs 8 political capital · infrastructure +2', enabled: (_s, c) => pcOf(c) >= 8, apply: (s, c, d) => { spendPC(c, 8); c.eco.infra = Math.min(100, c.eco.infra + 2); arcNext(s, 'arc_blackout_3', 10, d, 3); return 'A grand plan is announced.'; } },
    ],
  },
  {
    id: 'arc_blackout_3', icon: '⚡', title: 'The energy future', weight: 0, cooldown: 0, ttl: 14, arc: { title: 'The Great Blackout', stage: 3, of: 3 },
    eligible: () => null, speaker: minSpeaker('finance'),
    lapse: (s) => { arcEnd(s, 'nothing changed. Until next summer.'); return 'The plans gather dust.'; },
    text: () => 'The inquiry into the blackout is out: the grid is old, the reserves too thin and the country too dependent on a few plants. It needs a decision on the energy future.',
    options: [
      { label: 'Build new power plants', hint: 'Costs 1% of GDP · energy +8%', enabled: canPay(0.01), apply: (s, c) => { pay(s, c, 0.01); c.eco.energyCap *= 1.08; arcEnd(s, 'new plants are rising across the country.'); return 'Construction begins.'; } },
      { label: 'An efficiency drive', hint: 'Costs 10 political capital · energy +4% · liberals +6', enabled: (_s, c) => pcOf(c) >= 10, apply: (s, c) => { spendPC(c, 10); c.eco.energyCap *= 1.04; sway(c, 'liberals', 6); arcEnd(s, 'insulation, heat pumps and smart meters for millions.'); return 'Efficiency first.'; } },
      { label: 'Buy from the neighbours', hint: 'Energy +5% · nationalists −6', apply: (s, c) => { c.eco.energyCap *= 1.05; sway(c, 'nationalists', -6); arcEnd(s, 'new interconnectors link us to the neighbours.'); return 'Cables cross the border.'; } },
    ],
  },

  // ---------------------------------------------------------------- the leaked files
  {
    id: 'arc_leaks_1', icon: '🗂', title: 'The leaked files', weight: 0, cooldown: 0, urgent: true, ttl: 10, arc: { title: 'The Leaked Files', stage: 1, of: 3 },
    eligible: () => null, speaker: (_s, c, d) => ({ name: person(c, 'jour', d.n | 0), role: 'Investigative journalist', cid: c.id, kind: 'leader' }),
    lapse: (s, _c, d) => { arcNext(s, 'arc_leaks_2', 4, { ...d, path: 2 }, 2); return 'Your silence became the story.'; },
    text: (_s, c, d) => { const m = ministerOf(c, 'finance'); const mm = c.cabinet?.find((x) => x.id === d.m) ?? m; return `A consortium of journalists led by ${person(c, 'jour', d.n | 0)} has ${8 + (d.n | 0)} million leaked files from an offshore law firm. Among the names: ${mm ? `${roleTitle(mm.role)} ${mm.name}` : 'a senior minister'} and two of the governing party's biggest donors, with accounts worth ${fmtMoney(4e7 + (d.n | 0) * 2.3e7)}.`; },
    options: [
      { label: 'Promise full transparency', hint: 'Liberals +8 · stability −1 · the minister is suspended', apply: (s, c, d) => { sway(c, 'liberals', 8); stab(c, -1); const m = c.cabinet?.find((x) => x.id === d.m); if (m) m.loyalty = clamp(m.loyalty - 20, 0, 100); arcNext(s, 'arc_leaks_2', 6, { ...d, path: 0 }, 2); return 'You promise to hide nothing.'; } },
      { label: 'Attack the press', hint: 'Liberals −12 · nationalists +4 · reputation −3', apply: (s, c, d) => { sway(c, 'liberals', -12); sway(c, 'nationalists', 4); rep(c, -3); arcNext(s, 'arc_leaks_2', 5, { ...d, path: 1 }, 2); return '"Foreign-funded fake news", you say.'; } },
      { label: 'Say nothing', hint: 'Nothing now', apply: (s, _c, d) => { arcNext(s, 'arc_leaks_2', 5, { ...d, path: 2 }, 2); return 'No comment.'; } },
    ],
  },
  {
    id: 'arc_leaks_2', icon: '🔍', title: 'The second batch', weight: 0, cooldown: 0, urgent: true, ttl: 10, arc: { title: 'The Leaked Files', stage: 2, of: 3 },
    eligible: () => null, speaker: (_s, c, d) => ({ name: person(c, 'jour', d.n | 0), role: 'Investigative journalist', cid: c.id, kind: 'leader' }),
    lapse: (s, c, d) => { stab(c, -3); arcNext(s, 'arc_leaks_3', 6, d, 3); return 'The story grows.'; },
    text: (s, c, d) => (d.path | 0) === 0
      ? `Prosecutors want to question the minister named in the files. The opposition says the investigation is a test of whether anyone in ${c.name} is above the law.`
      : `The second batch is worse: a trust fund opened in ${2008 + (d.n | 0)} in the name of ${s.legacy?.leader ? `${s.legacy.leader}'s` : 'the head of government\'s'} family, with ${fmtMoney(2e6 + (d.n | 0) * 1.1e6)} in it. Every front page has your photograph.`,
    options: [
      { label: 'Let justice do its work', hint: 'The minister goes · liberals +8 · political capital +4', apply: (s, c, d) => { const m = c.cabinet?.find((x) => x.id === d.m); if (m) replaceMinister(s, m.id, 'steps down to face prosecutors'); sway(c, 'liberals', 8); if (c.politics) c.politics.pc = Math.min(100, c.politics.pc + 4); arcNext(s, 'arc_leaks_3', 8, d, 3); return 'The minister resigns.'; } },
      { label: 'Publish every tax return you ever filed', hint: 'Costs 10 political capital · stability +2', enabled: (_s, c) => pcOf(c) >= 10, apply: (s, c, d) => { spendPC(c, 10); stab(c, 2); arcNext(s, 'arc_leaks_3', 8, d, 3); return 'Radical transparency.'; } },
      { label: 'Sue the journalists', hint: 'Liberals −14 · reputation −4', apply: (s, c, d) => { sway(c, 'liberals', -14); rep(c, -4); arcNext(s, 'arc_leaks_3', 6, d, 3); return 'Lawyers are sent.'; } },
    ],
  },
  {
    id: 'arc_leaks_3', icon: '⚖', title: 'The reckoning in parliament', weight: 0, cooldown: 0, urgent: true, ttl: 10, arc: { title: 'The Leaked Files', stage: 3, of: 3 },
    eligible: () => null, speaker: minSpeaker('interior'),
    lapse: (s, c) => { stab(c, -4); camp(s, -3); arcEnd(s, 'the stain never quite washed out.'); return 'The scandal lingers.'; },
    text: (_s, c) => (c.gov === 'D' || c.gov === 'F') ? 'The opposition has tabled a motion of no confidence over the leaked files. Some of your own MPs are wavering.' : 'Crowds gather outside the presidential palace with photocopies of the leaked files, chanting "Where is our money?".',
    options: [
      { label: 'Fight it out', hint: 'Costs 12 political capital · you survive, damaged', enabled: (_s, c) => pcOf(c) >= 12, apply: (s, c) => { spendPC(c, 12); stab(c, -1); arcEnd(s, 'the government survived the vote.'); return 'You win the vote.'; } },
      { label: 'Offer an anti-corruption package', hint: 'The Anti-Corruption Agency becomes law · liberals +8', apply: (s, c) => { grantLaw(s, c, 'anti_graft'); sway(c, 'liberals', 8); arcEnd(s, 'a new anti-corruption agency is born from the scandal.'); return 'Reform wins the day.'; } },
      { label: 'Ride it out', hint: 'Stability −4 · political capital −10 · polls −3', apply: (s, c) => { stab(c, -4); if (c.politics) c.politics.pc = Math.max(0, c.politics.pc - 10); camp(s, -3); arcEnd(s, 'you survived, but the stain remains.'); return 'You ride it out.'; } },
    ],
  },
];

// ---------------------------------------------------------------- helpers
function bankName(d: D) {
  const kinds = ['Savings Bank', 'Commercial Bank', 'Mutual Credit', 'Trust & Loan', 'Agricultural Bank'];
  return `${prov(d.p)} ${kinds[(d.size | 0) % kinds.length]}`;
}
const ceo = (c: Country, d: D) => person(c, 'ceo', (d.p | 0) * 7 + (d.size | 0));
const isFemaleCeo = (c: Country, d: D) => isFemaleName(ceo(c, d));
const plotter = (c: Country, d: D) => person(c, 'plot', d.corps | 0, 'general');
const sepLeader = (c: Country, d: D) => person(c, 'sep', d.p | 0);
const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

function ousted(s: GameState, c: Country, d: D): string {
  const gen = plotter(c, d);
  arcEnd(s, `General ${gen} seized power.`);
  if (s.legacy && overthrow(s, `${s.legacy.leader} is overthrown in a military coup led by General ${gen}.`)) return 'You have been overthrown.';
  // sandbox: you survive as a figurehead and must rebuild your authority
  stab(c, -20);
  if (c.politics) { c.politics.pc = 0; sway(c, 'military', 25); sway(c, 'liberals', -25); }
  c.cabinet = undefined; ensureCabinet(s, 7 + s.tick);
  logEvent(s, `🚨 COUP: General ${gen} seizes power in ${c.name}. You remain head of state, but the generals now run the government.`, 'danger', [c.id], true, { big: true, prov: c.capital });
  return 'The coup succeeded. You keep your title, not your power.';
}
