import { SPEEDS, store, useStore } from '../state/store';
import { dateLabel } from '../sim/tick';

export function TimeControls() {
  useStore();
  const s = store.state!;
  const labels = ['⏸', '▶', '▶▶', '▶▶▶'];
  return (
    <div className="timebox" role="group" aria-label="Time controls">
      <div className="date">{dateLabel(s.tick)}<small>{store.speed === 0 ? 'paused' : SPEEDS[store.speed].label.toLowerCase()}</small></div>
      <div className="speedrow">
        {SPEEDS.map((sp, i) => (
          <button key={sp.label} className={`${i === 0 ? 'pause' : ''} ${store.speed === i ? 'on' : ''}`} title={`${sp.label}${i ? ` (${i})` : ' (space)'}`} aria-label={sp.label} aria-pressed={store.speed === i}
            onClick={() => store.setSpeed(i)}>{labels[i]}</button>
        ))}
        <button title="Advance one week" aria-label="Advance one week" onClick={() => { store.setSpeed(0); store.stepOnce(); }}>+1w</button>
      </div>
    </div>
  );
}
