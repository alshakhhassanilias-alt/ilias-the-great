/**
 * The mission card (desktop): what you are playing for, at a glance. The nation's ambition and the act of its story you
 * are in, then the three current objectives with progress, reward and a one-tap way to work on each. Everything here
 * is also in the Goals tab; this is the short version that is always on screen.
 */
import { store } from '../../state/store';
import { activeGoals } from '../../sim/goals';
import { PATH_LABEL, pathOf, type Path } from '../../sim/goals2';
import { raceOf, tierLabel } from '../../sim/power';
import { seedOf } from '../../sim/story';
import { goalHelp, guideLevel } from '../guides';

const THEME_COL: Record<string, string> = { economy: 'var(--teal)', politics: 'var(--blue)', military: 'var(--red)' };
const THEME_ICON: Record<string, string> = { economy: '📈', politics: '🏛', military: '⚔' };
const REGION: Record<string, string> = { EU: 'Europe', RU: 'Eurasia', ME: 'the Middle East', AF: 'Africa', SA: 'South Asia', EA: 'East Asia', SEA: 'Southeast Asia', LA: 'Latin America', NA: 'North America', OC: 'Oceania' };
/** The ambition follows the road the player is actually on once it is clear (otherwise the nation's own story). */
const AMBITION: Record<Path, (region: string) => string> = {
  conqueror: (r) => `the master of ${r}`, strongman: () => 'a fortress no one dares to touch', reformer: (r) => `the model democracy of ${r}`,
  trader: () => 'the trading crossroads of the world', peacemaker: (r) => `the peacemaker of ${r}`, builder: () => '',
};

export function MissionCard() {
  const s = store.state!;
  const geo = store.geo;
  const c = s.countries[s.player];
  const goals = activeGoals(s);
  const level = guideLevel(s);
  const waiting = s.inbox.some((x) => x.id.startsWith('story'));
  const path = pathOf(s, c);
  const race = raceOf(s);
  const A = race.above ? s.countries[race.above.id] : null;
  const ambition = AMBITION[path.path](REGION[c.region] ?? 'its region') || seedOf(c).ambition;
  return (
    <section className="section mission desk-only">
      <div className="mission-head">
        <span className="mission-kicker">The race for world power</span>
        <div className="mission-race">
          <span className="mr-rank">#{race.rank}</span>
          <div className="mr-body">
            <b>{race.tier ? `Goal: ${tierLabel(race.tier)}` : race.rank === 1 ? `Hold first place: ${race.yearsTop.toFixed(1)} of 5 years` : ''}</b>
            {A && <span>Next to pass: <b>{A.name}</b> <span className="faint">({Math.round(race.toNext * 100)}%)</span></span>}
            {A && <i className="mr-bar"><i style={{ width: `${Math.round(race.toNext * 100)}%` }} /></i>}
          </div>
        </div>
        <span className="mission-path">Make {c.name} {ambition} · <b>{PATH_LABEL[path.path]}</b>{waiting ? <em className="mission-now"> · a story decision is waiting</em> : null}</span>
      </div>
      <ol className="mission-goals">
        {goals.map((g) => {
          const p = g.progress(s, c);
          const help = level !== 'none' ? goalHelp(g.id, s, c, geo) : null;
          const fix = help?.fix && (level === 'full' || !help.fix.run) ? help.fix : null;
          return (
            <li key={g.id} style={{ ['--gc' as string]: THEME_COL[g.theme] }}>
              <span className="mg-icon" aria-hidden>{THEME_ICON[g.theme]}</span>
              <div className="mg-body">
                <div className="mg-top"><b>{g.title}</b><span className="mg-pct">{Math.round(p.value * 100)}%</span></div>
                <div className="mg-bar"><i style={{ width: `${Math.round(p.value * 100)}%` }} /></div>
                <div className="mg-meta"><span>{p.text}</span></div>
              </div>
              {fix && (
                <button className="btn sm mg-go" title={help?.how} onClick={() => { if (fix.run) store.act((x) => fix.run!(x, store.geo)); else if (fix.open) fix.open(); else if (fix.tab) store.setTab(fix.tab); }}>
                  {fix.run ? 'Do it' : 'Go'}
                </button>
              )}
            </li>
          );
        })}
        {goals.length === 0 && <li className="faint">Every objective is complete. Set your own course.</li>}
      </ol>

    </section>
  );
}
