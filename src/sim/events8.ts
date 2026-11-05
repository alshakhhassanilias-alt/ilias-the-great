/** Decisions born of the reconciliation process (detente.ts): how you answer an incident staged by hardliners. */
import type { EventDef } from './eventkit';
import { answerIncident, INCIDENTS, trackOf } from './detente';

export const EVENTS8: EventDef[] = [
  {
    id: 'detente_incident', icon: '⚠', title: 'Sabotage of the talks', weight: 0, cooldown: 0, ttl: 8, eligible: () => null,
    text: (s, _c, d) => {
      const T = s.countries[d.them], tk = trackOf(s, d.them);
      if (!T) return 'Hardliners strike while the talks are under way. Your hardliners want a response; your negotiators want calm.';
      return `Hardliners in ${T.name} strike while the talks are under way: ${INCIDENTS[d.k] ?? 'an ugly incident'}. Trust stands at ${Math.round(tk?.trust ?? 0)}/100. ${T.leader ? `${T.leader.name} has not said a word yet.` : ''} Your hardliners want a response; your negotiators want calm.`;
    },
    options: [
      { label: 'Condemn it and keep talking', hint: 'trust −4 · nationalists unhappy', apply: (s, _c, d) => answerIncident(s, d.them, 'talk') },
      { label: 'Retaliate', hint: 'trust −20 (the talks may collapse) · stability +1 · nationalists pleased · relations −6', apply: (s, _c, d) => answerIncident(s, d.them, 'retaliate') },
      { label: 'Demand a public apology', hint: 'a gamble: they apologise (trust +6) or refuse (trust −12)', apply: (s, _c, d) => answerIncident(s, d.them, 'apology') },
    ],
    lapse: (s, _c, d) => answerIncident(s, d.them, 'talk'),
  },
];
