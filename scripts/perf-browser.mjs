/**
 * Frame-time check under a slowed CPU (simulates a mid-range phone). Needs `npm run build && npx vite preview --port 4173`.
 *   node scripts/perf-browser.mjs [cpuThrottle=4]
 */
import { chromium } from 'playwright-core';
const THROTTLE = Number(process.argv[2] ?? 4);
const exe = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const b = await chromium.launch({ executablePath: exe });
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
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
const measure = (label, ms, during) => pg.evaluate(async ({ ms }) => {
  const frames = []; let last = performance.now(); let long = 0, longMs = 0;
  const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) { long++; longMs += e.duration; } });
  try { po.observe({ entryTypes: ['longtask'] }); } catch { /* unsupported */ }
  await new Promise((res) => { const f = (t) => { frames.push(t - last); last = t; if (frames.length * 16 < ms * 3 && performance.now() - frames[0] < ms + 1e9) { if (frames.reduce((a, b) => a + b, 0) < ms) requestAnimationFrame(f); else res(); } }; requestAnimationFrame(f); });
  po.disconnect();
  frames.shift();
  const sorted = [...frames].sort((a, b) => a - b);
  const p = (q) => sorted[Math.floor(sorted.length * q)] ?? 0;
  return { fps: (1000 * frames.length / frames.reduce((a, b) => a + b, 0)).toFixed(1), p50: p(0.5).toFixed(1), p95: p(0.95).toFixed(1), max: sorted[sorted.length - 1]?.toFixed(1), long, longMs: Math.round(longMs), stats: window.__renderer?.stats };
}, { ms }).then((r) => console.log(label.padEnd(26), JSON.stringify(r)));
// 1) running the war at very fast speed
await pg.click('button[aria-label="Very fast"]');
await measure('war, very fast', 5000);
// 2) panning while running
const pan = (async () => { for (let i = 0; i < 40; i++) { await pg.mouse.move(400 + (i % 20) * 8, 400); if (i === 0) await pg.mouse.down(); } await pg.mouse.up(); })();
await measure('pan while running', 2500);
await pan;
// 3) paused, idle
await pg.click('button[aria-label="Pause"]');
await measure('paused idle', 2500);
await b.close();
