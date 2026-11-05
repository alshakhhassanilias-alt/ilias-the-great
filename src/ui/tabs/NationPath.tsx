import { useState } from 'react';
import { store } from '../../state/store';
import { Section } from '../widgets';
import { actCancelProject, actStartProject, blocked, pathOf, type NatNode } from '../../sim/nations';
import { fmtMoney } from '../../sim/util';
import { factionMeta } from '../../sim/domestic';
import { dateLabel } from '../../sim/tick';
import { fundingText } from '../../sim/treasury';
import type { Country, FactionId } from '../../sim/types';

/** What a project does, in plain words. */
export function fxText(n: NatNode): string[] {
  const f = n.fx, out: string[] = [];
  const pc = (v: number) => `${v > 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(0)}%`;
  if (f.eff?.tfp) out.push(`Productivity ${f.eff.tfp > 0 ? '+' : '−'}${Math.abs(f.eff.tfp * 100).toFixed(2)}%/yr for good`);
  if (f.eff?.stab) out.push(`Stability +${f.eff.stab} for good`);
  if (f.eff?.accept) out.push(`Treaties easier (+${Math.round(f.eff.accept * 100)} pts)`);
  if (f.eff?.def && f.eff.def !== 1) out.push(`Defence ${pc(f.eff.def - 1)}`);
  if (f.eff?.off && f.eff.off !== 1) out.push(`Attack ${pc(f.eff.off - 1)}`);
  if (f.eff?.deter && f.eff.deter !== 1) out.push(`Enemies ${Math.round((1 - f.eff.deter) * 100)}% less keen to attack`);
  if (f.eff?.rep) out.push(`Reputation +${f.eff.rep}/yr`);
  if (f.stab) out.push(`Stability ${f.stab > 0 ? '+' : ''}${f.stab}`);
  if (f.rep) out.push(`Reputation ${f.rep > 0 ? '+' : ''}${f.rep}`);
  if (f.infra) out.push(`Infrastructure +${f.infra}`);
  if (f.tech) out.push(`Technology +${f.tech}`);
  if (f.milTech) out.push(`Military tech +${f.milTech}`);
  if (f.energy) out.push(`Energy ${pc(f.energy)}`);
  if (f.food) out.push(`Food ${pc(f.food)}`);
  if (f.capital) out.push(`Capital stock ${pc(f.capital)}`);
  if (f.labour) out.push(`Workforce ${pc(f.labour)}`);
  if (f.troops) out.push(`Troops ${pc(f.troops)}`);
  if (f.readiness) out.push(`Readiness +${Math.round(f.readiness * 100)}%`);
  if (f.cash) out.push(`${f.cash > 0 ? 'Windfall' : 'Cost'} ${Math.abs(f.cash * 100).toFixed(1)}% of GDP`);
  if (f.army || f.air || f.navy) out.push(`New equipment (${[f.army && 'army', f.air && 'air force', f.navy && 'navy'].filter(Boolean).join(', ')})`);
  if (f.nuclear) out.push('☢ Nuclear weapons');
  if (f.cb) out.push(`A cause for war against ${f.cb}`);
  for (const [n, v] of f.rel ?? []) out.push(`${n} ${v > 0 ? '+' : ''}${v}`);
  for (const [n, k] of f.treaty ?? []) out.push(`${k === 'trade' ? 'Trade deal' : k === 'coop' ? 'Military cooperation' : k} with ${n}`);
  return out;
}

function depthOf(nodes: NatNode[]) {
  const d = new Map<string, number>();
  const get = (n: NatNode): number => {
    if (d.has(n.id)) return d.get(n.id)!;
    const deps = [...(n.req ?? []), ...(n.any ?? [])].map((x) => nodes.find((y) => y.id === x)).filter(Boolean) as NatNode[];
    const v = deps.length ? 1 + Math.max(...deps.map(get)) : 0;
    d.set(n.id, v);
    return v;
  };
  nodes.forEach(get);
  return d;
}

export function NationPath() {
  const s = store.state!;
  const c: Country = s.countries[s.player];
  const path = pathOf(c);
  const [sel, setSel] = useState<string | null>(null);
  const depth = depthOf(path.nodes);
  const rows: NatNode[][] = [];
  for (const n of path.nodes) (rows[depth.get(n.id)!] ??= []).push(n);
  const act = c.nat?.active;
  const actNode = act ? path.nodes.find((n) => n.id === act.id) : undefined;
  const doneN = c.nat?.done.length ?? 0;
  const node = sel ? path.nodes.find((n) => n.id === sel) : undefined;
  return (
    <Section title={path.title} hint={`national path · ${doneN} of ${path.nodes.length} done`}>
      <p className="path-intro">{path.intro}</p>
      {actNode && act && (
        <div className="path-active">
          <span className="path-ic">{actNode.icon}</span>
          <div className="grow">
            <b>{actNode.title}</b> <span className="faint">· completes {dateLabel(act.until)}</span>
            <div className="path-prog"><i style={{ width: `${Math.min(100, (100 * (s.tick - act.start)) / Math.max(1, act.until - act.start))}%` }} /></div>
          </div>
          <button className="linkbtn" onClick={() => store.act((g) => actCancelProject(g))}>Abandon</button>
        </div>
      )}
      <div className="path-tree">
        {rows.map((r, i) => (
          <div className="path-row" key={i}>
            {r.map((n) => {
              const why = blocked(s, c, n);
              const st = c.nat?.done.includes(n.id) ? 'done' : act?.id === n.id ? 'active' : why && /Closed off/.test(why) ? 'closed' : why && /Needs [A-Z]/.test(why) && !/political capital/.test(why) ? 'locked' : 'open';
              return (
                <button key={n.id} className={`path-node ${st} ${sel === n.id ? 'sel' : ''}`} onClick={() => setSel(sel === n.id ? null : n.id)} title={n.desc}>
                  <span className="path-ic">{n.icon}</span>
                  <span className="path-t">{n.title}</span>
                  <small>{st === 'done' ? '✓ done' : st === 'active' ? '⏳ under way' : st === 'closed' ? '✗ closed' : `${n.weeks} wk · ${n.pc} PC`}</small>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {node && (() => {
        const why = blocked(s, c, node);
        const fac = Object.entries(node.fx.fac ?? {}) as [FactionId, number][];
        return (
          <div className="path-detail">
            <b>{node.icon} {node.title}</b>
            <p>{node.desc}</p>
            <div className="law-eff">{fxText(node).map((t, i) => <span key={i}>• {t}</span>)}</div>
            {fac.length > 0 && <div className="law-lean">{fac.map(([f, v]) => <span key={f} className={`chip-mini ${v > 0 ? 'good' : 'bad'}`}>{factionMeta(f).icon} {factionMeta(f).short} {v > 0 ? '+' : ''}{v}</span>)}</div>}
            {node.excl && <div className="faint" style={{ fontSize: 12 }}>Choosing this closes off: {node.excl.map((x) => path.nodes.find((y) => y.id === x)?.title).join(', ')}.</div>}
            <div className="btnrow">
              <button className="btn primary" disabled={!!why} onClick={() => { store.act((g) => actStartProject(g, node.id)); setSel(null); }}>
                {why ?? `Start · ${node.pc} PC${node.cost ? ` · ${fundingText(c, node.cost * c.eco.gdp)}` : ''} · ${node.weeks} weeks`}
              </button>
            </div>
          </div>
        );
      })()}
    </Section>
  );
}
