/**
 * Development (Economy tab → Build): the four ladders of named projects, the energy mix, and what is under
 * construction. The old instant top-ups sit at the bottom.
 */
import type { ReactNode } from 'react';
import { store } from '../../state/store';
import { Section, Meter } from '../widgets';
import { fundingText } from '../../sim/treasury';
import { fmtMoney } from '../format';
import { RUNGS, SOURCES, TRACKS, actBuildRung, actBuildStation, devSlots, ensureDev, fuelBill, nextRung, rungById, stationOf, type Source } from '../../sim/develop';

const SRC_COL: Record<Source, string> = { coal: '#6f6458', gas: '#e0a040', nuclear: '#9a7cff', renew: '#5bd48c', fusion: '#ffe07a' };

export function DevelopmentSection({ quick }: { quick: ReactNode }) {
  const s = store.state!;
  const c = s.countries[s.player];
  const D = ensureDev(c);
  const e = c.eco;
  const slots = devSlots(c);
  const label = (id: string) => (id.startsWith('pow:') ? SOURCES.find((x) => x.id === id.slice(4))?.name ?? id : rungById(id)?.name ?? id);
  const icon = (id: string) => (id.startsWith('pow:') ? SOURCES.find((x) => x.id === id.slice(4))?.icon : rungById(id)?.icon) ?? '🏗';
  // the power you make, as shares of what you use: what was there at the start, and what you added by kind
  const added = (Object.values(D.mix) as number[]).reduce((t, v) => t + v, 0);
  const demand = Math.max(1, e.energyDemand);
  const base = Math.max(0, e.energyCap - added);
  const parts: { k: string; v: number; col: string; name: string }[] = [
    { k: 'base', v: base, col: '#3d4b5c', name: 'existing' },
    ...SOURCES.filter((x) => (D.mix[x.id] ?? 0) > 0).map((x) => ({ k: x.id, v: D.mix[x.id] ?? 0, col: SRC_COL[x.id], name: x.name })),
  ];
  const scale = Math.max(demand, e.energyCap);
  const fuel = fuelBill(s, c);
  return (
    <>
      <Section title="Under construction" hint={`${D.prog.length} of ${slots} building slots in use`}>
        {D.prog.length === 0 ? <p className="faint dev-empty">Nothing is being built. Pick a rung on a ladder below, or a power station.</p> : (
          <ul className="dev-prog">
            {D.prog.map((p) => (
              <li key={p.id}>
                <span className="dp-ic" aria-hidden>{icon(p.id)}</span>
                <span className="dp-body"><b>{label(p.id)}</b><Meter value={(s.tick - p.start) / Math.max(1, p.until - p.start)} color="var(--accent)" /></span>
                <span className="dp-left">{Math.max(0, p.until - s.tick)} wk</span>
              </li>
            ))}
          </ul>
        )}
        <p className="faint dev-note">Freight rail and industrial parks each add a building slot. Projects are paid when they start.</p>
      </Section>

      <Section title="⚡ The energy mix" hint={`you make ${Math.round((e.energyCap / demand) * 100)}% of the power you use${fuel > 0 ? ` · gas fuel ${fmtMoney(fuel)} a year` : ''}`}>
        <div className="dev-mix" aria-label="Power supply against demand">
          {parts.map((p) => <i key={p.k} title={`${p.name}: ${Math.round((p.v / demand) * 100)}% of demand`} style={{ width: `${(100 * p.v) / scale}%`, background: p.col }} />)}
          <u style={{ left: `${(100 * demand) / scale}%` }} title="what the country uses" />
        </div>
        <div className="dev-mix-key">{parts.map((p) => <span key={p.k}><i style={{ background: p.col }} />{p.name} {Math.round((p.v / demand) * 100)}%</span>)}<span className="faint">│ demand</span></div>
        <div className="dev-src">
          {SOURCES.map((src) => {
            const x = stationOf(c, src.id);
            return (
              <button key={src.id} className="dev-src-btn" disabled={!!x.why} title={x.why ?? src.desc} onClick={() => store.act((g) => actBuildStation(g, src.id))} style={{ ['--sc' as string]: SRC_COL[src.id] }}>
                <span className="ds-top"><span aria-hidden>{src.icon}</span><b>{src.name}</b><em>+{Math.round((x.add / demand) * 100)}%</em></span>
                <small>{src.desc}</small>
                <span className="ds-cost">{x.why ?? `${fundingText(c, x.cost)} · ${x.weeks} wk`}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <div className="dev-tracks">
        {TRACKS.map((t) => {
          const rungs = RUNGS.filter((r) => r.track === t.id);
          const nx = nextRung(c, t.id);
          const built = rungs.filter((r) => D.done.includes(r.id)).length;
          return (
            <section key={t.id} className="section dev-track">
              <h3><span aria-hidden>{t.icon}</span> {t.name}<small>{built}/{rungs.length} built</small></h3>
              <p className="faint dev-blurb">{t.blurb}</p>
              <ol className="dev-ladder">
                {rungs.map((r) => {
                  const done = D.done.includes(r.id);
                  const building = D.prog.some((p) => p.id === r.id);
                  const next = nx.rung?.id === r.id;
                  return (
                    <li key={r.id} className={done ? 'done' : building ? 'building' : next ? 'next' : 'later'}>
                      <span className="dl-ic" aria-hidden>{done ? '✓' : r.icon}</span>
                      <span className="dl-body">
                        <b>{r.name}</b>
                        <small>{r.effect}{!done && r.needs?.length ? ` · needs ${r.needs.map((n) => rungById(n)?.name).join(', ')}` : ''}</small>
                        {next && !building && (
                          <button className="btn sm" disabled={!!nx.why} title={nx.why ?? ''} onClick={() => store.act((g) => actBuildRung(g, t.id))}>
                            Build<small>{nx.why ?? `${fundingText(c, nx.cost)} · ${nx.weeks} weeks`}</small>
                          </button>
                        )}
                        {building && <em className="dl-wip">under construction</em>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
      {quick}
    </>
  );
}
