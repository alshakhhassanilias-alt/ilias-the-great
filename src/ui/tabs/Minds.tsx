/** What foreign leaders want, what they are working toward, and what they think of you. */
import { store } from '../../state/store';
import { Section } from '../widgets';
import { dateLabel } from '../../sim/tick';
import { DRIVE_ICON, DRIVE_LABEL, agendaOf, asYou, commitLabel, leanLabel, moodOf, opinionOf, recOf, topDrives } from '../../sim/minds';
import { PLAN_ICON, type PlanKind } from '../../sim/plans';
import { memberValue } from '../../sim/membership';
import { threatLevel } from '../../sim/ai';
import { isMajor } from '../../sim/drama';
import { neighborsOf } from '../../sim/diplomacy';
import type { Country, GameState } from '../../sim/types';

const MOOD_LABEL: [keyof ReturnType<typeof moodOf>, string][] = [['weary', 'tired of war'], ['burden', 'tired of paying for allies'], ['pain', 'angry about the economy'], ['threat', 'afraid of a neighbour'], ['shame', 'humiliated by a defeat']];

/** The leader's agenda, aim and the public mood (shown in the Leadership card of a foreign country). */
export function LeaderMind({ c }: { c: Country }) {
  const s = store.state!;
  if (!c.leader) return null;
  const a = agendaOf(s, c);
  const top = topDrives(a);
  const m = moodOf(c);
  const g = c.goal;
  const moods = MOOD_LABEL.filter(([k]) => m[k] > 0.3).map(([k, l]) => `${l} (${Math.round(m[k] * 100)}%)`);
  return (
    <div className="mind">
      {c.leader.mandate && <div className="mind-line">Came to power {c.leader.mandate}.</div>}
      <div className="mind-drives">
        {top.map((d) => <div key={d} className="mind-drive" title={`${DRIVE_LABEL[d]}: ${Math.round(a[d] * 100)}% of what drives this leader`}><span>{DRIVE_ICON[d]} {DRIVE_LABEL[d]}</span><i style={{ width: `${Math.round((a[d] / a[top[0]]) * 100)}%` }} /></div>)}
      </div>
      <div className="mind-line faint">{c.leader.commit !== undefined ? `${commitLabel(c.leader.commit)} · ` : ''}{c.leader.lean !== undefined ? `personally ${leanLabel(c.leader.lean)}` : ''}</div>
      {g && (
        <div className="mind-plan">
          <b>{PLAN_ICON[g.kind as PlanKind] ?? '🎯'} Aim: {g.text}</b>
          <span className="faint"> · since {dateLabel(g.since)}</span>
          {g.kind !== 'growth' && <div className="mind-bars"><span>progress</span><i className="p" style={{ width: `${Math.round((g.progress ?? 0) * 100)}%` }} /><span>patience</span><i className="q" style={{ width: `${Math.round((g.patience ?? 1) * 100)}%` }} /></div>}
          {g.note && <div className="faint" style={{ fontSize: 11.5 }}>Last attempt: {g.note}</div>}
        </div>
      )}
      {moods.length > 0 && <div className="mind-line faint">The public is {moods.join(', ')}. The next {c.gov === 'D' || c.gov === 'F' ? 'election' : 'change of ruler'} will turn on it.</div>}
    </div>
  );
}

/** How a foreign leader judges your record. */
export function TheirJudgement({ id }: { id: number }) {
  const s = store.state!;
  const c = s.countries[id];
  if (!c.leader || id === s.player) return null;
  const op = opinionOf(s, id, s.player);
  return (
    <div className="judge">
      <div className="why-title">What {c.leader.name} thinks of your record <b className={op.v < 0 ? 'bad' : op.v > 0 ? 'good' : ''}>{op.v > 0 ? '+' : ''}{op.v}</b></div>
      {op.reasons.length ? op.reasons.map((r, i) => <div className="why-row" key={i}><span>You {asYou(r.label)}</span><b className={r.v < 0 ? 'bad' : 'good'}>{r.v > 0 ? '+' : ''}{r.v}</b></div>)
        : <div className="faint" style={{ fontSize: 12 }}>Nothing in your record stands out to them yet. That changes with what you do.</div>}
      <div className="faint" style={{ fontSize: 11 }}>Their judgement weighs on deals, votes, sanctions, coalitions and war, on top of plain relations. They judge through their own agenda: {topDrives(agendaOf(s, c)).slice(0, 2).map((d) => DRIVE_LABEL[d].toLowerCase()).join(' and ')} first.</div>
    </div>
  );
}

const REC_LABEL: [keyof ReturnType<typeof recOf>, string][] = [['aggr', 'Wars started'], ['conquest', 'Land seized'], ['betray', 'Promises broken'], ['loyal', 'Allies defended'], ['sanction', 'Sanctions imposed'], ['repress', 'Crackdowns'], ['reform', 'Reforms'], ['aid', 'Aid given'], ['defaulted', 'Defaults'], ['nuke', 'The bomb']];

function watchers(s: GameState) {
  const geo = store.geo;
  const ids = new Set<number>(neighborsOf(s, geo, s.player));
  for (const c of s.countries) if (c.alive && isMajor(s, c.id)) ids.add(c.id);
  if (s.rival >= 0) ids.add(s.rival);
  ids.delete(s.player);
  return [...ids].map((i) => s.countries[i]).filter((c) => c?.alive && c.leader);
}

/** The player's own view: the record the world remembers, who admires and who condemns it, and who has made you their aim. */
export function WorldJudgement() {
  const s = store.state!;
  const r = recOf(s, s.player);
  const list = watchers(s).map((c) => ({ c, op: opinionOf(s, c.id, s.player) })).sort((a, b) => a.op.v - b.op.v);
  const critics = list.filter((x) => x.op.v <= -5).slice(0, 5), fans = list.filter((x) => x.op.v >= 5).reverse().slice(0, 4);
  const aims = s.countries.filter((c) => c.alive && !c.isPlayer && c.goal && c.goal.target === s.player);
  const rec = REC_LABEL.filter(([k]) => r[k] >= 0.1);
  const row = (x: { c: Country; op: ReturnType<typeof opinionOf> }) => (
    <div className="why-row judge-row" key={x.c.id} onClick={() => store.select(x.c.id, null, true)}>
      <span><b>{x.c.name}</b> <span className="faint">({x.c.leader!.name})</span>{x.op.reasons[0] && <> · you {asYou(x.op.reasons[0].label)}</>}</span>
      <b className={x.op.v < 0 ? 'bad' : 'good'}>{x.op.v > 0 ? '+' : ''}{x.op.v}</b>
    </div>
  );
  return (
    <Section title="How the world sees you" hint="leaders judge your record through their own agendas">
      <div className="card judge-card">
        <div className="judge-rec">{rec.length ? rec.map(([k, l]) => <span key={k} className="chip-mini">{l}: {r[k] >= 1 ? r[k].toFixed(1) : 'some'}</span>) : <span className="faint">A clean slate: the world has nothing on you yet.</span>}</div>
        {aims.length > 0 && <div className="judge-aims">{aims.map((c) => <div key={c.id}>⚠ <b>{c.name}</b>{c.leader ? ` (${c.leader.name})` : ''} has made you its aim: {c.goal!.text.charAt(0).toLowerCase() + c.goal!.text.slice(1)}</div>)}</div>}
        {critics.length > 0 && <><div className="why-title">Condemn you</div>{critics.map(row)}</>}
        {fans.length > 0 && <><div className="why-title">Admire you</div>{fans.map(row)}</>}
        {!critics.length && !fans.length && <div className="faint" style={{ fontSize: 12 }}>The great powers and your neighbours have not made up their minds about you.</div>}
        <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>Wars, conquests and broken promises are remembered for about a decade; so are loyalty, reforms and aid. The bomb is never forgotten. A democrat ideologue condemns a crackdown that a strongman respects; a security hawk next door fears a warmonger; a mercantilist hates sanctions and defaults.</div>
      </div>
    </Section>
  );
}

/** What membership of an organisation is worth to you, part by part. */
export function MembershipWorth({ orgId }: { orgId: number }) {
  const s = store.state!;
  const o = s.orgs?.find((x) => x.id === orgId);
  if (!o) return null;
  const others = o.members.filter((m) => m !== s.player).map((m) => ({ m, v: s.stats[`mv:${o.id}:${m}`] })).filter((x) => x.v !== undefined).sort((a, b) => a.v! - b.v!);
  const mine = memberValue(s, o, s.player, Math.min(1, threatLevel(s, store.geo, s.countries[s.player])));
  return (
    <div className="org-worth">
      {o.ultimatum && <div className="org-ultimatum">📢 {s.countries[o.ultimatum.by].name} threatens to leave by {dateLabel(o.ultimatum.until)} unless the others carry more.</div>}
      <div className="hint">What it is worth to you: {mine.parts.slice(0, 4).map((p) => `${p.label} ${p.v > 0 ? '+' : ''}${p.v.toFixed(2)}`).join(' · ')}</div>
      {others.length > 0 && <div className="hint">Least happy members: {others.slice(0, 3).map((x) => `${s.countries[x.m].name} (${x.v! > 0 ? '+' : ''}${x.v!.toFixed(2)})`).join(', ')}</div>}
    </div>
  );
}
