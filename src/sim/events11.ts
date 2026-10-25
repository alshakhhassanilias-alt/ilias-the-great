/**
 * Legacy mode's own decisions: the election campaign in three acts (strategy, the debate, the final push), the
 * challenge from your rival inside the party, the personal side of power (scandals, health, family, an attempt on your
 * life) and life in opposition. None of these appear in Sandbox, where you are the country rather than a person.
 */
import type { EventDef } from './eventkit';
import { canPay, pay, rep, stab } from './eventkit';
import { clamp } from './util';
import { nextRand } from './rng';
import { actNameHeir, personaOf } from './persona';
import { approval } from './approval';
import { overthrow, endLegacy, isFree } from './legacy';
import { isAtWar } from './relations';
import type { Country, GameState } from './types';

const camp = (s: GameState, v: number) => { s.stats.campaign = (s.stats.campaign ?? 0) + v; };
const boost = (s: GameState, v: number) => { s.stats.apprBoost = (s.stats.apprBoost ?? 0) + v; };
const skill = (s: GameState, k: 'cha' | 'adm' | 'dip' | 'cmd') => personaOf(s)?.skills[k] ?? 5;
const office = (s: GameState) => s.settings.mode === 'legacy' && s.legacy?.status === 'office';
const opp = (s: GameState) => s.settings.mode === 'legacy' && s.legacy?.status === 'opposition';
const pcOf = (c: Country) => c.politics?.pc ?? 0;
const spend = (c: Country, n: number) => { if (c.politics) c.politics.pc = Math.max(0, c.politics.pc - n); };
const growthGap = (c: Country) => c.eco.growth - (Number.isFinite(c.eco.baseGrowth) ? c.eco.baseGrowth : 0.02);

export const EVENTS11: EventDef[] = [
  // ------------------------------------------------ the campaign
  {
    id: 'legacy_camp1', icon: '🗳', title: 'The campaign: what do you run on?', weight: 0, cooldown: 0, ttl: 4, urgent: true, eligible: () => null,
    text: (s, c) => `Twelve weeks to election day in ${c.name}. Your strategists want a theme. The economy is ${growthGap(c) > 0.005 ? 'doing better than usual' : growthGap(c) < -0.005 ? 'doing worse than usual' : 'doing about as usual'}, stability is ${c.eco.stability.toFixed(0)}, and ${isAtWar(s, c.id) ? 'the country is at war' : 'the country is at peace'}.`,
    options: [
      { label: 'Run on the economy', hint: 'Polls +4 if growth beats the country’s normal, −2 if it lags', apply: (s, c) => { const v = growthGap(c) > 0 ? 4 : -2; camp(s, v); return v > 0 ? 'The numbers speak for you.' : 'Voters looked at their bills and were not convinced.'; } },
      { label: 'Run on security', hint: 'Polls +4 at war or with a hostile neighbour, otherwise +1', apply: (s, c) => { const v = isAtWar(s, c.id) || s.rival >= 0 ? 4 : 1; camp(s, v); return 'Strength and order: the message lands.'; } },
      { label: 'Run as the candidate of change', hint: 'Polls +3, more the longer you have been in power (+1 a term)', apply: (s) => { camp(s, 3 + Math.min(3, (s.legacy?.term ?? 1) - 1)); return 'You ran against the system you lead. It worked, oddly.'; } },
      { label: 'A populist pledge', hint: 'Polls +5 · public services +0.5% of GDP for good', apply: (s, c) => { camp(s, 5); c.budget.social = clamp(c.budget.social + 0.005, 0, 0.35); return 'More for everyone. Someone will pay later.'; } },
    ],
    lapse: () => 'The campaign drifted without a theme.',
  },
  {
    id: 'legacy_debate', icon: '📺', title: 'The televised debate', weight: 0, cooldown: 0, ttl: 4, urgent: true, eligible: () => null,
    text: (s, c) => `Eight weeks out: tonight, the debate. Forty million viewers, one stage, your opponent across from you. Your charisma: ${skill(s, 'cha')}/10, your grasp of the files: ${skill(s, 'adm')}/10. The polls have you at ${approval(s, c).toFixed(0)}% approval.`,
    options: [
      { label: 'Stick to facts and figures', hint: 'Safe: polls +1 to +4 (better with administration)', apply: (s) => { const v = 1 + Math.round(3 * (skill(s, 'adm') / 10) + nextRand(s)); camp(s, v); return `Solid, detailed, a little dull. Polls +${v}.`; } },
      { label: 'Go on the attack', hint: 'Risky: polls −3 to +7 (better with charisma)', apply: (s) => { const win = nextRand(s) < 0.25 + skill(s, 'cha') / 14; const v = win ? 4 + Math.round(3 * nextRand(s)) : -3; camp(s, v); return win ? `A knockout line that will run all week. Polls +${v}.` : 'It came across as nasty. Polls −3.'; } },
      { label: 'Speak to the heart', hint: 'Polls +2 to +5 when times are hard (stability below 60), else +1', apply: (s, c) => { const v = c.eco.stability < 60 ? 2 + Math.round(3 * nextRand(s)) : 1; camp(s, v); return `You talked about real lives. Polls +${v}.`; } },
      { label: 'Skip the debate', hint: 'Polls −2 · nothing can go wrong on stage', apply: (s) => { camp(s, -2); return 'An empty podium, and jokes about it all week.'; } },
    ],
    lapse: (s) => { camp(s, -2); return 'You never showed up. Polls −2.'; },
  },
  {
    id: 'legacy_final', icon: '🚩', title: 'The final push', weight: 0, cooldown: 0, ttl: 4, urgent: true, eligible: () => null,
    text: (s) => `Four weeks to go. ${s.legacy?.persona?.rival ? `${s.legacy.persona.rival.name}, your rival in the party, is ${s.legacy.persona.rival.power > 60 ? 'openly briefing against you' : 'keeping quiet'}.` : ''} One last big move.`,
    options: [
      { label: 'A rally in every city', hint: 'Costs 0.4% of GDP · polls +3', enabled: canPay(0.004), apply: (s, c) => { pay(s, c, 0.004); camp(s, 3); return 'Stadiums full of flags.'; } },
      { label: 'Announce a tax cut', hint: 'Polls +3 · income tax −1 point after the vote', apply: (s, c) => { camp(s, 3); c.budget.taxIncome = clamp(c.budget.taxIncome - 0.01, 0, 0.7); return 'Money back in every pocket.'; } },
      { label: 'Win an endorsement', hint: 'Polls +4 if a faction is happy with you (mood 60+), else +1', apply: (s, c) => { const happy = c.politics?.factions.some((f) => f.mood >= 60); camp(s, happy ? 4 : 1); return happy ? 'A powerful endorsement on the front pages.' : 'Nobody important would stand next to you.'; } },
      { label: 'Stay presidential', hint: 'Polls +1 · reputation +1', apply: (s, c) => { camp(s, 1); rep(c, 1); return 'Above the fray, until the end.'; } },
    ],
    lapse: () => 'The campaign coasted to the finish.',
  },
  // ------------------------------------------------ the party
  {
    id: 'legacy_challenge', icon: '🗡', title: 'A leadership challenge', weight: 0, cooldown: 0, ttl: 6, urgent: true, eligible: () => null,
    text: (s, c) => `${s.legacy?.persona?.rival.name ?? 'Your rival'} has the signatures: the party will vote on whether you stay as leader. Your approval is ${approval(s, c).toFixed(0)}%, your political capital ${Math.floor(pcOf(c))}.`,
    options: [
      { label: 'Fight it out', hint: 'You win if approval + charisma + capital outweigh the rival (better with higher approval)', apply: (s, c) => {
        const p = personaOf(s); if (!p) return 'Nothing comes of it.';
        const odds = clamp(0.3 + (approval(s, c) - 40) / 50 + (p.skills.cha - 5) * 0.04 + pcOf(c) / 400, 0.1, 0.92);
        p.rival.tries++;
        if (nextRand(s) < odds) { p.rival.power = 15; boost(s, 2); return `You crushed the challenge. ${p.rival.name} returns to the back benches.`; }
        overthrow(s, `${s.legacy?.leader ?? 'The leader'} loses a leadership challenge to ${p.rival.name}.`);
        return `The party chose ${p.rival.name}. You are out.`;
      } },
      { label: 'Buy them off with a top job', hint: 'Costs 25 political capital · the rival backs off for now', enabled: (_s, c) => pcOf(c) >= 25, why: () => 'Needs 25 political capital', apply: (s, c) => { spend(c, 25); const p = personaOf(s); if (!p) return 'Nothing comes of it.'; p.rival.power = 45; return `${p.rival.name} takes the finance ministry, and waits.`; } },
      { label: 'Step down with dignity', hint: 'Your career ends now, on your own terms (no defeat on your record)', apply: (s) => { if (!s.legacy) return 'Nothing comes of it.'; endLegacy(s, `${s.legacy.leader} resigns rather than fight the party.`); return 'You resigned.'; } },
    ],
    lapse: (s) => { if (!s.legacy) return ''; overthrow(s, `${s.legacy.leader} is ousted by the party.`); return 'You did not fight. The party moved on without you.'; },
  },
  // ------------------------------------------------ the person
  {
    id: 'legacy_scandal', icon: '📰', title: 'A scandal breaks', weight: 3, cooldown: 156, ttl: 10,
    eligible: (s) => (office(s) && s.tick > 40 ? {} : null),
    text: (s, c) => `A newspaper has documents: contracts in ${c.name} steered to a friend of ${s.legacy?.leader ?? 'yours'}. It is on every front page.`,
    options: [
      { label: 'Deny everything', hint: '50%: it blows over · 50%: approval −6, reputation −2', apply: (s, c) => { if (nextRand(s) < 0.5) return 'The story died after a week.'; boost(s, -6); rep(c, -2); return 'More documents came out. It got worse.'; } },
      { label: 'Apologise and order an inquiry', hint: 'Approval −2 · charisma experience', apply: (s) => { boost(s, -2); const p = personaOf(s); if (p) p.xp.cha += 20; return 'An honest apology. Some respect for it.'; } },
      { label: 'Fire the minister involved', hint: 'Approval −1 · cabinet loyalty falls', apply: (s, c) => { boost(s, -1); for (const m of c.cabinet ?? []) m.loyalty = clamp(m.loyalty - 8, 0, 100); return 'A head rolled. The cabinet took note.'; } },
    ],
    lapse: (s) => { boost(s, -4); return 'Silence looked like guilt. Approval −4.'; },
  },
  {
    id: 'legacy_health', icon: '🩺', title: 'A health scare', weight: 4, cooldown: 104, ttl: 8,
    eligible: (s) => { const p = personaOf(s); return office(s) && p && (p.age > 58 || p.health < 65) && p.health < 80 ? {} : null; },
    text: (s) => `The doctors are worried: at ${personaOf(s)?.age} your heart is tired (health ${personaOf(s)?.health.toFixed(0)}). The press does not know yet.`,
    options: [
      { label: 'Take a month off', hint: 'Costs 10 political capital · health +12', apply: (s, c) => { spend(c, 10); const p = personaOf(s); if (!p) return 'Nothing comes of it.'; p.health = clamp(p.health + 12, 0, 100); return 'A month of rest, officially a working holiday.'; } },
      { label: 'Hide it and work on', hint: 'Health −6 · if it leaks (30%): approval −4', apply: (s) => { const p = personaOf(s); if (!p) return 'Nothing comes of it.'; p.health = clamp(p.health - 6, 0, 100); if (nextRand(s) < 0.3) { boost(s, -4); return 'It leaked. Questions about who is really in charge.'; } return 'Nobody noticed. This time.'; } },
      { label: 'Tell the country', hint: 'Approval +2 (sympathy) · health +6 · your rival smells weakness', apply: (s) => { boost(s, 2); const p = personaOf(s); if (!p) return 'Nothing comes of it.'; p.health = clamp(p.health + 6, 0, 100); p.rival.power = clamp(p.rival.power + 12, 0, 100); return 'Get-well cards by the sackful. Your rival starts counting votes.'; } },
    ],
  },
  {
    id: 'legacy_family', icon: '🏠', title: 'Family business', weight: 2, cooldown: 208, ttl: 10,
    eligible: (s) => (office(s) && s.tick > 60 ? {} : null),
    text: (s, c) => `Your brother-in-law's company has bid for the new ${c.name} motorway contract. It is the cheapest bid. It will look terrible.`,
    options: [
      { label: 'Block the bid', hint: 'Family dinners get awkward · reputation +1', apply: (_s, c) => { rep(c, 1); return 'The contract went elsewhere. Christmas will be cold.'; } },
      { label: 'Let the best bid win', hint: 'Saves money (treasury +0.1% of GDP) · 40%: a scandal later (approval −5)', apply: (s, c) => { c.eco.cash += 0.001 * c.eco.gdp; if (nextRand(s) < 0.4) { boost(s, -5); return 'The press found out. "All in the family."'; } return 'It was the best bid, and nobody made a fuss.'; } },
    ],
  },
  {
    id: 'legacy_attempt', icon: '🎯', title: 'An attempt on your life', weight: 2, cooldown: 520, ttl: 8,
    eligible: (s, c) => (office(s) && (c.eco.stability < 45 || isAtWar(s, c.id)) && s.tick > 52 ? {} : null),
    text: () => 'Shots at the motorcade. Your bodyguard took the bullet meant for you. The country is in shock, and waiting for you to speak.',
    options: [
      { label: 'A speech of national unity', hint: 'Approval +5 · stability +3', apply: (s, c) => { boost(s, 5); stab(c, 3); return 'The nation rallied around you.'; } },
      { label: 'Emergency powers', hint: 'Stability +6 · political capital +15 · reputation −4 · liberals furious', apply: (s, c) => { stab(c, 6); if (c.politics) c.politics.pc = Math.min(100, c.politics.pc + 15); rep(c, -4); const f = c.politics?.factions.find((x) => x.id === 'liberals'); if (f) f.mood = clamp(f.mood - 12, 0, 100); return 'Checkpoints, curfews, arrests.'; } },
    ],
  },
  {
    id: 'legacy_memoir', icon: '✍', title: 'Who comes after you?', weight: 2, cooldown: 520, ttl: 20,
    eligible: (s) => { const p = personaOf(s); return office(s) && p && !p.heir && (p.age >= 62 || (s.legacy?.term ?? 1) >= 2) ? {} : null; },
    text: (s) => `A quiet word from party elders: at ${personaOf(s)?.age}, have you thought about who will carry on your work?`,
    options: [
      { label: 'Name a protégé', hint: 'A chosen successor: retire while popular and they may win for you (legacy +80) · your rival is not pleased', apply: (s) => actNameHeir(s).message },
      { label: 'Not yet', hint: 'Nothing changes', apply: () => 'You have work to finish.' },
    ],
  },
  // ------------------------------------------------ opposition
  {
    id: 'opp_scandal', icon: '📰', title: 'The government is in trouble', weight: 4, cooldown: 52, ttl: 8,
    eligible: (s, c) => (opp(s) && approval(s, c) < 50 ? {} : null),
    text: (s) => `${s.legacy?.opposition?.gov ?? 'The government'} is mired in a procurement scandal. Your party wants blood.`,
    options: [
      { label: 'Go for the jugular', hint: 'Support +4 · stability −2', apply: (s, c) => { if (s.legacy?.opposition) s.legacy.opposition.support = clamp(s.legacy.opposition.support + 4, 5, 85); stab(c, -2); return 'Every day a new question in parliament.'; } },
      { label: 'Stay above it', hint: 'Support +1 · reputation +1', apply: (s, c) => { if (s.legacy?.opposition) s.legacy.opposition.support = clamp(s.legacy.opposition.support + 1, 5, 85); rep(c, 1); return 'Statesmanlike, they said.'; } },
    ],
  },
  {
    id: 'opp_split', icon: '🪓', title: 'The party argues about the way back', weight: 3, cooldown: 104, ttl: 10,
    eligible: (s) => (opp(s) ? {} : null),
    text: () => 'Half the party wants to move to the centre; the other half wants a sharper, angrier opposition.',
    options: [
      { label: 'Move to the centre', hint: 'Support +2 now, +more slowly over time', apply: (s) => { if (s.legacy?.opposition) s.legacy.opposition.support = clamp(s.legacy.opposition.support + 2, 5, 85); return 'Moderation. The commentators approve.'; } },
      { label: 'Fire up the base', hint: '60%: support +6 · 40%: support −3', apply: (s) => { const o = s.legacy?.opposition; if (!o) return ''; if (nextRand(s) < 0.6) { o.support = clamp(o.support + 6, 5, 85); return 'The rallies are electric.'; } o.support = clamp(o.support - 3, 5, 85); return 'It frightened the middle ground.'; } },
    ],
  },
  {
    id: 'opp_unity', icon: '🤝', title: 'An offer from the government', weight: 2, cooldown: 208, ttl: 8,
    eligible: (s, c) => (opp(s) && (isAtWar(s, c.id) || c.eco.stability < 40) && isFree(c.gov) ? {} : null),
    text: (s) => `In the crisis, ${s.legacy?.opposition?.gov ?? 'the government'} offers you a seat in a government of national unity.`,
    options: [
      { label: 'Refuse: you will win it back properly', hint: 'Support +2', apply: (s) => { if (s.legacy?.opposition) s.legacy.opposition.support = clamp(s.legacy.opposition.support + 2, 5, 85); return 'You kept your hands clean.'; } },
      { label: 'Join for the country’s sake', hint: 'Stability +5 · reputation +2 · support −4 (you share the blame)', apply: (s, c) => { stab(c, 5); rep(c, 2); if (s.legacy?.opposition) s.legacy.opposition.support = clamp(s.legacy.opposition.support - 4, 5, 85); return 'Country before party.'; } },
    ],
  },
];
