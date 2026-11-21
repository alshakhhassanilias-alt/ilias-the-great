/**
 * The campaign on screen: a banner over the map while a race is on, and Campaign HQ, where you pick a region, an issue
 * and a move, see what it would do before you commit, and follow the trail (your speeches, their attacks).
 */
import { useState } from 'react';
import { store, useStoreSelect } from '../state/store';
import { ISSUES, MOVES, actCampaign, credibility, nationalPoll, previewMove, regionPolls, type CampaignMove, type Issue } from '../sim/campaign';
import { dateLabel } from '../sim/tick';
import { Portrait, faceFor } from './art/Portrait';
import { leaderFace } from './LookEditor';
import { sfx } from '../audio';

const stars = (v: number) => (v >= 1.35 ? '★★★' : v >= 1.05 ? '★★' : '★');
const credWord = (v: number) => (v >= 1.15 ? { t: 'strong', c: 'up' } : v >= 0.9 ? { t: 'fair', c: '' } : { t: 'weak', c: 'down' });

export function CampaignBanner() {
  const key = useStoreSelect(() => { const s = store.state, cm = s?.campaign; return cm && !store.preview ? `${s!.tick}|${cm.days}|${Math.round(nationalPoll(s!, cm) * 10)}` : ''; });
  if (!key) return null;
  const s = store.state!, cm = s.campaign!;
  const poll = nationalPoll(s, cm);
  const weeks = Math.max(0, cm.vote - s.tick);
  return (
    <button className={`camp-banner ${cm.days > 0 ? 'ready' : ''} ${poll >= 50 ? 'ahead' : 'behind'}`} onClick={() => store.openDrawer('campaign')}>
      <span className="cb-k">🗳 {cm.kind === 'congress' ? 'Congress' : cm.kind === 'comeback' ? 'The road back' : 'Election'} in {weeks} wk</span>
      <span className="cb-race"><b>{poll.toFixed(1)}</b><i><i style={{ width: `${poll}%` }} /></i><b className="foe">{(100 - poll).toFixed(1)}</b></span>
      <span className="cb-days">{Array.from({ length: 3 }, (_, i) => <i key={i} className={i < cm.days ? 'on' : ''} />)}</span>
      <span className="cb-go">Campaign HQ ›</span>
    </button>
  );
}

export function CampaignHQ({ onClose }: { onClose: () => void }) {
  useStoreSelect(() => { const s = store.state; return `${s?.tick}|${s?.campaign?.days}|${s?.campaign?.trail.length}|${store.actSeq}`; });
  const s = store.state!, cm = s.campaign;
  const c = s.countries[s.player];
  const [reg, setReg] = useState(0);
  const [issue, setIssue] = useState<Issue>('jobs');
  if (!cm) return (
    <div className="scrim" role="presentation" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}><div className="modal-head"><h2>Campaign HQ</h2><button className="iconbtn" aria-label="Close" onClick={onClose}>✕</button></div><div className="modal-body"><p className="muted">No campaign is under way. The last twelve weeks before a vote are fought here.</p></div></div></div>
  );
  const polls = regionPolls(s, cm);
  const poll = nationalPoll(s, cm);
  const cred = credibility(s, c);
  const free = cm.kind !== 'congress';
  const R = cm.regions[reg] ?? cm.regions[0];
  const foeTarget = cm.trail.filter((x) => !x.mine).at(-1)?.text.split(':')[0];
  const go = (m: CampaignMove) => { const r = store.act((g) => actCampaign(g, m, reg, issue)); if (r.ok) sfx(m === 'attack' ? 'drums' : 'stamp'); };
  return (
    <div className="scrim camp-scrim" role="presentation" onClick={onClose}>
      <div className="modal camp-modal" role="dialog" aria-label="Campaign HQ" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>🗳 Campaign HQ <small>{cm.kind === 'congress' ? 'the congress' : cm.kind === 'comeback' ? 'the vote that could bring you back' : 'election day'} · {dateLabel(cm.vote)} · {Math.max(0, cm.vote - s.tick)} weeks</small></h2><button className="iconbtn" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          <div className="camp-race">
            <div className="cr-side me"><Portrait f={leaderFace(s)} size={56} title={s.legacy?.leader} /><div><b>{s.legacy?.leader ?? 'You'}</b><span className="cr-num">{poll.toFixed(1)}%</span></div></div>
            <div className="cr-mid">
              <div className="cr-bar"><i className="a" style={{ width: `${poll}%` }} /><i className="b" style={{ width: `${100 - poll}%` }} /><u /></div>
              <div className="cr-meta">
                <span>Momentum <b className={cm.momentum >= 0 ? 'up' : 'down'}>{cm.momentum >= 0 ? '+' : ''}{cm.momentum.toFixed(1)}</b></span>
                <span>Campaign days {Array.from({ length: 3 }, (_, i) => <i key={i} className={`pip ${i < cm.days ? 'on' : ''}`} />)}</span>
                {cm.foeIssue && <span>They attack you on <b>{ISSUES.find((x) => x.id === cm.foeIssue)!.icon} {ISSUES.find((x) => x.id === cm.foeIssue)!.name}</b></span>}
              </div>
            </div>
            <div className="cr-side them"><div><b>{cm.foe}</b><span className="cr-num">{(100 - poll).toFixed(1)}%</span></div><Portrait f={faceFor(c, cm.foe, 'leader')} size={56} title={cm.foe} /></div>
          </div>

          <div className="camp-grid">
            <div className="camp-regions" role="listbox" aria-label="Regions">
              <h4>{free ? 'The regions' : 'The provincial delegations'} <small>pick where to campaign</small></h4>
              {polls.map(({ r, share }, i) => {
                const top = ISSUES.map((x) => x.id).sort((a, b) => r.sal[b] - r.sal[a]).slice(0, 2);
                return (
                  <button key={r.name} role="option" aria-selected={reg === i} className={`camp-reg ${reg === i ? 'on' : ''} ${share >= 50 ? 'lead' : 'trail'}`} onClick={() => { setReg(i); sfx('select', i); }}>
                    <span className="crg-name"><b>{r.name}</b><small>{Math.round(r.w * 100)}% of voters · cares about {top.map((t) => ISSUES.find((x) => x.id === t)!.icon).join(' ')}{r.visits >= 1 ? ` · ${Math.round(r.visits)} visit${r.visits >= 1.5 ? 's' : ''}` : ''}{foeTarget?.includes(r.name) ? ' · 🎯 they are here' : ''}</small></span>
                    <span className="crg-bar"><i style={{ width: `${share}%` }} /><u /></span>
                    <span className={`crg-num ${share >= 50 ? 'up' : 'down'}`}>{share.toFixed(1)}</span>
                  </button>
                );
              })}
            </div>

            <div className="camp-act">
              <h4>The message <small>in {R.name}</small></h4>
              <div className="camp-issues" role="radiogroup" aria-label="Issue">
                {ISSUES.map((x) => {
                  const cw = credWord(cred[x.id]);
                  const avg = ISSUES.reduce((t, y) => t + R.sal[y.id], 0) / ISSUES.length;
                  return (
                    <button key={x.id} role="radio" aria-checked={issue === x.id} className={`camp-issue ${issue === x.id ? 'on' : ''}`} onClick={() => setIssue(x.id)}>
                      <span className="ci-ic" aria-hidden>{x.icon}</span><b>{x.name}</b>
                      <small>matters here <em>{stars(R.sal[x.id] / avg)}</em></small>
                      <small>your record <em className={cw.c}>{cw.t}</em></small>
                    </button>
                  );
                })}
              </div>
              <h4>The move</h4>
              <div className="camp-moves">
                {MOVES.map((m) => {
                  const p = previewMove(s, m.id, reg, issue);
                  return (
                    <button key={m.id} className="camp-move" disabled={cm.days < 1} onClick={() => go(m.id)} title={m.desc}>
                      <span><span aria-hidden>{m.icon}</span> <b>{free ? m.free : m.regime}</b></span>
                      <small>{m.desc}</small>
                      <em>{m.id === 'tv' || m.id === 'attack' ? 'everywhere' : R.name}: ≈ +{p.national.toFixed(1)} nationally{m.id === 'rally' || m.id === 'door' ? ` (+${p.region.toFixed(1)} there)` : ''}{m.id === 'attack' ? ' if it lands' : ''}</em>
                    </button>
                  );
                })}
              </div>
              {cm.days < 1 && <p className="faint camp-wait">No campaign days left: one more comes each week (up to three in hand). Unused days are not lost, but a full hand means your team acts without you, at half strength.</p>}
            </div>
          </div>

          <h4 className="camp-h">The campaign trail</h4>
          <ul className="camp-trail">
            {[...cm.trail].reverse().slice(0, 10).map((x, i) => <li key={i} className={x.mine ? 'mine' : 'foe'}><small>{dateLabel(x.tick)}</small>{x.text}</li>)}
            {!cm.trail.length && <li className="faint">Nothing yet. Pick a region, a message and a move.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
