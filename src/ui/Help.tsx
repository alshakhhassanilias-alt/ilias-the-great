import { store } from '../state/store';

const STEPS: { title: string; body: string[] }[] = [
  { title: 'You run a country, in real time you control', body: [
    'The world starts on 1 January 2024 with real countries, real borders and approximate real data. Nothing waits in real life: every decision takes effect at once or at the next tick (one week of game time).',
    'Use the clock (bottom-left): ⏸ pause, ▶ slow (a year in ~1m45s), ▶▶ normal, ▶▶▶ fast, ⏩ very fast. Start slow, pause any time to think, then resume. Space toggles pause; keys 1-4 pick a speed (1 slow, 2 normal, 3 fast, 4 very fast); + and − zoom the map. Big news about you slows fast-forward down automatically.' ] },
  { title: 'Two ways to play', body: [
    '🌍 Sandbox: the open world. Play as long as you like and set the start (today, a world depression, a new cold war, détente), random events, nuclear weapons and an end year in World options.',
    '📜 Legacy: a political career. You serve terms of four years. At the start of each term pick up to three promises from five agenda cards; keeping them grows your legacy. Eight weeks before each vote a campaign begins; lose and you lead the opposition (or go into exile) and can fight your way back. Two failed comebacks, retirement or the end of the era close the career and history writes its verdict (grade S to F). The 👑 chip in the top bar opens your legacy.',
    'How much you do yourself is your choice, in both modes and at any time (Settings): Economy, Military and Diplomacy can each be on Auto (your ministers run it), Guided (they propose, you decide) or Hands-on.' ] },
  { title: 'Politics at home', body: [
    'Political capital (top bar) is the currency of power. It trickles in every week, faster when you are popular and your cabinet is loyal, and you spend it on laws, doctrine reforms, deals with angry factions and crisis responses. You can never afford everything.',
    'Six factions (Unions, Business, the Military, Nationalists, Liberals, the Regions) watch everything you do: the budget, the economy, wars and the laws you pass. Their mood moves stability, approval and elections. Happy factions give you perks; furious ones strike, riot, pull their money out or plot a coup. Open the Politics tab to see each faction, its leader and exactly why it feels the way it does.',
    'Laws go to parliament in a democracy: you see the expected vote faction by faction and can whip extra votes with political capital. Autocracies rule by decree, at a higher price. Crises unfold in stages (a banking crisis, a border standoff, a coup plot, a separatist movement): what you choose at each stage decides what comes next.' ] },
  { title: 'Your country\'s own road', body: [
    'Every country has a national path in the Goals tab. Twenty major countries have their own: China\'s Taiwan question, Germany\'s debt brake, Iran\'s choice between the bomb and a deal, Poland as NATO\'s eastern bastion, and more. Everyone else gets a path that fits their situation. Run one project at a time: it costs political capital and money and takes weeks, then changes the country for good. Some choices close off others.',
    'AI countries follow their own paths too, so the world changes around you: navies get built, deals get signed, nuclear thresholds get crossed.' ] },
  { title: 'War and the world', body: [
    'When a war starts you declare its aim: a limited war, a total war, or defending and restoring your borders. You are judged on it when the war ends. Wartime brings its own decisions: sieges, volunteers, atrocity reports, mediators, arms offers with strings attached, anti-war marches, heroes and saboteurs.',
    'Weapons programmes (Military tab) permanently change how you fight: drones, air defence, missile brigades (which unlock strikes on the enemy\'s economy), armour, a navy squadron, cyber command, special forces, a national reserve.',
    'The world pushes back. Wars of aggression and conquered regions raise your aggression score. If it gets too high, your neighbours form a coalition that sanctions you and joins any war you start against one of them. Great powers also arm the side they favour in other people\'s wars.' ] },
  { title: 'Your cabinet and the world\'s leaders', body: [
    'Four ministers run your departments: Finance, Foreign Affairs, Defence and Interior. Each has a face, a trait (Technocrat, Hardliner, Fixer, Ambitious...) and a skill of 1 to 5 stars that changes your numbers. Their briefing on the Overview tab tells you what is going on with real figures; tap a minister for details, to win them over, or to replace them with one of three candidates.',
    'Loyalty rises and falls with your popularity. Fixers cause scandals, ambitious ministers plot, the Treasury and the generals fight over money, and a minister pushed too far resigns in public. Decisions arrive on the desk of the minister in charge, who tells you what they would do.',
    'Foreign leaders have faces and personalities too. When you sign, refuse, sanction or invade, they answer in a diplomatic cable. Reply warmly (relations +4) or firmly (stability +1, relations -4).' ] },
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
    'Watch the front move: contested regions fall cell by cell in the attacker\'s colour, the red line shows where the fighting is, and army counters show divisions and their strength. Click a ⚔ marker for the battle report (odds, terrain, forts, air power, losses) and actions such as air strikes or digging in.',
    'Supply lines: armies are fed from your capital, big cities, 📦 supply hubs and open ports. The deeper you push, the weaker the attack, so build a supply hub near the front. Cut an enemy region off from every hub and it is ENCIRCLED: its defenders fight at half strength.',
    'Army groups (Military on Guided or Hands-on): your field forces form 3 to 6 armies, shown as banners on the map. Drag a banner onto an enemy region to make it the objective (or onto your own region to hold it), or click it to set its order: ➤ Advance, ⭕ Encircle (pincers, +25% against cut-off regions), ⚡ Raid (half the losses, wrecks their economy), 🛡 Hold (dig in) or 🏛 Defend capital. Each army has a commander and a share of the troops. On Auto the generals run the war themselves.',
    'Generals lead your offensives: each has a trait (Blitz, Fortress, Logistician, Encircler, Gunner, Inspiring) and earns stars by fighting. Assign them in the Military tab. Click an enemy region for special operations: ⚓ naval invasions and 🪂 airborne assaults behind the lines; if your land is occupied, arm the partisans.',
    'War support (top bar while at war): victories and defending your homeland raise it; casualties and a long war wear it down. Low support lowers morale and stability. Use propaganda, war bonds or censorship in the Military tab.',
    'Peace talks offer ceasefires, territory or concessions. If an ally is attacked you will be asked whether to honour the alliance. Rivals may send an ultimatum before attacking.' ] },
  { title: 'Things to do', body: [
    'The Goals tab holds your objectives and a check-up of your country. How much help you get depends on difficulty: full guides with one-tap fixes on Easy, a few hints on Normal, none on Hard. Decisions wait in a small inbox on the map and never stop the clock; open one when you are ready. The news ticker (bottom) shows what the rest of the world is doing.',
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
