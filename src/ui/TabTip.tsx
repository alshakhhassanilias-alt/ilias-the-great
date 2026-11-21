/**
 * The first time you open each of your own tabs, two sentences on what it is for and the one thing to do there first.
 * Read once, then gone (they can be brought back from the menu by replaying the walkthrough).
 */
import { prefs, setPrefs } from '../prefs';
import { usePrefs } from './SystemScreens';
import { Glyph } from './art/Glyphs';
import { WALK_STEPS } from './Walkthrough';
import { sfx } from '../audio';
import type { Tab } from '../state/store';

const TIPS: Partial<Record<Tab, { icon: string; title: string; text: string; first: string }>> = {
  overview: { icon: 'clipboard', title: 'The Overview', text: 'Your mission in the world power race, your desk of things to do (each with a priced button), and the rivals you are measured against.', first: 'Work down your desk, most urgent first.' },
  politics: { icon: 'scale', title: 'Politics', text: 'Your coalition and what each partner demands, political capital, the factions and their moods, parliament and the laws.', first: 'Keep your partners’ demands on track, then spend capital on a law you need.' },
  goals: { icon: 'target', title: 'Goals', text: 'Your objectives (they follow the way you play), your national storyline and, in a scenario, its three stars.', first: 'Pick the objective you can finish soonest; it pays capital.' },
  research: { icon: 'flask', title: 'Research', text: 'Five ladders of technology. Each rung has lasting effects; some steps make you choose between two roads for good.', first: 'Choose a branch that fits this year’s focus.' },
  economy: { icon: 'factory', title: 'The Economy', text: 'Industries on world markets, megaprojects, and the budget: taxes, spending and debt. Detail sections are folded: open them when you need them.', first: 'Start one industry expansion; keep the deficit small.' },
  military: { icon: 'shield', title: 'The Military', text: 'Your forces, their budget, recruitment and weapons programmes; in a war, the front, operations and the home front.', first: 'In peacetime, a modest budget is enough. Strength deters.' },
  diplomacy: { icon: 'olive', title: 'Diplomacy', text: 'Your place in the world, alliances and organisations, and your sphere of influence. Open another country for treaties, influence and pressure.', first: 'Click a neighbour on the map and open talks.' },
};

export function TabTip({ tab }: { tab: Tab }) {
  const p = usePrefs();
  const tip = TIPS[tab];
  if (!tip || p.tips.includes(tab) || (p.walk >= 0 && p.walk < WALK_STEPS)) return null;
  const close = () => { sfx('tick'); setPrefs({ tips: [...prefs.tips, tab] }); };
  return (
    <div className="tab-tip" role="note">
      <span className="tt-ic" aria-hidden="true"><Glyph name={tip.icon} size={18} /></span>
      <div>
        <b>{tip.title}</b>
        <p>{tip.text}</p>
        <div className="tt-first">{tip.first}</div>
        <button className="btn sm" onClick={close}>Got it</button>
      </div>
    </div>
  );
}
