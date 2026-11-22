// Main-thread cost probe: skips GPU rasterisation and measures our per-frame JS at real rAF cadence
// (1x and 20x), plus the worker tick rate. Run after `npm run build`.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let playwright; try { playwright = require('playwright'); } catch { playwright = require('/opt/node-tools/node_modules/playwright'); }
const dist = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => { const f = path.join(dist, req.url === '/' ? 'index.html' : req.url.split('?')[0]); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, r));
const browser = await playwright.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.__genesis && window.__genesis.state.ready);
await page.evaluate(() => window.__genesis.fastForward(1000));
for (const speed of [1, 20]) {
  const r = await page.evaluate(async (speed) => {
    const g = window.__genesis;
    g.renderer.render = () => {}; // skip GPU rasterisation: measure only our main-thread JS at real rAF cadence
    g.setSpeed(speed); g.setView([150, 140, 190], [0, 2, 0]);
    g.perf.samples.length = 0;
    const t0 = performance.now();
    await g.waitFrames(300);
    const secs = (performance.now() - t0) / 1000;
    const s = g.perf.samples.slice().sort((a, b) => a - b);
    const q = (p) => +s[Math.floor(p * (s.length - 1))].toFixed(2);
    return { speed, rafFps: +(300 / secs).toFixed(1), median: q(0.5), p95: q(0.95), max: q(1), pop: g.state.counts.total, tickRate: Math.round(g.state.tickRate) };
  }, speed);
  console.log(JSON.stringify(r));
}
await browser.close(); server.close();
