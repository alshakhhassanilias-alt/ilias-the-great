import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
await pg.addInitScript(() => { localStorage.setItem('wo-tutorial-1', '1'); });
await pg.goto('http://localhost:4173');
await pg.fill('input[type=search]', 'Poland'); await pg.click('.picklist button:has-text("Poland")'); await pg.click('button:has-text("Lead Poland")');
await pg.waitForSelector('.app');
await pg.evaluate(() => { const s = window.__store.state; s.lastEventTick = 1e9; const id = s.countries.findIndex((c) => c.name === 'Belarus'); window.__store.select(id, null, false); });
await pg.click('.tabs button:has-text("Diplomacy")');
await pg.click('button:has-text("Declare war")'); await pg.click('.btnrow button:has-text("Declare war")');
await pg.evaluate(() => window.__store.select(window.__store.state.player, null, false));
await pg.click('.tabs button:has-text("Overview")');
const cdp = await pg.context().newCDPSession(pg);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.argv[3] ?? 4) });
await pg.click('button[aria-label="Very fast"]');
await pg.waitForTimeout(1500);
const events = [];
cdp.on('Tracing.dataCollected', (d) => events.push(...d.value));
const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
const mode = process.argv[2] || 'war';
if (mode === 'pan') { for (let i = 0; i < 60; i++) { await pg.mouse.move(400 + (i % 20) * 12, 400 + (i%7)*5); if (i === 0) await pg.mouse.down(); await pg.waitForTimeout(40);} await pg.mouse.up(); }
else await pg.waitForTimeout(5000);
await cdp.send('Tracing.end'); await done;
const tid = events.find((e) => e.name === 'thread_name' && e.args.name === 'CrRendererMain')?.tid;
const main = events.filter((e) => e.tid === tid && e.ph === 'X' && e.dur);
const tasks = main.filter((e) => e.name === 'RunTask' && e.dur > 50000);
const summ = new Map();
for (const T of tasks) {
  const inside = main.filter((e) => e !== T && e.ts >= T.ts && e.ts + e.dur <= T.ts + T.dur && e.name !== 'RunTask');
  const top = new Map(); for (const e of inside) if (['FunctionCall', 'FireAnimationFrame', 'Commit', 'Paint', 'Layout', 'UpdateLayoutTree', 'TimerFire', 'MinorGC', 'MajorGC', 'EventDispatch', 'PrePaint'].includes(e.name)) top.set(e.name, (top.get(e.name) || 0) + e.dur / 1000);
  const k = [...top].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => `${n}:${v.toFixed(0)}`).join(' ');
  console.log((T.dur / 1000).toFixed(0).padStart(5), k);
}
const agg = new Map(); for (const e of main) agg.set(e.name, (agg.get(e.name) || 0) + e.dur / 1000);
console.log([...agg].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v.toFixed(0)}`).join('  '));
await b.close();
