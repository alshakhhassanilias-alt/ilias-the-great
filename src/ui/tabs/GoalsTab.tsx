import { useState } from 'react';
import { store } from '../../state/store';
import { Meter, Section } from '../widgets';
import { activeGoals, goalById } from '../../sim/goals';
import { dateLabel } from '../../sim/tick';
import { ProjectsMini } from './Projects';
import { NationPath } from './NationPath';
import { StorylinePanel } from './Storyline';
import { countryChecks, goalHelp, guideLevel, topPriority, type Check, type Fix } from '../guides';

const THEME_COL: Record<string, string> = { economy: 'var(--teal)', politics: 'var(--blue)', military: 'var(--red)' };
const STATUS_ICON: Record<Check['status'], string> = { good: '●', warn: '▲', bad: '■' };

function FixButton({ fix }: { fix: Fix }) {
  return (
    <button className="btn sm" onClick={() => { if (fix.run) store.act((g) => fix.run!(g, store.geo)); else if (fix.open) fix.open(); else if (fix.tab) store.setTab(fix.tab); }}>
      {fix.label}
    </button>
  );
}

/** Objectives and guides. Guidance shrinks with difficulty: full on Easy, limited on Normal, none on Hard. */
export function GoalsTab() {
  const s = store.state!;
  const geo = store.geo;
  const c = s.countries[s.player];
  const level = guideLevel(s);
  const goals = activeGoals(s);
  const done = Object.entries(s.goalsDone).sort((a, b) => b[1] - a[1]);
  const checks = level === 'none' ? [] : countryChecks(s, c, geo);
  const top = level === 'limited' ? topPriority(checks) : null;
  const [showDone, setShowDone] = useState(false);
  return (
    <>
      <StorylinePanel />
      <NationPath />
      <div className={`guide-level ${level}`}>
        {level === 'full' && <><b>Guides: full</b> (Easy). Tips and one-tap fixes for everything below.</>}
        {level === 'limited' && <><b>Guides: limited</b> (Normal). Status lights and one top priority; the rest is up to you.</>}
        {level === 'none' && <><b>Guides: off</b> (Hard). No hints. Read the numbers and decide for yourself.</>}
      </div>

      <Section title="Objectives" hint={`${done.length} done · new ones appear as you finish, made for the way you play`}>
        <div className="goal-cards">
          {goals.map((g) => {
            const p = g.progress(s, c);
            const help = level !== 'none' ? goalHelp(g.id, s, c, geo) : null;
            return (
              <div className="goal-card" key={g.id} style={{ borderLeftColor: THEME_COL[g.theme] }}>
                <div className="gc-top"><span className="gc-theme" style={{ color: THEME_COL[g.theme] }}>{g.theme}</span><span className="gc-pct">{Math.round(p.value * 100)}%</span></div>
                <b className="gc-title">{g.title}</b>
                <div className="gc-desc">{g.desc}</div>
                <Meter value={p.value} color={THEME_COL[g.theme]} />
                <div className="gc-meta"><span>{p.text}</span><span>{g.reward.replace('Reward: ', '🎁 ')} · +6 political capital</span></div>
                {help?.how && <div className="gc-how">💡 {help.how}</div>}
                {help?.fix && (level === 'full' || !help.fix.run) && <div style={{ marginTop: 6 }}><FixButton fix={help.fix} /></div>}
              </div>
            );
          })}
          {goals.length === 0 && <div className="faint">All objectives complete. Set your own goals, or conquer the world.</div>}
        </div>
        {s.projects.some((r) => r.owner === s.player) && <div className="card" style={{ padding: '2px 12px', marginTop: 8 }}><ProjectsMini /></div>}
      </Section>

      {level !== 'none' && (
        <Section title="Country check-up" hint={level === 'full' ? 'what to fix, and how' : 'status at a glance'}>
          {top && (
            <div className="card top-priority">
              <div className="why-title">Top priority</div>
              <b>{top.title}</b>
              <div className="faint" style={{ fontSize: 12.5, marginTop: 2 }}>{top.detail}</div>
            </div>
          )}
          {(['Economy', 'Security', 'Diplomacy'] as const).map((area) => {
            const list = checks.filter((x) => x.area === area);
            if (!list.length) return null;
            return (
              <div className="card checks" key={area}>
                <div className="why-title">{area}</div>
                {list.map((x, i) => (
                  <div className={`check-row ${x.status}`} key={i}>
                    <span className="ck-dot" aria-label={x.status}>{STATUS_ICON[x.status]}</span>
                    <div className="grow">
                      <b>{x.title}</b>
                      {level === 'full' && <div className="faint">{x.detail}</div>}
                    </div>
                    {level === 'full' && x.fix && x.status !== 'good' && <FixButton fix={x.fix} />}
                  </div>
                ))}
              </div>
            );
          })}
        </Section>
      )}

      <Section title="Completed" hint={`${done.length}`}>
        <button className="linkbtn" onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide' : 'Show'} completed objectives</button>
        {showDone && (
          <div className="card" style={{ marginTop: 6 }}>
            {done.length === 0 && <div className="faint">None yet.</div>}
            {done.map(([id, tick]) => { const g = goalById(s, id); return g ? <div className="why-row" key={id}><span>✓ {g.title}</span><span className="faint">{dateLabel(tick)}</span></div> : null; })}
          </div>
        )}
      </Section>
    </>
  );
}
