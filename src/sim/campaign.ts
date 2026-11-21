/**
 * The campaign: the last twelve weeks before a vote are fought region by region, not rolled.
 *
 *   - The country is split into three to six electoral regions (clusters of its own provinces, weighted by
 *     population). Each cares about the six issues in its own proportions (jobs, prices, security, corruption, public
 *     services, national pride): the capital about services and corruption, a border region about security...
 *   - Your record decides how believable you are on each issue: talk about jobs with unemployment at a record and the
 *     crowd does not buy it. The best message is the one a region cares about and you can stand behind.
 *   - You get a campaign day a week (three at most in hand): a rally (strong, but the same crowd tires of you), door to
 *     door (smaller, lasts), a national TV address (costs money), an attack ad (a gamble). Each builds momentum, which
 *     fades if you stop.
 *   - Your opponent campaigns too: every week, in the closest region, on the issue where your record is weakest.
 *   - On the day, each region votes (its lean, the national mood, your campaign there and theirs, a little luck), and
 *     election night shows the regions as they report.
 * In a regime the same contest is a congress: regions are provincial delegations, rallies are tours with the governor.
 */
import { clamp } from './util';
import { nextRand, hash01 } from './rng';
import { personName } from './leaders';
import { logEvent } from './log';
import { fund } from './actions';
import { approval } from './approval';
import { isAtWar } from './relations';
import { geoRefGet } from './geoRef';
import { voteBase } from './legacy';
import type { Country, GameState } from './types';

export type Issue = 'jobs' | 'prices' | 'security' | 'corruption' | 'services' | 'pride';
export const ISSUES: { id: Issue; icon: string; name: string; lines: string[]; foe: string[] }[] = [
  { id: 'jobs', icon: '🛠', name: 'Jobs', lines: [
    'Every family in this country deserves a paycheck, and under us they will get one.',
    'They closed your factories. We will open them again, and you will run them.',
    'I did not come here to manage decline. I came to put {region} back to work.',
    'Work is dignity. Give me four years and I will give you both.',
  ], foe: ['Ask yourselves who still has a job after four years of this government.', 'They promised work. They delivered queues.'] },
  { id: 'prices', icon: '🧺', name: 'Prices', lines: [
    'Bread, rent, fuel: I know what you pay, and I will bring it down.',
    'Your wages should buy more next year than they did this year. That is my promise.',
    'Nobody in {region} should choose between heating and eating. Not on my watch.',
    'We will stop the prices running away from the people who earn the least.',
  ], foe: ['Look at your shopping bill. That is their record.', 'Every month you pay more, and they tell you it is fine.'] },
  { id: 'security', icon: '🛡', name: 'Security', lines: [
    'No one will threaten this nation while I stand at its head.',
    'Our soldiers stand on the border so that {region} can sleep. I stand with them.',
    'Peace through strength: that is not a slogan, it is a plan.',
    'Let our enemies hear this tonight: {country} will not bend.',
  ], foe: ['They have made us weaker and our enemies bolder.', 'Is this country safer than it was? You know the answer.'] },
  { id: 'corruption', icon: '⚖', name: 'Corruption', lines: [
    'Every stolen coin goes back to the people it was stolen from. Every one.',
    'The days of envelopes and favours are over. Not one more.',
    'I will open the books, and the thieves will meet the judges.',
    'Clean hands, open doors, and a state that works for {region}, not for its friends.',
  ], foe: ['Their friends got rich. You got the bill.', 'Follow the money, and it leads to their cabinet table.'] },
  { id: 'services', icon: '🏥', name: 'Services', lines: [
    'A hospital in every district, a good school on every street. That is the country I want.',
    'Your children will learn in schools we are proud of, and your parents will be cared for.',
    '{region} has waited long enough for its clinics and its trains.',
    'A state that is there when you need it: that is what you pay your taxes for.',
  ], foe: ['Wait three months for a doctor, then thank them for it.', 'Our schools are crumbling while they cut ribbons.'] },
  { id: 'pride', icon: '🏳', name: 'Pride', lines: [
    'We are an old nation, and we are not finished. Our best years are ahead.',
    'Stand up, {region}! This country bows to no one.',
    'Our language, our flag, our history: no one will take them from us.',
    'They told you to be small. I tell you we are {country}, and we are great.',
  ], foe: ['They sold this country short.', 'A proud nation deserves a leader who believes in it.'] },
];
export const issueById = (id: Issue) => ISSUES.find((x) => x.id === id)!;

export interface CRegion { name: string; provs: number[]; w: number; lean: number; sal: Record<Issue, number>; camp: number; foe: number; visits: number; last?: number; border?: boolean; capital?: boolean }
export interface Campaign {
  start: number; vote: number; kind: 'election' | 'congress' | 'comeback';
  regions: CRegion[]; momentum: number; days: number; foe: string;
  trail: { tick: number; text: string; mine: boolean }[];
  /** the issue the opponent is hammering you on */ foeIssue?: Issue;
}
export interface CampaignResult { tick: number; regions: { name: string; share: number; w: number }[]; share: number; foe?: string }

export const CAMPAIGN_WEEKS = 12;
const DAYS_MAX = 3;
const free = (c: Country) => c.gov === 'D' || c.gov === 'F';

/** How believable you are on each issue, from your record (0.6 = they laugh, 1.4 = they cheer). */
export function credibility(s: GameState, c: Country): Record<Issue, number> {
  const e = c.eco;
  const nat = c.politics?.factions.find((f) => f.id === 'nationalists');
  const losing = s.wars.some((w) => (w.attackers.includes(c.id) || w.defenders.includes(c.id)) && (w.lost[c.id] ?? 0) > 0.03);
  return {
    jobs: clamp(1 + (e.uNat + 0.01 - e.unemployment) * 12, 0.6, 1.4),
    prices: clamp(1 + (0.035 - e.inflation) * 8, 0.6, 1.4),
    security: clamp(losing ? 0.65 : 1 + (c.mil.readiness - 0.6) * 0.8 + (isAtWar(s, c.id) ? 0.1 : 0), 0.6, 1.4),
    corruption: clamp(1 + (e.collection - 0.7) * 2.5, 0.6, 1.4),
    services: clamp(1 + (c.budget.social - 0.12) * 4 + (e.stability - 55) * 0.006, 0.6, 1.4),
    pride: clamp(1 + ((nat?.mood ?? 50) - 50) * 0.01 + (c.reputation - 50) * 0.004, 0.6, 1.4),
  };
}

/** How much each issue matters across the country right now. */
function salience(s: GameState, c: Country): Record<Issue, number> {
  const e = c.eco;
  const nat = c.politics?.factions.find((f) => f.id === 'nationalists');
  return {
    jobs: 0.6 + 12 * Math.max(0, e.unemployment - e.uNat),
    prices: 0.6 + 8 * Math.max(0, e.inflation - 0.02),
    security: 0.5 + (isAtWar(s, c.id) ? 1.2 : 0) + ((c.hostile ?? 0) > 0.5 ? 0.4 : 0),
    corruption: 0.5 + 1.2 * Math.max(0, 0.8 - e.collection),
    services: 0.7 + (e.stability < 50 ? 0.4 : 0),
    pride: 0.5 + ((nat?.support ?? 15) / 100) * 1.5,
  };
}

/** Split the country into electoral regions: clusters of its provinces by place, weighted by population. */
export function buildRegions(s: GameState, c: Country): CRegion[] {
  const geo = geoRefGet();
  const provs = c.provinces.filter((p) => s.owner[p] === c.id);
  if (!geo || !provs.length) return [{ name: c.name, provs: [c.capital], w: 1, lean: 0, sal: salience(s, c), camp: 0, foe: 0, visits: 0, capital: true }];
  const P = geo.provinces;
  // remote specks (a far-off island territory) do not make a region of their own: they join the nearest real one
  const totW = provs.reduce((t, p) => t + Math.max(0.01, P[p].w), 0);
  const core = provs.filter((p) => !P[p].territory && Math.max(0.01, P[p].w) / totW >= 0.025);
  const seedSet = core.length ? core : provs;
  const k = Math.min(6, seedSet.length, Math.max(seedSet.length > 1 ? 2 : 1, Math.round(Math.sqrt(seedSet.length) * 1.6)));
  // farthest-point start from the capital, then a few rounds of weighted k-means on the province centres
  const pt = (p: number) => P[p].seed;
  const cents: [number, number][] = [[...pt(seedSet.includes(c.capital) ? c.capital : seedSet[0])] as [number, number]];
  while (cents.length < k) {
    let best = seedSet[0], bd = -1;
    for (const p of seedSet) { const d = Math.min(...cents.map((q) => Math.hypot(pt(p)[0] - q[0], pt(p)[1] - q[1]))); if (d > bd) { bd = d; best = p; } }
    cents.push([...pt(best)] as [number, number]);
  }
  let groups: number[][] = [];
  for (let it = 0; it < 6; it++) {
    groups = cents.map(() => []);
    for (const p of provs) { let bi = 0, bd = Infinity; cents.forEach((q, i) => { const d = Math.hypot(pt(p)[0] - q[0], pt(p)[1] - q[1]); if (d < bd) { bd = d; bi = i; } }); groups[bi].push(p); }
    groups.forEach((g, i) => { if (!g.length) return; const wt = g.reduce((t, p) => t + Math.max(0.01, P[p].w), 0); cents[i] = [g.reduce((t, p) => t + pt(p)[0] * Math.max(0.01, P[p].w), 0) / wt, g.reduce((t, p) => t + pt(p)[1] * Math.max(0.01, P[p].w), 0) / wt]; });
  }
  groups = groups.filter((g) => g.length);
  const nat = salience(s, c);
  const tot = provs.reduce((t, p) => t + Math.max(0.01, P[p].w), 0);
  const hostile = new Set(s.countries.filter((x) => x.alive && x.id !== c.id && (isAtWar(s, x.id) && s.wars.some((w) => (w.attackers.includes(x.id) && w.defenders.includes(c.id)) || (w.defenders.includes(x.id) && w.attackers.includes(c.id))))).map((x) => x.id));
  const regions: CRegion[] = groups.map((g, i) => {
    const big = [...g].sort((a, b) => P[b].w - P[a].w)[0];
    const capital = g.includes(c.capital);
    const border = g.some((p) => (geo.adj[p] ?? []).some((q) => s.owner[q] >= 0 && s.owner[q] !== c.id && (hostile.has(s.owner[q]) || hash01('bord', s.owner[q], c.id) < 0.25)));
    const sal = {} as Record<Issue, number>;
    for (const is of ISSUES) sal[is.id] = nat[is.id] * (0.65 + 0.7 * hash01('sal', c.id, i, ISSUES.indexOf(is), s.settings.seed));
    if (capital) { sal.services += 0.3; sal.corruption += 0.3; }
    if (border) sal.security += 0.6;
    const name = capital ? `${P[c.capital].name || c.name} & the capital` : P[big].name || `${c.name} ${i + 1}`;
    return { name, provs: g, w: g.reduce((t, p) => t + Math.max(0.01, P[p].w), 0) / tot, lean: (hash01('lean', c.id, i, s.settings.seed) - 0.5) * 10 + (capital ? 1.5 : 0), sal, camp: 0, foe: 0, visits: 0, border, capital };
  });
  // the leans average out to nothing: they move the map, not the national total
  const mean = regions.reduce((t, r) => t + r.w * r.lean, 0);
  for (const r of regions) r.lean = Math.round((r.lean - mean) * 10) / 10;
  return regions;
}

/** The national starting point of the race, before the campaign trail. */
function baseShare(s: GameState, cm: Campaign): number {
  if (cm.kind === 'comeback') return (s.legacy?.opposition?.support ?? 40) + (s.stats.campaign ?? 0);
  return voteBase(s); // (the national race without the campaign trail, which is counted here region by region)
}
/** what the campaign trail adds to the national share: your campaign against theirs, region by region, and momentum */
export function trailOf(cm: Campaign | undefined): number {
  if (!cm) return 0;
  return cm.regions.reduce((t, r) => t + r.w * (r.camp - r.foe), 0) + cm.momentum * 0.3;
}
/** today's poll in each region */
export function regionPolls(s: GameState, cm: Campaign): { r: CRegion; share: number }[] {
  const b = baseShare(s, cm) + cm.momentum * 0.3;
  return cm.regions.map((r) => ({ r, share: clamp(b + r.lean + r.camp - r.foe, 3, 97) }));
}
export function nationalPoll(s: GameState, cm: Campaign): number {
  return regionPolls(s, cm).reduce((t, x) => t + x.r.w * x.share, 0);
}

export function startCampaign(s: GameState, kind: Campaign['kind'], vote: number) {
  const c = s.countries[s.player];
  const L = s.legacy;
  const foe = L?.persona?.rival?.name && kind !== 'comeback' && !free(c) ? L.persona.rival.name : personName(c, 'foe', (L?.term ?? 1) * 7 + s.settings.seed % 97);
  s.campaign = { start: s.tick, vote, kind, regions: buildRegions(s, c), momentum: 0, days: 2, foe, trail: [] };
  const word = kind === 'congress' ? 'The congress is twelve weeks away: the provincial delegations decide' : kind === 'comeback' ? 'Twelve weeks to the vote that could bring you back' : 'Twelve weeks to election day';
  logEvent(s, `🗳 THE CAMPAIGN BEGINS: ${word}. Your opponent: ${foe}.`, 'info', [s.player], true, { big: true, prov: c.capital });
}

const crowdOf = (s: GameState, c: Country, r: CRegion, k: number) => {
  const n = Math.max(1500, c.eco.pop * r.w * 0.006 * k * (1 + Math.max(0, s.campaign?.momentum ?? 0) / 8));
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : n >= 1e4 ? `${Math.round(n / 1000)},000` : `${Math.round(n / 100) * 100}`;
};
const say = (t: string, c: Country, r?: CRegion) => t.replace('{region}', r?.name ?? c.name).replace('{country}', c.name);

export type CampaignMove = 'rally' | 'door' | 'tv' | 'attack';
export const MOVES: { id: CampaignMove; icon: string; name: string; free: string; regime: string; desc: string }[] = [
  { id: 'rally', icon: '📣', name: 'Rally', free: 'Rally', regime: 'Tour with the governor', desc: 'Strong in one region, and spills into the rest. The same crowd tires of you: each return to a region gives less.' },
  { id: 'door', icon: '🚪', name: 'Door to door', free: 'Door to door', regime: 'Meet the local bosses', desc: 'Smaller, but it does not wear thin: volunteers in one region, week after week.' },
  { id: 'tv', icon: '📺', name: 'TV address', free: 'TV address', regime: 'Address on state TV', desc: 'Every region at once, a little. Costs money (0.1% of GDP).' },
  { id: 'attack', icon: '🎯', name: 'Attack ad', free: 'Attack ad', regime: 'Expose the plotters', desc: 'A gamble: 2 in 3 it cuts into your opponent everywhere; otherwise it backfires on you.' },
];

/** One campaign day: a move, in a region (rally and door to door), on an issue. */
export function actCampaign(s: GameState, move: CampaignMove, region: number, issue: Issue) {
  const cm = s.campaign, c = s.countries[s.player];
  if (!cm) return { ok: false, message: 'There is no campaign under way' };
  if (cm.days < 1) return { ok: false, message: 'No campaign days left this week' };
  const r = cm.regions[region];
  if ((move === 'rally' || move === 'door') && !r) return { ok: false, message: 'Pick a region' };
  const cred = credibility(s, c)[issue];
  const cha = s.legacy?.persona?.skills.cha ?? 5;
  const avg = (rr: CRegion) => ISSUES.reduce((t, x) => t + rr.sal[x.id], 0) / ISSUES.length;
  const I = issueById(issue);
  let text = '';
  if (move === 'tv') {
    const f = fund(s, c.id, 0.001 * c.eco.gdp, 'Campaign: TV address');
    if (!f.ok) return f;
  }
  cm.days--;
  const before = nationalPoll(s, cm);
  if (move === 'rally') {
    const g = 1.7 * (r.sal[issue] / avg(r)) * cred * (0.75 + cha / 20) * Math.pow(0.72, r.visits);
    r.camp += g; r.visits += 1; r.last = s.tick;
    for (const o of cm.regions) if (o !== r) o.camp += 0.12 * g;
    cm.momentum = clamp(cm.momentum + 0.6 * cred, -5, 5);
    const line = say(I.lines[Math.floor(nextRand(s) * I.lines.length)], c, r);
    text = `📣 "${line}" ${s.legacy?.leader ?? 'You'} draws ${crowdOf(s, c, r, cred)} in ${r.name}.${cred < 0.85 ? ' Some in the crowd laugh: your record on ' + I.name.toLowerCase() + ' says otherwise.' : ''}`;
  } else if (move === 'door') {
    const g = 0.95 * (r.sal[issue] / avg(r)) * (0.85 + 0.15 * cred) * (0.9 + cha / 50);
    r.camp += g; r.visits += 0.25; r.last = s.tick;
    cm.momentum = clamp(cm.momentum + 0.2, -5, 5);
    text = `🚪 Volunteers knock on doors across ${r.name}, talking ${I.name.toLowerCase()}.`;
  } else if (move === 'tv') {
    for (const o of cm.regions) o.camp += 0.55 * (o.sal[issue] / avg(o)) * cred;
    cm.momentum = clamp(cm.momentum + 0.4, -5, 5);
    text = `📺 Prime time: "${say(I.lines[Math.floor(nextRand(s) * I.lines.length)], c)}"`;
  } else {
    if (nextRand(s) < 0.66) {
      for (const o of cm.regions) o.foe = Math.max(-3, o.foe - 0.9);
      cm.momentum = clamp(cm.momentum + 0.5, -5, 5);
      text = `🎯 The attack ad lands: ${cm.foe} spends the week explaining.`;
    } else {
      for (const o of cm.regions) o.camp -= 0.6;
      cm.momentum = clamp(cm.momentum - 1.5, -5, 5);
      text = `🎯 The attack ad backfires: voters call it a smear, and ${cm.foe} plays the victim on every channel.`;
    }
  }
  const d = nationalPoll(s, cm) - before;
  cm.trail.push({ tick: s.tick, text, mine: true });
  if (cm.trail.length > 40) cm.trail.shift();
  if (move === 'rally' && r) logEvent(s, text, 'info', [s.player], true);
  return { ok: true, message: `${text} Poll ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}.` };
}

/** Weekly while a campaign runs: a new campaign day, the opponent's move, momentum fades, an idle team acts alone. */
export function stepCampaign(s: GameState) {
  const cm = s.campaign;
  if (!cm) return;
  const c = s.countries[s.player];
  const L = s.legacy;
  // the race is over (a vote came early, you fell, the career ended): no campaign to run
  if (!L || s.tick > cm.vote + 1 || (cm.kind === 'comeback' ? L.status !== 'opposition' : L.status !== 'office')) { delete s.campaign; return; }
  // a day you never used: your team does something without you (at half the strength of you being there)
  if (cm.days >= DAYS_MAX) {
    const pick = regionPolls(s, cm).sort((a, b) => Math.abs(a.share - 50) * (1 / (0.2 + a.r.w)) - Math.abs(b.share - 50) * (1 / (0.2 + b.r.w)))[0].r;
    const top = ISSUES.map((x) => x.id).sort((a, b) => pick.sal[b] - pick.sal[a])[0];
    pick.camp += 0.5; cm.days--;
    cm.trail.push({ tick: s.tick, text: `🚌 Without you, your team holds a small event in ${pick.name} on ${issueById(top).name.toLowerCase()}.`, mine: true });
  }
  cm.days = Math.min(DAYS_MAX, cm.days + 1);
  cm.momentum *= 0.85;
  // the opponent: the closest big region, on your weakest issue that matters there
  const cred = credibility(s, c);
  const polls = regionPolls(s, cm);
  const target = polls.sort((a, b) => b.r.w / (1 + Math.abs(b.share - 50) / 4) - a.r.w / (1 + Math.abs(a.share - 50) / 4))[0].r;
  const issue = ISSUES.map((x) => x.id).sort((a, b) => target.sal[b] * (2 - cred[b]) - target.sal[a] * (2 - cred[a]))[0];
  const avg = ISSUES.reduce((t, x) => t + target.sal[x.id], 0) / ISSUES.length;
  const g = 1.05 * (target.sal[issue] / avg) * (2 - cred[issue]) * 0.75 * (0.85 + 0.3 * nextRand(s));
  target.foe += g;
  for (const o of cm.regions) if (o !== target) o.foe += 0.1 * g;
  cm.foeIssue = issue;
  const I = issueById(issue);
  cm.trail.push({ tick: s.tick, text: `${cm.foe} in ${target.name}: "${say(I.foe[Math.floor(nextRand(s) * I.foe.length)], c, target)}"`, mine: false });
  if (cm.trail.length > 40) cm.trail.shift();
  void approval;
}

/** The vote: each region decides; returns the national share (and keeps the regional result for election night). */
export function countVotes(s: GameState): number | null {
  const cm = s.campaign;
  if (!cm) return null;
  const polls = regionPolls(s, cm);
  const regions = polls.map((x) => ({ name: x.r.name, w: x.r.w, share: clamp(x.share + (nextRand(s) - 0.5) * 5, 1, 99) }));
  const share = regions.reduce((t, r) => t + r.w * r.share, 0);
  s.campaignResult = { tick: s.tick, regions, share, foe: cm.foe };
  delete s.campaign;
  return share;
}

/**
 * What a move would do, before you make it (no luck involved: the attack ad shows what it does when it lands): the gain
 * in the region and in the national poll.
 */
export function previewMove(s: GameState, move: CampaignMove, region: number, issue: Issue): { region: number; national: number } {
  const cm = s.campaign, c = s.countries[s.player];
  if (!cm) return { region: 0, national: 0 };
  const r = cm.regions[region];
  const cred = credibility(s, c)[issue];
  const cha = s.legacy?.persona?.skills.cha ?? 5;
  const avg = (rr: CRegion) => ISSUES.reduce((t, x) => t + rr.sal[x.id], 0) / ISSUES.length;
  if (move === 'rally' && r) { const g = 1.7 * (r.sal[issue] / avg(r)) * cred * (0.75 + cha / 20) * Math.pow(0.72, r.visits); return { region: g, national: r.w * g + (1 - r.w) * 0.12 * g + 0.6 * cred * 0.3 }; }
  if (move === 'door' && r) { const g = 0.95 * (r.sal[issue] / avg(r)) * (0.85 + 0.15 * cred) * (0.9 + cha / 50); return { region: g, national: r.w * g + 0.06 }; }
  if (move === 'tv') { const n = cm.regions.reduce((t, o) => t + o.w * 0.55 * (o.sal[issue] / avg(o)) * cred, 0); return { region: r ? 0.55 * (r.sal[issue] / avg(r)) * cred : 0, national: n + 0.12 }; }
  if (move === 'attack') return { region: 0.9, national: 0.9 * cm.regions.reduce((t, o) => t + o.w * (o.foe > -3 ? 1 : 0), 0) + 0.15 };
  return { region: 0, national: 0 };
}
