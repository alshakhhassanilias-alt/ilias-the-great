// Gameplay capture for the trailer: the game's clock is frozen and advanced 1/30 s per screenshot (smooth 30 fps).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const OUT = process.argv[2], ONLY = (process.argv[3] ?? '').split(',').filter(Boolean);
const PORT = 4600 + Math.floor(Math.random() * 40), URL = `http://127.0.0.1:${PORT}/?seed=${process.env.SEED ?? 7}`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i++) { try { await fetch(URL); break; } catch { await sleep(250); } }
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const pg = await ctx.newPage();
const errors = []; pg.on('pageerror', (e) => errors.push(String(e)));
await pg.clock.install();
await pg.addInitScript(() => { try { localStorage.setItem('wo-tutorial-1', '1'); } catch {} });
const cdp = await ctx.newCDPSession(pg);
await cdp.send('Animation.enable');
const ui = async (css) => pg.evaluate((css) => { let el = document.getElementById('tr-css'); if (!el) { el = document.createElement('style'); el.id = 'tr-css'; document.head.appendChild(el); } el.textContent = css; }, css);
const MAPONLY = '.side, .side-dock, .toasts, .notes-col, .inbox, .offer, .cable, .ticker, .timebox, .time-controls, .map-modes, .zoom-ctl, .breaking, .topbar, .mapmodes, .map-tools, .bottom-bar, .newsbar { display: none !important; } .stage { grid-template-columns: minmax(0, 1fr) !important; } .app { grid-template-rows: 1fr !important; }';
const CLEAN = '.toasts, .notes-col, .inbox, .offer { display: none !important; }';
async function rec(name, n, each) {
  if (ONLY.length && !ONLY.includes(name)) { for (let i = 0; i < n; i++) { if (each) await each(i, n); await pg.clock.runFor(33.333); } return; }
  const dir = `${OUT}/${name}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.3 });
  for (let i = 0; i < n; i++) {
    if (each) await each(i, n);
    await pg.clock.runFor(33.333);
    await pg.screenshot({ path: `${dir}/${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 93 });
  }
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
  console.log('shot', name, n, 'frames');
}
const ev = (f, a) => pg.evaluate(f, a);
const run = async (ms) => { for (let t = 0; t < ms; t += 100) await pg.clock.runFor(100); };
const ease = (t) => t * t * (3 - 2 * t);
// after a scripted camera move, let the map treat the view as settled so it redraws crisply every frame
const settle = () => ev(() => { const r = window.__renderer; r.lastViewChange = performance.now() - 500; });

await pg.goto(URL); await pg.waitForSelector('.start');
await pg.fill('input[type=search]', 'Venezuela'); await pg.click('.picklist button:has-text("Venezuela")'); await pg.click('button:has-text("Lead Venezuela")');
await pg.waitForSelector('.app');
await run(1500);
await ev(() => { const st = window.__store; st.pauseOnDecision = false; st.pauseBeforeLapse = false; st.autoSlow = false; st.pauseOnWar = false; st.state.lastEventTick = 1e9; });
// a few months of history so the world is alive
await ev(() => { const st = window.__store; for (let i = 0; i < 30; i++) { st.state.inbox = []; st.stepOnce(); } st.state.inbox = []; st.notify(); });
await run(1500);

// A. the world, wide, slow push toward the Atlantic / Europe (map only)
await ui(MAPONLY); await run(800);
await ev(() => { const r = window.__renderer; r.fitWorld(); });
await ev(() => window.__store.setSpeed(2)); await run(600);
await rec('A_world', 150, async (i, n) => { await ev(([f]) => { const r = window.__renderer; r.zoomNow(r.w * 0.47, r.h * 0.42, f); }, [1 + 0.0032 * (0.4 + 0.6 * Math.sin(Math.PI * i / n))]); await settle(); });

// B. select a country: the dossier opens (full interface)
await ui(CLEAN); await run(400);
const ids = await ev(() => { const s = window.__store.state; const id = (n) => s.countries.find((c) => c.name === n).id; return { ven: id('Venezuela'), guy: id('Guyana'), bra: id('Brazil'), col: id('Colombia') }; });
await ev((id) => window.__store.select(id, null, true), ids.ven); await run(1800);
await ev(() => window.__store.select(null, null, false)); await run(500);
await rec('B_select', 100, async (i) => { if (i === 18) await ev((id) => window.__store.select(id, null, true), ids.guy); });

// C. the declaration: Diplomacy → Declare war → the WAR splash and the breaking news
await pg.locator('.tabs button:has-text("Diplomacy")').first().click(); await run(500);
const warBtn = pg.locator('button:has-text("Declare war…")').first(); await warBtn.scrollIntoViewIfNeeded(); await run(300);
await rec('C_declare', 120, async (i) => {
  if (i === 10) await warBtn.click();
  if (i === 30) await pg.locator('button.btn.danger:has-text("Declare war")').last().click();
});
await pg.keyboard.press('Escape').catch(() => {}); await ev(() => { const st = window.__store; st.splash = null; st.notify(); }); await run(400);

// E. the war room (full interface)
await ui(CLEAN); await ev(() => window.__store.setSpeed(3)); await run(2500); await ev(() => window.__store.setSpeed(0)); await run(300);
await rec('E_warroom', 110, async (i) => { if (i === 4) await ev(() => { const st = window.__store, s = st.state; const w = s.wars.find((x) => x.attackers.includes(s.player) || x.defenders.includes(s.player)); if (w) st.openWarRoom(w.id); }); });
await ev(() => { window.__store.warRoom = null; window.__store.notify(); }); await run(300);

// D. the front: armies advance, regions change hands (map only, close on the front, crisp every frame)
await ui(MAPONLY); await run(600);
await ev(() => { const st = window.__store, s = st.state, r = window.__renderer, geo = r.geom.geo; st.select(null, null, false);
  const w = s.wars.find((x) => x.attackers.includes(s.player) || x.defenders.includes(s.player)); const f = w?.fronts[0];
  const p = f ? f.prov : s.countries.find((c) => c.name === 'Guyana').capital; const sd = geo.provinces[p].seed;
  r.view.k = r.fitK * 9; r.view.x = r.w / 2 - sd[0] * r.view.k; r.view.y = r.h / 2 - sd[1] * r.view.k; r.targetK = r.view.k; r.dirty = true; st.setSpeed(3); });
await settle(); await run(1500);
await rec('D_front', 240, async (i, n) => { await ev(([f]) => { const r = window.__renderer; r.zoomNow(r.w * 0.5, r.h * 0.5, f); }, [1.0011]); await settle(); });

// I. the war ends: victory (or a ceasefire) as the game presents it
await ui(CLEAN); await run(300);
for (let k = 0; k < 120; k++) { const done = await ev(() => { const s = window.__store.state; return !s.wars.some((x) => x.attackers.includes(s.player) || x.defenders.includes(s.player)); }); if (done) break; await run(1000); }
await rec('I_victory', 110);
await pg.keyboard.press('Escape').catch(() => {}); await ev(() => { const st = window.__store; st.splash = null; st.notify(); }); await run(400);

// F. the negotiating table (full interface)
await ev((id) => { const st = window.__store; st.select(id, null, true); st.state.countries[st.state.player].politics.pc = 70; }, ids.bra); await run(1200);
await rec('F_nego', 100, async (i) => { if (i === 4) await ev((id) => window.__store.openNego(id, 'alliance'), ids.bra); });
await ev(() => { window.__store.nego = null; window.__store.notify(); }); await run(300);

// G. the world at war: two years later, wide, blocs map mode, very fast (map only)
await ev(() => { const st = window.__store; for (let i = 0; i < 90; i++) { st.state.inbox = []; st.stepOnce(); } st.state.inbox = []; st.notify(); });
await ui(MAPONLY); await ev(() => { const st = window.__store; st.select(null, null, false); window.__renderer.fitWorld(); st.mapMode = 'blocs'; st.notify(); }); await run(1500);
await pg.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (b.textContent?.trim() === 'Blocs') b.click(); })); await run(800);
await rec('G_blocs', 120, async (i) => { await ev(([f]) => { const r = window.__renderer; r.zoomNow(r.w * 0.55, r.h * 0.45, f); }, [1.0018]); await settle(); });
await pg.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (b.textContent?.trim() === 'Political') b.click(); })); await run(500);

// H. one world: the whole map turning at top speed (map only)
await ev(() => { window.__renderer.fitWorld(); window.__store.setSpeed(4); }); await run(800);
await rec('H_oneworld', 150, async (i) => { await ev(([f]) => { const r = window.__renderer; r.zoomNow(r.w * 0.5, r.h * 0.48, f); }, [0.9992]); await settle(); });

console.log(errors.join('\n') || 'no page errors');
await browser.close(); server.kill();
