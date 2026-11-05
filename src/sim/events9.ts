/** Decisions born of the long run of history (epochs.ts): a region that wants to leave you, a neighbour that wants to unite. */
import type { EventDef } from './eventkit';
import { rep, stab } from './eventkit';
import { breakAway, bidBlock, unionReady, unite } from './epochs';
import { geoRefGet } from './geoRef';
import { placeName } from './places';
import { spendPC, sway } from './domestic';
import { addRelation } from './relations';
import { declareWar } from './war';
import { nextRand } from './rng';
import { clamp } from './util';

const pcOf = (c: { politics?: { pc: number } }) => c.politics?.pc ?? 0;

export const EVENTS9: EventDef[] = [
  {
    id: 'independence_bid', icon: '🏳', title: 'A region wants to leave', weight: 0, cooldown: 0, ttl: 30, eligible: () => null,
    text: (s, c, d) => {
      const n = d.n | 0, where = placeName(d.p0);
      const who = d.k >= 0 ? `the old nation of ${s.countries[d.k]?.name ?? 'their fathers'}, swallowed by ${c.name} long ago` : 'a country of their own';
      return `Crowds fill the squares of ${where}: ${n} region${n === 1 ? '' : 's'} on our far side want ${who}. Their leaders have declared a provisional government and ask the world to recognise it. Stability stands at ${Math.round(c.eco.stability)}. History is watching how we answer.`;
    },
    options: [
      { label: 'Let them go in peace', hint: 'They become independent · reputation +6 · stability −3 · they stay friendly', apply: (s, c, d) => { const geo = geoRefGet(); const X = breakAway(s, geo, c, bidBlock(s, geo, { k: d.k, p0: d.p0 }), { revive: d.k >= 0 ? d.k : undefined, peaceful: true }); rep(c, 6); stab(c, -3); sway(c, 'liberals', 6); sway(c, 'nationalists', -12); if (X) addRelation(s, c.id, X.id, 30); return X ? `${X.name} is born. Its first act is a treaty of friendship with us.` : 'The movement melted away before anything was signed.'; } },
      { label: 'Hold a referendum', hint: 'A fair vote: the less integrated and the shakier the country, the likelier they leave', apply: (s, c, d) => {
        const geo = geoRefGet(); const block = bidBlock(s, geo, { k: d.k, p0: d.p0 });
        const integ = block.length ? block.reduce((t, p) => t + s.integ[p], 0) / block.length : 1;
        const leave = 0.25 + 0.4 * (1 - integ) + (c.eco.stability < 40 ? 0.2 : 0) + (d.k >= 0 ? 0.15 : 0);
        rep(c, 4);
        if (nextRand(s) < leave) { const X = breakAway(s, geo, c, block, { revive: d.k >= 0 ? d.k : undefined, peaceful: true }); if (X) addRelation(s, c.id, X.id, 20); return X ? `They voted to leave. ${X.name} is independent.` : 'The vote was close; nothing changed.'; }
        for (const p of block) s.integ[p] = clamp(s.integ[p] + 0.3, 0, 1);
        stab(c, 3); s.stats.indepBid = s.tick + 20 * 52; return 'They voted to stay. The question is settled for a generation.';
      } },
      { label: 'Grant wide autonomy', hint: 'Costs 15 political capital · regions +10 · nationalists −8 · the movement calms', enabled: (_s, c) => pcOf(c) >= 15, why: () => 'Needs 15 political capital', apply: (s, c, d) => { spendPC(c, 15); sway(c, 'regions', 10); sway(c, 'nationalists', -8); for (const p of bidBlock(s, geoRefGet(), { k: d.k, p0: d.p0 })) s.integ[p] = clamp(s.integ[p] + 0.4, 0, 1); s.stats.indepBid = s.tick + 12 * 52; return 'They have their own parliament now, and stay.'; } },
      { label: 'Crush the movement', hint: 'Stability −6 · reputation −8 · 35%: they rise anyway and fight a war of independence', apply: (s, c, d) => {
        stab(c, -6); rep(c, -8); sway(c, 'nationalists', 8); sway(c, 'liberals', -12);
        if (nextRand(s) < 0.35) { const geo = geoRefGet(); const X = breakAway(s, geo, c, bidBlock(s, geo, { k: d.k, p0: d.p0 }), { revive: d.k >= 0 ? d.k : undefined, peaceful: true }); if (X) { addRelation(s, c.id, X.id, -70); declareWar(s, geo, X.id, c.id, 'a war of independence'); return `The crackdown failed. ${X.name} declares independence and takes up arms: you can fight to win it back, or make peace.`; } }
        s.stats.indepBid = s.tick + 10 * 52; return 'The leaders are in prison. The anger is not.';
      } },
    ],
    lapse: (s, c, d) => { const geo = geoRefGet(); const X = breakAway(s, geo, c, bidBlock(s, geo, { k: d.k, p0: d.p0 }), { revive: d.k >= 0 ? d.k : undefined, peaceful: true }); stab(c, -4); return X ? `With no answer from the capital, ${X.name} simply declared independence.` : 'The moment passed.'; },
  },
  {
    id: 'union_offer', icon: '🤝', title: 'An offer to unite', weight: 0, cooldown: 0, ttl: 30, eligible: () => null,
    text: (s, c, d) => {
      const O = s.countries[d.o];
      if (!O?.alive) return 'The talks of union have ended.';
      return `After decades as the closest of allies, ${O.name}${O.leader ? `, led by ${O.leader.name},` : ''} proposes that our two countries become one. Their ${Math.round(O.eco.pop / 1e6)} million people and their economy would join ours under our government; their parliament asks for a new name for the union. Many on both sides dream of it; others fear losing who they are.`;
    },
    options: [
      { label: 'Unite under a new name', hint: 'Their land, people, army and debts join you · reputation +4 · a new name for the union', apply: (s, c, d) => { const O = s.countries[d.o]; if (!O?.alive || !unionReady(s, c, O)) return 'The moment passed: the conditions for union are gone.'; unite(s, geoRefGet(), c, O); rep(c, 4); stab(c, 4); return `${c.name} is born.`; } },
      { label: 'Unite, keeping our name', hint: 'They join us as they are · their nationalists sulk (stability −2)', apply: (s, c, d) => { const O = s.countries[d.o]; if (!O?.alive || !unionReady(s, c, O)) return 'The moment passed: the conditions for union are gone.'; unite(s, geoRefGet(), c, O, c.name); stab(c, -2); return `${O.name} has joined us.`; } },
      { label: 'A closer partnership, not a union', hint: 'Relations +10 · nothing else changes', apply: (s, c, d) => { addRelation(s, c.id, d.o, 10); return 'We stay two countries, and the best of friends.'; } },
      { label: 'Decline', hint: 'Relations −8', apply: (s, c, d) => { addRelation(s, c.id, d.o, -8); return 'They were hurt, but they will get over it.'; } },
    ],
  },
];
