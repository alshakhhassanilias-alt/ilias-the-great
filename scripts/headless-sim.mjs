// Headless ecosystem verification: runs the simulation without a browser and checks that
// the ecosystem stays alive, predator/prey dynamics persist and civilization emerges.
import { Simulation } from '../src/sim/simulation.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const TICKS = Number(args.ticks ?? 5000);
const SEEDS = (args.seeds ?? '42,7,1337').split(',').map(Number);
const EVERY = Number(args.every ?? 250);
const quiet = 'quiet' in args;

function pad(v, n) { return String(v).padStart(n); }

let failures = 0;
const summary = [];
for (const seed of SEEDS) {
  const sim = new Simulation({ seed });
  const t0 = performance.now();
  let minPop = Infinity, minHerb = Infinity, minCarn = Infinity, maxPop = 0;
  let firstTribeTick = null;
  const carnSeries = [], herbSeries = [];
  if (!quiet) {
    console.log(`\n=== seed ${seed} ===`);
    console.log(' tick | total herb omni carn |  IQ  gen | species extinct | tribes inTribe wars | trades  births  deaths(st/kl/old/pl)');
  }
  for (let i = 1; i <= TICKS; i++) {
    sim.step();
    const c = sim.counts();
    minPop = Math.min(minPop, c.total); maxPop = Math.max(maxPop, c.total);
    minHerb = Math.min(minHerb, c.herb + c.omni); minCarn = Math.min(minCarn, c.carn + c.omni);
    if (firstTribeTick == null && c.tribes > 0) firstTribeTick = i;
    if (i % 50 === 0) { carnSeries.push(c.carn + c.omni * 0.5); herbSeries.push(c.herb + c.omni * 0.5); }
    if (!quiet && i % EVERY === 0) {
      const d = sim.deaths;
      console.log(`${pad(i, 5)} | ${pad(c.total, 5)} ${pad(c.herb, 4)} ${pad(c.omni, 4)} ${pad(c.carn, 4)} | ${c.avgIQ.toFixed(1)} ${pad(c.avgGen.toFixed(1), 4)} | ${pad(c.speciesAlive, 7)} ${pad(c.extinctions, 7)} | ${pad(c.tribes, 6)} ${pad(c.inTribes, 8)} ${pad(c.wars, 4)} | ${pad(sim.totalTrades, 6)} ${pad(sim.births, 7)}  ${d.starved}/${d.killed}/${d.old}/${d.plague}`);
    }
  }
  const ms = performance.now() - t0;
  const c = sim.counts();
  const kinds = {};
  for (const e of sim.events) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  // predator-prey oscillation: count direction reversals of the smoothed series
  const reversals = (s) => { let r = 0, prev = 0; for (let i = 2; i < s.length; i++) { const d = Math.sign((s[i] + s[i - 1]) - (s[i - 1] + s[i - 2])); if (d && prev && d !== prev) r++; if (d) prev = d; } return r; };
  // predator-prey coupling: lag (in ticks) at which predator numbers best track prey numbers
  const corr = (a, b) => {
    const n = a.length; if (n < 4) return 0;
    const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
    return sab / Math.sqrt(saa * sbb + 1e-9);
  };
  let bestLag = 0, bestCorr = -1;
  for (let lag = 0; lag <= 30 && lag < herbSeries.length - 10; lag++) {
    const r = corr(herbSeries.slice(0, herbSeries.length - lag), carnSeries.slice(lag));
    if (r > bestCorr) { bestCorr = r; bestLag = lag; }
  }
  const res = {
    seed, ticksPerSec: Math.round(TICKS / (ms / 1000)), final: c.total, minPop, maxPop, minHerb, minCarn,
    firstTribeTick, tribesFounded: sim.nextTribeId - 1, totalWars: sim.totalWars, totalTrades: sim.totalTrades,
    extinctions: c.extinctions, avgIQ: +c.avgIQ.toFixed(1), avgGen: +c.avgGen.toFixed(1),
    herbReversals: reversals(herbSeries), carnReversals: reversals(carnSeries), predatorLagTicks: bestLag * 50, predatorPreyCorr: +bestCorr.toFixed(2), events: kinds,
  };
  summary.push(res);
  const checks = [
    ['population never collapses (min >= 40)', minPop >= 40],
    ['population bounded (max < 520)', maxPop < 520],
    ['plant-eaters persist (min herb+omni >= 20)', minHerb >= 20],
    ['predators persist (min carn+omni >= 3)', minCarn >= 3],
    ['first tribe within 1000 ticks', firstTribeTick != null && firstTribeTick <= 1000],
    ['multiple tribes emerge (>= 2 founded)', res.tribesFounded >= 2],
    ['inter-tribal diplomacy (war or trade occurred)', res.totalWars + res.totalTrades > 0],
    ['evolution happened (avg generation >= 2)', c.avgGen >= 2],
    ['population cycles (prey + predator series oscillate)', res.herbReversals >= 3 && res.carnReversals >= 3],
  ];
  console.log(`\nseed ${seed}: ${JSON.stringify(res)}`);
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failures++;
  }
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL HEADLESS CHECKS PASSED');
process.exitCode = failures ? 1 : 0;
