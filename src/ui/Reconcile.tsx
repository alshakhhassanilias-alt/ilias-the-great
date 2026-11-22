/** The reconciliation process with a hostile country: back channel, gestures, summit, détente. */
import { store } from '../state/store';
import { Section } from './widgets';
import { AGENDA, actTrack, askOf, backChannelOdds, friendshipReady, gestures, needsReconciling, summitOdds, trackOf, type Agenda } from '../sim/detente';
import { dateLabel } from '../sim/tick';
import { areAtWar } from '../sim/relations';

const STAGES = ['Back channel', 'Gestures', 'Summit', 'Détente', 'Friendship'];

export function ReconcilePanel({ id }: { id: number }) {
  const s = store.state!;
  if ((!needsReconciling(s, id) && trackOf(s, id)?.stage !== 5) || areAtWar(s, id, s.player)) return null;
  const T = s.countries[id];
  const tk = trackOf(s, id);
  const stage = tk?.stage ?? 1;
  const wait = tk ? Math.max(0, tk.next - s.tick) : 0;
  const pc = s.countries[s.player].politics?.pc ?? 0;
  const ask = askOf(s, id);
  const go = (step: 'open' | 'gesture' | 'summit' | 'treaty', gid?: string) => {
    const r = store.act((g) => actTrack(g, store.geo, id, step, gid), true);
    store.toast(r.message, r.ok ? 'diplo' : 'danger');
  };
  const bc = backChannelOdds(s, id);
  return (
    <Section title="Reconciliation" hint="no enemy is forever: a process, step by step">
      <div className="card recon">
        <div className="recon-steps">
          {STAGES.map((l, i) => <div key={l} className={`recon-step ${i + 1 < stage || (i + 1 === 5 && stage === 5) ? 'done' : i + 1 === stage ? 'now' : ''}`}><i>{i + 1}</i><span>{l}</span></div>)}
        </div>
        {tk && stage >= 2 && <div className="recon-trust"><span>Trust</span><div className="meter"><i style={{ width: `${tk.trust}%` }} /></div><b>{Math.round(tk.trust)}/100</b></div>}
        {tk?.note && <div className="recon-note">“{tk.note}”</div>}
        {ask && <div className="recon-ask">📨 Their request: <b>{gestures(s, store.geo, id).find((g) => g.id === ask.id)?.title ?? ask.id}</b> · within {ask.until - s.tick} weeks it counts double</div>}
        {stage === 1 && (
          <>
            <p className="hint">Secret talks through intermediaries. Costs 5 political capital. Chance they answer: <b className={bc.p >= 0.5 ? 'good' : bc.p >= 0.3 ? '' : 'bad'}>{Math.round(bc.p * 100)}%</b></p>
            <ul className="recon-why">{bc.why.map((w) => <li key={w.label}><span>{w.label}</span><b className={w.v >= 0 ? 'good' : 'bad'}>{w.v >= 0 ? '+' : ''}{Math.round(w.v * 100)}%</b></li>)}</ul>
            <button className="btn primary" disabled={wait > 0 || pc < 5} onClick={() => go('open')}>Open a back channel<small>{wait > 0 ? `again in ${wait} weeks` : pc < 5 ? 'needs 5 political capital' : `${Math.round(bc.p * 100)}% · a failure may leak`}</small></button>
          </>
        )}
        {(stage === 2 || stage === 4) && (
          <>
            <p className="hint">{stage === 2 ? 'Confidence-building steps, one every 4 weeks. Reach 50 trust for a summit. Hardliners may strike in between.' : `Détente until ${dateLabel(tk!.detenteUntil ?? s.tick)}: relations warm every week and deals are easier. A gesture extends it.`}</p>
            <div className="recon-gestures">
              {gestures(s, store.geo, id).map((g) => (
                <button key={g.id} className={`recon-g ${g.ok ? '' : 'off'} ${ask?.id === g.id ? 'asked' : ''}`} disabled={!g.ok || wait > 0} title={g.why} onClick={() => go('gesture', g.id)}>
                  <span className="recon-gi">{g.icon}</span><b>{g.title}</b><small>trust +{g.trust} · {g.price}</small>
                </button>
              ))}
            </div>
            {wait > 0 && <div className="faint" style={{ fontSize: 12 }}>Next step possible in {wait} weeks.</div>}
            {stage === 4 && (friendshipReady(s, id)
              ? <button className="btn primary" disabled={pc < 8} onClick={() => go('treaty')}>Sign a treaty of friendship<small>{pc < 8 ? 'needs 8 political capital' : '8 capital · the détente becomes permanent'}</small></button>
              : <div className="faint" style={{ fontSize: 12 }}>A treaty of friendship becomes possible after a year of détente with relations above +20.</div>)}
          </>
        )}
        {stage === 5 && <p className="hint">🕊 A treaty of friendship binds you. Relations keep warming; this old enmity is over.</p>}
        {stage === 3 && (
          <>
            <p className="hint">Enough trust for a summit in a neutral capital (10 political capital). Choose what it is for. Success: relations +25, a two-year détente and the agenda below. Failure: trust −20, back to gestures.</p>
            <div className="recon-gestures">
              {(Object.keys(AGENDA) as Agenda[]).map((a) => (
                <button key={a} className="recon-g" disabled={wait > 0 || pc < 10} onClick={() => go('summit', a)}>
                  <b>{AGENDA[a].title}</b><small>{AGENDA[a].desc} · {Math.round(Math.max(0.05, Math.min(0.95, summitOdds(s, id) + AGENDA[a].odds)) * 100)}% chance</small>
                </button>
              ))}
            </div>
            {(wait > 0 || pc < 10) && <div className="faint" style={{ fontSize: 12 }}>{wait > 0 ? `Possible in ${wait} weeks.` : 'Needs 10 political capital.'} With {T.leader?.name ?? T.name}.</div>}
          </>
        )}
      </div>
    </Section>
  );
}
