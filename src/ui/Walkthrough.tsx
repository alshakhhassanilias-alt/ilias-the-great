/**
 * The first-game walkthrough: a few short steps that point at the real interface (top bar, panel tabs, time,
 * decisions, map modes, diplomacy, saving). Some steps wait for the player to try the thing; every step can
 * be skipped, and the whole tour can be replayed from the menu.
 */
import { useEffect, useState } from 'react';
import { store, useStore } from '../state/store';
import { keyName, prefs, setPrefs } from '../prefs';
import { usePrefs } from './SystemScreens';

interface Step { target?: string; title: string; text: () => string; done?: () => boolean; hint?: string; place?: 'below' | 'left' | 'above' | 'center' }
const me = () => store.state!.countries[store.state!.player];
/** keyboard hints only where there is a keyboard */
const keys = (text: string) => (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? '' : text);
const STEPS: Step[] = [
  { title: 'Welcome to World Order', place: 'center', text: () => `You lead ${me().name}. There are no levels and no script: the world runs by itself, week by week, and reacts to everything you do. This short tour shows where things are. You can skip it at any time.` },
  { target: '.topbar .kpis', place: 'below', title: 'Your country at a glance', text: () => 'Political capital, treasury, economy, debt, inflation and stability. Hover over any number for what it means; numbers in red need attention.' },
  { target: '.side .tabs', place: 'left', title: 'Your government', text: () => `Overview, Politics, Goals, Economy, Military and Diplomacy. Each tab is a ministry.${keys(` Keys: ${keyName(prefs.keys.tabOverview)} ${keyName(prefs.keys.tabPolitics)} ${keyName(prefs.keys.tabGoals)} ${keyName(prefs.keys.tabEconomy)} ${keyName(prefs.keys.tabMilitary)} ${keyName(prefs.keys.tabDiplomacy)}.`)}` },
  { target: '.side .nc-traits, .side .section', place: 'left', title: 'What makes your country different', text: () => `Scroll the Overview to “National character”: ${me().name}'s traits and its long-running challenges. Open a challenge to see three ways to tackle it.` },
  { target: '.timebox', place: 'above', title: 'Time', text: () => `The game is paused. Press play${keys(` (or ${keyName(prefs.keys.pause)})`)} to let the weeks run; the arrows beside it set the speed. Try it now.`, done: () => store.speed > 0, hint: 'Press play to continue' },
  { target: '.inbox', place: 'above', title: 'Decisions', text: () => 'Decisions arrive here. They never stop the clock and lapse if you ignore them, so open them when you are ready. Urgent ones pause the game two weeks before they run out.' },
  { target: '.mapmodes-top', place: 'below', title: 'Read the map', text: () => 'Switch the map between political borders, blocs, relations with you, wealth, power and stability.' },
  { target: '.map-area', place: 'center', title: 'Meet the neighbours', text: () => 'Click any other country on the map to open its dossier: its leader, what it wants, and what you can do together (or against it) in its Diplomacy tab.', done: () => store.selected !== null && store.selected !== store.state!.player, hint: 'Click a country on the map' },
  { target: 'button[aria-label="Menu"]', place: 'below', title: 'Saving', text: () => `The game autosaves every ${prefs.autosaveMonths || 6} months of game time. ${keys(`${keyName(prefs.keys.quickSave)} quick saves, ${keyName(prefs.keys.quickLoad)} loads it. `)}The menu has named saves, settings and How to play. That is all: lead well.` },
];

export function Walkthrough() {
  useStore();
  const p = usePrefs();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = p.walk >= 0 && p.walk < STEPS.length ? STEPS[p.walk] : null;
  useEffect(() => {
    if (!step) return;
    const find = () => {
      const el = step.target ? (document.querySelector(step.target) as HTMLElement | null) : null;
      setRect(el && el.offsetParent !== null ? el.getBoundingClientRect() : null);
      if (step.done?.()) setPrefs({ walk: p.walk + 1 });
    };
    find();
    const id = window.setInterval(find, 300);
    return () => window.clearInterval(id);
  }, [step, p.walk]);
  if (!step || !store.state || store.preview) return null;
  // a target that is not on screen (e.g. no decision waiting yet): the step shows in the middle
  const r = step.place === 'center' && step.target !== '.map-area' ? null : rect;
  const W = 340;
  let left = window.innerWidth / 2 - W / 2, top = window.innerHeight / 2 - 110;
  if (r) {
    if (step.place === 'below') { left = r.left + r.width / 2 - W / 2; top = r.bottom + 14; }
    else if (step.place === 'above') { left = r.left + r.width / 2 - W / 2; top = r.top - 14 - 190; }
    else if (step.place === 'left') { left = r.left - W - 16; top = r.top + 20; }
    if (step.target === '.map-area') { left = r.left + r.width / 2 - W / 2; top = r.top + r.height * 0.18; }
  }
  left = Math.max(12, Math.min(window.innerWidth - W - 12, left));
  top = Math.max(12, Math.min(window.innerHeight - 220, top));
  const last = p.walk === STEPS.length - 1;
  const next = () => setPrefs({ walk: last ? 99 : p.walk + 1 });
  return (
    <div className="walk" aria-live="polite">
      {r && step.target !== '.map-area' && <div className="walk-ring" style={{ left: r.left - 6, top: r.top - 6, width: r.width + 12, height: r.height + 12 }} />}
      <div className="walk-card" role="dialog" aria-label={step.title} style={{ left, top, width: W }}>
        <div className="walk-step">{p.walk + 1} / {STEPS.length}</div>
        <h3>{step.title}</h3>
        <p>{step.text()}</p>
        <div className="walk-act">
          <button className="btn" onClick={() => setPrefs({ walk: 99 })}>Skip tour</button>
          {step.done && !step.done() ? <span className="walk-hint">{step.hint}</span> : null}
          <button className="btn primary" onClick={next}>{last ? 'Start playing' : step.done && !step.done() ? 'Skip step' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
