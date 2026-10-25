import { useState, type ReactElement } from 'react';
import { store } from '../../state/store';
import { Section } from '../widgets';
import { Portrait, faceFor } from '../art/Portrait';
import { FACTIONS, LAWS, PERK, REVOLT, actPassLaw, actRepealLaw, clout, factionMeta, factionTarget, forecast, hasLaw, lawById, moodColor, moodLabel, pcIncome, type Law } from '../../sim/domestic';
import { arcById } from '../../sim/arcs';
import { approval } from '../../sim/approval';
import { CoalitionSection } from './Coalition';
import { LeverList } from './Levers';
import { RegimeSection } from './Regime';
import { dateLabel } from '../../sim/tick';
import type { Country, FactionId } from '../../sim/types';

const ORDER: FactionId[] = ['labour', 'liberals', 'regions', 'business', 'nationalists', 'military'];

/** A parliament of 100 seats in a half circle, coloured by faction; with a law selected, the "no" seats dim. */
function Hemicycle({ c, yesBy }: { c: Country; yesBy?: Record<string, number> }) {
  const P = c.politics!;
  const rows = 5, seats: { x: number; y: number; a: number }[] = [];
  const radii = Array.from({ length: rows }, (_, r) => 46 + r * 11);
  const tot = radii.reduce((t, r) => t + r, 0);
  radii.forEach((r) => {
    const n = Math.round((100 * r) / tot);
    for (let i = 0; i < n; i++) { const a = Math.PI - (Math.PI * (i + 0.5)) / n; seats.push({ x: 100 + r * Math.cos(a), y: 104 - r * Math.sin(a), a }); }
  });
  seats.sort((p, q) => q.a - p.a);
  const counts = ORDER.map((id) => ({ id, n: Math.round(P.factions.find((f) => f.id === id)!.support) }));
  let k = 0;
  const out: ReactElement[] = [];
  for (const { id, n } of counts) {
    const yes = yesBy ? Math.round(n * (yesBy[id] ?? 0)) : n;
    for (let i = 0; i < n && k < seats.length; i++, k++) {
      const s = seats[k], on = i < yes;
      out.push(<circle key={k} cx={s.x} cy={s.y} r={3.6} fill={on ? factionMeta(id).color : 'rgba(40,30,25,.9)'} stroke={on ? 'rgba(0,0,0,.35)' : factionMeta(id).color} strokeWidth={on ? 0.6 : 1} />);
    }
  }
  return <svg className="hemicycle" viewBox="0 0 200 110" role="img" aria-label="Parliament">{out}<line x1="100" y1="40" x2="100" y2="106" stroke="rgba(255,255,255,.18)" strokeDasharray="2 3" /></svg>;
}

export function PoliticsTab() {
  const s = store.state!;
  const c = s.countries[s.player];
  const P = c.politics;
  const [sel, setSel] = useState<string | null>(null);
  const [whip, setWhip] = useState(0);
  const [cat, setCat] = useState<string>('all');
  if (!P) return null;
  const appr = approval(s, c);
  const inc = pcIncome(s, c, appr);
  const mode = c.gov === 'D' ? 'Parliamentary democracy: laws need a majority' : c.gov === 'F' ? 'Hybrid regime: parliament usually does what it is told' : 'Rule by decree: no vote, but decrees cost more and anger liberals';
  const law = sel ? lawById(sel) : undefined;
  const fc = law ? forecast(c, law, whip) : null;
  const arc = P.arc ? arcById(P.arc.id) : undefined;
  const cats = ['all', ...new Set(LAWS.map((l) => l.cat))];
  const open = (l: Law) => { setSel(sel === l.id ? null : l.id); setWhip(0); };
  return (
    <>
      <CoalitionSection />
      <Section title="Political capital" hint={mode}>
        <div className="pc-card">
          <div className="pc-big"><b>{Math.floor(P.pc)}</b><small>/ 100</small></div>
          <div className="pc-why">
            <div className="pc-bar"><i style={{ width: `${P.pc}%` }} /></div>
            <div className="faint" style={{ fontSize: 12 }}>{inc.v >= 0 ? '+' : ''}{inc.v.toFixed(2)} a week ({Math.round(inc.v * 52)} a year): {inc.parts.map((p) => `${p.label} ${p.v >= 0 ? '+' : ''}${p.v.toFixed(2)}`).join(' · ')}</div>
            <div className="faint" style={{ fontSize: 12 }}>Spend it on laws, reforms, deals with angry factions and crisis responses. Signing treaties (+2, alliances +4) and meeting objectives (+6) earn it too.</div>
            {P.pc >= 99 && <div className="pc-full">Full: what you earn from now on is wasted. Pass a law (below), start a national project (<button className="linkish" onClick={() => store.setTab('goals')}>Goals</button>) or change a doctrine (<button className="linkish" onClick={() => store.setTab('overview')}>Overview</button>).</div>}
          </div>
        </div>
        <LeverList kind="pc" />
      </Section>

      {arc && P.arc && (
        <Section title="Crisis" hint={`stage ${P.arc.stage} of ${arc.stages}`}>
          <div className="card crisis-card">
            <b>{arc.icon} {arc.title}</b>
            <div className="arc-steps">{Array.from({ length: arc.stages }, (_, i) => <i key={i} className={i < P.arc!.stage ? 'on' : ''} />)}</div>
            <div className="faint" style={{ fontSize: 12 }}>{P.arc.next ? `Next development around ${dateLabel(P.arc.next.at)}. What you chose decides what comes.` : 'A decision is waiting in your inbox.'}</div>
          </div>
        </Section>
      )}

      <Section title="The factions" hint="their mood drives stability, approval and your elections">
        {P.unrest && s.tick < P.unrest.until && <div className="card hot" style={{ marginBottom: 8 }}><b>🔥 {factionMeta(P.unrest.f).name}: {REVOLT[P.unrest.f]}</b><div className="faint" style={{ fontSize: 12 }}>Until {dateLabel(P.unrest.until)}. It costs you every week.</div></div>}
        <div className="factions">
          {ORDER.map((id) => {
            const f = P.factions.find((x) => x.id === id)!;
            const m = factionMeta(id);
            const tg = factionTarget(s, c, f);
            const trend = tg.target - f.mood;
            return (
              <div className="faction" key={id} style={{ ['--fc' as string]: m.color }}>
                <Portrait f={faceFor(c, f.leader, id === 'military' ? 'general' : 'minister')} size={46} title={f.leader} />
                <div className="fac-main">
                  <div className="fac-top"><b>{m.icon} {m.name}</b><span className="faint">{f.support.toFixed(0)}% · clout ×{clout(c, id).toFixed(1)}</span></div>
                  <div className="fac-mood"><div className="fac-bar"><i style={{ width: `${f.mood}%`, background: moodColor(f.mood) }} /></div><em style={{ color: moodColor(f.mood) }}>{moodLabel(f.mood)} {Math.abs(trend) > 2 ? (trend > 0 ? '▲' : '▼') : ''}</em></div>
                  <div className="fac-why">
                    <span className="faint">{f.leader} · wants {m.wants}.</span>
                    {tg.parts.slice(0, 3).map((p, i) => <span key={i} className={`chip-mini ${p.v > 0 ? 'good' : 'bad'}`}>{p.label} {p.v > 0 ? '+' : ''}{p.v.toFixed(0)}</span>)}
                  </div>
                  {f.mood >= 75 && <div className="fac-note good">Happy: {PERK[id]}</div>}
                  {f.mood < 28 && <div className="fac-note bad">Furious: risk of {REVOLT[id]}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={c.gov === 'D' ? 'Parliament' : c.gov === 'F' ? 'Parliament (managed)' : 'The council'} hint={law ? `${law.title}: ${fc!.mode === 'decree' ? 'by decree' : `${Math.round(fc!.yes * 100)}% expected yes`}` : 'seats by faction'}>
        <Hemicycle c={c} yesBy={fc && fc.mode !== 'decree' ? Object.fromEntries(fc.by.map((b) => [b.id, b.p + (fc.yes - fc.by.reduce((t, x) => t + (x.seats / 100) * x.p, 0))])) : undefined} />
        <div className="hemi-legend">{ORDER.map((id) => <span key={id}><i style={{ background: factionMeta(id).color }} />{factionMeta(id).short}</span>)}</div>
      </Section>

      <Section title="Laws" hint={`${P.laws.length} in force`}>
        {P.laws.length > 0 && (
          <div className="laws-in">
            {P.laws.map((l) => { const L = lawById(l.id)!; return (
              <div className="law-in" key={l.id}><span>{L.icon} <b>{L.title}</b> <span className="faint">since {dateLabel(l.since)}</span></span><button className="btn" onClick={() => store.act((g) => actRepealLaw(g, l.id))}>Repeal ({Math.round(L.pc / 2)} PC)</button></div>
            ); })}
          </div>
        )}
        <div className="chips law-cats">{cats.map((k) => <button key={k} className={`pill ${cat === k ? 'gold' : ''}`} onClick={() => setCat(k)}>{k === 'all' ? 'All' : k}</button>)}</div>
        <div className="laws">
          {LAWS.filter((l) => !hasLaw(c, l.id) && (cat === 'all' || l.cat === cat)).map((l) => {
            const blocked = l.excl && hasLaw(c, l.excl) ? `Repeal the ${lawById(l.excl)!.title} first` : l.req?.(c) ?? null;
            const isSel = sel === l.id;
            const f = isSel ? fc! : forecast(c, l, 0);
            const total = f.cost + (isSel ? whip : 0);
            return (
              <div className={`law ${isSel ? 'open' : ''}`} key={l.id}>
                <button className="law-head" onClick={() => open(l)} aria-expanded={isSel}>
                  <span className="law-ic">{l.icon}</span>
                  <span className="grow"><b>{l.title}</b><small>{l.desc}</small></span>
                  <span className="law-cost">{f.cost} PC<small>{f.mode === 'decree' ? 'decree' : `${Math.round(f.yes * 100)}% yes`}</small></span>
                </button>
                {isSel && (
                  <div className="law-body">
                    <div className="law-eff">{l.pros.map((p, i) => <span key={i} className="good">✓ {p}</span>)}{l.cons.map((p, i) => <span key={i} className="bad">✗ {p}</span>)}</div>
                    <div className="law-lean">{FACTIONS.filter((x) => l.lean[x.id]).map((x) => <span key={x.id} className={`chip-mini ${(l.lean[x.id] ?? 0) > 0 ? 'good' : 'bad'}`}>{x.icon} {x.short} {(l.lean[x.id] ?? 0) > 0 ? '+' : ''}{l.lean[x.id]}</span>)}</div>
                    {f.mode !== 'decree' && (
                      <>
                        <div className="vote-bar"><i style={{ width: `${f.yes * 100}%` }} /><span style={{ left: '50%' }} /></div>
                        <div className="faint" style={{ fontSize: 12 }}>Expected: <b className={f.yes >= 0.55 ? 'good' : f.yes >= 0.5 ? '' : 'bad'}>{Math.round(f.yes * 100)}% yes</b> (a majority needs 50%; votes can swing by ±3%). Factions: {f.by.map((b) => `${factionMeta(b.id).short} ${Math.round(b.p * 100)}%`).join(' · ')}</div>
                        <label className="whip">Whip the vote: <b>+{whip} PC</b> (+{(whip * 0.8).toFixed(0)}% yes)<input type="range" min={0} max={30} step={2} value={whip} onChange={(e) => setWhip(Number(e.target.value))} /></label>
                      </>
                    )}
                    <div className="btnrow">
                      <button className="btn primary" disabled={!!blocked || P.pc < total} onClick={() => { store.act((g) => actPassLaw(g, l.id, whip)); setSel(null); setWhip(0); }}>
                        {blocked ?? (P.pc < total ? `Needs ${total} PC (you have ${Math.floor(P.pc)})` : f.mode === 'decree' ? `Sign the decree (${total} PC)` : `Put it to a vote (${total} PC)`)}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>
      <RegimeSection />
    </>
  );
}
