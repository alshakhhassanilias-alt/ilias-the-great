/**
 * The war room: everything about one war on one screen. The toll (soldiers killed and wounded, civilians,
 * refugees), who is winning and how that changed, each side country by country, the fronts, and the war's story.
 */
import { useEffect } from 'react';
import { store, useStore } from '../state/store';
import { warScore } from '../sim/war';
import { dateLabel } from '../sim/tick';
import { Emblem } from './art/Emblem';
import { Tween } from './Tween';
import type { CountryId, GameState, War, WarRecord } from '../sim/types';

const big = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));
const dur = (weeks: number) => (weeks < 9 ? `${weeks} weeks` : weeks < 104 ? `${Math.round(weeks / 4.33)} months` : `${(weeks / 52).toFixed(1)} years`);

/** Casualties over time (two lines) and the war score (a band) from the war's 4-weekly history. */
function WarChart({ hist, aName, dName }: { hist: number[][]; aName: string; dName: string }) {
  if (hist.length < 2) return <div className="faint wr-nochart">The chart fills in as the war goes on.</div>;
  const W = 520, H = 150, pad = 4;
  const t0 = hist[0][0], t1 = hist[hist.length - 1][0] || t0 + 1;
  const maxC = Math.max(1, ...hist.map((h) => Math.max(h[1], h[2])));
  const x = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * pad);
  const y = (v: number) => H - pad - (v / maxC) * (H - 2 * pad - 18);
  const line = (k: 1 | 2) => hist.map((h, i) => `${i ? 'L' : 'M'}${x(h[0]).toFixed(1)},${y(h[k]).toFixed(1)}`).join('');
  const ys = (v: number) => H / 2 - (v / 100) * (H / 2 - pad);
  const score = `M${x(t0)},${H / 2}` + hist.map((h) => `L${x(h[0]).toFixed(1)},${ys(h[3]).toFixed(1)}`).join('') + `L${x(t1)},${H / 2}Z`;
  return (
    <svg className="wr-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Casualties and war score over time">
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="wr-mid" />
      <path d={score} className="wr-score" />
      <path d={line(1)} className="wr-l wr-la" />
      <path d={line(2)} className="wr-l wr-ld" />
      <text x={pad + 2} y={12} className="wr-tx">casualties: <tspan className="wr-ta">{aName}</tspan> · <tspan className="wr-td">{dName}</tspan> · band: war score</text>
    </svg>
  );
}

function SideCol({ s, ids, label, cls, w }: { s: GameState; ids: CountryId[]; label: string; cls: string; w: War | null }) {
  const total = w ? ids.reduce((t, c) => t + (w.casualties[c] ?? 0), 0) : 0;
  return (
    <div className={`wr-side ${cls}`}>
      <div className="wr-side-h">{label}<b>{big(total)}</b><small>military casualties</small></div>
      {ids.map((id) => {
        const c = s.countries[id];
        if (!c) return null;
        const cas = w?.casualties[id] ?? 0;
        return (
          <button className="wr-c" key={id} onClick={() => store.select(id, null, true)}>
            <Emblem c={c} size={30} crest={false} />
            <div className="grow">
              <b>{c.name}{id === s.player ? ' (you)' : ''}</b>
              <small>{big(cas)} lost · {big(c.mil.troops)} under arms · {w?.taken?.[id] ? `${w.taken[id]} regions taken · ` : ''}exhaustion {Math.round(c.mil.exhaustion * 100)}%</small>
              <div className="wr-ex"><i style={{ width: `${Math.round(c.mil.exhaustion * 100)}%` }} /></div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function WarRoom() {
  useStore();
  const s = store.state;
  const sel = store.warRoom;
  useEffect(() => { store.hold('the war room', !!sel); return () => store.hold('the war room', false); }, [sel]);
  if (!s || !sel) return null;
  const close = () => { store.warRoom = null; store.notify(); };
  const w = sel.past ? null : s.wars.find((x) => x.id === sel.id) ?? null;
  const rec: WarRecord | undefined = sel.past ? s.warHistory?.find((x) => x.id === sel.id) : undefined;
  if (!w && !rec) return null;
  const atk = w ? w.attackers : rec!.atk ?? [rec!.a], def = w ? w.defenders : rec!.def ?? [rec!.b];
  const A = s.countries[atk[0]], D = s.countries[def[0]];
  const start = w ? w.start : rec!.start, end = w ? s.tick : rec!.end;
  const mil = w ? Object.values(w.casualties).reduce((a, b) => a + b, 0) : rec!.casA + rec!.casB;
  const civ = w ? Object.values(w.civ ?? {}).reduce((a, b) => a + b, 0) : rec!.civ ?? 0;
  const disp = w ? w.displaced ?? 0 : rec!.displaced ?? 0;
  const score = w ? warScore(s, w, atk[0]) : rec!.winner === 'a' ? 0.6 : rec!.winner === 'b' ? -0.6 : 0;
  const hist = (w ? w.hist : rec!.hist) ?? [];
  const verdict = score > 0.25 ? `${A.name} is winning` : score < -0.25 ? `${D.name} is winning` : Math.abs(score) < 0.08 ? 'A stalemate' : score > 0 ? `${A.name} has the edge` : `${D.name} has the edge`;
  const ids = new Set([...atk, ...def]);
  const story = s.log.filter((l) => l.tick >= start && l.tick <= end && (l.kind === 'war' || l.kind === 'territory' || l.kind === 'peace') && l.countries.some((c) => ids.has(c))).slice(-14).reverse();
  const fronts = w ? [...w.fronts].sort((a, b) => b.progress - a.progress).slice(0, 8) : [];
  const geo = store.geo;
  return (
    <div className="scrim" role="presentation" onClick={close}>
      <div className="modal warroom" role="dialog" aria-label={`War room: ${w?.name ?? rec!.name}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>⚔ {w?.name ?? rec!.name}</h2><button className="iconbtn" aria-label="Close" onClick={close}>✕</button></div>
        <div className="modal-body">
          <div className="wr-top">
            <span>{dateLabel(start)} – {w ? 'today' : dateLabel(end)} · {dur(end - start)}{w ? ` · ${w.fronts.length} active fronts` : ` · ended: ${rec!.terms.replace('_', ' ')}`}</span>
            <span className="wr-verdict">{w ? verdict : rec!.winner === 'draw' ? 'No clear winner' : `${(rec!.winner === 'a' ? A : D).name} prevailed`}</span>
          </div>
          <div className="wr-toll">
            <div><b><Tween value={mil} format={big} /></b><small>soldiers killed and wounded</small></div>
            <div><b><Tween value={civ} format={big} /></b><small>civilian deaths</small></div>
            <div><b><Tween value={disp} format={big} /></b><small>people forced from their homes</small></div>
            <div><b>{big(mil + civ)}</b><small>total human cost</small></div>
          </div>
          <div className="wr-tug" title="War score: territory taken and lost, and casualties inflicted">
            <span>{A.name}</span>
            <div className="wr-tugbar"><i className="a" style={{ width: `${50 + score * 50}%` }} /><em style={{ left: `${50 + score * 50}%` }} /></div>
            <span>{D.name}</span>
          </div>
          <WarChart hist={hist} aName={A.name} dName={D.name} />
          <div className="wr-sides">
            <SideCol s={s} ids={atk} label="Attackers" cls="atk" w={w} />
            <SideCol s={s} ids={def} label="Defenders" cls="def" w={w} />
          </div>
          {!w && rec && <div className="faint" style={{ fontSize: 12 }}>Military losses: {A.name} {big(rec.casA)}, {D.name} {big(rec.casB)} · regions {rec.provsA >= 0 ? '+' : ''}{rec.provsA} / {rec.provsB >= 0 ? '+' : ''}{rec.provsB}</div>}
          {fronts.length > 0 && (
            <>
              <h4 className="wr-h">The fronts</h4>
              <div className="wr-fronts">
                {fronts.map((f) => {
                  const by = s.countries[f.by], owner = s.countries[s.owner[f.prov]];
                  return (
                    <button className="wr-front" key={`${f.prov}-${f.by}`} onClick={() => { store.select(s.owner[f.prov], f.prov, true); close(); }}>
                      <span><b>{geo.provinces[f.prov]?.name || owner?.name}</b> <small>{by.name} attacks {owner?.name}{f.amphibious ? ' · from the sea' : ''}{f.pocket ? ' · ⭕ encircled' : ''}</small></span>
                      <div className="wr-prog"><i style={{ width: `${Math.round(f.progress * 100)}%` }} /></div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {story.length > 0 && (
            <>
              <h4 className="wr-h">How the war has gone</h4>
              <div className="wr-story">{story.map((l) => <div key={l.seq}><span>{dateLabel(l.tick)}</span>{l.text}</div>)}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
