/**
 * Reconciliation with a rival: nobody is an enemy forever, but nobody becomes a friend overnight either.
 *
 *   1. Back channel   secret talks through intermediaries. Whether they answer depends on their leader (doves,
 *                     pragmatists and reformers listen; hawks and nationalists do not), on how much trouble they
 *                     are in, and on whether you share an enemy. A failed contact may leak.
 *   2. Gestures       confidence-building steps, one every few weeks: prisoner exchanges, troops pulled back,
 *                     sanctions lifted, aid, a military hotline, cultural exchanges. Each builds trust, and they
 *                     answer in kind. Hardliners on their side may sabotage it with an incident.
 *   3. Summit         a public meeting in a neutral capital. With enough trust it succeeds: relations jump,
 *                     grudges fade, and a détente begins. If it fails, trust takes a blow and you go back to gestures.
 *   4. Détente        for two years relations warm every week and every deal at the table gets easier. Keep it up
 *                     with the occasional gesture and it is renewed; a war ends it at once.
 */
import { clamp, fmtMoney } from './util';
import { nextRand } from './rng';
import { logEvent } from './log';
import { addRelation, areAtWar, getRelation, sanctionLevel } from './relations';
import { neighborsOf, liftSanction } from './diplomacy';
import { fund } from './actions';
import { spendPC, sway } from './domestic';
import { crisisOf } from './turns';
import { cable } from './cables';
import type { Geo } from './geo';
import type { Country, CountryId, GameState, Track } from './types';

export const trackOf = (s: GameState, them: CountryId): Track | undefined => s.nego?.[them]?.track;
const memo = (s: GameState, them: CountryId) => ((s.nego ??= {})[them] ??= { patience: 2, until: -1 });
const NEUTRAL = ['Geneva', 'Vienna', 'Oslo', 'Helsinki', 'Doha', 'Singapore', 'Muscat', 'Reykjavik'];
const has = (c: Country, t: string) => !!c.leader?.traits.includes(t);

/** Is a reconciliation process the right tool (they are hostile enough that ordinary deals fail)? */
export const needsReconciling = (s: GameState, them: CountryId) => getRelation(s, them, s.player) < -25 || !!trackOf(s, them);

/** Why they might take the call, as factors; the chance is their sum. */
export function backChannelOdds(s: GameState, them: CountryId): { p: number; why: { label: string; v: number }[] } {
  const T = s.countries[them], P = s.countries[s.player];
  const why: { label: string; v: number }[] = [{ label: 'Talking costs nothing in secret', v: 0.3 }];
  const tr = (t: string, v: number, label: string) => { if (has(T, t)) why.push({ label, v }); };
  tr('dove', 0.2, 'A dove leads them'); tr('pragmatist', 0.15, 'A pragmatist leads them'); tr('reformer', 0.1, 'A reformer wants calm abroad');
  tr('hawk', -0.15, 'A hawk leads them'); tr('nationalist', -0.15, 'A nationalist sees talks as weakness'); tr('ideologue', -0.1, 'An ideologue distrusts you');
  if (T.leader?.turn) why.push({ label: `${T.leader.name} is breaking with the old line`, v: 0.2 });
  const cr = crisisOf(T, s);
  if (cr > 0.15) why.push({ label: `They are in trouble at home (crisis ${Math.round(cr * 100)}%)`, v: Math.min(0.25, cr * 0.4) });
  if ((T.mil.exhaustion ?? 0) > 0.3) why.push({ label: 'They are tired of war', v: 0.1 });
  const common = s.countries.find((x) => x.alive && x.id !== them && x.id !== s.player && getRelation(s, them, x.id) < -50 && getRelation(s, s.player, x.id) < -30);
  if (common) why.push({ label: `You share an enemy: ${common.name}`, v: 0.12 });
  const g = (s.grudges?.[`${them}>${s.player}`] ?? []).reduce((t, x) => t + x.w, 0);
  if (g > 5) why.push({ label: 'They have grudges against you', v: -Math.min(0.25, g / 120) });
  if (areAtWar(s, them, s.player)) why.push({ label: 'You are at war with them', v: -0.2 });
  if (P.reputation > 65) why.push({ label: 'Your word is trusted', v: 0.05 });
  return { p: clamp(why.reduce((t, x) => t + x.v, 0), 0.05, 0.9), why };
}
export function summitOdds(s: GameState, them: CountryId): number {
  const T = s.countries[them], tk = trackOf(s, them);
  const base = 0.2 + ((tk?.trust ?? 0) / 100) * 0.7 + (has(T, 'dove') ? 0.08 : 0) + (has(T, 'pragmatist') ? 0.05 : 0) - (has(T, 'hawk') || has(T, 'nationalist') ? 0.08 : 0);
  return clamp(base, 0.05, 0.95);
}

export interface Gesture { id: string; icon: string; title: string; trust: number; price: string; reply: string; ok: boolean; why?: string }
/** The confidence-building steps on offer, and what each costs. */
export function gestures(s: GameState, geo: Geo, them: CountryId): Gesture[] {
  const T = s.countries[them], P = s.countries[s.player], tk = trackOf(s, them);
  const done = tk?.done ?? [];
  const pc = P.politics?.pc ?? 0;
  const list: Gesture[] = [
    { id: 'prisoners', icon: '🔓', title: 'Exchange prisoners', trust: 12, price: 'Free · nationalists grumble', reply: `${T.name} releases detainees of its own in return.`, ok: true },
    { id: 'hotline', icon: '☎', title: 'Open a military hotline', trust: 10, price: '4 political capital · no more accidents spiralling out of control', reply: 'Their general staff picks up the phone.', ok: pc >= 4, why: 'needs 4 political capital' },
    { id: 'culture', icon: '🎻', title: 'Cultural and sports exchange', trust: 8, price: '3 political capital', reply: 'Orchestras, students and football teams cross the border.', ok: pc >= 3, why: 'needs 3 political capital' },
    { id: 'aid', icon: '📦', title: 'Humanitarian aid', trust: 10, price: `${fmtMoney(0.001 * P.eco.gdp)}`, reply: 'Their state media, for once, reports it without sneering.', ok: true },
  ];
  if (neighborsOf(s, geo, s.player).includes(them)) list.push({ id: 'border', icon: '🪖', title: 'Pull troops back from the border', trust: 15, price: 'Army readiness −5% · the generals object', reply: 'They thin out their own border garrisons.', ok: true });
  if (sanctionLevel(s, s.player, them)) list.push({ id: 'sanction', icon: '🔗', title: 'Lift your sanctions', trust: 20, price: 'Your sanctions end', reply: 'Their markets rally; their foreign minister calls it "a first step".', ok: true });
  return list.map((g) => (done.includes(g.id) ? { ...g, ok: false, why: 'already done' } : g));
}

const note = (tk: Track, text: string) => { tk.note = text; };

/** The player's next step in the process. */
export function actTrack(s: GameState, geo: Geo, them: CountryId, step: 'open' | 'gesture' | 'summit' | 'renew', gid?: string): { ok: boolean; message: string } {
  const T = s.countries[them], P = s.countries[s.player];
  if (areAtWar(s, them, s.player) && step !== 'open') return { ok: false, message: 'Not while you are at war: make peace first' };
  const M = memo(s, them);
  let tk = M.track;
  if (tk && s.tick < tk.next) return { ok: false, message: `The next step is possible in ${tk.next - s.tick} weeks` };
  if (step === 'open') {
    if (tk && tk.stage > 1) return { ok: false, message: 'The back channel is already open' };
    if (!spendPC(P, 5)) return { ok: false, message: 'Needs 5 political capital' };
    const { p } = backChannelOdds(s, them);
    tk = M.track ??= { stage: 1, trust: 0, next: s.tick, since: s.tick, done: [] };
    if (nextRand(s) < p) {
      tk.stage = 2; tk.trust = 15; tk.next = s.tick + 4;
      note(tk, `${T.leader?.name ?? T.name} sent word through intermediaries: they are willing to talk.`);
      logEvent(s, `🤫 BACK CHANNEL: secret contacts with ${T.name} have begun. ${T.leader ? `${T.leader.name} is listening.` : ''}`, 'diplo', [s.player, them], true);
      return { ok: true, message: tk.note! };
    }
    tk.next = s.tick + 13;
    const leak = nextRand(s) < 0.35;
    if (leak) { sway(P, 'nationalists', -5); addRelation(s, them, s.player, -2); }
    note(tk, leak ? `The approach leaked to the press in ${T.name}: they deny everything and denounce you. Try again in 13 weeks.` : `No answer from ${T.name}. Try again in 13 weeks; a crisis on their side or a new leader may change their mind.`);
    logEvent(s, `🤫 ${tk.note}`, 'diplo', [s.player, them], true);
    return { ok: false, message: tk.note! };
  }
  if (!tk || tk.stage < 2) return { ok: false, message: 'Open a back channel first' };
  if (step === 'gesture') {
    const g = gestures(s, geo, them).find((x) => x.id === gid);
    if (!g || !g.ok) return { ok: false, message: g?.why ?? 'Not available' };
    switch (g.id) {
      case 'prisoners': sway(P, 'nationalists', -2); break;
      case 'hotline': spendPC(P, 4); break;
      case 'culture': spendPC(P, 3); break;
      case 'aid': { const f = fund(s, s.player, 0.001 * P.eco.gdp, `Aid to ${T.name}`); if (!f.ok) return f; T.eco.cash += 0.001 * P.eco.gdp; break; }
      case 'border': P.mil.readiness = clamp(P.mil.readiness - 0.05, 0.2, 1); sway(P, 'military', -3); break;
      case 'sanction': liftSanction(s, s.player, them); break;
    }
    tk.done.push(g.id);
    tk.trust = clamp(tk.trust + g.trust, 0, 100);
    tk.next = s.tick + 4;
    addRelation(s, them, s.player, 4);
    note(tk, `${g.title}: ${g.reply} Trust ${Math.round(tk.trust)}/100.`);
    if (tk.stage === 2 && tk.trust >= 50) { tk.stage = 3; note(tk, `${tk.note} There is enough trust now for a summit.`); }
    if (tk.stage === 4 && tk.detenteUntil !== undefined) tk.detenteUntil = Math.max(tk.detenteUntil, s.tick + 52);
    logEvent(s, `🕊 ${T.name}: ${tk.note}`, 'diplo', [s.player, them], true);
    return { ok: true, message: tk.note! };
  }
  if (step === 'summit') {
    if (tk.stage !== 3) return { ok: false, message: 'Build more trust first (50 needed)' };
    if (!spendPC(P, 10)) return { ok: false, message: 'Needs 10 political capital' };
    const city = NEUTRAL[(them + s.player + s.tick) % NEUTRAL.length];
    if (nextRand(s) < summitOdds(s, them)) {
      tk.stage = 4; tk.trust = Math.max(tk.trust, 75); tk.next = s.tick + 4; tk.detenteUntil = s.tick + 104;
      addRelation(s, them, s.player, 25);
      const H = (s.relHist ??= {}), k = them < s.player ? `${them}-${s.player}` : `${s.player}-${them}`;
      H[k] = clamp((H[k] ?? 0) + 10, -40, 40);
      for (const gr of s.grudges?.[`${them}>${s.player}`] ?? []) gr.w *= 0.4;
      // the West stops treating the other side as an adversary (whichever side the West is on)
      if (T.hostile && (P.orient ?? 0) > 0.3) T.hostile = Math.max(0, T.hostile - 0.15);
      if (P.hostile && (T.orient ?? 0) > 0.3) P.hostile = Math.max(0, P.hostile - 0.15);
      cable(s, them, 'treaty_yes');
      note(tk, `The ${city} summit is a success. Handshakes, a joint statement, and a détente for two years.`);
      logEvent(s, `🤝 THE ${city.toUpperCase()} SUMMIT: you and ${T.leader?.name ?? T.name} agree a détente. Relations +25, old grudges fade.`, 'diplo', [s.player, them], true, { big: true, prov: T.capital });
      return { ok: true, message: tk.note! };
    }
    tk.stage = 2; tk.trust = clamp(tk.trust - 20, 0, 100); tk.next = s.tick + 8;
    addRelation(s, them, s.player, -3);
    note(tk, `The ${city} summit collapses over the final communiqué. Trust ${Math.round(tk.trust)}/100: more gestures are needed before another try.`);
    logEvent(s, `💢 ${tk.note}`, 'diplo', [s.player, them], true);
    return { ok: false, message: tk.note! };
  }
  return { ok: false, message: 'Nothing to do' };
}

const INCIDENTS = [
  'a border patrol opens fire and a soldier is killed', 'state TV airs a vicious documentary about you', 'a spy ring working for them is uncovered in your capital',
  'hardline generals stage provocative exercises on your border', 'a fishing boat is seized in disputed waters', 'their parliament votes to condemn the talks',
];
/** Weekly: hardliners may sabotage a process; a détente warms relations while it lasts; a war ends everything. */
export function stepTracks(s: GameState) {
  for (const [k, m] of Object.entries(s.nego ?? {})) {
    const tk = m.track;
    if (!tk) continue;
    const them = Number(k), T = s.countries[them];
    if (!T?.alive || areAtWar(s, them, s.player)) {
      if (tk.stage > 1) logEvent(s, `💥 The reconciliation with ${T?.name ?? 'them'} is dead: you are at war.`, 'danger', [s.player, them], true);
      delete m.track; continue;
    }
    if (tk.detenteUntil !== undefined) {
      if (s.tick < tk.detenteUntil) {
        if (getRelation(s, them, s.player) < 30) addRelation(s, them, s.player, 0.35);
        const P = s.countries[s.player];
        if (P.hostile && (T.orient ?? 0) > 0.3) P.hostile = Math.max(0, P.hostile - 0.002);
        if (T.hostile && (P.orient ?? 0) > 0.3) T.hostile = Math.max(0, T.hostile - 0.002);
      }
      else if (tk.stage === 4) { tk.stage = 2; tk.trust = 40; tk.done = []; tk.detenteUntil = undefined; note(tk, 'The détente has lapsed without new gestures. Trust 40/100: a new round of gestures can revive it.'); logEvent(s, `🕊 The détente with ${T.name} has lapsed.`, 'diplo', [s.player, them]); }
    }
    if ((tk.stage === 2 || tk.stage === 3) && s.tick % 4 === them % 4) {
      const p = 0.035 * (has(T, 'hawk') || has(T, 'nationalist') ? 1.6 : 1) * (tk.done.includes('hotline') ? 0.5 : 1);
      if (nextRand(s) < p) {
        const what = INCIDENTS[Math.floor(nextRand(s) * INCIDENTS.length)];
        tk.trust = clamp(tk.trust - 12, 0, 100);
        if (tk.stage === 3 && tk.trust < 50) tk.stage = 2;
        note(tk, `Hardliners strike: ${what}. Trust falls to ${Math.round(tk.trust)}/100.${tk.done.includes('hotline') ? '' : ' A military hotline would have helped.'}`);
        logEvent(s, `⚠ ${T.name}: ${tk.note}`, 'danger', [s.player, them], true);
        if (tk.trust <= 0) { delete m.track; logEvent(s, `💢 The talks with ${T.name} have collapsed.`, 'danger', [s.player, them], true); }
      }
    }
  }
}
