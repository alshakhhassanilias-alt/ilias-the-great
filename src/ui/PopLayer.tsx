/** Short-lived feedback over the screen: "−$12B", "✓ Done", "✕ Not now", rising and fading where you clicked. */
import { store, useStore } from '../state/store';

export function PopLayer() {
  useStore();
  if (!store.pops.length) return null;
  return (
    <div className="pop-layer" aria-hidden="true">
      {store.pops.map((p) => <span key={p.id} className={`fx-pop ${p.tone}`} style={{ left: p.x, top: p.y }}>{p.text}</span>)}
    </div>
  );
}
