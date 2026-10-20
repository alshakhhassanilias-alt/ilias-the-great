/**
 * Where your country stands in the world, and the organisations that bind countries together: see what pulls you
 * East or West, change course, apply to join, leave, or found a bloc of your own.
 */
import { START_YEAR } from '../../sim/types';
import { MembershipWorth } from './Minds';
import { useState } from 'react';
import { store } from '../../state/store';
import { Section } from '../widgets';
import {
  FOUND_PC, GOV_LABEL, REALIGN_PC, actApplyOrg, actFoundOrg, actLeaveOrg, actRealign, admitted, applicationVotes, credibility, foundingAnswers, orientTarget, westShare,
} from '../../sim/alignment';
import { areAtWar, getRelation } from '../../sim/relations';
import { actProposeDefence, actRenameOrg, defenceClauseVotes, depthLabel, orgName } from '../../sim/blocs';
import type { Org } from '../../sim/types';

export const orientLabel = (o: number) => (o > 0.7 ? 'Firmly Western' : o > 0.3 ? 'Leans West' : o < -0.7 ? 'Firmly Eastern' : o < -0.3 ? 'Leans East' : 'Non-aligned');
const KIND_LABEL: Record<Org['kind'], string> = { defence: 'Defence pact: an attack on one is an attack on all', union: 'Political and economic union', economic: 'Economic club' };

/** A bar from East (−1) to West (+1) with a marker for where the country is and a ghost for where it is heading. */
export function OrientBar({ o, target }: { o: number; target?: number }) {
  return (
    <div className="orient-bar" aria-label={`Orientation ${o.toFixed(2)}`}>
      <span>East</span>
      <div className="ob-track">
        <i className="ob-mid" />
        {target !== undefined && <i className="ob-ghost" style={{ left: `${(target + 1) * 50}%` }} />}
        <i className="ob-dot" style={{ left: `${(o + 1) * 50}%` }} />
      </div>
      <span>West</span>
    </div>
  );
}

export function AlignmentSection() {
  const s = store.state!;
  const c = s.countries[s.player];
  const o = c.orient ?? 0, h = c.hostile ?? 0;
  const t = orientTarget(s, c);
  const share = westShare(s);
  const wait = Math.max(0, 52 - (s.tick - (s.stats.realignAt ?? -999)));
  const pc = c.politics?.pc ?? 100;
  return (
    <Section title="Your place in the world" hint={orientLabel(o)}>
      <div className="card">
        <OrientBar o={o} target={t.target} />
        <div className="hint" style={{ marginTop: 6 }}>
          {GOV_LABEL[c.gov] ? `${/^[aeiou]/i.test(GOV_LABEL[c.gov]) ? 'An' : 'A'} ${GOV_LABEL[c.gov]}. ` : ''}Drifting toward <b>{orientLabel(t.target).toLowerCase()}</b>
          {Math.abs(t.target - o) <= 0.25 ? ' (settled: small differences do not move a country)' : ` (slowly, over years)`}: your friends and partners pull toward {t.friends >= 0 ? `the West (${t.friends.toFixed(2)})` : `the East (${t.friends.toFixed(2)})`}
          {Math.abs(t.bandwagon) > 0.01 ? `; ${t.bandwagon > 0 ? 'the West looks like the winning side' : 'the West looks like it is losing'} (${t.bandwagon > 0 ? '+' : ''}${t.bandwagon.toFixed(2)})` : ''}
          {t.gov ? `; your form of government ${t.gov > 0 ? 'pulls West' : 'pulls East'}` : ''}.
          {' '}The Western camp holds {(share * 100).toFixed(0)}% of the power of countries that pick a side.
        </div>
        {h > 0.05 && <div className="hint bad" style={{ marginTop: 4 }}>The West treats you as an adversary ({(h * 100).toFixed(0)}%): relations with every Western-leaning country suffer. It fades while you lean West and keep the peace with it.</div>}
        <div className="btnrow" style={{ marginTop: 8 }}>
          {(['west', 'neutral', 'east'] as const).map((l) => (
            <button key={l} className="btn" disabled={wait > 0 || pc < REALIGN_PC} onClick={() => store.act((g) => actRealign(g, l))}>
              {l === 'west' ? 'Turn toward the West' : l === 'east' ? 'Turn toward the East' : 'Declare non-alignment'}
              <small>{wait > 0 ? `again in ${wait} wk` : `${REALIGN_PC} political capital · relations shift`}</small>
            </button>
          ))}
        </div>
        <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>A change of course moves you a step at a time, at most once a year. Your old friends notice, and the people who built the old alliances at home may resist.</div>
      </div>
    </Section>
  );
}

export function OrgsSection() {
  const s = store.state!;
  const me = s.player;
  const [open, setOpen] = useState<number | null>(null);
  const orgs = [...(s.orgs ?? [])].sort((a, b) => Number(b.members.includes(me)) - Number(a.members.includes(me)) || b.members.length - a.members.length);
  return (
    <Section title="Organisations" hint="alliances, unions and clubs: membership changes">
      <div className="list">
        {orgs.map((o) => {
          const member = o.members.includes(me);
          const votes = member ? [] : applicationVotes(s, o, me);
          const yes = votes.filter((v) => v.yes).length;
          const wait = Math.max(0, 52 - (s.tick - (s.stats[`orgApply:${o.id}`] ?? -999)));
          const cred = o.kind === 'defence' ? credibility(s, o) : 1;
          return (
            <div key={o.id} className={`card org-card ${member ? 'member' : ''}`}>
              <div className="row" style={{ border: 'none', padding: 0 }}>
                <div className="grow">
                  <b>{o.icon} {o.name.replace(/^the /, 'The ')}</b>{member && <span className="pill green" style={{ marginLeft: 6 }}>member</span>}
                  <div className="hint">{KIND_LABEL[o.kind]} · {o.members.length} members{o.camp ? ` · ${o.camp > 0 ? 'Western' : 'Eastern'} camp` : ''}{o.founded > 0 ? ` · founded ${2024 + Math.floor(o.founded / 52)}` : ''} · ties {depthLabel(o.depth ?? 2 / 3)} (+{o.bonus} relations between members){cred < 0.8 ? ` · credibility ${(cred * 100).toFixed(0)}%` : ''}{o.ultimatum ? ` · 📢 ${s.countries[o.ultimatum.by].name} threatens to leave` : ''}{o.founder === me ? ' · you founded it' : ''}</div>
                </div>
                {member
                  ? <button className="btn danger" onClick={() => store.act((g) => actLeaveOrg(g, o.id))}>Leave<small>relations with members fall</small></button>
                  : <button className={`btn ${admitted(o, votes) ? 'primary' : ''}`} disabled={wait > 0} onClick={() => store.act((g) => actApplyOrg(g, o.id))}>Apply<small>{wait > 0 ? `again in ${wait} wk` : `${yes}/${votes.length} would vote yes · ${admitted(o, votes) ? 'likely admitted' : 'would be rejected'}`}</small></button>}
              </div>
              <button className="linkbtn" onClick={() => setOpen(open === o.id ? null : o.id)}>{open === o.id ? 'Hide details' : member ? 'Members, history and proposals' : 'Who votes how, and its history'}</button>
              {open === o.id && (o.history?.length ?? 0) > 0 && <ul className="org-history">{o.history!.slice(-5).map((h, i) => <li key={i}><span>{START_YEAR + Math.floor(h.tick / 52)}</span>{h.text}</li>)}</ul>}
              {open === o.id && member && <MembershipWorth orgId={o.id} />}
              {open === o.id && member && <OrgProposals o={o} />}
              {open === o.id && (
                <div className="org-members">
                  {member ? o.members.map((m) => <span key={m} className="pill" onClick={() => store.select(m, null, true)}>{s.countries[m].name}</span>)
                    : votes.sort((a, b) => Number(a.yes) - Number(b.yes)).map((v) => <span key={v.m} className={`pill ${v.yes ? 'green' : 'red'}`} title={v.why} onClick={() => store.select(v.m, null, true)}>{v.yes ? '✓' : '✗'} {s.countries[v.m].name} <small>{v.why}</small></span>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <FoundOrg />
    </Section>
  );
}

function OrgProposals({ o }: { o: Org }) {
  const s = store.state!;
  const [name, setName] = useState(o.name);
  const votes = o.kind !== 'defence' ? defenceClauseVotes(s, o) : [];
  return (
    <div className="org-props">
      {o.kind !== 'defence' && (
        <button className="btn" onClick={() => store.act((g) => actProposeDefence(g, o.id))}>Propose a mutual-defence clause<small>{votes.filter((v) => v.yes).length}/{votes.length} members in favour (needs 75%) · turns it into an alliance</small></button>
      )}
      {o.founder === s.player && (
        <div className="row" style={{ border: 'none', gap: 6 }}>
          <input className="org-name-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="New name" />
          <button className="btn" disabled={name.trim() === o.name} onClick={() => store.act((g) => actRenameOrg(g, o.id, name))}>Rename</button>
        </div>
      )}
    </div>
  );
}

function FoundOrg() {
  const s = store.state!;
  const me = s.player;
  const [kind, setKind] = useState<Org['kind'] | null>(null);
  const [pick, setPick] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [salt, setSalt] = useState(0);
  if (!kind) return <button className="btn" style={{ marginTop: 8, width: '100%' }} onClick={() => setKind('economic')}>Found a new organisation…<small>{FOUND_PC} political capital · needs at least two countries to join</small></button>;
  const cands = s.countries.filter((x) => x.alive && x.id !== me && !areAtWar(s, me, x.id)).sort((a, b) => getRelation(s, me, b.id) - getRelation(s, me, a.id)).slice(0, 10);
  const ans = foundingAnswers(s, kind, pick);
  const suggestion = orgName(s, kind, me, pick, Math.sign(Math.round((s.countries[me].orient ?? 0) * 2) / 2), salt);
  return (
    <div className="card" style={{ marginTop: 8 }}>
      <div className="btnrow">{(['economic', 'union', 'defence'] as const).map((k) => <button key={k} className={`btn ${kind === k ? 'primary' : ''}`} onClick={() => setKind(k)}>{k === 'defence' ? 'Defence pact' : k === 'union' ? 'Union' : 'Economic club'}</button>)}</div>
      <div className="hint" style={{ margin: '6px 0' }}>{KIND_LABEL[kind]}. Invite up to five countries:</div>
      <div className="org-members">
        {cands.map((x) => {
          const on = pick.includes(x.id), a = ans.find((y) => y.m === x.id);
          return <span key={x.id} className={`pill ${on ? (a?.yes ? 'green' : 'red') : ''}`} style={{ cursor: 'pointer' }} onClick={() => setPick(on ? pick.filter((y) => y !== x.id) : pick.length < 5 ? [...pick, x.id] : pick)}>{on ? (a?.yes ? '✓ ' : '✗ ') : ''}{x.name} <small>{on && a ? a.why : `relations ${getRelation(s, me, x.id).toFixed(0)}`}</small></span>;
        })}
      </div>
      <div className="org-name-row">
        <label className="hint" htmlFor="org-name">Its name</label>
        <input id="org-name" className="org-name-input" value={name} maxLength={40} placeholder={suggestion} onChange={(e) => setName(e.target.value)} />
        <button className="linkbtn" onClick={() => { setName(''); setSalt(salt + 1); }}>suggest another</button>
      </div>
      <div className="btnrow" style={{ marginTop: 8 }}>
        <button className="btn primary" disabled={ans.filter((a) => a.yes).length < 2} onClick={() => { const r = store.act((g) => actFoundOrg(g, kind, pick, name.trim() || suggestion)); if (r.ok) { setKind(null); setPick([]); setName(''); } }}>Found {name.trim() || suggestion}<small>{ans.filter((a) => a.yes).length} would join · {FOUND_PC} political capital</small></button>
        <button className="btn" onClick={() => { setKind(null); setPick([]); }}>Cancel</button>
      </div>
    </div>
  );
}
