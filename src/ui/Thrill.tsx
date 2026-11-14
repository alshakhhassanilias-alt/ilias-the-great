/**
 * The pulse of the game on screen: the map jolts when you are hit, the edge of the screen glows and your heart
 * beats when you are in danger, the biggest moments take the whole screen, and an election is a night of counting,
 * not a line in the news. What triggers each of them is decided in thrill.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { store, useStoreSelect } from '../state/store';
import { prefs } from '../prefs';
import { sfx } from '../audio';
import { countAt, dangerOf } from '../thrill';
import { Portrait } from './art/Portrait';
import { leaderFace } from './LookEditor';

const still = () => prefs.calm || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
const restart = (el: HTMLElement, cls: string) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

/** the map jolts and the screen flashes: red when you are struck, white-hot for an explosion, gold for a triumph */
export function ImpactLayer() {
  const seq = useStoreSelect(() => store.jolt?.seq ?? 0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const j = store.jolt, el = ref.current;
    if (!j || !seq || !el) return;
    const p = Math.min(1.6, j.power);
    el.style.setProperty('--p', String(p));
    el.className = `impact ${j.kind}`;
    restart(el, 'on');
    if (!still() && j.kind !== 'glory') {
      const m = document.querySelector<HTMLElement>('.map-area');
      if (m) { m.style.setProperty('--shake', `${(2 + 6 * p).toFixed(1)}px`); restart(m, 'shake'); }
    }
    if (j.kind !== 'glory' && p >= 0.6) sfx(j.kind === 'alarm' ? 'siren' : 'impact', p * 60);
  }, [seq]);
  return <div ref={ref} className="impact" aria-hidden="true" />;
}

/** danger you can feel: a red glow breathing at the edge of the screen, your own heartbeat under it, and the reason */
export function DangerPulse() {
  const key = useStoreSelect(() => { const s = store.state; return s && !store.preview ? `${s.tick}|${s.inbox.length}|${s.wars.length}` : ''; });
  const running = useStoreSelect(() => store.speed > 0 && store.drawer.open === 'none' && !store.election);
  const d = useMemo(() => (store.state && key ? dangerOf(store.state) : { level: 0, why: '' }), [key]);
  const on = d.level >= 0.35;
  const period = Math.round(1150 - 520 * d.level);
  useEffect(() => {
    if (d.level < 0.6 || !running) return;
    const beat = () => sfx('heart', (d.level - 0.6) * 250);
    const id = window.setInterval(beat, period);
    return () => window.clearInterval(id);
  }, [d.level >= 0.6, period, running]);
  if (!on) return null;
  return (
    <>
      <div className={`danger-vig ${d.level >= 0.6 ? 'hot' : ''}`} aria-hidden="true" style={{ ['--d' as string]: d.level.toFixed(2), ['--beat' as string]: `${period}ms` }} />
      {d.level >= 0.5 && d.why && <div className="danger-why desk-only" role="status"><i />{d.why}</div>}
    </>
  );
}

/** three seconds that belong to one moment: black bars close in, the word lands */
export function CineBanner() {
  const seq = useStoreSelect(() => store.cine?.seq ?? 0);
  const c = store.cine;
  if (!c || !seq) return null;
  return (
    <div key={seq} className={`cine ${c.tone} ${still() ? 'still' : ''}`} role="alert">
      <i className="cine-bar top" /><i className="cine-bar bot" />
      <div className="cine-mid">
        <div className="cine-kicker">{c.kicker}</div>
        <div className="cine-title" data-t={c.title}>{c.title}</div>
        {c.sub && <div className="cine-sub">{c.sub.length > 150 ? `${c.sub.slice(0, 148)}…` : c.sub}</div>}
      </div>
    </div>
  );
}

const NIGHT = 9000;
/** election night: the boxes come in, the lead swings, and only at the end do you know */
export function ElectionNight() {
  const seq = useStoreSelect(() => store.election?.seq ?? 0);
  const [p, setP] = useState(0);
  const t0 = useRef(0);
  const rolled = useRef(false);
  const called = useRef(false);
  useEffect(() => {
    if (!seq) return;
    setP(0); rolled.current = false; called.current = false;
    t0.current = performance.now();
    const quick = still();
    let raf = 0, lastTick = 0;
    const step = (now: number) => {
      // the count crawls at the end, when it matters
      const u = Math.min(1, (now - t0.current) / (quick ? 1200 : NIGHT));
      const q = u < 0.6 ? u * 1.25 : 0.75 + 0.25 * (1 - Math.pow(1 - (u - 0.6) / 0.4, 1.6));
      setP(q);
      if (now - lastTick > 95 && q < 1) { lastTick = now; sfx('count', Math.floor(q * 60)); }
      if (!rolled.current && u > 0.72) { rolled.current = true; sfx('roll'); }
      if (u < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const hb = window.setInterval(() => { if (!called.current) sfx('heart', 60); }, 720);
    return () => { cancelAnimationFrame(raf); window.clearInterval(hb); };
  }, [seq]);
  const e = store.election, s = store.state;
  const done = p >= 1;
  useEffect(() => {
    if (!done || !e || called.current) return;
    called.current = true;
    sfx(e.won ? 'victory' : 'defeat');
    store.shake(e.won ? 'glory' : 'hit', 1.2);
    store.notify();
  }, [done, e]);
  const regions = useMemo(() => {
    if (!e || !s) return [];
    const out: { name: string; at: number; share: number }[] = [];
    const seen = new Set<string>();
    let h = (e.seq * 2654435761) >>> 0;
    const rnd = () => ((h = (Math.imul(h, 1664525) + 1013904223) >>> 0) / 4294967296);
    const mine = store.geo.provinces.map((pr, i) => ({ pr, i })).filter(({ pr, i }) => s.owner[i] === s.player && !!pr.name);
    for (let n = 0; n < 40 && out.length < 6 && mine.length; n++) {
      const pick = mine[Math.floor(rnd() * mine.length)].pr.name!;
      if (seen.has(pick)) continue;
      seen.add(pick);
      out.push({ name: pick, at: 0.12 + out.length * 0.14 + rnd() * 0.05, share: Math.min(92, Math.max(8, e.share + (rnd() - 0.5) * 22)) });
    }
    return out;
  }, [seq]);
  if (!e || !s || !seq) return null;
  const L = s.legacy;
  const c = s.countries[s.player];
  const now = done ? e.share : countAt(e.share, p, e.seq);
  const lead = now - 50;
  const close = Math.abs(lead) < 2.2;
  const name = L?.leader ?? 'You';
  const call = done ? (e.won ? (e.free ? 'RE-ELECTED' : 'CONFIRMED IN POWER') : (e.free ? 'DEFEATED' : 'OUSTED')) : close ? 'TOO CLOSE TO CALL' : lead > 0 ? (L?.leader ? `${name.split(' ').slice(-1)[0].toUpperCase()} LEADS` : 'YOU LEAD') : (e.free ? 'THE OPPOSITION LEADS' : 'THE PLOTTERS LEAD');
  const skip = () => { t0.current = -1e9; };
  return (
    <div className="scrim night-scrim" role="dialog" aria-label={e.free ? 'Election night' : 'The party congress votes'} onClick={done ? undefined : skip}>
      <div className={`night ${done ? (e.won ? 'won' : 'lost') : close ? 'close' : ''}`} onClick={(ev) => { if (done) ev.stopPropagation(); }}>
        <div className="night-kicker"><i className="live" />{e.free ? 'Election night' : 'The congress votes'} · {c.name}</div>
        <div className={`night-call ${done ? 'final' : ''}`} key={done ? 'f' : call}>{call}</div>
        <div className="night-race">
          <div className="night-heads">
            <div className="night-side me"><Portrait f={leaderFace(s)} size={72} title={name} /><div><b>{name}</b><span className="night-num">{now.toFixed(1)}<small>%</small></span></div></div>
            <div className="night-side them"><div><b>{e.free ? 'The opposition' : 'The rival faction'}</b><span className="night-num">{(100 - now).toFixed(1)}<small>%</small></span></div></div>
          </div>
          <div className="night-bar"><i className="a" style={{ width: `${now}%` }} /><i className="b" style={{ width: `${100 - now}%` }} /><u /></div>
        </div>
        <div className="night-count"><div className="night-prog"><i style={{ width: `${p * 100}%` }} /></div><span>{Math.round(p * 100)}% {e.free ? 'of the vote counted' : 'of delegates have voted'}</span></div>
        <ul className="night-regions">
          {regions.map((r) => {
            const inn = p >= r.at;
            return <li key={r.name} className={inn ? (r.share >= 50 ? 'in up' : 'in down') : ''}><span>{r.name}</span><b>{inn ? `${r.share.toFixed(0)}–${(100 - r.share).toFixed(0)}` : 'counting…'}</b></li>;
          })}
        </ul>
        {done
          ? <button className="btn primary" autoFocus onClick={() => store.closeElection()}>{e.won ? 'Read the morning paper' : 'Face the morning'}</button>
          : <small className="night-skip">click to skip the count</small>}
      </div>
    </div>
  );
}
