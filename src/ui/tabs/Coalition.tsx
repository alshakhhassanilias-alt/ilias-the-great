/**
 * Your government (Politics tab): the coalition partners (or the regime's pillars), what each of them demands and by
 * when, your majority, and the cost of bringing a faction in or showing one the door.
 */
import { store } from '../../state/store';
import { Section, Meter } from '../widgets';
import { FACTIONS, factionMeta, moodColor, moodLabel } from '../../sim/domestic';
import { INVITE_PC, actDropPartner, actInvite, demandDef, demandProgress, ensureCoalition, isDemocracy, minority, seatsOf } from '../../sim/coalition';

export function CoalitionSection() {
  const s = store.state!;
  const c = s.countries[s.player];
  const G = ensureCoalition(s, c);
  const P = c.politics;
  if (!G || !P) return null;
  const demo = isDemocracy(c);
  const seats = seatsOf(c, G.partners);
  const minor = minority(c);
  const outside = FACTIONS.filter((f) => !G.partners.includes(f.id));
  return (
    <Section title={demo ? 'Your government' : 'The power base'} hint={demo ? `${seats.toFixed(0)}% of seats · ${minor ? 'MINORITY' : 'majority'}` : `${G.partners.length} of 3 pillars`}>
      <p className="faint coal-intro">
        {demo ? 'Your government rests on a coalition. Each partner holds you to one demand with a deadline: deliver it and they stay loyal and pay you in political capital; miss it twice and they walk out. Lose your majority and laws get harder, approval falls and a vote of confidence can bring the government down.'
          : 'Your rule rests on the factions that really matter. Each holds you to a demand; let them down and they turn on you. Lose two pillars and the regime itself is in danger.'}
      </p>
      {demo && (
        <div className="coal-seats" aria-label="Seats held by the government">
          {P.factions.map((f) => <i key={f.id} title={`${factionMeta(f.id).name} ${f.support.toFixed(0)}%`} style={{ width: `${f.support}%`, background: factionMeta(f.id).color, opacity: G.partners.includes(f.id) ? 1 : 0.25 }} />)}
          <span className="coal-half" />
        </div>
      )}
      {minor && <div className="note bad" style={{ margin: '6px 0' }}>Minority government: laws need 10 more points of support, political capital comes in slower, approval −3, and a confidence vote comes {G.nextVote ? `in ${Math.max(0, G.nextVote - s.tick)} weeks` : 'soon'}. Bring a faction into government to win back a majority.</div>}
      <div className="coal-list">
        {G.partners.map((f) => {
          const fac = P.factions.find((x) => x.id === f)!;
          const d = G.demands.find((x) => x.f === f);
          const def = d ? demandDef(d.id) : null;
          const p = d ? demandProgress(s, c, d) : 0;
          const pat = G.patience[f] ?? 2;
          return (
            <div key={f} className="coal-card" style={{ ['--fc' as string]: factionMeta(f).color }}>
              <div className="coal-head">
                <span aria-hidden="true">{factionMeta(f).icon}</span>
                <b className="grow">{factionMeta(f).name}</b>
                <span className="coal-mood" style={{ color: moodColor(fac.mood) }}>{moodLabel(fac.mood)}</span>
                <span className="coal-pat" title="patience: missed demands left before they walk out">{'●'.repeat(Math.max(0, pat))}{'○'.repeat(Math.max(0, 3 - pat))}</span>
              </div>
              {d && def ? (
                <>
                  <div className="coal-dem"><span>{def.text(d, c)}</span><small className={d.due - s.tick < 13 ? 'bad' : 'faint'}>{Math.max(0, d.due - s.tick)} wk left</small></div>
                  <Meter value={p} color={p >= 1 ? 'var(--green)' : 'var(--fc)'} />
                  <small className="faint">Where: {def.where}{def.below ? ' · must hold until the deadline' : ''}</small>
                </>
              ) : <small className="faint">No demand on the table right now.</small>}
              <button className="linkbtn coal-drop" onClick={() => store.act((g) => actDropPartner(g, f))}>{demo ? 'Drop from the coalition' : 'Sideline them'} (5 capital)</button>
            </div>
          );
        })}
      </div>
      {outside.length > 0 && (
        <div className="coal-out">
          <small className="faint">{demo ? 'Outside the government' : 'Outside the circle'}:</small>
          {outside.map((f) => {
            const fac = P.factions.find((x) => x.id === f.id)!;
            const ok = fac.mood >= 35 && P.pc >= INVITE_PC;
            return <button key={f.id} className="btn sm" disabled={!ok} title={fac.mood < 35 ? 'They will not join a government they despise (mood below 35)' : ''} onClick={() => store.act((g) => actInvite(g, f.id))}>{f.icon} Invite {f.short}<small>{demo ? `${fac.support.toFixed(0)}% seats · ` : ''}{INVITE_PC} capital · they bring a demand</small></button>;
          })}
        </div>
      )}
      <small className="faint">Demands kept {G.kept ?? 0} · missed {G.broken ?? 0}</small>
    </Section>
  );
}
