/**
 * Browser smoke test (Playwright + the preinstalled Chromium).  Usage:  npm run build && npm run e2e
 * Starts `vite preview`, plays through the main loop on desktop and mobile viewports and fails on any
 * console error or broken assertion.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const PORT = 4179;
const URL = `http://127.0.0.1:${PORT}/`;
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], { stdio: 'ignore' });
let failures = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40; i++) { try { await fetch(URL); break; } catch { await sleep(250); } }

const browser = await chromium.launch({ executablePath: exe });
const errors = [];
const watch = (pg) => { pg.on('console', (m) => m.type() === 'error' && errors.push(m.text())); pg.on('pageerror', (e) => errors.push(String(e.stack))); };

async function startGame(pg, country, opts = {}) {
  await pg.goto(URL);
  await pg.waitForSelector('.start');
  await pg.fill('input[type=search]', country);
  await pg.click(`.picklist button:has-text("${country}")`);
  if (opts.noAlliances) await pg.click('label.check:has-text("Defensive alliances") input');
  await pg.click(`button:has-text("Lead ${country}")`);
  await pg.waitForSelector('.app');
  await quiet(pg, true);
}
const quiet = (pg, on) => pg.evaluate((o) => { window.__store.state.lastEventTick = o ? 1e9 : window.__store.state.tick; }, on);
async function answerEvent(pg) {
  const o = pg.locator('.event-opt:not([disabled])').first();
  if (await o.count()) { await o.click(); return true; }
  return false;
}
const S = (pg) => pg.evaluate(() => { const st = window.__store, s = st.state, c = s.countries[s.player]; return { tick: s.tick, speed: st.speed, wars: s.wars.length, cash: c.eco.cash, capital: c.eco.capital, troops: c.mil.troops, vat: c.budget.taxVat, rev: c.eco.revenue }; });

// ---------------- desktop ----------------
{
  const pg = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  watch(pg);
  await startGame(pg, 'Poland');
  const s0 = await S(pg);
  check('game starts paused at tick 0', s0.tick === 0 && s0.speed === 0);
  await quiet(pg, false);
  await pg.click('button[aria-label="Very fast"]');
  let sawEvent = false;
  for (let i = 0; i < 40 && !sawEvent; i++) { await sleep(250); sawEvent = await pg.locator('.event-opt').count() > 0; }
  check('a decision event pauses the game and offers choices', sawEvent && (await S(pg)).speed === 0);
  await answerEvent(pg);
  await quiet(pg, true);
  check('the news ticker shows headlines', (await pg.locator('.ticker-text').count()) > 0);
  await pg.click('button[aria-label="Pause"]');
  await pg.click('button[aria-label="Very fast"]'); await sleep(1500); await pg.click('button[aria-label="Pause"]');
  const s1 = await S(pg);
  check('time advances at very fast speed and pauses', s1.tick > 10 && (await S(pg)).tick === s1.tick, `(tick ${s1.tick})`);
  await pg.click('.tabs button:has-text("Economy")');
  await pg.locator('input[aria-label="Consumption tax (VAT)"]').fill('0.05');
  check('tax slider changes policy immediately', (await S(pg)).vat === 0.05);
  const k0 = (await S(pg)).capital;
  await pg.click('button:has-text("Build factories")');
  check('factory project adds capital instantly', (await S(pg)).capital > k0);
  await pg.click('.tabs button:has-text("Military")');
  const t0 = (await S(pg)).troops;
  await pg.click('button:has-text("Recruit +")');
  check('recruiting adds troops instantly', (await S(pg)).troops > t0);
  // map interaction: click Czechia's capital province
  const pos = await pg.evaluate(() => { const st = window.__store, m = window.__map, s = st.state; const c = s.countries.find((x) => x.name === 'Czechia'); const sd = st.geo.provinces[c.capital].seed; const b = document.querySelector('.map-wrap').getBoundingClientRect(); return { x: sd[0] * m.view.k + m.view.x + b.left, y: sd[1] * m.view.k + m.view.y + b.top }; });
  await pg.mouse.move(pos.x, pos.y); await sleep(200);
  check('hover tooltip shows country', (await pg.locator('.map-tip').count()) > 0 && (await pg.locator('.map-tip').innerText()).includes('Czechia'));
  await pg.mouse.click(pos.x, pos.y); await sleep(200);
  check('clicking the map selects the country', (await pg.locator('.side-head h2').innerText()) === 'Czechia');
  const kz = await pg.evaluate(() => window.__map.view.k);
  await pg.mouse.wheel(0, -500); await sleep(150);
  check('mouse wheel zooms', (await pg.evaluate(() => window.__map.view.k)) > kz);
  // diplomacy + war + fronts
  await pg.click('.tabs button:has-text("Diplomacy")');
  await pg.click('button:has-text("Declare war")'); await pg.click('.btnrow button:has-text("Declare war")');
  check('declaring war takes effect immediately', (await S(pg)).wars >= 1);
  await pg.click('button[aria-label="Fast"]'); await sleep(2500); await answerEvent(pg); await sleep(500);
  check('simulation keeps running after the player declares war', (await S(pg)).tick > s1.tick + 5);
  await pg.click('button[aria-label="Pause"]');
  // save / load
  await pg.click('button[aria-label="Menu"]'); await pg.click('button:has-text("Save game")');
  const saved = (await S(pg)).tick;
  await pg.click('button[aria-label="Fast"]'); await sleep(800); await pg.click('button[aria-label="Pause"]');
  await pg.click('button[aria-label="Menu"]'); await pg.click('button:has-text("Load saved game")'); await sleep(200);
  check('save then load restores the earlier state', (await S(pg)).tick === saved);
  await pg.close();
}
// ---------------- mobile ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const pg = await ctx.newPage();
  watch(pg);
  await startGame(pg, 'Japan');
  await sleep(1200);
  const layout = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, side: document.querySelector('.side').getBoundingClientRect().toJSON(), vh: innerHeight }));
  check('mobile: no horizontal overflow', layout.sw <= layout.cw);
  check('mobile: country details are a bottom sheet', layout.side.bottom >= layout.vh - 2 && layout.side.top > layout.vh * 0.3);
  const btn = await pg.locator('.speedrow button').first().boundingBox();
  check('mobile: touch targets are at least 40px', btn.height >= 40 && btn.width >= 40, `(${btn.width}x${btn.height})`);
  // pinch zoom through synthetic pointer events
  const k0 = await pg.evaluate(() => window.__map.view.k);
  await pg.evaluate(() => {
    const c = document.querySelector('.map-wrap'); const r = c.getBoundingClientRect();
    const ev = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: id === 1 }));
    ev('pointerdown', 1, 150, 250); ev('pointerdown', 2, 230, 250);
    for (let i = 1; i <= 8; i++) ev('pointermove', 2, 230 + i * 12, 250);
    ev('pointerup', 2, 326, 250); ev('pointerup', 1, 150, 250);
  });
  check('mobile: pinch gesture zooms the map', (await pg.evaluate(() => window.__map.view.k)) > k0 * 1.3);
  await pg.tap('.sheet-handle');
  check('mobile: tapping the handle expands the sheet', (await pg.locator('.side.full').count()) === 1);
  await pg.tap('.tabs button:has-text("Economy")');
  check('mobile: tabs work in the sheet', (await pg.locator('.side-body').innerText()).toLowerCase().includes('why is the economy moving'));
  await ctx.close();
}
await browser.close();
server.kill();
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(failures ? `\n${failures} check(s) failed` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
