'use strict';
// End-to-end test of the real UI in headless Chromium at iPhone size.
// Run: node --test tests/e2e.test.js   (screenshots → tests/screens/)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')));
}

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'screens');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, () => resolve(srv));
  });
}

test('waiter flow on iPhone viewport', async (t) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await serve();
  const url = 'http://localhost:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + '.png') });
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('waiter.state.v1')));

  await page.goto(url);
  await shot('01-empty');

  await t.test('open table 12 with keypad', async () => {
    await page.tap('.actionbar [data-a="newTable"]');
    await page.tap('.keypad >> text=1');
    await page.tap('.keypad >> text=2');
    await page.tap('[data-a="kpGuests"][data-g="3"]');
    await shot('02-keypad');
    await page.tap('[data-a="createTable"]');
    await page.waitForSelector('#picker');
    const s = await state();
    assert.equal(s.tables.length, 1);
    assert.equal(s.tables[0].num, '12');
    assert.equal(s.tables[0].guests, 3);
  });

  await t.test('search + tap adds, second tap merges', async () => {
    await page.fill('#psearch', 'пельм сиб');
    await page.waitForSelector('#plist .irow');
    await shot('03-search');
    const first = page.locator('#plist .irow').first();
    assert.match(await first.innerText(), /Пельмени сибирские/);
    await first.locator('[data-a="pickQ"][data-c="yes"]').tap();
    await first.locator('[data-a="pickQ"][data-c="yes"]').tap();
    const s = await state();
    assert.equal(s.tables[0].lines.length, 1);
    assert.equal(s.tables[0].lines[0].qty, 2);
    assert.equal(s.tables[0].lines[0].itemId, 'pl_sib');
    assert.equal(s.tables[0].lines[0].opts.smet, 'yes');
  });

  await t.test('tasting set counter like the tablet', async () => {
    await page.fill('#psearch', 'дегустационный сет');
    await page.locator('#plist [data-a="pick"]').first().tap();
    await page.waitForSelector('.crow');
    assert.equal(await page.locator('.crow').count(), 10);
    const plus = (c) => page.tap('[data-a="lCnt"][data-c="' + c + '"][data-d="1"]');
    await plus('c1'); await plus('c1'); await plus('c1'); await plus('c9');
    assert.equal(await page.locator('[data-a="lSave"]').isDisabled(), true);
    await plus('c9');
    assert.equal(await page.locator('[data-a="lCnt"][data-c="c2"][data-d="1"]').isDisabled(), true);
    await shot('17-shot-set');
    await page.tap('[data-a="closeSheet"]');
  });

  await t.test('shortcut search learns what you pick', async () => {
    await page.fill('#psearch', 'пс');
    await page.waitForSelector('#plist .irow');
    assert.match(await page.locator('#plist .irow').first().innerText(), /Пельмени сибирские/);
    // pick the 2nd result twice → it should come first next time
    const second = page.locator('#plist [data-a="pick"]').nth(1);
    const name = (await second.innerText()).split('\n').find((x) => /[а-я]/i.test(x) && x.length > 4);
    await second.tap();
    await page.fill('#psearch', '');
    await page.fill('#psearch', 'пс');
    await page.locator('#plist [data-a="pick"]').first().innerText().then((txt) => assert.ok(txt.includes(name.replace(/^(варёные|NEW|STOP|⚠ check|★)\s*/, '').slice(0, 10)), txt + ' vs ' + name));
    // undo the extra line so later checks see the same order as before
    await page.tap('[data-a="undo"]');
    await page.tap('[data-a="pClear"]');
  });

  await t.test('wrong keyboard layout search works', async () => {
    await page.fill('#psearch', ',jhom');   // “борщ” typed on EN layout
    await page.waitForSelector('#plist .irow');
    assert.match(await page.locator('#plist .irow').first().innerText(), /борщ/i);
    await page.tap('[data-a="pClear"]');
  });

  await t.test('juice needs a size before it can be added', async () => {
    await page.tap('[data-a="pGroup"][data-g="drinks"]');
    await page.tap('[data-a="pCat"][data-c="juice"]');
    await page.locator('#plist [data-a="pick"]', { hasText: 'Сок Апельсиновый' }).tap();
    await page.waitForSelector('.sheet');
    assert.equal(await page.locator('[data-a="lSave"]').isDisabled(), true);
    await shot('04-size-sheet');
    await page.tap('[data-a="lOpt"][data-c="1000"]');
    assert.equal(await page.locator('[data-a="lSave"]').isDisabled(), false);
    assert.match(await page.locator('[data-a="lSave"]').innerText(), /820/);
    await page.tap('[data-a="lSave"]');
    const s = await state();
    const juice = s.tables[0].lines.find((l) => l.itemId === 'jc_orange');
    assert.equal(juice.opts.size, '1000');
  });

  await t.test('main with side: reminder, swap +35 via editor', async () => {
    await page.tap('[data-a="pGroup"][data-g="food"]');
    await page.tap('[data-a="pCat"][data-c="mains"]');
    await page.locator('#plist [data-a="pick"]', { hasText: 'Жареный судак' }).tap();
    await page.tap('[data-a="closePicker"]');
    await page.waitForSelector('.line');
    await shot('05-table');
    const body = await page.locator('#app').innerText();
    assert.match(body, /Side: картофельное пюре/);
    assert.match(body, /Offer Куриный бульон/);
    await page.locator('.line', { hasText: 'Жареный судак' }).locator('[data-a="editLine"]').tap();
    await page.waitForSelector('.sheet');
    await page.tap('[data-a="lSide"][data-v="sd_rice"]');
    await page.evaluate(() => { document.querySelector('.sheet').scrollTop = 0; });
    await shot('06-line-editor');
    await page.tap('[data-a="lSave"]');
    const s = await state();
    const sudak = s.tables[0].lines.find((l) => l.itemId === 'mn_sudak');
    assert.equal(sudak.sideSwap, 'sd_rice');
    assert.doesNotMatch(await page.locator('#app').innerText(), /Side: картофельное пюре/);
  });

  await t.test('offer chip adds bouillon; +/- buttons', async () => {
    await page.tap('[data-a="addMod"][data-mod="r_broth"]');
    let s = await state();
    assert.equal(s.tables[0].lines.find((l) => l.itemId === 'pl_sib').mods.r_broth, 1);
    const line = page.locator('.line', { hasText: 'Пельмени сибирские' });
    await line.locator('[data-a="inc"]').tap();
    s = await state();
    assert.equal(s.tables[0].lines.find((l) => l.itemId === 'pl_sib').qty, 3);
    await line.locator('[data-a="dec"]').tap();
  });

  await t.test('undo restores a removed line', async () => {
    const line = page.locator('.line', { hasText: 'Сок Апельсиновый' });
    await line.locator('[data-a="dec"]').tap();
    assert.equal((await state()).tables[0].lines.some((l) => l.itemId === 'jc_orange'), false);
    await page.tap('[data-a="undo"]');
    assert.equal((await state()).tables[0].lines.some((l) => l.itemId === 'jc_orange'), true);
  });

  await t.test('notes on a line and on the table, custom request', async () => {
    const line = page.locator('.line', { hasText: 'Пельмени сибирские' }).first();
    await line.locator('[data-a="noteLine"]').tap();
    await page.fill('#note_text', 'без укропа');
    await page.tap('[data-a="noteChip"][data-n="соус отдельно"]');
    await page.tap('[data-a="noteSave"]');
    assert.match(await page.locator('.line', { hasText: 'Пельмени сибирские' }).first().innerText(), /📝 без укропа, соус отдельно/);
    await page.tap('[data-a="noteTable"]');
    await page.fill('#note_text', 'аллергия на орехи');
    await page.tap('[data-a="noteSave"]');
    assert.match(await page.locator('#app').innerText(), /📝 аллергия на орехи/);
    await page.tap('[data-a="openPicker"]');
    await page.fill('#psearch', 'тёплое молоко для ребёнка');
    await page.tap('[data-a="customLine"]');
    await page.fill('#cl_new_price', '100');
    await page.tap('[data-a="customSave"]');
    await page.tap('[data-a="closePicker"]');
    await shot('16-notes-custom');
    const txt = await page.locator('#app').innerText();
    assert.match(txt, /тёплое молоко для ребёнка/);
    const s = await state();
    const cl = s.tables[0].lines.find((l) => l.custom);
    assert.equal(cl.custom.price, 100);
    // remove the custom line again so later checks see the same order
    await page.locator('.line', { hasText: 'тёплое молоко' }).locator('[data-a="dec"]').tap();
  });

  await t.test('state survives a reload (app killed by iOS)', async () => {
    await page.reload();
    await page.waitForSelector('.line');
    const txt = await page.locator('#app').innerText();
    assert.match(txt, /Стол 12/);
    assert.match(txt, /Пельмени сибирские/);
  });

  await t.test('review → tick → mark entered; re-order shows second-order warning', async () => {
    await page.tap('[data-a="review"]');
    await page.waitForSelector('.rvline');
    await shot('07-review');
    const txt = await page.locator('#app').innerText();
    // menu order: pelmeni before mains before juice
    assert.ok(txt.indexOf('Пельмени') < txt.indexOf('судак') && txt.indexOf('судак') < txt.indexOf('Сок'));
    await page.tap('[data-a="markSent"]');
    let s = await state();
    assert.ok(s.tables[0].lines.every((l) => l.status === 'sent'));
    await page.tap('[data-a="openPicker"]');
    await page.fill('#psearch', 'пельмени сибирские');
    await page.locator('#plist [data-a="pickQ"][data-c="yes"]').first().tap();
    await page.tap('[data-a="closePicker"]');
    assert.match(await page.locator('#app').innerText(), /already entered ×2/);
    s = await state();
    assert.equal(s.tables[0].lines.length, 4);
  });

  await t.test('second table and quick switching strip', async () => {
    await page.tap('[data-a="tab"][data-v="tables"]');
    await page.tap('.actionbar [data-a="newTable"]');
    await page.tap('.keypad >> text=4');
    await page.tap('[data-a="createTable"]');
    await page.fill('#psearch', 'мохито');
    await page.waitForSelector('#plist .irow');
    await shot('08-mojito-lookalikes');
    const rows = await page.locator('#plist .irow').allInnerTexts();
    assert.ok(rows.some((r) => /С РОМОМ/.test(r)) && rows.some((r) => /БЕЗ АЛКОГОЛЯ/.test(r)));
    await page.tap('[data-a="closePicker"]');
    await page.locator('.strip [data-a="open"]', { hasText: '12' }).tap();
    assert.match(await page.locator('#app').innerText(), /Стол 12/);
    await page.tap('[data-a="tab"][data-v="tables"]');
    await shot('09-tables');
  });

  await t.test('opening an already-open table number does not duplicate it', async () => {
    await page.tap('.actionbar [data-a="newTable"]');
    await page.tap('.keypad >> text=4');
    await page.tap('[data-a="createTable"]');
    const s = await state();
    assert.equal(s.tables.filter((x) => x.num === '4').length, 1);
    await page.tap('[data-a="closePicker"]').catch(() => {});
  });

  await t.test('breakfast gift reminder', async () => {
    // Add an omelet through the UI, then back-date it to 10:00 in the live state.
    await page.tap('[data-a="openPicker"]');
    await page.fill('#psearch', 'омлет');
    await page.locator('#plist [data-a="pick"]').first().tap();
    await page.tap('[data-a="closePicker"]');
    await page.evaluate(() => {
      const d = new Date(); d.setHours(10, 0, 0, 0);
      const t = window.__waiter.state.tables.find((x) => x.num === '4');
      t.lines.find((l) => l.itemId === 'omelet').addedAt = d.getTime();
    });
    await page.tap('[data-a="tab"][data-v="table"]');
    assert.match(await page.locator('#app').innerText(), /free espresso \/ americano \/ tea/);
  });

  await t.test('close table goes to history and can be reopened', async () => {
    await page.tap('[data-a="tableMenu"]');
    await page.tap('[data-a="closeTable"]');
    // Table has an omelet not yet entered in POS → in-app confirmation
    assert.match(await page.locator('.sheet').innerText(), /NOT marked as entered/);
    await page.tap('[data-a="confirmOk"]');
    let s = await state();
    assert.equal(s.tables.length, 1);
    assert.equal(s.history.length, 1);
    await page.tap('[data-a="histOpen"]');
    await page.tap('[data-a="reopen"]');
    s = await state();
    assert.equal(s.tables.length, 2);
  });

  await t.test('stop-list marks item in picker', async () => {
    await page.tap('[data-a="tab"][data-v="menu"]');
    await page.fill('#msearch', 'борщ');
    await page.locator('#mlist [data-a="editItem"]').first().tap();
    await page.tap('.sheet [data-a="stop"]');
    await page.tap('.sheet [data-a="saveItem"]');
    await page.tap('[data-a="tab"][data-v="table"]');
    await page.tap('[data-a="openPicker"]');
    await page.fill('#psearch', 'борщ');
    assert.match(await page.locator('#plist .irow').first().innerText(), /STOP/);
    await page.tap('[data-a="closePicker"]');
    await page.tap('[data-a="tab"][data-v="menu"]');
    await page.tap('[data-a="mFilter"][data-f="unv"]');
    await shot('10-verify-list');
    await page.tap('[data-a="mFilter"][data-f="data"]');
    await shot('11-data');
  });

  await t.test('quiz and flashcards work', async () => {
    await page.tap('[data-a="tab"][data-v="learn"]');
    await page.waitForSelector('.answer');
    await page.locator('.answer').first().tap();
    assert.ok(await page.locator('.answer.right').count() === 1);
    await shot('12-quiz');
    await page.tap('[data-a="nextQ"]');
    await page.tap('[data-a="lrMode"][data-m="flash"]');
    await page.tap('[data-a="flip"]');
    await page.tap('[data-a="flashGrade"][data-r="1"]');
    await page.tap('[data-a="lrMode"][data-m="confuse"]');
    await shot('13-lookalikes');
    const s = await state();
    assert.equal(s.training.stats.right + s.training.stats.wrong, 2);
  });

  await t.test('practice order: separate from real tables, graded', async () => {
    const before = await state();
    await page.tap('[data-a="tab"][data-v="learn"]');
    await page.tap('[data-a="lrMode"][data-m="drill"]');
    await page.tap('[data-a="drillStart"]');
    // add something through the real picker — must land on the practice table
    await page.tap('[data-a="openPicker"]');
    await page.fill('#psearch', 'уха');
    await page.locator('#plist [data-a="pick"]').first().tap();
    assert.match(await page.locator('#pdone').innerText(), /Practice · 1 new/);
    await page.tap('[data-a="closePicker"]');
    let s = await state();
    assert.deepEqual(s.tables.map((x) => x.lines.length), before.tables.map((x) => x.lines.length));
    assert.deepEqual(s.usage, before.usage);
    // replace with a perfect answer and check
    await page.evaluate(() => {
      const pr = window.__waiter.ui.practice;
      pr.table.lines = pr.sc.lines.map((l) => Object.assign(window.__waiter.L.newLine(l.itemId), JSON.parse(JSON.stringify(l)), { sideOk: !l.sideSwap }));
    });
    await page.tap('[data-a="lrMode"][data-m="drill"]');
    await page.tap('[data-a="drillCheck"]');
    await shot('14-practice-result');
    const txt = await page.locator('#app').innerText();
    assert.doesNotMatch(txt, /✗/);
    s = await state();
    assert.equal(s.training.drill.perfect, 1);
    await page.tap('[data-a="drillStart"]');
    await page.tap('[data-a="drillCheck"]').catch(() => {}); // disabled while empty
    assert.match(await page.locator('#app').innerText(), /Guest says/);
  });

  await t.test('review grouped by guest', async () => {
    await page.locator('[data-a="tab"][data-v="tables"]').tap();
    await page.locator('.tcard').first().tap();
    await page.tap('[data-a="openPicker"]');
    await page.tap('[data-a="pSeat"][data-s="2"]');
    await page.fill('#psearch', 'солянка');
    await page.locator('#plist [data-a="pick"]').first().tap();
    await page.tap('[data-a="pSeat"][data-s="1"]');
    await page.fill('#psearch', 'медовик');
    await page.locator('#plist [data-a="pick"]').first().tap();
    await page.tap('[data-a="closePicker"]');
    await page.tap('[data-a="review"]');
    await page.tap('[data-a="rvGroup"][data-g="seat"]');
    await shot('15-review-by-guest');
    const txt = await page.locator('#app').innerText();
    assert.ok(txt.indexOf('ГОСТЬ 1') >= 0 || txt.indexOf('Гость 1') >= 0);
    const i1 = txt.search(/гость 1/i), i2 = txt.search(/гость 2/i);
    assert.ok(i1 >= 0 && i2 > i1);
    assert.ok(txt.indexOf('медовик') > i1 && txt.indexOf('медовик') < i2);
  });

  await t.test('export produces a backup that imports back', async () => {
    await page.tap('[data-a="tab"][data-v="menu"]');
    await page.tap('[data-a="mFilter"][data-f="data"]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.tap('[data-a="export"]')]);
    const p = await dl.path();
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(data.app, 'waiter-assistant');
    assert.equal(data.state.tables.length, 2);
  });

  await t.test('text backup round-trip (for web views that block downloads)', async () => {
    await page.tap('[data-a="backupText"]');
    const txt = await page.inputValue('#bk_out');
    await page.tap('[data-a="closeSheet"]');
    await page.evaluate(() => { window.__waiter.state.tables.length = 0; });
    await page.tap('[data-a="backupText"]');
    await page.fill('#bk_in', txt);
    await page.tap('[data-a="pasteBackup"]');
    await page.tap('[data-a="confirmOk"]');
    assert.equal((await state()).tables.length, 2);
  });

  await t.test('no horizontal overflow and no JS errors', async () => {
    for (const v of ['tables', 'table', 'learn', 'menu']) {
      if (v === 'table') await page.locator('.tcard').first().tap();
      else await page.tap('[data-a="tab"][data-v="' + v + '"]');
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(w <= 390, v + ' overflows: ' + w);
    }
    assert.deepEqual(errors, []);
  });

  await browser.close();
  srv.close();
});
