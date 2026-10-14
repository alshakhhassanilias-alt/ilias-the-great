/**
 * Cabinet events: the people around you. Scandals, a minister plotting against you, and the Treasury and
 * Defence fighting over money. Every one names the minister, the sums involved and what each answer does.
 */
import { clamp, fmtMoney } from './util';
import { nextRand } from './rng';
import { type EventDef, canPay, pay, rep, stab } from './eventkit';
import { mtraitById, ministerById, replaceMinister, roleTitle } from './cabinet';
import { strength } from './military';
import { getRelation } from './relations';
import type { Country, GameState, Minister } from './types';

const who = (c: Country, id: number): Minister | undefined => ministerById(c, id);
const nm = (c: Country, id: number) => { const m = who(c, id); return m ? `${roleTitle(m.role)} ${m.name}` : 'The minister'; };
const loy = (m: Minister | undefined, v: number) => { if (m) m.loyalty = clamp(m.loyalty + v, 0, 100); };
const camp = (s: GameState, v: number) => { if (s.legacy) s.stats.campaign = (s.stats.campaign ?? 0) + v; };

const SCANDALS: ((r: number, gdp: number) => string)[] = [
  (r, gdp) => `steered a ${fmtMoney(Math.min(gdp * 0.002, 4e7 + r * 6e8))} state contract to a construction firm owned by a brother-in-law`,
  (r) => `owns an undeclared seaside villa abroad worth ${fmtMoney(2e6 + r * 1.4e7)}`,
  (r) => `was recorded promising a lobbyist "special treatment" in exchange for ${fmtMoney(5e5 + r * 4.5e6)} in party donations`,
  (r) => `put ${8 + Math.floor(r * 20)} relatives and old classmates on the ministry payroll`,
  (r) => `billed the taxpayer ${fmtMoney(3e5 + r * 2.2e6)} for private flights, a yacht charter and a daughter's wedding`,
  () => `leaked classified cabinet papers to a newspaper to damage a rival`,
];
const DEMANDS: Record<string, string> = {
  finance: 'a free hand to cut public spending by 1% of GDP',
  foreign: 'the right to name every ambassador and set policy toward your allies',
  defence: 'a rise in the military budget of 0.4% of GDP',
  interior: 'emergency powers to break up protests and tap phones',
};

export const EVENTS4: EventDef[] = [
  {
    id: 'min_scandal', icon: '📰', title: 'Cabinet scandal', weight: 0, cooldown: 0, urgent: true, ttl: 20,
    eligible: () => null,
    lapse: (s, c, d) => { stab(c, -3); camp(s, -2); return `The scandal around ${who(c, d.m)?.name ?? 'the minister'} dragged on for weeks. Stability −3.`; },
    text: (s, c, d) => {
      const m = who(c, d.m);
      return `${pickPaper(c, Math.abs(d.k | 0))} reveals that ${nm(c, d.m)} ${SCANDALS[Math.abs(d.k | 0) % SCANDALS.length](d.amt ?? 0.5, c.eco.gdp)}. The opposition is demanding a resignation by the end of the week${m ? `; ${m.name.split(' ')[0]} insists it is a smear` : ''}. ${s.legacy?.status === 'office' ? 'Your polls are watching.' : ''}`;
    },
    options: [
      { label: 'Sack them today', hint: 'Stability +1 · reputation +1 · a replacement takes over · the rest of the cabinet is nervous (loyalty −3)', apply: (s, c, d) => {
        const m = who(c, d.m); if (!m) return 'They already left.';
        stab(c, 1); rep(c, 1);
        for (const o of c.cabinet ?? []) if (o.id !== m.id) loy(o, -3);
        const n = replaceMinister(s, m.id, 'is sacked over the scandal');
        return `${m.name} is gone. ${n ? `${n.name} takes over.` : ''}`;
      } },
      { label: 'Stand by them', hint: 'Stability −3 · their loyalty +20 · polls −2 · it may not be over', apply: (s, c, d) => {
        const m = who(c, d.m); stab(c, -3); loy(m, 20); camp(s, -2);
        if (m) m.scandal = s.tick;
        if (nextRand(s) < 0.35) { stab(c, -2); return `More revelations: ${m?.name ?? 'the minister'} survives, but the story runs for another month (stability −2 more).`; }
        return `You back ${m?.name ?? 'your minister'}. The story fades, slowly.`;
      } },
      { label: 'Order a quiet internal inquiry', hint: 'Costs 0.02% of GDP · half the time it clears them (stability +1), half the time it leaks (stability −4, they resign)', enabled: canPay(0.0002), apply: (s, c, d) => {
        pay(s, c, 0.0002);
        const m = who(c, d.m);
        if (nextRand(s) < 0.5) { stab(c, 1); loy(m, 10); return `The inquiry clears ${m?.name ?? 'the minister'}. The papers move on.`; }
        stab(c, -4); camp(s, -1);
        if (m) replaceMinister(s, m.id, 'resigns after the inquiry\'s findings leak');
        return 'The inquiry leaked. Worse than the scandal itself.';
      } },
    ],
  },
  {
    id: 'min_revolt', icon: '🗡', title: 'A minister turns on you', weight: 0, cooldown: 0, urgent: true, ttl: 14,
    eligible: () => null,
    lapse: (s, c, d) => { const m = who(c, d.m); stab(c, -2); camp(s, -2); if (m) replaceMinister(s, m.id, 'quits and joins your critics'); return 'Ignored, the minister walked out and went straight to the television studios.'; },
    text: (s, c, d) => {
      const m = who(c, d.m);
      return `${nm(c, d.m)} (${m ? mtraitById(m.trait).title : ''}, loyalty ${m ? m.loyalty.toFixed(0) : '?'}) has been briefing journalists against you for weeks. Now ${m?.name.split(' ')[0] ?? 'they'} demands ${m ? DEMANDS[m.role] : 'concessions'}, or a very public resignation${s.legacy?.status === 'office' ? ' just as your re-election campaign needs a united front' : ''}.`;
    },
    options: [
      { label: 'Give them what they want', hint: 'Their loyalty +30 · the policy changes now (see the demand)', apply: (s, c, d) => {
        const m = who(c, d.m); if (!m) return 'They already left.';
        loy(m, 30);
        if (m.role === 'finance') { c.budget.social = Math.max(0.02, c.budget.social - 0.006); c.budget.infra = Math.max(0.003, c.budget.infra - 0.004); stab(c, -2); return 'Spending cuts are announced. Unions grumble (stability −2).'; }
        if (m.role === 'defence') { c.budget.military = Math.min(0.12, c.budget.military + 0.004); return 'The military budget rises by 0.4% of GDP.'; }
        if (m.role === 'interior') { stab(c, 3); rep(c, -4); return 'Emergency powers are passed. The streets go quiet; abroad, eyebrows rise (reputation −4).'; }
        rep(c, -1); return 'The Foreign Minister now runs foreign policy in all but name.';
      } },
      { label: 'Fire them before they quit', hint: 'Stability −2 · polls −3 · they take their faction with them', apply: (s, c, d) => {
        const m = who(c, d.m); if (!m) return 'They already left.';
        stab(c, -2); camp(s, -3);
        replaceMinister(s, m.id, 'is dismissed after weeks of open rebellion');
        return `${m.name} is out, and now a free agent with a grudge.`;
      } },
      { label: 'Call their bluff', hint: 'Half the time they back down (loyalty +10); otherwise a public resignation (stability −3)', apply: (s, c, d) => {
        const m = who(c, d.m); if (!m) return 'They already left.';
        if (nextRand(s) < 0.5 + (m.skill <= 2 ? 0.15 : 0)) { loy(m, 10); return `${m.name} backs down. For now.`; }
        stab(c, -3); camp(s, -2);
        replaceMinister(s, m.id, 'resigns live on the evening news');
        return 'They meant it.';
      } },
    ],
  },
  {
    id: 'min_clash', icon: '⚖', title: 'The Treasury against the generals', weight: 0, cooldown: 0, ttl: 18,
    eligible: () => null,
    text: (s, c, d) => {
      const f = who(c, d.f), df = who(c, d.d);
      const deficit = (c.eco.spending - c.eco.revenue);
      const threat = [...s.countries].filter((x) => x.alive && x.id !== c.id).sort((a, b) => strength(b) - strength(a)).find((x) => getRelation(s, x.id, c.id) < -20);
      return `${f ? `${roleTitle('finance')} ${f.name}` : 'The Treasury'} wants to cut the military budget by 0.3% of GDP (${fmtMoney(0.003 * c.eco.gdp)} a year) to ${deficit > 0 ? `close a ${fmtMoney(deficit)} deficit` : 'fund schools and hospitals'}. ${df ? `${roleTitle('defence')} ${df.name}` : 'The Defence Ministry'} says it would leave the country exposed${threat ? ` to ${threat.name}` : ''} and threatens to resign. The cabinet room is silent; everyone is looking at you.`;
    },
    options: [
      { label: 'Back the Treasury: cut the military', hint: 'Military budget −0.3% of GDP · Finance loyalty +10 · Defence loyalty −18', apply: (_s, c, d) => {
        c.budget.military = Math.max(0.004, c.budget.military - 0.003); loy(who(c, d.f), 10); loy(who(c, d.d), -18); return 'The cuts go through. The generals are furious.';
      } },
      { label: 'Back the generals: keep it and add more', hint: 'Military budget +0.15% of GDP · Defence loyalty +10 · Finance loyalty −18', apply: (_s, c, d) => {
        c.budget.military = Math.min(0.12, c.budget.military + 0.0015); loy(who(c, d.d), 10); loy(who(c, d.f), -18); return 'The army gets its money. The Treasury warns about the deficit.';
      } },
      { label: 'Split the difference', hint: 'Military budget −0.1% of GDP · both lose 6 loyalty', apply: (_s, c, d) => {
        c.budget.military = Math.max(0.004, c.budget.military - 0.001); loy(who(c, d.f), -6); loy(who(c, d.d), -6); return 'A compromise nobody likes. That is how you know it is a compromise.';
      } },
    ],
  },
];

function pickPaper(c: Country, k: number) {
  const papers = [`${c.name}'s biggest daily`, `A leading investigative weekly`, `The country's best-selling tabloid`, `The state broadcaster`, `An opposition newspaper`, `A foreign newspaper`];
  return papers[k % papers.length];
}
