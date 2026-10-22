/**
 * The mission card (desktop): what you are playing for, at a glance. The nation's ambition and the act of its story you
 * are in, then the three current objectives with progress, reward and a one-tap way to work on each. Everything here
 * is also in the Goals tab; this is the short version that is always on screen.
 */
import { store } from '../../state/store';
import { activeGoals, goalsDoneCount } from '../../sim/goals';
import { PATH_LABEL, pathOf, type Path } from '../../sim/goals2';
import { actTitles, seedOf, storyChip } from '../../sim/story';
import { dateLabel } from '../../sim/tick';
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
  const st = c.story;
  const story = s.settings.storylines !== false;
  const act = st?.act ?? 1;
  const nextAct = story && act <= 4 ? actTitles(c)[act - 1] : null;
  const waiting = s.inbox.some((x) => x.id.startsWith('story'));
  const done = goalsDoneCount(s);
  const path = pathOf(s, c);
  const ambition = AMBITION[path.path](REGION[c.region] ?? 'its region') || seedOf(c).ambition;
  return (
    <section className="section mission desk-only">
      <div className="mission-head">
        <span className="mission-kicker">Your mission</span>
        <b className="mission-aim">Make {c.name} {ambition}</b>
        <span className="mission-path">Your path: <b>{PATH_LABEL[path.path]}</b> <span className="faint">({path.why})</span></span>
        {story && (
          <span className="mission-act">
            {storyChip(c) || 'Chapter I · act I of IV'}
            {nextAct && <> · next: <b>{nextAct.replace(/^Act [IV]+: /, '')}</b> {waiting ? <em className="mission-now">waiting in your decisions</em> : st && st.next > s.tick ? <span className="faint">around {dateLabel(st.next)}</span> : null}</>}
          </span>
        )}
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
                <div className="mg-meta"><span>{p.text}</span><span>🎁 {g.reward.replace('Reward: ', '')}</span></div>
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
      <div className="mission-foot faint">{done} objective{done === 1 ? '' : 's'} done · new ones are made for your path as you finish</div>
    </section>
  );
}
