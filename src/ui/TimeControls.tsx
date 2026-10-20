import { useEffect, useRef } from 'react';
import { SPEEDS, store, useStore } from '../state/store';
import { dateLabel } from '../sim/tick';
import { crisisById, crisisLeft } from '../sim/crises';

export function TimeControls() {
  useStore();
  const s = store.state!;
  const labels = ['⏸', '▶', '▶▶', '▶▶▶', '⏩'];
  // the decision list stacks above the clock; it needs the clock's real height (a crisis adds a line)
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--timebox-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="timebox" role="group" aria-label="Time controls">
      <div className="date">{dateLabel(s.tick)}<small className={store.heldBy && store.speed ? 'held' : ''}>{store.speed === 0 ? 'paused' : store.heldBy ? `held: reading ${store.heldBy}` : SPEEDS[store.speed].label.toLowerCase()}</small></div>
      {s.crisis && (() => { const d = crisisById(s.crisis.id); return <div className={`crisis-chip ${d.id === 'boom' ? 'good' : ''}`} title={d.blurb}>{d.icon}<span className="t"> {d.title} ·</span> {crisisLeft(s)} wk</div>; })()}
      <div className="speedrow">
        {SPEEDS.map((sp, i) => (
          <button key={sp.label} className={`${i === 0 ? 'pause' : ''} ${store.speed === i ? 'on' : ''}`} title={`${sp.label}: ${sp.hint}${i ? ` (key ${i})` : ' (space)'}`} aria-label={sp.label} aria-pressed={store.speed === i}
            onClick={() => store.setSpeed(i)}>{labels[i]}</button>
        ))}
        <button title="Advance one week" aria-label="Advance one week" onClick={() => { store.setSpeed(0); store.stepOnce(); }}>+1w</button>
      </div>
    </div>
  );
}
