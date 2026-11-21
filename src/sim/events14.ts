/**
 * Out of power: situations for the years in opposition (in a democracy) or in exile (anywhere else). Losing office used
 * to switch the game off: no situations, no story, almost no decisions for years. Now the director (director.ts) opens
 * these instead: leaks, defectors, donors with strings, a party that splits, a warrant for your arrest, a by-election
 * that could change everything. What you choose moves your support (and the government's footing), and some are
 * gambles with the odds in the hint.
 */
import { clamp } from './util';
import { type D } from './eventkit';
import { nextRand } from './rng';
import { personName } from './leaders';
import { logEvent } from './log';
import { approval } from './approval';
import { isFree, oppGain } from './legacy';
import { situationEvents, type Situation } from './events13';
import { geoRefGet } from './geoRef';
import type { Country, GameState } from './types';

/** your support (the movement's standing; it fades back toward what the government's record gives you) */
const sup = (s: GameState, v: number) => oppGain(s, v);
/** points carried into the next vote (campaign money, organisation, a reputation) */
const vote = (s: GameState, v: number) => { s.stats.campaign = (s.stats.campaign ?? 0) + v; };
/** the government's footing: the country's stability */
const gov = (c: Country, v: number) => { c.eco.stability = clamp(c.eco.stability + v, 0, 100); };
const then = (s: GameState, id: string, stage: number, weeks: number, d: D, extra: D = {}) => { s.scheduled.push({ tick: s.tick + weeks, id: `sit_${id}_${stage}`, data: { ...d, ...extra } }); };
const who = (s: GameState, c: Country, salt: string, d: D) => personName(c, salt, (d.k ?? 0) + s.settings.seed % 89);
const free = (c: Country) => isFree(c.gov);
const govName = (s: GameState) => s.legacy?.opposition?.gov ?? 'the government';
const news = (s: GameState, c: Country, text: string) => logEvent(s, text, 'info', [c.id], true, { big: true, prov: c.capital });
const k0 = (s: GameState) => ({ k: Math.floor(nextRand(s) * 60) });

export const OPP_SITUATIONS: Situation[] = [
  { id: 'o_leak', icon: '📂', title: 'The envelope', weight: 3, opener: true,
    pick: (s) => k0(s),
    stages: [
      { text: (s, c, d) => `${who(s, c, 'leak', d)}, a mid-level official at the finance ministry, has left an envelope with your people: ${free(c) ? 'bank transfers from a state contract to a company owned by the governing party\'s treasurer' : 'proof that the ruling council\'s families moved billions abroad'}. It could finish ${govName(s)}. It could also be a trap.`,
        options: [
          { label: 'Publish it tonight', hint: 'Support +6 now · if it is a forgery (1 in 3), support −6', apply: (s, c) => { if (nextRand(s) < 0.34) { sup(s, -6); return 'Within a day the documents are shown to be forged. You were set up, and everyone saw it.'; } sup(s, 6); gov(c, -2); news(s, c, `📂 ${c.name}: the opposition publishes documents that shake the government.`); return 'The front pages are yours for a week. Ministers stop taking questions.'; } },
          { label: 'Have it checked first', hint: 'Six weeks · then a bigger story (support +8) if it holds', apply: (s, _c, d) => { then(s, 'o_leak', 1, 6, d); return 'Two forensic accountants and a retired judge go through it, page by page.'; } },
          { label: 'Hand it to the prosecutors', hint: 'Support +3 · the next vote +2 · you look clean', apply: (s) => { sup(s, 3); vote(s, 2); return 'You give it to the law, publicly. Some say you lack the killer instinct. Most say you are trustworthy.'; } },
        ] },
      { title: 'The envelope, checked', text: (s, c) => `It is real: every transfer, every signature. ${free(c) ? 'Three ministers are named.' : 'Two council members are named, and a general.'} ${govName(s)} does not yet know you have it.`,
        options: [
          { label: 'Release it all at once', hint: 'Support +8 · government stability −4', apply: (s, c) => { sup(s, 8); gov(c, -4); news(s, c, `📂 ${c.name}: verified documents expose the government. Calls for resignations.`); return 'You hold the press conference yourself. By evening two ministers have resigned.'; } },
          { label: 'Drip it out, a page a week', hint: 'Support +5 · the next vote +4', apply: (s) => { sup(s, 5); vote(s, 4); return 'A new page every Monday. The government never gets ahead of the story.'; } },
        ] },
    ] },
  { id: 'o_defector', icon: '🚪', title: 'Crossing the floor', weight: 3,
    pick: (s) => k0(s),
    stages: [{ text: (s, c, d) => `${who(s, c, 'def', d)}, ${free(c) ? 'a serving minister' : 'a deputy interior minister'}, asks for a meeting in a car park at midnight. They want to come over to your side, and they want a promise: a seat at your table when you win.`,
      options: [
        { label: 'Welcome them, in front of the cameras', hint: 'Support +5 · government stability −2', apply: (s, c) => { sup(s, 5); gov(c, -2); news(s, c, `🚪 ${c.name}: a senior figure defects to the opposition.`); return 'A handshake on the steps. The government looks like it is coming apart.'; } },
        { label: 'Keep them where they are, as your source', hint: 'The next vote +4 · if discovered (1 in 4), support −3', apply: (s) => { vote(s, 4); if (nextRand(s) < 0.25) { sup(s, -3); return 'Their phone is tapped. The story is about you now: plotting with turncoats.'; } return 'Every cabinet paper reaches you before the press. You always know their next move.'; } },
        { label: 'Refuse: no deals with them', hint: 'Support +1', apply: (s) => { sup(s, 1); return 'You walk away. Word gets around that you cannot be bought, or bargained with.'; } },
      ] }] },
  { id: 'o_donor', icon: '💰', title: 'A generous friend', weight: 3, opener: true,
    pick: (s) => k0(s),
    stages: [
      { text: (s, c, d) => `${who(s, c, 'donor', d)}, who made a fortune in ${['ports', 'telecoms', 'construction', 'mining', 'banking'][(d.k ?? 0) % 5]}, offers to pay for your whole ${free(c) ? 'campaign' : 'movement abroad'}. In return, nothing, they say. For now.`,
        options: [
          { label: 'Take the money', hint: 'The next vote +5 · in a year the bill may come', apply: (s, _c, d) => { vote(s, 5); then(s, 'o_donor', 1, 40, d); return 'Offices, buses, advertising, lawyers. Overnight you look like a government in waiting.'; } },
          { label: 'Take some, publish every cent', hint: 'The next vote +2 · support +2', apply: (s) => { vote(s, 2); sup(s, 2); return 'A smaller cheque, and a website with every donation on it.'; } },
          { label: 'Refuse it', hint: 'Support +1', apply: (s) => { sup(s, 1); return 'Small donations, volunteers and borrowed halls. It is slow. It is yours.'; } },
        ] },
      { title: 'The bill', text: (s, c, d) => `${who(s, c, 'donor', d)} calls. A licence the government is about to award: they want your public support for their bid, and your silence on their tax affairs.`,
        options: [
          { label: 'Pay the debt', hint: 'The next vote +2 · if it leaks (1 in 2), support −6', apply: (s) => { vote(s, 2); if (nextRand(s) < 0.5) { sup(s, -6); return 'A journalist has the call log. Your speeches about clean government are played back on every channel.'; } return 'A few kind words in an interview. Nobody connects the dots.'; } },
          { label: 'Cut them off, and say so', hint: 'Support +4 · the next vote −3', apply: (s) => { sup(s, 4); vote(s, -3); return 'You return the money you have not spent and announce it yourself. They will fund your rival now.'; } },
        ] },
    ] },
  { id: 'o_interview', icon: '🎤', title: 'Prime time', weight: 2,
    pick: (s, c) => (free(c) ? k0(s) : null),
    stages: [{ text: (s, c, d) => `The country's toughest interviewer, ${who(s, c, 'tv', d)}, has offered you forty minutes live on Sunday night. The government's spin doctors are already briefing that you have no plan.`,
      options: [
        { label: 'Go on the attack', hint: 'A gamble: support +7 (1 in 2) or −4', apply: (s) => { if (nextRand(s) < 0.5) { sup(s, 7); return 'One answer, about the price of bread, is clipped and shared a million times. You looked like a leader.'; } sup(s, -4); return 'You lost your temper on the fourth question. That is the clip they show.'; } },
        { label: 'Present the plan, line by line', hint: 'Support +3 (3 in 4)', apply: (s) => { if (nextRand(s) < 0.75) { sup(s, 3); return 'Dull, solid, believable. The polls tick up.'; } return 'Too many numbers. Nobody remembers a word.'; } },
        { label: 'Send your deputy', hint: 'No risk · support −1', apply: (s) => { sup(s, -1); return 'Your deputy does fine. People notice that you did not.'; } },
      ] }] },
  { id: 'o_split', icon: '💔', title: 'The movement splits', weight: 2,
    pick: (s) => k0(s),
    stages: [{ text: (s, c, d) => `${who(s, c, 'split', d)} and a third of your ${free(c) ? 'parliamentary party' : 'movement'} want a new strategy: ${free(c) ? 'a pact with the government on the budget, in return for reforms' : 'talks with the regime about a gradual opening'}. They will go public on Friday unless you give them something.`,
      options: [
        { label: 'Expel the rebels', hint: 'Support −3 now · the next vote +3 (a united campaign)', apply: (s) => { sup(s, -3); vote(s, 3); return 'A painful week of headlines. Then one voice, one message.'; } },
        { label: 'Give them the deputy leadership', hint: 'Support +2 · the next vote −1', apply: (s) => { sup(s, 2); vote(s, -1); return 'A compromise. They are inside the tent, and arguing in it.'; } },
        { label: 'Call a vote of the members', hint: 'A gamble: you win (2 in 3), support +5; lose, support −6', apply: (s) => { if (nextRand(s) < 0.66) { sup(s, 5); return 'Seventy-one percent back you. The rebels fall into line.'; } sup(s, -6); return 'You win by four votes. Everyone can see the cracks.'; } },
      ] }] },
  { id: 'o_strike', icon: '✊', title: 'The general strike', weight: 2,
    pick: (s, c) => (c.eco.unemployment > c.eco.uNat || c.eco.inflation > 0.04 || nextRand(s) < 0.4 ? k0(s) : null),
    stages: [{ text: (s, c) => `The unions have called a general strike against ${govName(s)}: ${c.eco.inflation > 0.05 ? 'prices are outrunning wages' : 'jobs are being cut'}. They want you on the picket line on Monday. Business leaders want you to stay away.`,
      options: [
        { label: 'Stand with the strikers', hint: 'Support +5 · government stability −3', apply: (s, c) => { sup(s, 5); gov(c, -3); return 'You march at the front, in the rain. The pictures are everywhere.'; } },
        { label: 'Offer to mediate', hint: 'Support +2 · the next vote +2', apply: (s) => { sup(s, 2); vote(s, 2); return 'You bring both sides to a hotel and broker a deal the government could not.'; } },
        { label: 'Stay out of it', hint: 'No change', apply: () => 'You say nothing. The strike fizzles after three days.' },
      ] }] },
  { id: 'o_warrant', icon: '⚖', title: 'A warrant in your name', weight: 3, opener: true,
    pick: (s, c) => (!free(c) || nextRand(s) < 0.3 ? k0(s) : null),
    stages: [
      { text: (s, c) => `${free(c) ? 'A prosecutor close to the government has charged you with "misuse of party funds".' : 'The regime has issued a warrant for your arrest on charges of "treason against the state".'} Your lawyers say the case is thin. Your friends say the verdict is already written.`,
        options: [
          { label: 'Go home and face it', hint: 'A gamble: they dare not (1 in 2, support +10) or you are detained (support +4, the vote −3)', apply: (s, c) => { if (nextRand(s) < 0.5) { sup(s, 10); news(s, c, `⚖ ${s.legacy?.leader ?? 'The opposition leader'} returns to face the charges. The government blinks.`); return 'Thousands meet you at the airport. The police watch, and do nothing.'; } sup(s, 4); vote(s, -3); return 'Handcuffs at passport control. Your face is on every placard now, but you are in a cell.'; } },
          { label: 'Fight it from abroad, through the courts', hint: 'Eight weeks · support +2', apply: (s, _c, d) => { sup(s, 2); then(s, 'o_warrant', 1, 8, d); return 'An international legal team, a hearing date, and a long wait.'; } },
          { label: 'Keep your head down', hint: 'Support −2', apply: (s) => { sup(s, -2); return 'You cancel your appearances. Some of your people wonder whether you are still in the fight.'; } },
        ] },
      { title: 'The ruling', text: (s, c) => `The court has ruled. ${free(c) ? 'The charges are thrown out: "politically motivated".' : 'An international tribunal calls the warrant "persecution"; the regime ignores it.'} The question is what you do with it.`,
        options: [
          { label: 'Tour the country / the capitals', hint: 'Support +5', apply: (s) => { sup(s, 5); return 'Every stop is a rally. The ruling is the speech.'; } },
          { label: 'Sue for damages', hint: 'The next vote +3', apply: (s) => { vote(s, 3); return 'The money pays for your campaign. The case keeps the story alive for months.'; } },
        ] },
    ] },
  { id: 'o_backer', icon: '🌐', title: 'A friend abroad', weight: 2,
    pick: (s, c) => { const p = s.countries.filter((x) => x.alive && x.id !== c.id && x.eco.gdp > c.eco.gdp * 2).sort((a, b) => b.eco.gdp - a.eco.gdp)[Math.floor(nextRand(s) * 5)]; return p ? { n: p.id, ...k0(s) } : null; },
    stages: [{ text: (s, c, d) => `${s.countries[d.n]?.name ?? 'A great power'} lets it be known that it would welcome a change of government in ${c.name}, and would help: money, media, and quiet pressure on ${govName(s)}.`,
      options: [
        { label: 'Accept the help', hint: 'The next vote +6 · if exposed (2 in 5), support −7 ("a foreign puppet")', apply: (s) => { vote(s, 6); if (nextRand(s) < 0.4) { sup(s, -7); return 'A leaked memo shows where the money comes from. "A puppet," the government says, and many believe it.'; } return 'Doors open: in the capitals, in the newsrooms, in the banks.'; } },
        { label: 'A meeting, in public, nothing more', hint: 'Support +2', apply: (s) => { sup(s, 2); return 'A photograph with a foreign minister makes you look like a statesman, not a client.'; } },
        { label: 'Refuse: our fight is ours', hint: 'Support +3', apply: (s) => { sup(s, 3); return 'You say no, loudly. It plays well at home.'; } },
      ] }] },
  { id: 'o_byelection', icon: '🗳', title: 'The by-election', weight: 2,
    pick: (s, c) => (free(c) ? k0(s) : null),
    stages: [{ text: (s, c, d) => `A safe government seat in ${geoRefGet()?.provinces[d.p ?? c.capital]?.name || 'the provinces'} is up for grabs after a scandal. Win it and the whole country will say the tide has turned. Lose it and they will say you are finished.`,
      options: [
        { label: 'Throw everything at it', hint: 'A gamble: win (2 in 5) support +9 · lose support −4', apply: (s, c) => { if (nextRand(s) < 0.4) { sup(s, 9); gov(c, -2); news(s, c, `🗳 SHOCK BY-ELECTION: the opposition takes a government stronghold in ${c.name}.`); return 'You win by eleven hundred votes. The victory speech goes on until two in the morning.'; } sup(s, -4); return 'You come a respectable second. Respectable seconds do not make headlines.'; } },
        { label: 'Back a local independent', hint: 'Support +2 (no risk)', apply: (s) => { sup(s, 2); return 'Your candidate is not on the ballot, but your friend wins. Quietly, it counts.'; } },
        { label: 'Save the money for the general election', hint: 'The next vote +2', apply: (s) => { vote(s, 2); return 'You let the seat go. The war chest grows.'; } },
      ] }] },
  { id: 'o_failing', icon: '📉', title: 'The government stumbles', weight: 3,
    pick: (s, c) => (approval(s, c) < 48 || c.eco.growth < 0.01 || c.eco.stability < 55 ? k0(s) : null),
    stages: [{ text: (s, c) => `${govName(s)} is in trouble: ${c.eco.growth < 0 ? 'the economy is shrinking' : c.eco.stability < 50 ? 'the streets are restless' : 'its own voters are deserting it'}, and its approval is at ${approval(s, c).toFixed(0)}%. Everyone is waiting to see what you do.`,
      options: [
        { label: 'Go for the jugular', hint: `Support +more the weaker they are · government stability −2`, apply: (s, c) => { const g = clamp(3 + (50 - approval(s, c)) * 0.2, 2, 9); sup(s, g); gov(c, -2); return `Every day a new attack. Support for you rises by ${g.toFixed(0)}.`; } },
        { label: 'Offer a government of national unity', hint: 'Support +3 · the next vote +2 · you look like a leader', apply: (s) => { sup(s, 3); vote(s, 2); return 'They refuse, of course. But you offered, and the country noticed.'; } },
        { label: 'Wait for them to fall', hint: 'No change', apply: () => 'You let them dig. It may be enough.' },
      ] }] },
  { id: 'o_shot', icon: '🩸', title: 'Shots at the motorcade', weight: 1, urgent: true,
    pick: (s) => k0(s),
    stages: [{ text: (s, c) => `Two shots hit your car outside ${free(c) ? 'a rally' : 'your residence abroad'}. Your driver is wounded; you are not. Nobody claims it. Your aides want you in hiding; your supporters want you on a stage.`,
      options: [
        { label: 'Speak from the stage tonight, bandaged driver at your side', hint: 'Support +8 (a wave of sympathy)', apply: (s, c) => { sup(s, 8); news(s, c, `🩸 ${s.legacy?.leader ?? 'The opposition leader'} survives an attack and speaks to a packed square the same night.`); return 'You speak for nine minutes. The square does not make a sound until the end.'; } },
        { label: 'Demand an inquiry, from safety', hint: 'Support +3 · the next vote +2', apply: (s) => { sup(s, 3); vote(s, 2); return 'You speak from a secure room. Calm, angry, unafraid. It works.'; } },
        { label: 'Disappear for a while', hint: 'Support −3', apply: (s) => { sup(s, -3); return 'Three weeks of silence. Rumours fill it.'; } },
      ] }] },
  { id: 'o_youth', icon: '📱', title: 'The students', weight: 2,
    pick: (s) => k0(s),
    stages: [{ text: (s, c, d) => `A student movement has taken over the main square, and their leader, ${who(s, c, 'student', d)}, is twenty-three and better on camera than you. They want you to march with them, under their banner, not yours.`,
      options: [
        { label: 'March under their banner', hint: 'Support +6 · if it turns violent (1 in 4), support −4', apply: (s, c) => { if (nextRand(s) < 0.25) { sup(s, -4); gov(c, -2); return 'Riot police, tear gas, and pictures of you running. The march is remembered for the wrong reasons.'; } sup(s, 6); return 'You walk in the middle of a hundred thousand young people. They chant your name, once.'; } },
        { label: 'Bring their leader into your team', hint: 'The next vote +4', apply: (s) => { vote(s, 4); return 'A new face on your platform, half your age. The movement comes with them.'; } },
        { label: 'Keep your distance', hint: 'Support −1', apply: (s) => { sup(s, -1); return 'The square empties after a month. They remember who did not come.'; } },
      ] }] },
  { id: 'o_book', icon: '📖', title: 'The memoir', weight: 1,
    pick: (s) => (s.tick - (s.legacy?.opposition?.since ?? s.tick) > 40 ? k0(s) : null), // after the first months out of office
    stages: [{ text: (s) => `A publisher offers a fortune for your memoir of your years in power. The chapter everyone wants is the one about ${govName(s)}'s leaders, and what you know about them.`,
      options: [
        { label: 'Tell everything', hint: 'Support +5 · the government stability −2', apply: (s, c) => { sup(s, 5); gov(c, -2); news(s, c, `📖 The former leader's memoir becomes the bestseller of the year in ${c.name}.`); return 'Number one for eleven weeks. Two ministers sue. That sells another hundred thousand copies.'; } },
        { label: 'Write it as a statesman', hint: 'The next vote +3', apply: (s) => { vote(s, 3); return 'Measured, generous, a vision for the country. Reviewers call it "presidential".'; } },
        { label: 'Not yet', hint: 'No change', apply: () => 'You put the contract in a drawer. The best chapter has not happened yet.' },
      ] }] },
  { id: 'o_poll', icon: '📊', title: 'The poll', weight: 2,
    pick: (s) => ((s.legacy?.opposition?.support ?? 0) > 44 ? k0(s) : null),
    stages: [{ text: (s, c) => `A poll nobody expected: you at ${s.legacy?.opposition?.support.toFixed(0)}%, ${govName(s)} sinking. Your advisers say this is the moment to ${free(c) ? 'force a vote of no confidence' : 'call the country into the streets'}. Others say wait: a failed attempt would be the end.`,
      options: [
        { label: 'Strike now', hint: 'A gamble on the moment: support +6 and the vote brought forward (1 in 2), else support −5', apply: (s, c) => { const L = s.legacy!; if (nextRand(s) < 0.5) { sup(s, 6); L.nextVote = Math.min(L.nextVote, s.tick + 8); news(s, c, `⚡ ${free(c) ? 'The government loses a confidence vote: elections in eight weeks!' : 'The streets fill: the regime agrees to a vote in eight weeks.'}`); return 'It works. In eight weeks the country decides.'; } sup(s, -5); return 'The government survives by three votes, and laughs at you across the chamber.'; } },
        { label: 'Bank it: build for the real vote', hint: 'The next vote +4', apply: (s) => { vote(s, 4); return 'You do not gloat. You hire organisers.'; } },
      ] }] },
];


/** Every stage of every situation out of power, as decisions (letting one lapse costs you a little support). */
export const EVENTS14 = situationEvents(OPP_SITUATIONS, 'You let it pass. The moment went to someone else.');
