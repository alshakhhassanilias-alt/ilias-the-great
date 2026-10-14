/**
 * Diplomatic cables: foreign leaders talk to you. When you sign, refuse, sanction, invade or make peace, the other
 * side's leader answers in their own voice, coloured by their traits (a hawk threatens, a dove pleads, a
 * mercantilist talks money). Rivals send the occasional message unprompted. You can reply warmly or firmly.
 * Template choice uses a hash, not the game's random stream, so cables never change how the world plays out.
 */
import { hash01 } from './rng';
import { clamp } from './util';
import { addRelation, getRelation, isAtWar } from './relations';
import type { Cable, Country, GameState } from './types';

export type CableKind = 'war_on_you' | 'you_declared' | 'sanctioned' | 'sanctions_you' | 'treaty_yes' | 'treaty_no' | 'declined_offer' | 'accepted_offer' | 'peace' | 'new_leader' | 'taunt' | 'warm' | 'offer';

type T = (o: { me: Country; you: Country; them: string; youName: string; kind?: string }) => string;
const LINES: Record<CableKind, { mood: Cable['mood']; hawk: T[]; dove: T[]; any: T[] }> = {
  war_on_you: { mood: 'angry',
    hawk: [(o) => `${o.you.name} ignored every warning. Now our army will settle it.`, (o) => `We did not want this war. ${o.youName} left us no choice. It will be short.`],
    dove: [(o) => `It grieves me to write this. Our generals have convinced the cabinet that ${o.you.name} is a danger. I hope we talk again soon.`],
    any: [(o) => `${o.me.name} has run out of patience with ${o.you.name}. Our forces are moving.`, () => 'You know why we are doing this. History will judge which of us was right.'] },
  you_declared: { mood: 'angry',
    hawk: [(o) => `You will regret this. ${o.me.name} has buried stronger invaders than you.`, () => 'Come, then. Every hill and every river will cost you a regiment.'],
    dove: [(o) => `Why? We offered talks a hundred times. The blood of both our peoples is on ${o.youName}'s hands.`],
    any: [(o) => `This is an act of naked aggression, and the whole world saw it. ${o.me.name} will defend every street.`, () => 'We will fight, and we will not forget.'] },
  sanctioned: { mood: 'angry',
    hawk: [(o) => `Sanctions? ${o.me.name} has survived worse. We will remember who sided with ${o.you.name}.`],
    dove: [() => 'We had hoped for dialogue, not punishment. This hurts ordinary families on both sides.'],
    any: [() => 'An unfriendly act. Our ambassador has been recalled for consultations.', (o) => `${o.me.name} will find other markets. Your exporters will not find ours again.`] },
  sanctions_you: { mood: 'cold',
    hawk: [(o) => `Our sanctions will stay until ${o.you.name} changes course. Every week you wait costs you more.`],
    dove: [() => 'This was not an easy decision. Our door remains open if you change course.'],
    any: [(o) => `${o.me.name} cannot do business as usual with your government. You know what you must do.`] },
  treaty_yes: { mood: 'warm',
    hawk: [(o) => `Good. Strong nations should stand together. ${o.me.name} keeps its word.`],
    dove: [(o) => `A fine day for both our peoples. My government thanks ${o.youName} personally.`],
    any: [(o) => `${o.me.name} welcomes the agreement. Our ministers will meet next month to put it to work.`, () => 'Signed and sealed. May it be the first of many.'] },
  treaty_no: { mood: 'cold',
    hawk: [(o) => `${o.me.name} does not sign deals from a position of weakness. Try again when you have something to offer.`],
    dove: [() => 'Not now, I am afraid. Our parliament would never accept it. Perhaps in a year.'],
    any: [() => 'We have studied your proposal carefully. The answer is no.', (o) => `Your offer does not serve ${o.me.name}'s interests at this time.`] },
  declined_offer: { mood: 'cold',
    hawk: [(o) => `So ${o.you.name} prefers to stand alone. Noted.`],
    dove: [() => 'A pity. The offer was made in good faith.'],
    any: [() => 'We regret your answer. We will look for other partners.'] },
  accepted_offer: { mood: 'warm',
    hawk: [() => 'A wise decision. Together we will be harder to bully.'],
    dove: [() => 'Thank you, my friend. This will be remembered.'],
    any: [(o) => `${o.me.name} is delighted. Let us make it work.`] },
  peace: { mood: 'neutral',
    hawk: [() => 'This is a pause, not an ending. Keep your army on your side of the line.'],
    dove: [() => 'Enough of our young people have died. Let this peace hold.'],
    any: [() => 'The guns are silent. It will take a generation to rebuild trust.', (o) => `${o.me.name} accepts the terms. Our border guards have their orders.`] },
  new_leader: { mood: 'neutral',
    hawk: [(o) => `I am the new leader of ${o.me.name}. Things will be different now. Do not test us.`],
    dove: [(o) => `I have just taken office in ${o.me.name}. I want our countries to start a new chapter.`],
    any: [(o) => `Greetings from the new government of ${o.me.name}. We look forward to working with ${o.youName}, where we can.`] },
  taunt: { mood: 'cold',
    hawk: [(o) => `Our satellites see your exercises. ${o.me.name}'s are bigger.`, (o) => `${o.you.name} talks of security. We remember what you did last time.`, () => 'Your newspapers call us a threat. Good. Let them stay afraid.'],
    dove: [() => 'Our countries keep drifting apart. I fear where this ends.'],
    any: [(o) => `${o.me.name} is watching your choices closely.`, (o) => `My ministers ask why ${o.you.name} is arming. I have no answer for them.`] },
  warm: { mood: 'warm',
    hawk: [(o) => `${o.me.name} has few real friends. ${o.you.name} is one of them.`],
    dove: [() => 'Our peoples have so much in common. Let us keep building on it.'],
    any: [() => 'Our trade grows every quarter. My compliments to your ministers.', (o) => `Whatever happens in the world, ${o.me.name} stands with ${o.you.name}.`] },
  offer: { mood: 'warm',
    hawk: [(o) => `${o.me.name} needs strong partners, and so does ${o.you.name}. Let us put it on paper.`],
    dove: [() => 'I believe we can do great things together. Will you sign?'],
    any: [(o) => `${o.me.name} would like to put our relations on a firmer footing.`] },
};

const HAWKISH = new Set(['hawk', 'strongman', 'nationalist', 'paranoid']);
const DOVISH = new Set(['dove', 'reformer', 'mercantilist', 'pragmatist']);

/** Record a message from country `from` to the player. */
export function cable(s: GameState, from: number, kind: CableKind) {
  if (from === s.player || !s.countries[from]?.alive) return;
  const me = s.countries[from], you = s.countries[s.player];
  const L = LINES[kind];
  const tr = me.leader?.traits ?? [];
  const pool = tr.some((t) => HAWKISH.has(t)) && hash01('cb', from, s.tick) < 0.75 ? L.hawk : tr.some((t) => DOVISH.has(t)) && hash01('cd', from, s.tick) < 0.75 ? L.dove : L.any;
  const fn = pool[Math.floor(hash01('ct', from, s.tick, kind) * pool.length)];
  const youName = s.legacy?.leader ?? `${you.name}'s government`;
  s.stats.cableSeq = (s.stats.cableSeq ?? 0) + 1;
  (s.cables ??= []).push({ tick: s.tick, from, text: fn({ me, you, them: me.leader?.name ?? me.name, youName }), mood: L.mood, seq: s.stats.cableSeq });
  if (s.cables.length > 30) s.cables.splice(0, s.cables.length - 30);
}

/** Weekly: rivals and close friends send the occasional message unprompted. */
export function stepCables(s: GameState) {
  if (s.tick % 9 !== 4) return;
  const r = s.rival;
  if (r >= 0 && s.countries[r]?.alive && !isAtWar(s, r) && hash01('rv', r, s.tick) < 0.16) cable(s, r, 'taunt');
  if (hash01('fr', s.player, s.tick) < 0.08) {
    let best = -1, bv = 55;
    for (const c of s.countries) if (c.alive && c.id !== s.player && c.leader) { const v = getRelation(s, c.id, s.player); if (v > bv) { bv = v; best = c.id; } }
    if (best >= 0) cable(s, best, 'warm');
  }
}

/** Answer a cable: warmly (relations +4) or firmly (relations −4, the home audience likes it: stability +1). */
export function actReplyCable(s: GameState, seq: number, tone: 'warm' | 'firm') {
  const cb = s.cables?.find((x) => x.seq === seq);
  if (!cb) return { ok: false, message: 'That message is gone' };
  const key = `cbr:${seq}`;
  if (s.stats[key]) return { ok: false, message: 'You already replied' };
  s.stats[key] = 1;
  const c = s.countries[s.player];
  if (tone === 'warm') { addRelation(s, cb.from, s.player, 4); return { ok: true, message: `A gracious reply. ${s.countries[cb.from].name} takes note (relations +4).` }; }
  addRelation(s, cb.from, s.player, -4);
  c.eco.stability = clamp(c.eco.stability + 1, 0, 100);
  return { ok: true, message: `A firm reply. It plays well at home (stability +1), less well in ${s.countries[cb.from].name} (relations −4).` };
}
