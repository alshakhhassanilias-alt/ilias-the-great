import { store } from '../state/store';
import { ctl, setControl } from '../sim/modes';
import type { ControlArea } from '../sim/types';
import { Segmented } from './widgets';

const TEXT: Record<ControlArea, { auto: string; guided: string; icon: string }> = {
  economy: { icon: '🏦', auto: 'Your ministers run taxes, spending and projects, aiming at the focus you set.', guided: 'The treasury sends you a budget proposal every quarter; approve or reject it in your inbox.' },
  military: { icon: '⚔', auto: 'Your generals pick the targets, recruit and equip the army. You still decide war and peace.', guided: 'You command your armies; the general staff handle recruitment, equipment and the defence budget.' },
  diplomacy: { icon: '🕊', auto: 'Your foreign ministry answers offers and opens trade with friendly neighbours. War, peace and alliances you ask for remain yours.', guided: 'Offers come to you to decide; your ministers flag the good ones.' },
};

/** Shown at the top of a tab when that area is delegated: what is happening, and how to take over. */
export function AutopilotBanner({ area }: { area: ControlArea }) {
  const s = store.state!;
  const level = ctl(s, area);
  if (level === 'hands') return null;
  const t = TEXT[area];
  const set = (l: 'auto' | 'guided' | 'hands') => store.act((g) => setControl(g, area, l));
  return (
    <div className={`autopilot ${level}`}>
      <div className="ap-head"><span aria-hidden="true">{t.icon}</span><b>{level === 'auto' ? 'On autopilot' : 'Guided'}</b><small>{t[level]}</small></div>
      {area === 'economy' && level === 'auto' && (
        <div className="ap-focus"><span>Focus</span>
          <Segmented<'growth' | 'stability' | 'military'> value={s.settings.econFocus ?? 'growth'} onChange={(v) => store.mutate((g) => { g.settings.econFocus = v; })} options={[{ v: 'growth', label: 'Growth' }, { v: 'stability', label: 'Stability' }, { v: 'military', label: 'Defence' }]} />
        </div>
      )}
      <div className="ap-btns">
        {level === 'auto' && <button className="btn" onClick={() => set('guided')}>Let them propose</button>}
        <button className="btn primary" onClick={() => set('hands')}>Take personal control</button>
      </div>
    </div>
  );
}
