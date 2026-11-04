/**
 * Your rivals: the leader just above you in the world power race and your nemesis, face to face with you on what
 * matters (power, economy, growth, army, technology, clients, stability, reputation).
 */
import { store } from '../../state/store';
import { Section } from '../widgets';
import { Portrait, faceFor } from '../art/Portrait';
import { Emblem } from '../art/Emblem';
import { FOCUS_GLYPH, Glyph } from '../art/Glyphs';
import { nationalColor } from '../../map/palette';
import { headToHead, nemesisOf } from '../../sim/rivals';
import { powerRank, raceOf } from '../../sim/power';
import { focusById } from '../../sim/focus';
import { dateLabel } from '../../sim/tick';
import type { GameState } from '../../sim/types';

export function rivalIds(s: GameState): { id: number; role: 'chase' | 'hunter' | 'nemesis' }[] {
  const out: { id: number; role: 'chase' | 'hunter' | 'nemesis' }[] = [];
  const R = s.rivals;
  const r = raceOf(s);
  const chase = r.above?.id ?? R?.chase ?? -1;
  if (chase >= 0 && s.countries[chase]?.alive) out.push({ id: chase, role: r.above ? 'chase' : 'hunter' });
  const n = nemesisOf(s);
  if (n >= 0 && n !== chase) out.push({ id: n, role: 'nemesis' });
  return out;
}

export function RivalCard({ id, role, compact }: { id: number; role: 'chase' | 'hunter' | 'nemesis'; compact?: boolean }) {
  const s = store.state!;
  const T = s.countries[id], me = s.countries[s.player];
  const h = headToHead(s, s.player, id);
  const F = focusById(T.focus);
  const quote = (s.cables ?? []).filter((x) => x.from === id).slice(-1)[0];
  const r = raceOf(s);
  const roleText = role === 'chase' ? `The one to catch · #${powerRank(s, id)}` : role === 'hunter' ? `Hunting you · #${powerRank(s, id)}` : `Your nemesis · #${powerRank(s, id)}`;
  const gap = role === 'chase' && r.above ? `${r.above.gap.toFixed(1)} power points ahead of you` : role === 'hunter' ? 'just behind you in the race' : '';
  const leader = T.leader?.name ?? T.name;
  const rows = compact ? h.rows.filter((x) => ['power', 'gdp', 'mil', 'tech', 'inf'].includes(x.key)) : h.rows;
  const lead = h.you - h.them;
  return (
    <div className={`rival-card r-${role}`} style={{ ['--rc' as string]: nationalColor(T) }}>
      <div className="rv-head">
        <span className="rv-face"><Portrait f={faceFor(T, leader, 'leader')} size={compact ? 52 : 64} title={leader} /><span className="rv-flag"><Emblem c={T} size={26} crest={false} /></span></span>
        <div className="rv-who">
          <small className="rv-role">{roleText}</small>
          <b>{leader}</b>
          <span className="faint">{T.name}{gap ? ` · ${gap}` : ''}</span>
          {F && <span className="rv-focus" title={F.pros.join(' · ')} style={{ ['--fc' as string]: F.color }}><Glyph name={FOCUS_GLYPH[F.id]} size={13} /> {F.name} year</span>}
        </div>
        <div className={`rv-score ${lead > 0 ? 'up' : lead < 0 ? 'down' : ''}`} title="categories where you lead – where they lead">
          <b>{h.you}<i>–</i>{h.them}</b><small>{lead > 0 ? 'you lead' : lead < 0 ? 'they lead' : 'level'}</small>
        </div>
      </div>
      {!compact && quote && <div className={`rv-quote mood-${quote.mood}`}>“{quote.text}” <span className="faint">· {dateLabel(quote.tick)}</span></div>}
      <div className="rv-rows">
        {rows.map((x) => (
          <div key={x.key} className="rv-row">
            <span className={`rv-a ${x.lead === 1 ? 'win' : ''}`}>{x.a}</span>
            <div className="rv-mid"><small>{x.label}</small><div className="rv-bar"><i style={{ width: `${Math.round(x.ra * 100)}%` }} /></div></div>
            <span className={`rv-b ${x.lead === -1 ? 'win' : ''}`}>{x.b}</span>
          </div>
        ))}
      </div>
      {!compact && <div className="rv-foot"><span className="faint">You: {me.name}</span><button className="linkbtn" onClick={() => store.select(id, null, true)}>Open {T.name} →</button></div>}
    </div>
  );
}

export function RivalsSection() {
  const s = store.state!;
  const ids = rivalIds(s);
  if (!ids.length) return null;
  const R = s.rivals;
  return (
    <Section title="Your rivals" hint={R && (R.won || R.lost) ? `overtakes ${R.won} won · ${R.lost} lost` : 'head to head'}>
      <div className="rivals">{ids.map((x) => <RivalCard key={x.id} id={x.id} role={x.role} />)}</div>
    </Section>
  );
}
