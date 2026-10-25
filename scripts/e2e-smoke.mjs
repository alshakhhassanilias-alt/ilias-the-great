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
  await pg.addInitScript(() => { try { localStorage.setItem('wo-tutorial-1', '1'); } catch {} });
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
  await pg.evaluate(() => { const s = window.__store.state; s.inbox.push({ uid: 99, id: 'tax_demand', tick: s.tick, expires: s.tick + 200, urgent: false, data: {} }); window.__store.notify(); });
  await pg.click('button[aria-label="Very fast"]');
  await sleep(1500);
  // (every new game is its own world, so another decision, such as a storyline act, may also have arrived by now)
  check('a decision waits in the inbox without stopping the game', (await pg.evaluate(() => window.__store.state.inbox.some((x) => x.uid === 99))) && (await pg.locator('.inbox-item').count()) >= 1 && (await S(pg)).speed === 4 && (await S(pg)).tick > 5);
  await pg.click('.inbox-row');
  check('expanding a decision shows its choices', (await pg.locator('.inbox .event-opt').count()) >= 2);
  await pg.locator('.inbox .event-opt:not([disabled])').first().click();
  check('answering a decision clears it', (await pg.locator('.inbox-item').count()) === 0);
  await pg.evaluate(() => { const s = window.__store.state; s.inbox.push({ uid: 98, id: 'tax_demand', tick: s.tick, expires: s.tick + 200, urgent: false, data: {} }); window.__store.notify(); });
  await pg.click('.inbox-row');
  const ht = (await S(pg)).tick; await sleep(1200);
  check('the clock holds while a decision is open', (await S(pg)).tick === ht && (await pg.evaluate(() => window.__store.heldBy)) === 'a decision');
  check('an open decision says what happens if it lapses', (await pg.locator('.lapse-line').count()) === 1);
  await answerEvent(pg); await sleep(800);
  check('the clock runs again once the decision is answered', (await S(pg)).tick > ht);
  await pg.evaluate(() => { const s = window.__store.state; s.log.push({ seq: s.logSeq++, tick: s.tick, text: 'TEST CAPITAL FALLS', kind: 'war', countries: [s.player], important: true, big: true, prov: 0 }); });
  await sleep(1200);
  check('breaking news shows a banner', (await pg.locator('.breaking').count()) === 1);
  await quiet(pg, true);
  check('the news ticker shows headlines', (await pg.locator('.ticker-text').count()) > 0);
  await pg.click('button[aria-label="Pause"]');
  await pg.click('button[aria-label="Very fast"]'); await sleep(2800); await pg.click('button[aria-label="Pause"]');
  const s1 = await S(pg);
  check('time advances at very fast speed and pauses', s1.tick > 10 && (await S(pg)).tick === s1.tick, `(tick ${s1.tick})`);
  await pg.click('.tabs button:has-text("Economy")');
  {
    const fin = await pg.locator('.fin-grid').innerText();
    const top = await pg.locator('.kpi:has-text("Treasury") small').innerText();
    const bal = await pg.evaluate(() => { const st = window.__store, s = st.state, c = s.countries[s.player]; const e = c.eco, b = c.budget; return e.gdp * e.collection * (b.taxIncome * 0.5 + b.taxCorporate * 0.2 + b.taxVat * 0.55) > 0; });
    check('the budget names a deficit or a surplus the same way in the top bar and the Economy tab', bal && (/DEFICIT/i.test(fin) ? /deficit/.test(top) : /surplus/.test(top)));
  }
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
  await pg.click('button:has-text("Negotiate…")');
  check('the negotiating table shows what they want, the odds and the factors', (await pg.locator('.modal.nego').count()) === 1 && /%|Refused/.test(await pg.locator('.nego-odds').innerText()) && (await pg.locator('.nego-factors li').count()) >= 2);
  await pg.click('.nego-actions button:has-text("Walk away")');
  check('walking away closes the table', (await pg.locator('.modal.nego').count()) === 0);
  await pg.click('button:has-text("Declare war")'); await pg.click('.btnrow button:has-text("Declare war")');
  check('declaring war takes effect immediately', (await S(pg)).wars >= 1);
  await pg.click('button[aria-label="Very fast"]');
  // wait for the moment itself (how many weeks pass per second depends on the machine)
  for (let i = 0; i < 32 && (await S(pg)).speed !== 0; i++) await sleep(250);
  // an urgent decision about to lapse stops the clock and says so; answer it and carry on
  const lastChance = (await S(pg)).speed === 0 && (await pg.locator('.toast:has-text("needs your answer")').count()) > 0;
  if (!(await pg.locator('.inbox .event-opt').count())) await pg.locator('.inbox-row').first().click().catch(() => {});
  await answerEvent(pg);
  await pg.evaluate(() => window.__store.openInbox(null));
  await pg.click('button[aria-label="Very fast"]'); await sleep(1500);
  check('an urgent decision pauses the game before it lapses, and play resumes after answering', lastChance && (await S(pg)).tick > s1.tick + 5, `(tick ${(await S(pg)).tick})`);
  // battles: zoom onto the front, click a battle marker, the report opens
  await pg.click('button[aria-label="Pause"]');
  await pg.evaluate(() => window.__store.openInbox(null));
  await pg.evaluate(() => { const s = window.__store.state; const R = window.__renderer; const b = R.geom.focusBox(s, s.player); R.focusBox([b[0], b[1], b[2] + 12, b[3]], 0, 440, false); });
  await sleep(900);
  const hits = await pg.evaluate(() => window.__renderer.battleHits);
  if (hits.length) {
    const mapBox = await pg.locator('.map-wrap').boundingBox();
    // click a marker that no panel covers (the decision tray sits over the bottom-left of the map)
    const free = await pg.evaluate(({ hs, bx, by }) => hs.find((h) => document.elementFromPoint(bx + h.x, by + h.y)?.classList.contains('map-canvas')) ?? hs[0], { hs: hits, bx: mapBox.x, by: mapBox.y });
    await pg.mouse.click(mapBox.x + free.x, mapBox.y + free.y);
    await sleep(300);
  }
  check('clicking a battle opens the battle report', hits.length > 0 && (await pg.locator('.battle-card').count()) === 1, `(${hits.length} battles)`);
  if (await pg.locator('.battle-card .x').count()) await pg.click('.battle-card .x');
  // war support + supply lines: the top bar pill opens the home front
  const atWarNow = await pg.evaluate(() => window.__store.state.wars.some((w) => w.attackers.includes(window.__store.state.player) || w.defenders.includes(window.__store.state.player)));
  if (atWarNow) {
    await pg.click('.ws-kpi');
    await sleep(200);
    const body = (await pg.locator('.side-body').innerText()).toLowerCase();
    check('war support shows in the top bar and opens the home front with supply lines', body.includes('home front') && body.includes('supply lines') && (await pg.locator('.ws-big').count()) === 1);
    const ws0 = await pg.evaluate(() => window.__store.state.countries[window.__store.state.player].mil.warSupport);
    await pg.click('button:has-text("Propaganda campaign")');
    check('a propaganda campaign raises war support', (await pg.evaluate(() => window.__store.state.countries[window.__store.state.player].mil.warSupport)) > ws0);
  } else check('war support shows in the top bar and opens the home front with supply lines', true, '(war already over: skipped)');
  // goals tab
  await pg.evaluate(() => window.__store.select(window.__store.state.player, null, false));
  await pg.click('.tabs button:has-text("Goals")');
  check('the Goals tab shows objectives and the country check-up', (await pg.locator('.goal-card').count()) >= 1 && (await pg.locator('.check-row').count()) >= 5);
  await pg.click('.tabs button:has-text("Overview")');
  check('the cabinet briefs you: four named ministers with portraits', (await pg.locator('.minister').count()) === 4 && (await pg.locator('.minister .portrait').count()) === 4);
  await pg.click('.min-head >> nth=0');
  check('a minister reports concrete numbers and can be replaced', /GDP/.test(await pg.locator('.min-more').innerText()) && (await pg.locator('.min-more button:has-text("Replace")').count()) === 1);
  await pg.evaluate(() => { const st = window.__store, s = st.state; const ru = s.countries.findIndex((x) => x.name === 'Russia'); s.offers = []; s.lastRipple = undefined; s.review = undefined; s.stats.cableSeq = (s.stats.cableSeq || 0) + 1; (s.cables ||= []).push({ tick: s.tick, from: ru, text: 'A test of the cable desk, from Moscow.', mood: 'cold', seq: s.stats.cableSeq }); st.notify(); });
  await sleep(100);
  // on the desktop a leader's messages do not pop up: they wait in that leader's dossier
  check('no diplomatic cable pops up over the map', (await pg.locator('.notes-col .cable').count()) === 0);
  await pg.evaluate(() => { const st = window.__store; st.select(st.state.countries.findIndex((x) => x.name === 'Russia'), null, false); st.setTab('overview'); });
  await sleep(200);
  check("a leader's latest message is in their dossier", /cable desk/.test(await pg.locator('.leader-quote').first().innerText()));
  await pg.evaluate(() => { const st = window.__store; st.select(st.state.player, null, false); });
  await pg.click('.tabs button:has-text("Politics")');
  check('the Politics tab shows six factions, a parliament and political capital', (await pg.locator('.faction').count()) === 6 && (await pg.locator('.hemicycle circle').count()) >= 95 && (await pg.locator('.pc-big b').count()) === 1);
  const lawsBefore = await pg.evaluate(() => { const s = window.__store.state; const c = s.countries[s.player]; c.politics.pc = 100; window.__store.notify(); return c.politics.laws.length; });
  await pg.click('.law-head:has-text("Universal Healthcare")');
  await pg.locator('.law.open input[type=range]').fill('30');
  await pg.click('.law.open .btn.primary');
  check('a law can be put to a vote from the Politics tab', (await pg.evaluate(() => { const s = window.__store.state; return s.countries[s.player].politics.laws.length; })) === lawsBefore + 1);
  await pg.click('.tabs button:has-text("Goals")');
  check('the Goals tab shows the national path for the country', (await pg.locator('.path-node').count()) >= 6 && /Bastion of the East/i.test(await pg.locator('.side-body').innerText()));
  await pg.evaluate(() => { const s = window.__store.state; const c = s.countries[s.player]; c.politics.pc = 100; c.eco.cash = 1e13; window.__store.notify(); });
  await pg.click('.path-node:has-text("Silicon Vistula")');
  await pg.click('.path-detail .btn.primary');
  check('a national project can be started', (await pg.evaluate(() => { const s = window.__store.state; return s.countries[s.player].nat?.active?.id; })) === 'pl_vistula');
  await pg.click('.tabs button:has-text("Military")');
  await pg.click('.prog:has-text("Drone Corps") .btn');
  check('a weapons programme can be started from the Military tab', (await pg.evaluate(() => { const s = window.__store.state; return (s.countries[s.player].progs ?? []).length; })) === 1);
  await pg.click('button[aria-label="Pause"]');
  // save / load
  await pg.click('button[aria-label="Menu"]'); await pg.click('.pause-menu button:has-text("Save game")');
  await pg.fill('#save-name', 'E2E test save'); await pg.click('.sv-new button[type=submit]'); await sleep(400);
  const saved = (await S(pg)).tick;
  check('a named save appears in the save list', await pg.evaluate(() => window.__store.saveList.some((m) => m.name === 'E2E test save')));
  await pg.click('button[aria-label="Very fast"]'); await sleep(800); await pg.click('button[aria-label="Pause"]');
  await pg.click('button[aria-label="Menu"]'); await pg.click('.pause-menu button:has-text("Load game")');
  await pg.click('.sv-row:has-text("E2E test save") button:has-text("Load")'); await pg.click('.ask button:has-text("Load")'); await sleep(400);
  check('save then load restores the earlier state', (await S(pg)).tick === saved);
  await pg.keyboard.press('F5'); await sleep(400);
  check('F5 quick saves', await pg.evaluate(() => window.__store.saveList.some((m) => m.name === 'Quicksave')));
  await pg.click('button[aria-label="Menu"]'); await pg.click('.pause-menu button:has-text("Settings")');
  check('settings has display, sound and controls', (await pg.locator('.set-tabs button').count()) === 4);
  await pg.click('.set-tabs button:has-text("Controls")');
  await pg.click('.kb-row:has-text("Pause / resume") .kb-key'); await pg.keyboard.press('KeyK');
  check('a key can be rebound', (await pg.locator('.kb-row:has-text("Pause / resume") .kb-key').innerText()) === 'K');
  await pg.click('button:has-text("Restore default keys")');
  await pg.keyboard.press('Escape'); await sleep(100);
  await pg.close();
}
// ---------------- Legacy mode ----------------
{
  const pg = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  watch(pg);
  await pg.addInitScript(() => { try { localStorage.setItem('wo-tutorial-1', '1'); } catch {} });
  await pg.goto(URL);
  await pg.waitForSelector('.start');
  await pg.click('.mode-card:has-text("Legacy")');
  await pg.fill('input[type=search]', 'Poland'); await pg.click('.picklist button:has-text("Poland")');
  await pg.click('.start-side .foot .btn.primary');
  await pg.waitForSelector('.app');
  await pg.waitForSelector('.agenda-card');
  check('Legacy: taking office deals five agenda cards', (await pg.locator('.agenda-card').count()) === 5);
  await pg.click('.agenda-card >> nth=0'); await pg.click('.agenda-card >> nth=1'); await pg.click('.agenda-card >> nth=3');
  await pg.click('button:has-text("Swear to this agenda")');
  check('Legacy: the chosen promises become the agenda', (await pg.evaluate(() => window.__store.state.legacy.agenda.length)) === 3 && (await pg.locator('.agenda-card').count()) === 0);
  await pg.click('.legacy-chip');
  const dossier = (await pg.locator('.legacy-modal').innerText()).toLowerCase();
  check('Legacy: the chip opens the legacy dossier', dossier.includes('legacy') && dossier.includes('prosperity'));
  await pg.close();
}
// ---------------- army groups ----------------
{
  const pg = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  watch(pg);
  await pg.addInitScript(() => { try { localStorage.setItem('wo-tutorial-1', '1'); } catch {} });
  await pg.goto(URL);
  await pg.waitForSelector('.start');
  await pg.fill('input[type=search]', 'Poland'); await pg.click('.picklist button:has-text("Poland")');
  await pg.click('.ctl-preset:has-text("Strategist")');
  await pg.click('label.check:has-text("Defensive alliances") input');
  await pg.click('.start-side .foot .btn.primary');
  await pg.waitForSelector('.app');
  await quiet(pg, true);
  await pg.evaluate(() => { const s = window.__store.state; const id = s.countries.findIndex((c) => c.name === 'Belarus'); window.__store.select(id, null, false); });
  await pg.click('.tabs button:has-text("Diplomacy")');
  await pg.click('button:has-text("Negotiate…")');
  check('the negotiating table shows what they want, the odds and the factors', (await pg.locator('.modal.nego').count()) === 1 && /%|Refused/.test(await pg.locator('.nego-odds').innerText()) && (await pg.locator('.nego-factors li').count()) >= 2);
  await pg.click('.nego-actions button:has-text("Walk away")');
  check('walking away closes the table', (await pg.locator('.modal.nego').count()) === 0);
  await pg.click('button:has-text("Declare war")'); await pg.click('.btnrow button:has-text("Declare war")');
  await pg.evaluate(() => { const st = window.__store; st.closeSplash(); for (let i = 0; i < 3; i++) st.stepOnce(); st.select(st.state.player, null, false); st.toasts = []; st.breaking = null; st.notify(); });
  await pg.evaluate(() => { const r = window.__renderer; const s = window.__store.state; const geo = window.__store.geo; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const n of ['Poland', 'Belarus']) for (const p of s.countries.find((c) => c.name === n).provinces) { const bb = geo.provinces[p].bbox; x0 = Math.min(x0, bb[0]); y0 = Math.min(y0, bb[1]); x1 = Math.max(x1, bb[2]); y1 = Math.max(y1, bb[3]); } r.focusBox([x0, y0, x1, y1], 0, 470, false); });
  await sleep(800);
  const info = await pg.evaluate(() => { const r = window.__renderer; const s = window.__store.state; const geo = window.__store.geo; const B = s.countries.find((c) => c.name === 'Belarus'); const sd = geo.provinces[B.capital].seed; return { n: s.armies?.length ?? 0, h: r.armyHits[0], tx: sd[0] * r.view.k + r.view.x, ty: sd[1] * r.view.k + r.view.y, cap: B.capital }; });
  check('armies: going to war forms army groups on the map', info.n >= 3 && !!info.h, `(${info.n} armies)`);
  if (info.h) {
    const box = await pg.locator('.map-wrap').boundingBox();
    await pg.mouse.move(box.x + info.h.x, box.y + info.h.y); await pg.mouse.down();
    for (let i = 1; i <= 10; i++) await pg.mouse.move(box.x + info.h.x + (info.tx - info.h.x) * i / 10, box.y + info.h.y + (info.ty - info.h.y) * i / 10);
    await pg.mouse.up(); await sleep(200);
    const tgt = await pg.evaluate((id) => window.__store.state.armies.find((a) => a.id === id).target, info.h.id);
    check('armies: dragging an army onto an enemy region sets its objective', tgt === info.cap, `(target ${tgt})`);
  }
  // round 33: research, industries, influence, the coalition
  await pg.evaluate(() => { const st = window.__store; st.setSpeed(0); st.select(st.state.player, null, false); st.setTab('research'); });
  await sleep(500);
  check('research: the tab shows five branches', (await pg.locator('.rs-branch').count()) === 5);
  const pick = pg.locator('.rs-go').first();
  if (await pick.count()) { await pick.click(); await sleep(200); }
  else { await pg.locator('.rs-alt').first().click(); await sleep(200); }
  check('research: picking a technology sets the current research', (await pg.evaluate(() => window.__store.state.countries[window.__store.state.player].rs.cur)) >= 0);
  await pg.evaluate(() => window.__store.setTab('economy')); await sleep(400);
  check('industries: eight sectors with world ranks', (await pg.locator('.ind-card').count()) === 8);
  await pg.evaluate(() => window.__store.setTab('politics')); await sleep(400);
  check('politics: the coalition panel lists the partners', (await pg.locator('.coal-card').count()) >= 1);
  await pg.evaluate(() => { const st = window.__store; const id = st.state.countries.findIndex((c) => c.name === 'Lithuania'); st.select(id, null, true); st.setTab('diplomacy'); });
  await sleep(500);
  check('influence: a foreign country shows who holds sway there', (await pg.locator('.inf-acts .btn').count()) === 5);
  await pg.evaluate(() => window.__store.setMapMode('spheres')); await sleep(400);
  check('influence: the Spheres map mode is available', (await pg.evaluate(() => window.__store.mapMode)) === 'spheres');
  await pg.evaluate(() => window.__store.setMapMode('political'));
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
