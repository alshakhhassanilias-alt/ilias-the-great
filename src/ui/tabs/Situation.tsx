import { arcById } from '../../sim/arcs';
import { pathOf } from '../../sim/nations';
import { aggOf, coalitionAgainst } from '../../sim/coalitions';
import { REVOLT, factionMeta } from '../../sim/domestic';
import { dateLabel } from '../../sim/tick';
import { store } from '../../state/store';
import { Section } from '../widgets';
import { fmtMoney, fmtNum } from '../format';
import { getRelation, isAtWar } from '../../sim/relations';
import { strengthIndex } from '../../sim/military';
import { crisisById, crisisLeft } from '../../sim/crises';
import { isMajor } from '../../sim/drama';
import { projectById, runsOf } from '../../sim/projects';

/** Compare two numbers as a tug-of-war bar: left = you, right = them. */
function Duel({ label, a, b, fmt }: { label: string; a: number; b: number; fmt: (v: number) => string }) {
  const tot = Math.max(1e-9, a + b);
  const lead = a >= b;
  return (
    <div className="duel">
      <div className="duel-l"><b className={lead ? 'good' : ''}>{fmt(a)}</b></div>
      <div className="duel-mid"><div className="duel-lab">{label}</div><div className="duel-bar"><i style={{ width: `${(100 * a) / tot}%`, background: lead ? 'var(--green)' : 'var(--amber)' }} /></div></div>
      <div className="duel-r"><b className={!lead ? 'bad' : ''}>{fmt(b)}</b></div>
    </div>
  );
}

export function SituationSection() {
  const s = store.state!;
  const me = s.countries[s.player];
  const rv = s.rival >= 0 && s.countries[s.rival]?.alive ? s.countries[s.rival] : null;
  const cr = s.crisis ? crisisById(s.crisis.id) : null;
  // other people's wars worth watching
  const hot = s.wars
    .filter((w) => !w.attackers.includes(s.player) && !w.defenders.includes(s.player))
    .map((w) => ({ w, score: [...w.attackers, ...w.defenders].reduce((t, x) => t + (isMajor(s, x) ? 2 : 0), 0) + w.fronts.length * 0.3 }))
    .sort((a, b) => b.score - a.score).slice(0, 3);
  const mineWars = s.wars.filter((w) => w.attackers.includes(s.player) || w.defenders.includes(s.player));
  const upcoming: { wk: number; text: string }[] = [];
  if (s.stats.nextVote !== undefined) upcoming.push({ wk: s.stats.nextVote - s.tick, text: me.gov === 'D' || me.gov === 'F' ? '🗳 Election' : '🏛 Leadership congress' });
  upcoming.push({ wk: (((13 - s.tick) % 104) + 104) % 104 || 104, text: '🌐 World Assembly vote' });
  for (const r of runsOf(s, s.player)) upcoming.push({ wk: r.weeks - r.done, text: `${projectById(r.id).icon} ${projectById(r.id).title} completes` });
  for (const it of s.inbox) upcoming.push({ wk: it.expires - s.tick, text: `⏳ Decision lapses: ${it.id.replace(/_/g, ' ')}` });
  upcoming.sort((a, b) => a.wk - b.wk);
  if (!rv && !cr && !hot.length && !mineWars.length && !upcoming.length && !me.politics?.arc) return null;
  const focus = (cid: number, prov?: number) => store.select(cid, prov ?? null, true);
  const P = me.politics;
  const arc = P?.arc ? arcById(P.arc.id) : undefined;
  const furious = P?.factions.filter((f) => f.mood < 30) ?? [];
  return (
    <Section title="Right now" hint="live">
      {arc && P?.arc && (
        <button className="card crisis-card" style={{ textAlign: 'left', width: '100%' }} onClick={() => store.setTab('politics')}>
          <b>{arc.icon} {arc.title}</b> <span className="faint">· stage {P.arc.stage} of {arc.stages}</span>
          <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>{P.arc.next ? `More to come around ${dateLabel(P.arc.next.at)}.` : 'A decision is waiting in your inbox.'}</div>
        </button>
      )}
      {(() => { const a = me.nat?.active; const n = a ? pathOf(me).nodes.find((x) => x.id === a.id) : undefined; return n && a ? (
        <button className="card" style={{ textAlign: 'left', width: '100%' }} onClick={() => store.setTab('goals')}>
          <b>{n.icon} {n.title}</b> <span className="faint">· national project, completes {dateLabel(a.until)}</span>
          <div className="path-prog" style={{ marginTop: 6 }}><i style={{ width: `${Math.min(100, (100 * (s.tick - a.start)) / Math.max(1, a.until - a.start))}%` }} /></div>
        </button>
      ) : !me.nat?.active && (me.politics?.pc ?? 0) >= 12 ? (
        <button className="card" style={{ textAlign: 'left', width: '100%' }} onClick={() => store.setTab('goals')}>
          <b>🏛 No national project under way</b>
          <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>{pathOf(me).title}: pick the next step in the Goals tab.</div>
        </button>
      ) : null; })()}
      {(() => {
        const k = coalitionAgainst(s, me.id), agg = aggOf(s, me.id);
        if (k) return (
          <button className="card hot" style={{ textAlign: 'left', width: '100%' }} onClick={() => focus(k.members[0])}>
            <b>⚠ A coalition of {k.members.length} countries stands against you</b>
            <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>{k.members.slice(0, 6).map((x) => s.countries[x].name).join(', ')}{k.members.length > 6 ? '…' : ''}. Attack any of them and the others join in. It breaks up as your aggression fades ({Math.round(agg)}).</div>
          </button>
        );
        if (agg > 14) return (
          <div className="card">
            <b>👁 The world is watching your aggression</b>
            <div className="bar" style={{ margin: '6px 0' }}><i style={{ width: `${Math.min(100, (agg / 35) * 100)}%`, background: agg > 28 ? 'var(--red)' : 'var(--amber)' }} /></div>
            <div className="faint" style={{ fontSize: 12 }}>{Math.round(agg)} of 35: above that your neighbours form a coalition against you. Wars of aggression and conquered regions raise it; it fades over time.</div>
          </div>
        );
        const theirs = (s.coalitions ?? []).filter((x) => x.members.includes(me.id) || isMajor(s, x.target)).slice(0, 2);
        return theirs.map((x) => <div className="card" key={x.target}><b>🤝 Coalition against {s.countries[x.target].name}</b><div className="faint" style={{ fontSize: 12 }}>{x.members.length} members{x.members.includes(me.id) ? ', including you' : ''}.</div></div>);
      })()}
      {furious.length > 0 && (
        <button className="card hot" style={{ textAlign: 'left', width: '100%' }} onClick={() => store.setTab('politics')}>
          <b>🔥 {furious.map((f) => factionMeta(f.id).name).join(', ')} {furious.length > 1 ? 'are' : 'is'} furious</b>
          <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>Risk of {furious.map((f) => REVOLT[f.id]).join(', ')}. Open Politics to see why.</div>
        </button>
      )}
      {cr && (
        <div className={`card crisis-card ${cr.id === 'boom' ? 'good' : ''}`}>
          <b>{cr.icon} {cr.title}</b> <span className="faint">· {crisisLeft(s)} weeks left</span>
          <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>{cr.blurb}</div>
        </div>
      )}
      {mineWars.map((w) => {
        const enemy = (w.attackers.includes(s.player) ? w.defenders : w.attackers)[0];
        const mine = w.fronts.filter((f) => f.by === s.player).length, theirs = w.fronts.length - mine;
        return (
          <div className="card hot" key={w.id}>
            <b>⚔ {w.name}</b>
            <div className="faint" style={{ fontSize: 12 }}>{mine} of your offensives · {theirs} enemy attacks · casualties {Math.round((w.casualties[s.player] ?? 0) / 1000)}k yours / {Math.round((w.casualties[enemy] ?? 0) / 1000)}k theirs</div>
            <button className="linkbtn" onClick={() => focus(enemy)}>Show on map</button>
          </div>
        );
      })}
      {rv && (
        <div className="card rival">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <b>🎯 Your rival: {rv.name}</b>
            <button className="linkbtn" onClick={() => focus(rv.id)}>Show</button>
          </div>
          <div className="faint" style={{ fontSize: 12, margin: '2px 0 8px' }}>{isAtWar(s, rv.id) ? '⚔ At war with you' : `${rv.intent || 'Watching you'} · relations ${getRelation(s, me.id, rv.id).toFixed(0)}`}</div>
          <Duel label="Economy" a={me.eco.gdp} b={rv.eco.gdp} fmt={(v) => fmtMoney(v)} />
          <Duel label="Military" a={strengthIndex(me)} b={strengthIndex(rv)} fmt={(v) => fmtNum(v * 1000)} />
          <Duel label="Technology" a={me.eco.tech} b={rv.eco.tech} fmt={(v) => v.toFixed(0)} />
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="card upcoming">
          <div className="why-title">Coming up</div>
          {upcoming.slice(0, 5).map((u, i) => <div className="why-row" key={i}><span>{u.text}</span><b>{u.wk <= 0 ? 'now' : u.wk >= 52 ? `${(u.wk / 52).toFixed(1)} yr` : `${u.wk} wk`}</b></div>)}
        </div>
      )}
      {hot.map(({ w }) => (
        <div className="card hot" key={w.id}>
          <b>🔥 {w.name}</b>
          <div className="faint" style={{ fontSize: 12 }}>{w.attackers.map((x) => s.countries[x].name).join(', ')} vs {w.defenders.map((x) => s.countries[x].name).join(', ')} · {w.fronts.length} active fronts</div>
          <button className="linkbtn" onClick={() => { const f = w.fronts[0]; focus(w.defenders[0], f?.prov); }}>Show on map</button>
        </div>
      ))}
    </Section>
  );
}
