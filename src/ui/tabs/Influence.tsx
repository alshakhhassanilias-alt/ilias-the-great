/**
 * Influence (Diplomacy tab): who holds sway in a country and what you can do about it; and, in your own tab, your
 * sphere, the countries you nearly hold, and the great powers' spheres.
 */
import { store } from '../../state/store';
import { Section, Meter } from '../widgets';
import { fmtMoney } from '../format';
import { fundingText } from '../../sim/treasury';
import { nextRand } from '../../sim/rng';
import { INF_ACTIONS, clientsOf, doInfluence, patronOf, quoteAction, sphereDividend, standings } from '../../sim/influence';
import { nationalColor } from '../../map/palette';

export function InfluenceSection({ id }: { id: number }) {
  const s = store.state!;
  const t = s.countries[id], me = s.countries[s.player];
  const st = standings(s, id).slice(0, 5);
  const ph = patronOf(s, id);
  const mine = st.find((x) => x.id === s.player);
  const lead = st[0];
  const gap = lead && lead.id !== s.player ? lead.v - (mine?.v ?? 0) : 0;
  return (
    <Section title={`Influence in ${t.name}`} hint={ph ? `in ${ph.patron === s.player ? 'your' : `${s.countries[ph.patron].name}'s`} sphere` : 'no one’s sphere'}>
      <p className="faint inf-intro">
        {ph?.patron === s.player ? `${t.name} is in your sphere: it votes with you in the Assembly, favours your treaties and pays you about ${fmtMoney(0.0015 * t.eco.gdp)} a year in contracts. Keep your lead: rivals are always buying.`
          : ph ? `${s.countries[ph.patron].name} holds ${t.name} in its sphere. To pull it out you need the most influence there, 40% of the total and 1.4 times the next power.`
            : `Whoever holds the most influence here (at least 30 points, 40% of the total, 1.4 times the next) brings ${t.name} into their sphere.`}
      </p>
      <div className="inf-bars">
        {st.length === 0 && <div className="faint">No foreign power has any real influence here yet.</div>}
        {st.map((x) => (
          <div key={x.id} className={`inf-row ${x.id === s.player ? 'me' : ''}`}>
            <span className="inf-name"><i style={{ background: nationalColor(s.countries[x.id]) }} />{x.id === s.player ? 'You' : s.countries[x.id].name}</span>
            <Meter value={x.share} color={x.id === s.player ? 'var(--accent)' : nationalColor(s.countries[x.id])} />
            <b>{x.v.toFixed(0)}</b>
          </div>
        ))}
      </div>
      {gap > 0 && <div className="faint" style={{ fontSize: 12, margin: '4px 0' }}>{s.countries[lead.id].name} leads you by {gap.toFixed(0)} points.</div>}
      <div className="inf-acts">
        {INF_ACTIONS.map((a) => {
          const q = quoteAction(s, me, t, a.id);
          return (
            <button key={a.id} className="btn" disabled={!!q.why} title={q.why ?? a.desc} onClick={() => store.act((g) => doInfluence(g, g.player, id, a.id, nextRand(g)))}>
              {a.icon} {a.label}
              <small>{q.why ?? `${q.cost ? fundingText(me, q.cost) : ''}${q.cost && q.pc ? ' · ' : ''}${q.pc ? `${q.pc} political capital` : ''}${!q.cost && !q.pc ? 'it pays for itself' : ''}${q.p !== undefined ? ` · ${Math.round(q.p * 100)}% safe` : ''} · ${a.desc}`}</small>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

/** Your sphere of influence, the countries within reach, and the great powers' spheres. */
export function SphereSection() {
  const s = store.state!;
  const P = s.player;
  const clients = clientsOf(s, P);
  const near = s.countries.filter((c) => c.alive && c.id !== P && !clients.includes(c.id)).map((c) => {
    const st = standings(s, c.id);
    const i = st.findIndex((x) => x.id === P);
    return { c, i, v: i >= 0 ? st[i].v : 0, lead: st[0] };
  }).filter((x) => x.i >= 0 && x.i <= 1 && x.v >= 12).sort((a, b) => b.v - a.v).slice(0, 6);
  const powers = s.countries.filter((c) => c.alive && c.id !== P).map((c) => ({ c, n: clientsOf(s, c.id).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 5);
  return (
    <Section title="Your sphere of influence" hint={`${clients.length} client${clients.length === 1 ? '' : 's'}${clients.length ? ` · ${fmtMoney(sphereDividend(s, P))} a year` : ''}`}>
      {clients.length ? (
        <div className="inf-chips">{clients.map((id) => <button key={id} className="chip" onClick={() => store.select(id, null, true)}>{s.countries[id].name}</button>)}</div>
      ) : <p className="faint inf-intro">No country is in your sphere yet. Select one on the map and use the Influence section of its Diplomacy tab: investment, aid, arms, culture or backing a party. Small neighbours are the easiest to win; the great powers are buying too.</p>}
      {near.length > 0 && (
        <>
          <h4 className="inf-sub">Within reach</h4>
          <ul className="inf-near">{near.map((x) => <li key={x.c.id}><button className="linkbtn" onClick={() => store.select(x.c.id, null, true)}>{x.c.name}</button> <span className="faint">{x.i === 0 ? `you lead (${x.v.toFixed(0)}) but not by enough` : `${x.v.toFixed(0)} vs ${s.countries[x.lead.id].name} ${x.lead.v.toFixed(0)}`}</span></li>)}</ul>
        </>
      )}
      {powers.length > 0 && <div className="faint inf-powers">Great-power spheres: {powers.map((x) => `${x.c.name} ${x.n}`).join(' · ')}. See them all on the Spheres map.</div>}
    </Section>
  );
}
