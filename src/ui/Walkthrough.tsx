/**
 * First steps: the first-game walkthrough, presented by your chief of staff. It does not just point at the interface,
 * it has you do the core loop once while the clock is still stopped: read the top bar, plan the year, act from your
 * desk, choose research, expand an industry, look at your government and your rivals, then start time, answer a
 * decision and meet a neighbour. Each step opens the right tab, rings the right thing, and moves on by itself when
 * you have done it. Every step can be skipped; the whole tour can be replayed from the menu.
 */
import { useEffect, useState } from 'react';
import { store, useStore, type Tab } from '../state/store';
import { keyName, prefs, setPrefs } from '../prefs';
import { usePrefs } from './SystemScreens';
import { personName } from '../sim/leaders';
import { Portrait, faceFor } from './art/Portrait';
import { Glyph } from './art/Glyphs';
import { sfx } from '../audio';

interface Step {
  target?: string; title: string; icon: string; text: () => string;
  /** the step is complete (the walkthrough moves on by itself) */
  done?: () => boolean; hint?: string;
  place?: 'below' | 'left' | 'above' | 'center';
  /** what to open when the step begins */
  tab?: Tab;
}
const me = () => store.state!.countries[store.state!.player];
const keys = (text: string) => (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? '' : text);
const phone = () => typeof window !== 'undefined' && window.innerWidth <= 900;
/** what the player has done since the step began (counters kept by the store) */
let base = { acts: 0, laws: 0, prog: 0 };
const snap = () => { const c = me(); base = { acts: store.deskActs, laws: c.politics?.laws.length ?? 0, prog: c.ind?.prog?.length ?? 0 }; };

const STEPS: Step[] = [
  { title: 'Welcome to World Order', icon: 'globe', place: 'center', text: () => `You lead ${me().name}. The world runs by itself, week by week, and answers everything you do. The clock is stopped: let me show you how to govern in a few minutes. Skip whenever you like.` },
  { target: '.topbar .kpis', icon: 'eye', place: 'below', title: 'Your country at a glance', text: () => 'Your place in the world power race, political capital (what you spend on laws and reforms), the treasury, the economy and stability. Hover any number to see what drives it.' },
  { target: '.desk', icon: 'clipboard', place: 'left', tab: 'overview', title: 'Your desk', text: () => 'Everything that needs you sits here, most urgent first. Every item has one button that does it, with the price on the button. When in doubt, start here.' },
  { target: '.desk', icon: 'compass', place: 'left', tab: 'overview', title: 'Plan your year', text: () => 'First, decide what this year is for. Press "Plan the year" on your desk, pick a national focus (each is strong in one thing and costs you in another) and promise one objective. Keep the promise and you are rewarded.', done: () => !!me().focus, hint: 'Plan the year on your desk' },
  { target: '.desk', icon: 'check', place: 'left', tab: 'overview', title: 'Act from your desk', text: () => 'Now do one thing your coalition or your country needs: press any gold button. The price is on it; nothing is hidden.', done: () => store.deskActs > base.acts, hint: 'Press any gold button' },
  { target: '.rs-top', icon: 'flask', place: 'left', tab: 'research', title: 'Research', text: () => 'Your scientists climb five ladders of technology. Pick what they work on next by opening a branch; some steps make you choose between two roads for good.', done: () => (me().rs?.cur ?? -1) >= 0, hint: 'Choose what to research' },
  { target: '.ind-grid', icon: 'factory', place: 'left', tab: 'economy', title: 'Build industries', text: () => 'Eight industries compete on world markets. Expanding one takes months and money, then adds output, jobs and exports for good. Start one expansion.', done: () => (me().ind?.prog?.length ?? 0) > base.prog, hint: 'Expand an industry' },
  { target: '.coal-list, .side .section', icon: 'scale', place: 'left', tab: 'politics', title: 'Your government', text: () => 'You govern with partners. Each holds you to one demand with a deadline (they also appear on your desk). Keep them happy and they pay you in political capital; let them down twice and they walk out.' },
  { target: '.rivals', icon: 'sword', place: 'left', tab: 'overview', title: 'Your rivals', text: () => 'Two leaders measure themselves against you: the nation just above you in the power race, and your nemesis. Overtake them and the world notices.' },
  { target: '.timebox', icon: 'play', place: 'above', title: 'Start the clock', text: () => `Press play${keys(` (or ${keyName(prefs.keys.pause)})`)} to let the weeks run; the arrows set the speed. Every 1 January the State of the Nation stops the clock to grade your year.`, done: () => store.speed > 0, hint: 'Press play' },
  { target: '.inbox', icon: 'mic', place: 'above', title: 'Decisions', text: () => 'Decisions arrive here as the weeks pass. They never stop the clock; open them when you are ready. Urgent ones pause the game two weeks before they lapse.' },
  { target: '.map-area', icon: 'olive', place: 'center', title: 'Meet the neighbours', text: () => 'Click any other country on the map: its leader, what it wants, and what you can do together (or against it) in its Diplomacy tab.', done: () => store.selected !== null && store.selected !== store.state!.player, hint: 'Click a country on the map' },
  { target: 'button[aria-label="Menu"]', icon: 'key', place: 'below', title: 'You are ready', text: () => `The game saves itself every ${prefs.autosaveMonths || 6} months of game time.${keys(` ${keyName(prefs.keys.quickSave)} quick saves.`)} How to play in the menu explains everything in more depth. Lead well.` },
];
export const WALK_STEPS = STEPS.length;

export function Walkthrough() {
  useStore();
  const p = usePrefs();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cover, setCover] = useState(false);
  const step = p.walk >= 0 && p.walk < STEPS.length ? STEPS[p.walk] : null;
  useEffect(() => {
    if (!step || !store.state || store.preview) return;
    snap();
    if (step.tab) { store.select(store.state.player, null, false); store.setTab(step.tab); if (store.sheet === 'peek') store.setSheet('half'); }
    const find = () => {
      const el = step.target ? (document.querySelector(step.target) as HTMLElement | null) : null;
      setRect(el && el.offsetParent !== null ? el.getBoundingClientRect() : null);
      // a window over everything (the State of the Nation, a negotiation): wait behind it
      setCover(!!document.querySelector('.sotn, .modal.nego, .agenda-draft, .gazette-page'));
      if (step.done?.()) { sfx('tick'); setPrefs({ walk: p.walk + 1 }); }
    };
    find();
    // bring the thing into view once (a panel may have to scroll to it)
    const sc = window.setTimeout(() => { const el = step.target ? (document.querySelector(step.target) as HTMLElement | null) : null; if (el && step.place === 'left') el.scrollIntoView({ block: phone() ? 'nearest' : 'start', behavior: 'smooth' }); }, 180);
    const id = window.setInterval(find, 200);
    return () => { window.clearInterval(id); window.clearTimeout(sc); };
  }, [step, p.walk]);
  if (!step || !store.state || store.preview || cover) return null;
  const c = me();
  const chief = personName(c, 'chief', 1);
  const r = step.place === 'center' && step.target !== '.map-area' ? null : rect;
  const W = Math.min(360, window.innerWidth - 24);
  let left = window.innerWidth / 2 - W / 2, top = window.innerHeight / 2 - 130;
  if (r && !phone()) {
    if (step.place === 'below') { left = r.left + r.width / 2 - W / 2; top = r.bottom + 14; }
    else if (step.place === 'above') { left = r.left + r.width / 2 - W / 2; top = r.top - 14 - 230; }
    else if (step.place === 'left') { left = r.left - W - 16; top = Math.max(r.top + 10, 70); }
    if (step.target === '.map-area') { left = r.left + r.width / 2 - W / 2; top = r.top + r.height * 0.15; }
  }
  // on a phone the card sits at the top or the bottom of the screen, on the other side from what it points at
  const atBottom = phone() && !!r && r.top < window.innerHeight * 0.45;
  if (phone()) top = 64;
  left = Math.max(12, Math.min(window.innerWidth - W - 12, left));
  top = Math.max(12, Math.min(window.innerHeight - 250, top));
  const last = p.walk === STEPS.length - 1;
  const next = () => { sfx('click'); setPrefs({ walk: last ? 99 : p.walk + 1 }); };
  const waiting = step.done && !step.done();
  return (
    <div className="walk" aria-live="polite">
      {r && step.target !== '.map-area' && <div className="walk-ring" style={{ left: r.left - 6, top: r.top - 6, width: r.width + 12, height: Math.min(r.height + 12, window.innerHeight - r.top) }} />}
      <div className="walk-card" role="dialog" aria-label={step.title} style={atBottom ? { left, bottom: 'max(12px, env(safe-area-inset-bottom))', width: W } : { left, top, width: W }}>
        <div className="walk-head">
          <span className="walk-face"><Portrait f={faceFor(c, chief, 'minister')} size={44} title={chief} /><span className="walk-glyph"><Glyph name={step.icon} size={14} /></span></span>
          <div className="grow"><small className="walk-who">{chief} · chief of staff</small><h3>{step.title}</h3></div>
        </div>
        <p>{step.text()}</p>
        <div className="walk-dots" aria-label={`step ${p.walk + 1} of ${STEPS.length}`}>{STEPS.map((_, i) => <i key={i} className={i < p.walk ? 'done' : i === p.walk ? 'on' : ''} />)}</div>
        <div className="walk-act">
          <button className="btn" onClick={() => setPrefs({ walk: 99 })}>Skip tour</button>
          {waiting ? <span className="walk-hint">{step.hint}</span> : null}
          <button className="btn primary" onClick={next}>{last ? 'Start playing' : waiting ? 'Skip step' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
