import { store } from '../../state/store';
import { Section, Meter } from '../widgets';
import { fmtMoney } from '../format';
import { actCancelProject, actStartProject } from '../../sim/actions';
import { PROJECTS, canStart, hasDone, projectById, runsOf, MAX_ACTIVE } from '../../sim/projects';

/** Megaprojects: multi-year national programmes with a spectacular payoff. */
export function ProjectsSection() {
  const s = store.state!;
  const c = s.countries[s.player];
  const runs = runsOf(s, c.id);
  return (
    <Section title="Megaprojects" hint={`${runs.length}/${MAX_ACTIVE} running · funded weekly`}>
      <div className="projects">
        {PROJECTS.map((d) => {
          const run = runs.find((r) => r.id === d.id);
          const done = hasDone(s, c.id, d.id) && d.id !== 'fortress';
          const why = !run && !done ? canStart(s, c.id, d.id) : null;
          const cost = d.pct * c.eco.gdp;
          return (
            <div key={d.id} className={`proj ${run ? 'run' : ''} ${done ? 'done' : ''}`}>
              <div className="proj-head">
                <span className="proj-icon" aria-hidden="true">{d.icon}</span>
                <div className="grow">
                  <b>{d.title}</b>
                  <div className="faint" style={{ fontSize: 11.5 }}>{d.blurb}</div>
                </div>
                {done && <span className="tag good">Built ✓</span>}
              </div>
              <div className="proj-perk">{d.perk}</div>
              {run ? (
                <>
                  <Meter value={run.done / run.weeks} color={run.stalled ? 'var(--red)' : 'var(--accent)'} />
                  <div className="proj-foot">
                    <span>{run.stalled ? '⚠ stalled: no money' : `${Math.round((100 * run.done) / run.weeks)}% · ${Math.ceil((run.weeks - run.done) / 52 * 10) / 10} yr left`}</span>
                    <button className="linkbtn" onClick={() => store.act((g) => actCancelProject(g, g.player, run.uid))}>Cancel</button>
                  </div>
                </>
              ) : !done && (
                <div className="proj-foot">
                  <span>{fmtMoney(cost)} over {(d.weeks / 52).toFixed(1)} yr</span>
                  <button className="btn primary sm" disabled={!!why} title={why ?? ''} onClick={() => store.act((g) => actStartProject(g, g.player, d.id))}>{why ? 'Locked' : 'Start'}</button>
                </div>
              )}
              {why && <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>{why}</div>}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

export function ProjectsMini() {
  const s = store.state!;
  const runs = runsOf(s, s.player);
  if (!runs.length) return null;
  return (
    <>
      {runs.map((r) => {
        const d = projectById(r.id);
        return (
          <div className="goal" key={r.uid}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span><span className="theme">PROJECT</span> <b>{d.icon} {d.title}</b></span><span className="faint">{Math.round((100 * r.done) / r.weeks)}%</span></div>
            <Meter value={r.done / r.weeks} color={r.stalled ? 'var(--red)' : 'var(--accent)'} />
          </div>
        );
      })}
    </>
  );
}
