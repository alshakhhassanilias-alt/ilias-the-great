'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MENU = require('../js/menu-data.js');
const { createLogic } = require('../js/logic.js');
const { createStore, emptyState } = require('../js/store.js');

const L = createLogic(MENU);
const table = () => ({ id: 't1', num: '5', lines: [], openedAt: Date.now() });
const menuState = { overrides: {}, custom: [] };
const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.getTime(); };

test('menu data: unique ids, valid categories and references', () => {
  const ids = new Set();
  for (const it of MENU.ITEMS) {
    assert.ok(!ids.has(it.id), 'duplicate ' + it.id);
    ids.add(it.id);
    assert.ok(MENU.CATS.some((c) => c.id === it.cat), 'bad cat ' + it.id);
    assert.ok(it.ru && it.en, 'names ' + it.id);
    assert.ok(it.price === null || Number.isFinite(it.price), 'price ' + it.id);
    (it.suggest || []).forEach((m) => assert.ok(MENU.MODS[m], 'suggest ' + m));
  }
  for (const c of MENU.CONFUSABLES) c.ids.forEach((id) => assert.ok(ids.has(id), 'confusable ' + id));
});

test('menu data: items with unknown price are flagged unverified', () => {
  for (const it of MENU.ITEMS) if (it.price == null) assert.ok(it.unverified, it.id);
});

test('adding the same item twice merges into one new line', () => {
  const t = table();
  L.addItem(t, 'pl_sib', {}, menuState);
  const r = L.addItem(t, 'pl_sib', {}, menuState);
  assert.equal(t.lines.length, 1);
  assert.equal(r.merged, true);
  assert.equal(t.lines[0].qty, 2);
});

test('same item with a different seat or note stays a separate line', () => {
  const t = table();
  L.addItem(t, 'pl_sib', { seat: 1 }, menuState);
  L.addItem(t, 'pl_sib', { seat: 2 }, menuState);
  L.addItem(t, 'pl_sib', { note: 'без укропа' }, menuState);
  assert.equal(t.lines.length, 3);
});

test('item already entered into POS is not merged with a new order', () => {
  const t = table();
  L.addItem(t, 'cf_espresso', {}, menuState);
  L.markSent(t);
  L.addItem(t, 'cf_espresso', {}, menuState);
  assert.equal(t.lines.length, 2);
  const issues = L.tableIssues(t, menuState);
  assert.ok(issues.some((i) => i.code === 'repeat:cf_espresso'));
});

test('size choice sets the price; missing required size blocks', () => {
  const t = table();
  const { line } = L.addItem(t, 'jc_orange', {}, menuState);
  assert.ok(L.lineIssues(line, L.getItem('jc_orange')).some((i) => i.level === 'block' && i.code === 'opt:size'));
  line.opts.size = '1000';
  assert.equal(L.unitPrice(line, L.getItem('jc_orange')), 820);
  assert.ok(!L.lineIssues(line, L.getItem('jc_orange')).some((i) => i.level === 'block'));
});

test('two options (flavor + size) on soda machine', () => {
  const t = table();
  const { line } = L.addItem(t, 'so_machine', { opts: { flavor: 'c1', size: '350' } }, menuState);
  assert.equal(L.unitPrice(line, L.getItem('so_machine')), 280);
  assert.deepEqual(L.lineDetail(line, L.getItem('so_machine')), ['Тархун', '350 мл']);
});

test('modifiers add to price and multiply with quantity', () => {
  const t = table();
  const { line } = L.addItem(t, 'v_potato', { qty: 2, mods: { p_meat: 1 } }, menuState);
  assert.equal(L.lineTotal(line, L.getItem('v_potato')), (420 + 140) * 2);
});

test('side reminder until confirmed; swap adds +35', () => {
  const t = table();
  const { line } = L.addItem(t, 'mn_sudak', {}, menuState);
  const it = L.getItem('mn_sudak');
  assert.ok(L.lineIssues(line, it).some((i) => i.code === 'side'));
  line.sideOk = true;
  assert.ok(!L.lineIssues(line, it).some((i) => i.code === 'side'));
  line.sideOk = false;
  line.sideSwap = 'sd_rice';
  assert.equal(L.unitPrice(line, it), 890 + 35);
  assert.ok(L.lineDetail(line, it).some((d) => d.includes('Рис с овощами')));
});

test('menu recommendations are offered, never auto-added', () => {
  const t = table();
  const { line } = L.addItem(t, 'pl_sib', {}, menuState);
  assert.deepEqual(line.mods, {});
  const offer = L.lineIssues(line, L.getItem('pl_sib')).find((i) => i.code === 'offer:r_broth');
  assert.equal(offer.level, 'info');
  line.dismissed.push('r_broth');
  assert.ok(!L.lineIssues(line, L.getItem('pl_sib')).some((i) => i.code === 'offer:r_broth'));
});

test('podzharka offer disappears once either podzharka is added', () => {
  const t = table();
  const { line } = L.addItem(t, 'v_potato', { mods: { p_mush: 1 } }, menuState);
  assert.ok(!L.lineIssues(line, L.getItem('v_potato')).some((i) => i.code.startsWith('offer:')));
});

test('breakfast gift reminder only for breakfast lines added before 12:00', () => {
  const t = table();
  L.addItem(t, 'omelet', { now: at(10) }, menuState);
  assert.ok(L.tableIssues(t, menuState).some((i) => i.code === 'bfgift'));
  const t2 = table();
  L.addItem(t2, 'omelet', { now: at(13) }, menuState);
  assert.ok(!L.tableIssues(t2, menuState).some((i) => i.code === 'bfgift'));
});

test('gift line costs 0, is counted for breakfast promo and never merges with paid', () => {
  const t = table();
  L.addItem(t, 'omelet', { now: at(9) }, menuState);
  L.addItem(t, 'cf_americano', { free: true, now: at(9) }, menuState);
  L.addItem(t, 'cf_americano', { now: at(9) }, menuState);
  assert.equal(t.lines.length, 3);
  assert.equal(L.lineTotal(t.lines[1], L.getItem('cf_americano')), 0);
  assert.ok(L.tableIssues(t, menuState).find((i) => i.code === 'bfgift').text.includes('1 gift line'));
});

test('vodka promo triggers at 1 L (25 × 40 мл)', () => {
  const t = table();
  L.addItem(t, 'vd_myagkov', { qty: 24 }, menuState);
  assert.ok(!L.tableIssues(t, menuState).some((i) => i.code === 'vodka'));
  L.addItem(t, 'vd_myagkov', {}, menuState);
  assert.ok(L.tableIssues(t, menuState).some((i) => i.code === 'vodka'));
});

test('no-drinks hint and stop-list block', () => {
  const t = table();
  L.addItem(t, 'sp_borsch', {}, menuState);
  assert.ok(L.tableIssues(t, menuState).some((i) => i.code === 'nodrinks'));
  const ms = { overrides: { sp_borsch: { stop: true } }, custom: [] };
  assert.ok(L.lineIssues(t.lines[0], L.getItem('sp_borsch', ms)).some((i) => i.level === 'block'));
});

test('price override replaces price and clears price-unverified flag', () => {
  const ms = { overrides: { tq_silver: { price: 480 } }, custom: [] };
  const it = L.getItem('tq_silver', ms);
  assert.equal(it.price, 480);
  assert.ok(!it.unverified);
});

test('summary groups lines in menu order and can show only new', () => {
  const t = table();
  L.addItem(t, 'cf_espresso', {}, menuState);
  L.addItem(t, 'pl_sib', { qty: 2, mods: { r_broth: 1 } }, menuState);
  L.markSent(t, [t.lines[0].id]);
  const all = L.summaryText(t, menuState, false).split('\n');
  assert.equal(all[0], 'Стол 5');
  assert.ok(all[1].startsWith('2 × Пельмени сибирские — + Куриный бульон'));
  assert.ok(all[2].startsWith('1 × Эспрессо'));
  assert.equal(L.summaryText(t, menuState, true).split('\n').length, 2);
});

test('merge duplicates joins plain new lines', () => {
  const t = table();
  t.lines.push(L.newLine('sl_caesar'), L.newLine('sl_caesar'));
  assert.ok(L.tableIssues(t, menuState).some((i) => i.code === 'dup:sl_caesar'));
  L.mergeDuplicates(t, 'sl_caesar');
  assert.equal(t.lines.length, 1);
  assert.equal(t.lines[0].qty, 2);
});

test('search: russian, english, wrong keyboard layout, typo, ё', () => {
  const items = L.allItems(menuState);
  assert.equal(L.search(items, 'пельмени сиб')[0].id, 'pl_sib');
  assert.equal(L.search(items, 'borsch')[0].id, 'sp_borsch');
  assert.equal(L.search(items, 'gtkmvtyb')[0].cat, 'pelmeni');
  assert.ok(L.search(items, 'пелмени').some((i) => i.cat === 'pelmeni'));
  assert.ok(L.search(items, 'томленой').some((i) => i.id === 'v_lamb'));
  const moj = L.search(items, 'мохито').map((i) => i.id);
  assert.ok(moj.includes('ck_mojito') && moj.includes('lm_mojito'));
});

// ---- store -------------------------------------------------------------------
function memStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => Array.from(m.keys())[i],
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  };
}

test('store: save → load roundtrip', () => {
  const st = memStorage();
  const s = createStore(st);
  const state = emptyState();
  state.tables.push({ id: 'a', num: '3', lines: [L.newLine('pl_sib')] });
  assert.ok(s.save(state));
  const loaded = createStore(st).load().state;
  assert.equal(loaded.tables[0].lines[0].itemId, 'pl_sib');
});

test('store: corrupt main record recovers from latest snapshot', () => {
  const st = memStorage();
  let t = 1e12;
  const s = createStore(st, { now: () => t });
  const state = emptyState();
  state.tables.push({ id: 'a', num: '7', lines: [] });
  s.save(state, { snapshot: true });
  st.setItem(s.KEY, '{broken');
  const r = createStore(st).load();
  assert.equal(r.recovered, true);
  assert.equal(r.state.tables[0].num, '7');
});

test('store: write failure is reported, not silent', () => {
  const st = memStorage();
  st.setItem = () => { throw new Error('QuotaExceededError'); };
  const s = createStore(st);
  assert.equal(s.save(emptyState()), false);
  assert.equal(s.status().ok, false);
});

test('store: snapshots are capped', () => {
  const st = memStorage();
  let t = 1e12;
  const s = createStore(st, { now: () => t });
  for (let i = 0; i < 30; i++) { t += 1000; s.save(emptyState(), { snapshot: true }); }
  assert.equal(s.listSnapshots().length, 12);
});

test('store: export/import roundtrip', () => {
  const s = createStore(memStorage());
  const state = emptyState();
  state.tables.push({ id: 'a', num: '9', lines: [] });
  const back = s.importJSON(s.exportJSON(state));
  assert.equal(back.tables[0].num, '9');
  assert.throws(() => s.importJSON('{"foo":1}'));
});
