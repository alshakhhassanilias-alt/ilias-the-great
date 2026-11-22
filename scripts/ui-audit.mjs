/**
 * Browser audit: plays three years of a Legacy game on a desktop, a laptop and a phone screen, then opens every tab (for
 * your own country and a foreign one), every view switch, every screen and every map mode, and reports console errors,
 * broken text (undefined, NaN), empty panels and horizontal scrolling on the phone. Usage: npm run audit:ui
 * (OUT=<folder> also saves phone screenshots there).
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
const PORT = 4302, URL = `http://127.0.0.1:${PORT}/`, OUT = process.env.OUT;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40; i++) { try { await fetch(URL); break; } catch { await sleep(250); } }
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const problems = [];
let where = '';
const note = (k, d = '') => problems.push(`${where} :: ${k} ${d}`.slice(0, 300));
for (const [tag, vp, country] of [['desk', { width: 1440, height: 900 }, 'Poland'], ['laptop', { width: 1280, height: 720 }, 'Brazil'], ['phone', { width: 390, height: 844 }, 'Turkey']]) {
  const pg = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
  pg.on('console', (m) => m.type() === 'error' && note('console', m.text())); pg.on('pageerror', (e) => note('pageerror', String(e.stack).slice(0, 200)));
  await pg.addInitScript(() => { try { localStorage.setItem('wo-tutorial-1', '1'); } catch {} });
  await pg.goto(URL); await pg.waitForSelector('.start');
  await pg.click('.mode-card:has-text("Legacy")');
  await pg.fill('input[type=search]', country); await pg.click(`.picklist button:has-text("${country}")`);
  await pg.click('.start-side .foot .btn.primary');
  await pg.waitForSelector('.agenda-card');
  await pg.click('.agenda-card >> nth=0'); await pg.click('.agenda-card >> nth=1'); await pg.click('.agenda-card >> nth=2');
  await pg.click('button:has-text("Swear to this agenda")');
  where = `${tag} aging`;
  // three years on, answering nothing: the later-game screens have something to show
  await pg.evaluate(async () => { const st = window.__store; for (let i = 0; i < 156; i++) { const s = st.state; s.inbox = []; if (s.legacy?.hand?.length) s.legacy.hand = []; if (s.plan?.pending) s.plan.pending = undefined; st.stepOnce(); if (i % 13 === 0) await new Promise((r) => setTimeout(r, 0)); } st.state.inbox = []; st.election = null; st.cine = null; st.splash = null; st.openDrawer('none'); st.notify(); });
  await sleep(500);
  const ids = await pg.evaluate(() => { const s = window.__store.state; const big = s.countries.filter((c) => c.alive && c.id !== s.player).sort((a, b) => b.eco.gdp - a.eco.gdp)[0]; return { me: s.player, other: big.id, alive: s.countries[s.player].alive, status: s.legacy?.status }; });
  for (const who of [ids.me, ids.other]) {
    for (const tab of ['overview', 'politics', 'goals', 'research', 'economy', 'military', 'diplomacy']) {
      where = `${tag} ${who === ids.me ? 'mine' : 'other'} ${tab}`;
      await pg.evaluate(([w, t]) => { const st = window.__store; st.select(w, null, false); st.setTab(t); }, [who, tab]);
      await sleep(250);
      const n = await pg.evaluate(() => (document.querySelector('.side-body')?.textContent ?? '').trim().length);
      if (who === ids.me && n < 80) note('nearly empty panel', String(n));
      if (/undefined|NaN|\[object/.test(await pg.evaluate(() => document.querySelector('.side-body')?.textContent ?? ''))) note('bad text', (await pg.evaluate(() => (document.querySelector('.side-body')?.textContent ?? '').match(/.{0,60}(undefined|NaN|\[object).{0,40}/)?.[0])));
      const segs = await pg.locator('.side-body .seg button').count();
      for (let i = 0; i < Math.min(segs, 12); i++) { await pg.locator('.side-body .seg button').nth(i).click({ timeout: 1500 }).catch(() => {}); await sleep(120); }
      await pg.evaluate(() => { const b = document.querySelector('.side-body'); if (b) b.scrollTop = b.scrollHeight; });
      await sleep(150);
      if (tag === 'phone') { const ov = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (ov > 2) note('horizontal overflow', `${ov}px`); }
      if (tag === 'phone' && who === ids.me) if (OUT) await pg.screenshot({ path: `${OUT}/ui-${tag}-${tab}.png` });
    }
  }
  const drawers = [['world', 'rankings'], ['world', 'blocs'], ['world', 'assembly'], ['world', 'wars'], ['world', 'news'], ['world', 'trophies'], ['world', 'history'], ['settings'], ['menu'], ['help'], ['legacy'], ['record'], ['campaign'], ['operation'], ['bill'], ['summit'], ['save'], ['load']];
  for (const [d, wt] of drawers) {
    where = `${tag} drawer ${d}${wt ? ':' + wt : ''}`;
    await pg.evaluate(([d, wt, other]) => { const st = window.__store; if (d === 'summit') st.openSummit(other); else st.openDrawer(d, wt); }, [d, wt, ids.other]);
    await sleep(350);
    const txt = await pg.evaluate(() => (document.querySelector('.modal, .drawer, .scrim')?.textContent ?? ''));
    if (!txt.trim()) note('drawer empty or missing');
    if (/undefined|NaN|\[object/.test(txt)) note('bad text', txt.match(/.{0,60}(undefined|NaN|\[object).{0,40}/)?.[0]);
    if (tag === 'phone') { const ov = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (ov > 2) note('horizontal overflow', `${ov}px`); if (OUT) await pg.screenshot({ path: `${OUT}/ui-${tag}-drawer-${d}${wt ? '-' + wt : ''}.png` }); }
    await pg.evaluate(() => { const st = window.__store; st.summitWith = null; st.openDrawer('none'); });
    await sleep(100);
  }
  for (const m of ['political', 'blocs', 'spheres', 'diplomacy', 'wealth', 'power', 'stability']) { where = `${tag} map ${m}`; await pg.evaluate((m) => window.__store.setMapMode(m), m); await sleep(250); }
  where = `${tag} run`;
  await pg.evaluate(() => window.__store.setSpeed(3)); await sleep(4000); await pg.evaluate(() => window.__store.setSpeed(0));
  console.log(tag, JSON.stringify(ids));
  await pg.close();
}
console.log(`PROBLEMS ${problems.length}`); for (const p of problems.slice(0, 60)) console.log(p);
await browser.close(); server.kill();
process.exit(problems.length ? 1 : 0);
