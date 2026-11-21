/**
 * War as the main event, on screen:
 *   - the war council when a war of tier 2 or more begins (the clock stops): the stakes, both sides, and three
 *     decisions (the war aim, mobilisation, the opening strategy);
 *   - the war strip over the map for as long as you are at war;
 *   - the war panel at the top of the Overview: the phase, the numbers, mobilisation and strategy, the war room.
 */
import { useEffect, useState } from 'react';
import { store, useStore } from '../state/store';
import { mainWar, playerWars, warScale, actWarCouncil, actMobilise, actSetStrategy, TIER_LABEL, TIER_DESC, type WarX } from '../sim/warmode';
import { MOBILISATION, STRATEGIES, mobOf, stratById, type MobLevel, type StratId } from '../sim/mobdata';
import { GOALS_META, type WarGoal } from '../sim/goalmeta';
import { goalOf } from '../sim/wargoals';
import { warScore } from '../sim/war';
import { strength } from '../sim/military';
import { warSupport } from '../sim/warsupport';
import { actCallAllies } from '../sim/actions';
import { RUNG_LABEL, threatOf, warReactions } from '../sim/redlines';
import { warSideOf } from '../sim/relations';
import { dateLabel } from '../sim/tick';
import { fmtMoney, fmtNum } from './format';
import { Emblem } from './art/Emblem';
import { Portrait, faceFor } from './art/Portrait';
import { Glyph } from './art/Glyphs';
import { Section } from './widgets';
import { sfx } from '../audio';
import type { CountryId, GameState, War } from '../sim/types';

const big = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));
const Pips = ({ n }: { n: number }) => <span className="wc-pips" aria-label={`tier ${n} of 5`}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}</span>;
const sides = (s: GameState, w: War) => { const me = s.player; const mine = (w.attackers.includes(me) ? w.attackers : w.defenders).filter((x) => s.countries[x]?.alive); const theirs = (w.attackers.includes(me) ? w.defenders : w.attackers).filter((x) => s.countries[x]?.alive); return { mine, theirs }; };
const sumStr = (s: GameState, ids: CountryId[]) => ids.reduce((t, x) => t + strength(s.countries[x]), 0);

function Side({ s, ids, label, cls }: { s: GameState; ids: CountryId[]; label: string; cls: string }) {
  const lead = s.countries[ids[0]];
  if (!lead) return null;
  const leader = lead.id === s.player ? s.legacy?.leader : lead.leader?.name;
  return (
    <div className={`wc-side ${cls}`}>
      <small>{label}</small>
      <div className="wc-flagrow"><Emblem c={lead} size={56} />{leader && <span className="desk-only"><Portrait f={faceFor(lead, leader, 'leader')} size={56} title={leader} /></span>}</div>
      <b>{lead.name}</b>
      {ids.length > 1 && <span className="faint">+ {ids.slice(1, 4).map((x) => s.countries[x].name).join(', ')}{ids.length > 4 ? ` +${ids.length - 4}` : ''}</span>}
      <span className="wc-num">{fmtNum(ids.reduce((t, x) => t + s.countries[x].mil.troops, 0))} troops · power {fmtNum(sumStr(s, ids))}</span>
    </div>
  );
}

/** The war council: opens by itself when a war of tier 2+ begins. */
export function WarCouncil() {
  useStore();
  const s = store.state;
  const mw = s ? playerWars(s).find((x) => x.x.council) : null;
  const show = !!s && !!mw && !store.preview && !store.splash;
  const defender = !!mw && mw.w.defenders.includes(s!.player);
  const [goal, setGoal] = useState<WarGoal>(3);
  const [mob, setMob] = useState<MobLevel>(1);
  const [strat, setStrat] = useState<StratId>('balanced');
  useEffect(() => {
    if (!show || !mw) return;
    setGoal(defender ? 3 : 1); setMob(mw.x.tier >= 4 ? 2 : mw.x.tier >= 2 ? 1 : 0); setStrat(defender ? 'depth' : 'balanced');
    sfx('drums');
  }, [show, mw?.w.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { store.hold('council', show); return () => store.hold('council', false); }, [show]);
  if (!show || !s || !mw) return null;
  const { w, x } = mw;
  const c = s.countries[s.player];
  const sc = warScale(s, w, s.player);
  const { mine, theirs } = sides(s, w);
  const a = sumStr(s, mine), b = sumStr(s, theirs);
  const odds = a / Math.max(1, a + b);
  const cur = c.mob ?? 0;
  const go = () => {
    const r = store.act((g) => actWarCouncil(g, w.id, { goal, mob, strat }), true);
    if (r.ok) { store.toast(`⚔ ${r.message}`, 'war'); sfx('begin'); if (store.speed === 0) store.setSpeed(store.lastSpeed || 1); } else store.toast(r.message, 'danger');
  };
  return (
    <div className="scrim sotn-scrim wc-scrim" role="presentation">
      <div className={`sotn wc t${x.tier}`} role="dialog" aria-label="War council">
        <header className="sotn-top">
          <span className="wc-badge"><Glyph name="sword" size={30} /></span>
          <div className="grow">
            <div className="sotn-kicker">{dateLabel(s.tick)} · War council</div>
            <h2>{w.name}</h2>
            <div className="wc-tier"><Pips n={x.tier} /><b>{TIER_LABEL[x.tier]}</b><span className="faint">{TIER_DESC[x.tier]}</span></div>
          </div>
        </header>
        <div className="sotn-body">
          <div className="wc-vs">
            <Side s={s} ids={mine} label="Our side" cls="us" />
            <div className="wc-mid"><b>VS</b><div className="wc-odds" title="share of the combined military power"><i style={{ width: `${Math.round(odds * 100)}%` }} /></div><small>{Math.round(odds * 100)}% of the strength on the field</small></div>
            <Side s={s} ids={theirs} label="The enemy" cls="them" />
          </div>
          {sc.reasons.length > 0 && <div className="wc-stakes"><b>What makes it a {TIER_LABEL[x.tier].toLowerCase()}:</b> {sc.reasons.join(' · ')}.</div>}
          <h3 className="sotn-h">1 · What is this war for? <small>you will be judged on it when it ends</small></h3>
          <div className="wc-cards">
            {([1, 2, 3] as WarGoal[]).map((g) => (
              <button key={g} className={`wc-card ${goal === g ? 'on' : ''}`} onClick={() => { sfx('select', g); setGoal(g); }}>
                <b>{GOALS_META[g].title}</b><span>{GOALS_META[g].desc}</span><small>Success: {GOALS_META[g].success}</small>
              </button>
            ))}
          </div>
          <h3 className="sotn-h">2 · Mobilisation <small>calling up costs money now; standing down is free</small></h3>
          <div className="wc-cards four">
            {MOBILISATION.map((m) => (
              <button key={m.level} className={`wc-card mob m${m.level} ${mob === m.level ? 'on' : ''}`} onClick={() => { sfx('select', m.level + 1); setMob(m.level); }}>
                <span className="wc-ic"><Glyph name={m.icon} size={22} /></span>
                <b>{m.name}</b>
                <ul>{m.pros.map((p) => <li key={p} className="pro">{p}</li>)}{m.cons.map((p) => <li key={p} className="con">{p}</li>)}</ul>
                {m.level > cur && <small>now: {fmtMoney(0.004 * (m.level - cur) * c.eco.gdp)}</small>}
              </button>
            ))}
          </div>
          <h3 className="sotn-h">3 · The opening strategy <small>change it later for 5 political capital</small></h3>
          <div className="wc-cards four">
            {STRATEGIES.map((t) => (
              <button key={t.id} className={`wc-card ${strat === t.id ? 'on' : ''}`} onClick={() => { sfx('select', STRATEGIES.indexOf(t) + 2); setStrat(t.id); }}>
                <span className="wc-ic"><Glyph name={t.icon} size={22} /></span>
                <b>{t.name}</b><span>{t.desc}</span>
                <ul>{t.pros.map((p) => <li key={p} className="pro">{p}</li>)}{t.cons.map((p) => <li key={p} className="con">{p}</li>)}</ul>
              </button>
            ))}
          </div>
        </div>
        <footer className="sotn-foot">
          <span className="faint">{GOALS_META[goal].title} · {MOBILISATION[mob].short} · {stratById(strat).name}</span>
          <button className="btn primary sotn-go wc-go" onClick={go}>{defender ? 'Defend the nation' : 'To war'} ▶</button>
        </footer>
      </div>
    </div>
  );
}

/** Over the map while you are at war: the biggest war, its tier, how it goes. */
export function WarStrip() {
  useStore();
  const s = store.state;
  if (!s || store.preview) return null;
  const mw = mainWar(s);
  if (!mw) return null;
  const { w, x } = mw;
  const c = s.countries[s.player];
  const sc = warScore(s, w, s.player);
  const n = playerWars(s).length;
  return (
    <div className={`war-strip t${x.tier}`} role="status">
      <span className="ws-ic"><Glyph name="sword" size={18} /></span>
      <div className="ws-txt">
        <b>{w.name}{n > 1 ? ` +${n - 1}` : ''}</b>
        <span><Pips n={x.tier} /> {x.label} · week {s.tick - w.start + 1}</span>
      </div>
      <div className="ws-score desk-only" title="war score"><i className={sc >= 0 ? 'up' : 'down'} style={{ width: `${Math.round(Math.abs(sc) * 50)}%`, [sc >= 0 ? 'left' : 'right']: '50%' } as React.CSSProperties} /><span>{sc >= 0 ? '+' : ''}{Math.round(sc * 100)}</span></div>
      <span className="ws-num desk-only" title="war support">{Math.round(warSupport(c) * 100)}% support</span>
      {x.council ? <button className="btn sm danger" onClick={() => store.notify()}>Council</button> : <button className="btn sm" onClick={() => store.openWarRoom(w.id)}>War room</button>}
    </div>
  );
}

const PHASES: [WarX['phase'], string][] = [['opening', 'Opening battles'], ['grind', 'The long war'], ['turning', 'Turning point'], ['endgame', 'Endgame']];
/** The Overview's first section while you are at war. */
/** Who is stepping in, for each side: arming, a red line, at war. For every action, a reaction (redlines.ts). */
function Reactions({ s, w }: { s: GameState; w: War }) {
  const me = s.player, mine = warSideOf(w, me);
  const rs = warReactions(s, w);
  const us = rs.filter((r) => r.side === mine), them = rs.filter((r) => r.side !== mine);
  const t = threatOf(s, w, me);
  const row = (list: typeof rs, label: string) => (
    <div className="wp-react"><small>{label}</small>
      {list.length ? list.slice(0, 6).map((r) => {
        const out = r.rung === 3 && warSideOf(w, r.f) < 0;
        return <span key={`${r.x}:${r.f}`} className={`wr-chip r${out ? 1 : r.rung}`} title={`${s.countries[r.f].name} for ${s.countries[r.x].name}: ${out ? 'fought, then left the war' : RUNG_LABEL[r.rung]}`}><Emblem c={s.countries[r.f]} size={16} crest={false} />{s.countries[r.f].name}<i>{out ? 'left' : RUNG_LABEL[r.rung]}</i></span>;
      }) : <span className="faint">no one</span>}
    </div>
  );
  return (
    <div className="wp-reacts">
      <div className="wp-react-h"><b>Who steps in</b><span className="faint">{t.v >= 0.05 ? `our danger ${Math.round(t.v * 100)}%: ${t.why.join(', ') || 'the war is going against us'}` : 'friends arm you, draw red lines and, if the line is crossed, fight'}</span></div>
      {row(us, 'For us')}
      {row(them, 'For them')}
    </div>
  );
}

export function WarPanel() {
  const s = store.state!;
  const mw = mainWar(s);
  if (!mw) return null;
  const { w, x } = mw;
  const c = s.countries[s.player];
  const { theirs } = sides(s, w);
  const E = s.countries[theirs[0]];
  const sc = warScore(s, w, s.player);
  const M = mobOf(c);
  const goal = goalOf(s, w);
  return (
    <Section title={`War: ${w.name}`} hint={`${x.label} · week ${s.tick - w.start + 1}`}>
      <div className={`war-panel t${x.tier}`}>
        <div className="wp-top"><Pips n={x.tier} /><b>{x.label}</b><span className="faint">{TIER_DESC[x.tier]}</span></div>
        <div className="wp-phases">{PHASES.map(([k, l]) => <span key={k} className={x.phase === k ? 'on' : PHASES.findIndex((p) => p[0] === k) < PHASES.findIndex((p) => p[0] === x.phase) ? 'done' : ''}>{l}</span>)}</div>
        <div className="wp-grid">
          <div><small>War score</small><b className={sc >= 0 ? 'good' : 'bad'}>{sc >= 0 ? '+' : ''}{Math.round(sc * 100)}</b></div>
          <div><small>War support</small><b className={warSupport(c) < 0.35 ? 'bad' : ''}>{Math.round(warSupport(c) * 100)}%</b></div>
          <div><small>Our losses</small><b>{big(w.casualties[c.id] ?? 0)}</b></div>
          <div><small>Theirs</small><b>{big(E ? w.casualties[E.id] ?? 0 : 0)}</b></div>
          <div><small>Exhaustion</small><b>{Math.round(c.mil.exhaustion * 100)}% / {Math.round((E?.mil.exhaustion ?? 0) * 100)}%</b></div>
          <div><small>War aim</small><b>{goal ? GOALS_META[goal as WarGoal].title : '—'}</b></div>
        </div>
        <Reactions s={s} w={w} />
        <div className="wp-row"><small>Mobilisation</small>
          <div className="wp-seg">{MOBILISATION.map((m) => <button key={m.level} className={`${M.level === m.level ? 'on' : ''} m${m.level}`} title={[...m.pros, ...m.cons].join(' · ')} onClick={() => store.act((g) => actMobilise(g, m.level))}>{m.short}</button>)}</div>
        </div>
        <div className="wp-row"><small>Strategy</small>
          <div className="wp-seg">{STRATEGIES.map((t) => <button key={t.id} className={(c.strat ?? 'balanced') === t.id ? 'on' : ''} title={`${t.desc} ${[...t.pros, ...t.cons].join(' · ')} (5 capital)`} onClick={() => store.act((g) => actSetStrategy(g, t.id))}>{t.short}</button>)}</div>
        </div>
        <div className="wp-acts">
          <button className="btn primary" onClick={() => store.openWarRoom(w.id)}>War room</button>
          <button className="btn" onClick={() => store.act((g) => actCallAllies(g, g.player))}>Call allies</button>
          {E && <button className="btn" onClick={() => store.openPeace(E.id)}>Peace terms…</button>}
        </div>
      </div>
    </Section>
  );
}
