import { store } from '../state/store';

const STEPS: { title: string; body: string[] }[] = [
  { title: 'You run a country, in real time you control', body: [
    'The world starts on 1 January 2024 with real countries, real borders and approximate real data. Nothing waits in real life: every decision takes effect at once or at the next tick (one week of game time).',
    'Use the clock (bottom-left): ⏸ pause, ▶ normal, ▶▶ fast, ▶▶▶ very fast. Pause any time to think, make several moves, then resume. Space toggles pause.' ] },
  { title: 'Read the map', body: [
    'Click or tap a country to inspect it. Drag to pan, wheel or pinch to zoom. The map switch (top right) recolours the world: Political, Blocs (who is allied with whom), Relations (how they see you), Wealth, Power, Stability.',
    'Gold outline = you. Red = at war with you. Blue = your allies. Hatched stripes = land that was conquered and is not yet integrated.' ] },
  { title: 'Grow the economy', body: [
    'Economy tab: taxes bring revenue but very high rates hurt output. Spending buys services, infrastructure, industry and research. Projects (factories, power plants, farms, R&D) are built instantly.',
    'The "Why is the economy moving?" bars show exactly what drives growth. The Overview tab shows why stability is high or low. Keep debt, inflation and unemployment in check.' ] },
  { title: 'Deals change world politics', body: [
    'Every treaty has consequences: the partner\'s rivals condemn you, its friends welcome you, and sanction-busting or dealing with an enemy angers others. Before you propose, the Diplomacy tab previews the likely world reaction; afterwards a card reports what actually happened.',
    'Alliances form blocs. Rivals answer with counter-blocs. The World Assembly votes on resolutions and your vote shifts relations. You can guarantee a country\'s security, send aid, hold summits, mediate wars, or issue ultimatums.' ] },
  { title: 'War and the military', body: [
    'Armies fight region by region. Strength depends on troops, equipment quality, technology, readiness, supply distance, terrain, air and naval power, and fortifications. Build fortresses, airbases, ports, factories and barracks in your regions (click a region).',
    'Peace talks offer ceasefires, territory or concessions. If an ally is attacked you will be asked whether to honour the alliance. Rivals may send an ultimatum before attacking.' ] },
  { title: 'Things to do', body: [
    'Your advisor (Overview tab) suggests one-tap actions. Objectives give direction, and new ones appear as you complete them. Decision events pop up and pause the game. The news ticker (bottom) shows what the rest of the world is doing.',
    'There is no single right way to play: trader, peacemaker, bloc builder or conqueror. Press ☰ → How to play any time to read this again.' ] },
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  const i = Math.min(store.helpStep, STEPS.length - 1);
  const st = STEPS[i];
  const go = (d: number) => { store.helpStep = Math.max(0, Math.min(STEPS.length - 1, i + d)); store.notify(); };
  return (
    <div className="scrim" role="presentation" onClick={onClose}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-label="How to play" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>How to play · {i + 1}/{STEPS.length}</h2><button className="iconbtn" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          <h3 style={{ margin: '0 0 8px', fontSize: 17 }}>{st.title}</h3>
          {st.body.map((t, k) => <p key={k} style={{ lineHeight: 1.55, margin: '0 0 10px', fontSize: 14 }}>{t}</p>)}
          <div className="btnrow" style={{ marginTop: 12, gridTemplateColumns: '1fr 1fr 1fr' }}>
            <button className="btn" disabled={i === 0} onClick={() => go(-1)}>Back</button>
            <button className="btn" onClick={onClose}>{i === STEPS.length - 1 ? 'Close' : 'Skip'}</button>
            <button className="btn primary" onClick={() => (i === STEPS.length - 1 ? onClose() : go(1))}>{i === STEPS.length - 1 ? 'Start playing' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
