import type { ControlArea, ControlLevel } from '../sim/types';
import { CONTROL_PRESETS, presetOf } from '../sim/modes';

const AREAS: { id: ControlArea; label: string; icon: string; desc: Record<ControlLevel, string> }[] = [
  { id: 'economy', label: 'Economy', icon: '🏦', desc: { auto: 'Ministers run taxes, spending and projects toward your focus', guided: 'The treasury proposes budgets; you approve or reject', hands: 'Every tax, slider and project is yours' } },
  { id: 'military', label: 'Military', icon: '⚔', desc: { auto: 'Generals pick targets, recruit and equip', guided: 'You give your armies orders; staff handle recruitment', hands: 'Orders, recruitment, equipment, budget: all yours' } },
  { id: 'diplomacy', label: 'Diplomacy', icon: '🕊', desc: { auto: 'Ministers answer offers and open trade (never war or peace)', guided: 'Offers come to you, with advice', hands: 'Every treaty is your call' } },
];
const LEVELS: { v: ControlLevel; label: string }[] = [{ v: 'auto', label: 'Auto' }, { v: 'guided', label: 'Guided' }, { v: 'hands', label: 'Hands-on' }];

/** "How much do you want to steer?" — presets plus a per-area switch. */
export function ControlPicker({ value, onChange, compact }: { value: Record<ControlArea, ControlLevel>; onChange: (v: Record<ControlArea, ControlLevel>) => void; compact?: boolean }) {
  const preset = presetOf(value);
  return (
    <div className="ctl-picker">
      {!compact && (
        <div className="ctl-presets">
          {Object.entries(CONTROL_PRESETS).map(([k, p]) => (
            <button key={k} className={`ctl-preset ${preset === k ? 'on' : ''}`} onClick={() => onChange({ ...p.control })}>
              <b>{p.label}</b><small>{p.desc}</small>
            </button>
          ))}
        </div>
      )}
      <div className="ctl-rows">
        {AREAS.map((a) => (
          <div className="ctl-row" key={a.id}>
            <div className="ctl-lab"><span aria-hidden="true">{a.icon}</span> {a.label}<small>{a.desc[value[a.id]]}</small></div>
            <div className="seg" role="group" aria-label={`${a.label} control`}>
              {LEVELS.map((l) => <button key={l.v} className={value[a.id] === l.v ? 'on' : ''} onClick={() => onChange({ ...value, [a.id]: l.v })}>{l.label}</button>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
