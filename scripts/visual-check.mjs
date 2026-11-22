// Visual verification: serves the production build, drives it in headless Chromium,
// fast-forwards evolution, captures screenshots and checks for WebGL errors and HUD overlap.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node-tools/node_modules/playwright'); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const outDir = path.join(root, 'artifacts', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const WIDTH = Number(args.width ?? 1600), HEIGHT = Number(args.height ?? 900);
const FF = Number(args.ticks ?? 1000);
const SCALE = Number(args.scale ?? 1);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(dist, url === '/' ? 'index.html' : url);
  if (!file.startsWith(dist) || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await playwright.chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: SCALE });
const consoleErrors = [];
const webglWarnings = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') consoleErrors.push(t);
  if (/webgl|GL_|THREE\.WebGL|shader/i.test(t) && m.type() !== 'debug') webglWarnings.push(`[${m.type()}] ${t}`);
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/${args.query ?? ''}`);
await page.waitForFunction(() => window.__genesis && window.__genesis.state.ready, null, { timeout: 60000 });
const gl = await page.evaluate(() => window.__genesis.webgl);
console.log('WebGL:', gl);

console.log(`fast-forwarding ${FF} ticks…`);
const ffStart = Date.now();
const tickAfter = await page.evaluate((n) => window.__genesis.fastForward(n), FF);
console.log(`  reached tick ${tickAfter} in ${((Date.now() - ffStart) / 1000).toFixed(1)}s`);
await page.waitForTimeout(800);

const shot = async (name) => {
  await page.evaluate(() => window.__genesis.waitFrames(3));
  const suffix = WIDTH === 1600 && HEIGHT === 900 ? '' : `-${WIDTH}x${HEIGHT}`;
  const p = path.join(outDir, `${name}${suffix}.png`);
  await page.screenshot({ path: p });
  console.log('  saved', path.relative(root, p));
  return p;
};
const G = (fn, arg) => page.evaluate(fn, arg);

// freeze the simulation so every shot shows the same evolved world (rendering keeps animating)
await G(() => window.__genesis.pause(true));
await G(() => window.__genesis.jumpToTime(0.36));
await page.waitForTimeout(600);

// 1. orbit overview
await G(() => window.__genesis.setView([150, 140, 190], [0, 2, 0]));
await shot('01-orbit');

// 2. tribe camp close-up (largest living tribe)
const camp = await G(() => {
  const camps = window.__genesis.state.camps.filter((c) => c.alive).sort((a, b) => b.members - a.members);
  return camps[0] || null;
});
if (camp) {
  await G((c) => window.__genesis.lookAt(c.x, c.z, 30, [0.62, 0.62, 0.48]), camp);
  await shot('02-tribe-camp');
} else console.log('  WARNING: no living tribe to photograph');

// 3. neural inspector on a tribe member, camera following it
const memberId = await G((c) => (c ? window.__genesis.tribeMember(c.id) : 0), camp);
await G((id) => { const g = window.__genesis; if (id) g.select(id); else g.spotlight(); }, memberId);
await page.waitForFunction(() => window.__genesis.state.inspect && !window.__genesis.state.inspect.dead, null, { timeout: 20000 });
await G(() => { const g = window.__genesis; const i = g.state.inspect; g.lookAt(i.x, i.z, 22, [0.55, 0.7, 0.45]); document.querySelector('[data-act="follow"]')?.click(); });
await shot('03-neural-inspector');

// 4. night at the camp
await G(() => window.__genesis.select(0));
if (camp) await G((c) => window.__genesis.lookAt(c.x, c.z, 36, [0.62, 0.62, 0.48]), camp);
await G(() => window.__genesis.jumpToTime(0.95));
await page.waitForTimeout(600);
await shot('04-night-camp');

// 5. god power: meteor strike on open land away from camps
const target = await G(() => {
  const g = window.__genesis;
  const camps = g.state.camps;
  let best = { x: 20, z: 20 }, bd = -1;
  for (let i = 0; i < 300; i++) {
    const x = (Math.random() - 0.5) * 120, z = (Math.random() - 0.5) * 120;
    const d = Math.min(...camps.map((c) => Math.hypot(c.x - x, c.z - z)), 999);
    if (d > bd) { bd = d; best = { x, z }; }
  }
  return best;
});
await G(() => window.__genesis.jumpToTime(0.45));
await page.waitForTimeout(600);
await G((t) => window.__genesis.lookAt(t.x, t.z, 90, [0.6, 0.6, 0.5]), target);
await G((t) => window.__genesis.power('meteor', t.x, t.z), target); // resolves at impact
await shot('05-meteor-impact');
await page.waitForTimeout(3500);
await shot('06-crater');

// 7. food oasis + plague near the biggest camp (shows god-power effects on the living world)
if (camp) {
  await G((c) => window.__genesis.lookAt(c.x + 14, c.z + 10, 48, [0.5, 0.75, 0.45]), camp);
  await G((c) => { window.__genesis.power('oasis', c.x + 16, c.z + 12); }, camp);
  await page.waitForTimeout(1200);
  await shot('07-oasis');
  // plague: infected creatures glow sickly green while the disease spreads
  await G((c) => { const g = window.__genesis; g.power('plague', c.x, c.z); g.pause(false); g.setSpeed(1); }, camp);
  await page.waitForTimeout(2500);
  await G(() => window.__genesis.pause(true));
  await G((c) => window.__genesis.lookAt(c.x, c.z, 30, [0.62, 0.62, 0.48]), camp);
  await shot('08-plague');
}
await G(() => window.__genesis.pause(false));

// ---- HUD layout checks
const layout = await page.evaluate(() => {
  const rects = [...document.querySelectorAll('#hud .panel')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => { const r = el.getBoundingClientRect(); return { id: el.id || el.className, x: r.x, y: r.y, w: r.width, h: r.height }; });
  const overlaps = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ix > 0.5 && iy > 0.5) overlaps.push(`${a.id} x ${b.id}`);
  }
  const offscreen = rects.filter((r) => r.x < 0 || r.y < 0 || r.x + r.w > innerWidth + 0.5 || r.y + r.h > innerHeight + 0.5).map((r) => r.id);
  // clipped text in chips/top bar
  const clipped = [...document.querySelectorAll('.chip, .tribe-row .nm, .stat-card .v')]
    .filter((el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent.trim().slice(0, 30));
  const chips = [...document.querySelectorAll('.chips .chip')].filter((el) => el.offsetParent !== null);
  const chipBox = document.querySelector('.chips').getBoundingClientRect();
  const hiddenChips = chips.filter((el) => { const r = el.getBoundingClientRect(); return r.right > chipBox.right + 0.5 || r.left < chipBox.left - 0.5; }).map((el) => el.textContent.trim());
  return { rects, overlaps, offscreen, clipped, hiddenChips };
});

const final = await page.evaluate(() => {
  const g = window.__genesis;
  return { tick: g.state.world.tick, counts: g.state.counts, tribes: g.state.camps.filter((c) => c.alive).map((c) => `${c.name}(${c.members})`), errors: g.errors, webgl: g.webgl };
});

// main-thread cost per frame (JS update + WebGL command submission). SwiftShader rasterises on the CPU in
// another process, so wall-clock FPS here is not representative of a real GPU; this isolates our own work.
const mainThread = await page.evaluate(async () => {
  const g = window.__genesis; g.pause(false); g.setSpeed(20);
  g.setView([150, 140, 190], [0, 2, 0]);
  await g.waitFrames(12);
  const s = g.perf.samples.slice(-10).sort((a, b) => a - b);
  return { medianMs: +s[5].toFixed(2), maxMs: +s[s.length - 1].toFixed(2), lastJsMs: +g.perf.js.toFixed(2), drawCalls: g.drawCalls, creatures: g.state.counts.total };
});
// wall-clock frame interval (dominated by CPU rasterisation in SwiftShader)
const frameStats = await page.evaluate(() => new Promise((resolve) => {
  const times = []; let last = performance.now(); let n = 0;
  const step = () => { const now = performance.now(); times.push(now - last); last = now; if (++n < 60) requestAnimationFrame(step); else { times.sort((a, b) => a - b); resolve({ median: times[30], p90: times[54] }); } };
  requestAnimationFrame(step);
}));

await browser.close();
server.close();

const report = {
  viewport: `${WIDTH}x${HEIGHT}`, webgl: gl, fastForward: FF, durationSec: (Date.now() - t0) / 1000,
  final, layout: { overlaps: layout.overlaps, offscreen: layout.offscreen, clipped: layout.clipped, hiddenChips: layout.hiddenChips, panels: layout.rects.length },
  consoleErrors, webglWarnings, mainThread, frameStats,
};
fs.writeFileSync(path.join(root, 'artifacts', `visual-report-${WIDTH}x${HEIGHT}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

const failures = [];
if (gl.lost) failures.push('WebGL context lost');
if (consoleErrors.length) failures.push(`${consoleErrors.length} console error(s)`);
if (webglWarnings.some((w) => /error/i.test(w))) failures.push('WebGL errors in console');
if (final.errors.length) failures.push('runtime errors captured');
if (layout.overlaps.length) failures.push(`overlapping panels: ${layout.overlaps.join(', ')}`);
if (layout.offscreen.length) failures.push(`offscreen panels: ${layout.offscreen.join(', ')}`);
if (!camp) failures.push('no tribe camp after fast-forward');
console.log(failures.length ? `\nVISUAL CHECK FAILED:\n - ${failures.join('\n - ')}` : '\nVISUAL CHECK PASSED');
process.exitCode = failures.length ? 1 : 0;
