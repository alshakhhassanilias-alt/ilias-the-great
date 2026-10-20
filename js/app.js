/* Waiter Pad — UI. Plain JS, no framework, no network. */
(function () {
  'use strict';

  var MENU = window.MENU;
  var L = window.createLogic(MENU);
  var T = window.createTrainer(MENU, L);
  var store = window.WaiterStore.createStore(window.localStorage);

  var loaded = store.load();
  var S = loaded.state;
  var ui = {
    view: (S.ui && S.ui.view) || 'tables',
    tableId: S.ui && S.ui.tableId,
    picker: null,           // {q, group, cat, seat}
    sheet: null,
    review: { ticked: {}, onlyNew: true, big: false },
    learn: { mode: 'quiz', group: 'all', q: null, answered: null, flash: null, flipped: false },
    menu: { q: '', filter: 'all' },
    lastCat: 'breakfast',
  };
  if (!findTable(ui.tableId)) { ui.tableId = null; if (ui.view === 'table' || ui.view === 'review') ui.view = 'tables'; }

  var $app = document.getElementById('app');
  var $tabs = document.getElementById('tabs');
  var $sheet = document.getElementById('sheet-root');
  var $toast = document.getElementById('toast');
  var $banner = document.getElementById('banner');

  // ---------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rub(n) { return n == null ? '? ₽' : n.toLocaleString('ru-RU') + ' ₽'; }
  function findTable(id) { return S.tables.filter(function (t) { return t.id === id; })[0] || null; }
  // In Learn → Practice, the order screens work on a throw-away practice table
  // that is never saved with the real tables.
  function isPractice() { return ui.view === 'learn' && !!ui.practice; }
  function cur() { return isPractice() ? ui.practice.table : findTable(ui.tableId); }
  function item(id) { return L.getItem(id, S.menu); }
  function catColor(catId) { var c = L.cat(catId); return 'hsl(' + (c ? c.hue : 0) + ' 62% 48%)'; }
  function ago(ts) {
    var m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' m';
  }
  function timeStr(ts) { var d = new Date(ts); return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
  function numSort(a, b) {
    var na = parseFloat(a.num), nb = parseFloat(b.num);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return String(a.num).localeCompare(String(b.num));
  }
  function persistUi() { S.ui = { view: ui.view, tableId: ui.tableId }; }

  // Every state change goes through commit(): save immediately, offer undo.
  function commit(label, fn, opts) {
    opts = opts || {};
    var prev = JSON.stringify(S);
    fn();
    persistUi();
    store.save(S, { snapshot: !!opts.snapshot });
    if (label) toast(label, opts.undo === false ? null : prev);
    render();
  }
  function nav(view, tableId) {
    ui.view = view;
    if (tableId !== undefined) ui.tableId = tableId;
    if (view !== 'review') ui.review.ticked = {};
    persistUi();
    store.save(S);
    render();
    window.scrollTo(0, 0);
  }

  var toastTimer = null, toastUndo = null;
  function toast(text, undoJSON) {
    toastUndo = isPractice() ? null : (undoJSON || null);
    $toast.innerHTML = '<span>' + esc(text) + '</span>' + (toastUndo ? '<button data-a="undo">Undo</button>' : '');
    $toast.hidden = false;
    $toast.classList.toggle('inpicker', !!ui.picker);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $toast.hidden = true; toastUndo = null; }, toastUndo ? 5000 : 2200);
  }

  store.onStatus(function (st) {
    if (!st.ok) {
      $banner.hidden = false; $banner.className = 'banner';
      $banner.textContent = '⚠ NOT SAVED (' + st.error + '). Free space or export a backup now.';
    } else if (!$banner.classList.contains('info')) {
      $banner.hidden = true;
    }
  });
  if (loaded.recovered) {
    $banner.hidden = false; $banner.className = 'banner info';
    $banner.textContent = 'Main save was damaged — restored from the latest snapshot. Check your tables.';
    setTimeout(function () { $banner.hidden = true; $banner.className = 'banner'; }, 9000);
  }

  function saveDot() {
    var st = store.status();
    if (!st.ok) return '<span class="savedot bad">● not saved</span>';
    return '<span class="savedot">✓ saved ' + (st.savedAt ? timeStr(st.savedAt) : '') + '</span>';
  }

  // ---------------------------------------------------------------- render
  function render() {
    document.documentElement.dataset.theme = S.settings.theme || '';
    var t = findTable(ui.tableId);
    var newCount = t ? t.lines.filter(function (l) { return l.status === 'new'; }).length : 0;
    $tabs.innerHTML = [
      tab('tables', '▦', 'Tables'),
      tab(t ? 'table' : 'tables', t ? esc(String(t.num)).slice(0, 4) : '–', t ? 'Order' + (newCount ? ' •' + newCount : '') : 'Order', ui.view === 'table' || ui.view === 'review'),
      tab('learn', '🎓', 'Learn'),
      tab('menu', '☰', 'Menu & data'),
    ].join('');
    var html = '';
    if (ui.view === 'tables') html = viewTables();
    else if (ui.view === 'table') html = viewTable();
    else if (ui.view === 'review') html = viewReview();
    else if (ui.view === 'learn') html = viewLearn();
    else if (ui.view === 'menu') html = viewMenu();
    $app.innerHTML = html;
    renderPicker();
    renderSheet();
  }
  function tab(view, icon, label, on) {
    var active = on != null ? on : ui.view === view;
    return '<button data-a="tab" data-v="' + view + '" class="' + (active ? 'on' : '') + '"><b>' + icon + '</b>' + label + '</button>';
  }

  // ---------------------------------------------------------------- tables
  function tableBadges(t) {
    var n = t.lines.filter(function (l) { return l.status === 'new'; }).reduce(function (a, l) { return a + l.qty; }, 0);
    var blocks = 0;
    t.lines.forEach(function (l) { blocks += L.lineIssues(l, item(l.itemId)).filter(function (i) { return i.level === 'block'; }).length; });
    var tot = L.tableTotal(t, S.menu);
    var out = '';
    if (n) out += '<span class="pill new">' + n + ' new</span>';
    if (blocks) out += '<span class="pill block">! ' + blocks + '</span>';
    if (!n && t.lines.length) out += '<span class="pill ok">✓ entered</span>';
    if (tot.count) out += '<span class="pill">' + rub(tot.sum) + '</span>';
    return out;
  }

  function viewTables() {
    var tables = S.tables.slice().sort(numSort);
    var h = '<div class="top"><h1>Tables <span class="sub">' + tables.length + ' open</span></h1>' + saveDot() + '</div>';
    if (!tables.length) {
      h += '<div class="empty">No open tables.<br>Tap <b>+ New table</b> below.</div>';
    } else {
      h += '<div class="grid">' + tables.map(function (t) {
        return '<button class="tcard" data-a="open" data-id="' + t.id + '">' +
          '<span class="num">' + esc(t.num) + '</span>' +
          '<span class="meta">' + (t.guests ? t.guests + ' guests · ' : '') + ago(t.openedAt) + '</span>' +
          (t.note ? '<span class="meta">📝 ' + esc(t.note) + '</span>' : '') +
          '<span class="badges">' + tableBadges(t) + '</span></button>';
      }).join('') + '</div>';
    }
    var today = S.history.filter(function (t) { return Date.now() - t.closedAt < 18 * 3600 * 1000; });
    if (S.history.length) {
      h += '<div class="section-h">Closed (last 7 days, ' + S.history.length + ')</div><ul class="list-plain">' +
        S.history.slice(0, today.length > 15 ? today.length : 15).map(function (t) {
          var tot = L.tableTotal(t, S.menu);
          return '<li><button class="btn ghost block" style="justify-content:space-between" data-a="histOpen" data-id="' + t.id + '">' +
            '<span>Стол ' + esc(t.num) + ' · ' + new Date(t.closedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + '</span>' +
            '<span class="muted">' + tot.count + ' items · ' + rub(tot.sum) + '</span></button></li>';
        }).join('') + '</ul>';
    }
    h += '<div class="actionbar"><button class="btn primary grow" data-a="newTable">+ New table</button></div>';
    return h;
  }

  // ---------------------------------------------------------------- table
  function issueChips(l, it, withInfo) {
    return L.lineIssues(l, it).filter(function (i) {
      if (i.level !== 'info') return true;
      if (!withInfo) return false;
      return i.code !== 'unverified';
    }).map(function (i) {
      if (i.mod) return '<button class="issue info tap" data-a="addMod" data-line="' + l.id + '" data-mod="' + i.mod + '">' + esc(i.text) + '</button>';
      return '<span class="issue ' + i.level + '">' + esc(i.text) + '</span>';
    }).join('');
  }

  function lineRow(l, opts) {
    var it = item(l.itemId);
    var name = it ? it.ru : (l.snap ? l.snap.ru : l.itemId);
    var pre = it && it.pre ? '<span class="pre">' + esc(it.pre) + '</span>' : '';
    var det = L.lineDetail(l, it);
    var tot = L.lineTotal(l, it);
    return '<div class="line ' + l.status + '">' +
      '<span class="stripe" style="background:' + catColor(it ? it.cat : '') + '"></span>' +
      '<span class="qty">' + l.qty + '</span>' +
      '<div class="body" role="button" tabindex="0" data-a="editLine" data-id="' + l.id + '">' + pre +
        '<span class="name">' + esc(name) + '</span> <span class="price muted small">' + rub(tot) + '</span>' +
        (det.length ? '<div class="detail">' + esc(det.join(' · ')) + '</div>' : '') +
        (opts.issues ? '<div class="issues">' + issueChips(l, it, l.status === 'new') + '</div>' : '') +
      '</div>' +
      (l.status === 'new' ? '<span class="steps"><button data-a="inc" data-id="' + l.id + '" aria-label="plus">+</button><button data-a="dec" data-id="' + l.id + '" aria-label="minus">−</button></span>' : '') +
      '</div>';
  }

  function viewTable() {
    var t = cur();
    if (!t) return viewTables();
    var others = S.tables.slice().sort(numSort);
    var h = '<div class="top"><h1>Стол ' + esc(t.num) + ' <span class="sub">' + (t.guests ? t.guests + ' guests · ' : '') + ago(t.openedAt) + '</span></h1>' +
      '<button class="iconbtn" data-a="tableMenu" aria-label="table options">⋯</button></div>';
    if (others.length > 1) {
      h += '<div class="strip">' + others.map(function (o) {
        var hasNew = o.lines.some(function (l) { return l.status === 'new'; });
        return '<button class="chip ' + (o.id === t.id ? 'on' : '') + '" data-a="open" data-id="' + o.id + '">' + (hasNew ? '<span class="dot"></span>' : '') + esc(o.num) + '</button>';
      }).join('') + '<button class="chip" data-a="newTable">+</button></div>';
    }
    if (t.note) h += '<div class="note">📝 ' + esc(t.note) + '</div>';
    var ti = L.tableIssues(t, S.menu);
    if (ti.length) {
      h += '<div class="tableissues mt">' + ti.map(function (i) {
        if (i.merge) return '<button class="issue ' + i.level + ' tap" data-a="merge" data-item="' + i.merge + '">' + esc(i.text) + '</button>';
        return '<div class="issue ' + i.level + '">' + esc(i.text) + '</div>';
      }).join('') + '</div>';
    }
    var news = t.lines.filter(function (l) { return l.status === 'new'; });
    var sent = t.lines.filter(function (l) { return l.status === 'sent'; });
    if (!t.lines.length) h += '<div class="empty">Empty order.<br>Tap <b>+ Add</b> — the menu opens with search at the top.</div>';
    if (news.length) {
      h += '<div class="section-h new"><span>Not in POS yet · ' + news.reduce(function (a, l) { return a + l.qty; }, 0) + '</span></div>';
      h += '<div class="lines">' + news.map(function (l) { return lineRow(l, { issues: true }); }).join('') + '</div>';
    }
    if (sent.length) {
      h += '<div class="section-h"><span>Entered in POS · ' + sent.reduce(function (a, l) { return a + l.qty; }, 0) + '</span></div>';
      h += '<div class="lines">' + sent.map(function (l) { return lineRow(l, { issues: false }); }).join('') + '</div>';
    }
    if (t.lines.length) {
      var tot = L.tableTotal(t, S.menu);
      h += '<div class="total"><span>≈ Total' + (tot.unknown ? ' (+' + tot.unknown + ' unknown)' : '') + '</span><span class="price">' + rub(tot.sum) + '</span></div>' +
        '<div class="small muted" style="padding:0 6px">Guide only — the POS bill is final.</div>';
    }
    h += '<div class="actionbar">' +
      '<button class="btn" data-a="review"' + (t.lines.length ? '' : ' disabled') + '>Review ✓' + (news.length ? ' (' + news.length + ')' : '') + '</button>' +
      '<button class="btn primary grow" data-a="openPicker">+ Add</button></div>';
    return h;
  }

  // ---------------------------------------------------------------- review
  function viewReview() {
    var t = cur();
    if (!t) return viewTables();
    var r = ui.review;
    var lines = L.sortedLines(t, S.menu).filter(function (l) { return !r.onlyNew || l.status === 'new'; });
    var blockers = [];
    lines.forEach(function (l) {
      L.lineIssues(l, item(l.itemId)).forEach(function (i) { if (i.level === 'block' || i.level === 'warn') blockers.push({ l: l, i: i }); });
    });
    var h = '<div class="top"><button class="iconbtn" data-a="tab" data-v="table" aria-label="back">‹</button>' +
      '<h1>Стол ' + esc(t.num) + ' <span class="sub">→ POS</span></h1>' +
      '<button class="iconbtn" data-a="bigText" aria-label="text size">' + (r.big ? 'A−' : 'A+') + '</button></div>';
    h += '<div class="seg" style="margin:0 0 10px"><button data-a="rvNew" class="' + (r.onlyNew ? 'on' : '') + '">New only</button>' +
      '<button data-a="rvAll" class="' + (!r.onlyNew ? 'on' : '') + '">Whole table</button></div>';
    var hasSeats = lines.some(function (l) { return l.seat; });
    if (hasSeats) {
      h += '<div class="seg" style="margin:0 0 10px"><button data-a="rvGroup" data-g="menu" class="' + (!r.bySeat ? 'on' : '') + '">By menu (for POS)</button>' +
        '<button data-a="rvGroup" data-g="seat" class="' + (r.bySeat ? 'on' : '') + '">By guest</button></div>';
    }
    if (hasSeats && r.bySeat) {
      lines = lines.map(function (l, i) { return { l: l, i: i }; }).sort(function (a, b) {
        return (a.l.seat || 99) - (b.l.seat || 99) || a.i - b.i;
      }).map(function (x) { return x.l; });
    }
    if (blockers.length) {
      h += '<div class="tableissues">' + blockers.map(function (b) {
        var it = item(b.l.itemId);
        return '<button class="issue ' + b.i.level + '" data-a="editLine" data-id="' + b.l.id + '">' + esc((it ? it.ru : '') + ': ' + b.i.text) + '</button>';
      }).join('') + '</div>';
    }
    L.tableIssues(t, S.menu).filter(function (i) { return i.level === 'warn'; }).forEach(function (i) {
      h += '<div class="issue warn mt">' + esc(i.text) + '</div>';
    });
    if (!lines.length) h += '<div class="empty">Nothing new to enter.</div>';
    var lastHead = null;
    h += '<div class="rv mt ' + (r.big ? 'big' : '') + '">';
    lines.forEach(function (l) {
      var it = item(l.itemId);
      var head = hasSeats && r.bySeat ? (l.seat ? 'Гость ' + l.seat : 'Без гостя / на стол') : (it ? L.cat(it.cat).ru : '');
      if (head !== lastHead) { lastHead = head; h += '<div class="cat-h">' + esc(head) + '</div>'; }
      var d = L.lineDetail(l, it);
      if (hasSeats && r.bySeat) d = d.filter(function (x) { return !/^гость /.test(x); });
      h += '<button class="rvline ' + (r.ticked[l.id] ? 'ticked' : '') + '" data-a="tick" data-id="' + l.id + '">' +
        '<span class="box">' + (r.ticked[l.id] ? '✓' : '') + '</span><span class="q">' + l.qty + '×</span>' +
        '<span><span class="n">' + esc(it ? L.displayName(it) : l.itemId) + '</span>' +
        (d.length ? '<div class="d">' + esc(d.join(' · ')) + '</div>' : '') +
        (l.status === 'sent' ? '<div class="d">✓ entered ' + timeStr(l.sentAt) + '</div>' : '') + '</span></button>';
    });
    h += '</div>';
    var ticked = Object.keys(r.ticked).filter(function (k) { return r.ticked[k]; }).length;
    var newCount = t.lines.filter(function (l) { return l.status === 'new'; }).length;
    h += '<div class="actionbar"><button class="btn" data-a="copy">Copy text</button>' +
      '<button class="btn ok grow" data-a="markSent"' + (newCount ? '' : ' disabled') + '>' +
      (ticked ? 'Mark ' + ticked + ' entered' : 'Mark all entered') + '</button></div>';
    return h;
  }

  // ---------------------------------------------------------------- picker
  function inOrderQty(t, itemId) {
    if (!t) return 0;
    return t.lines.filter(function (l) { return l.itemId === itemId && l.status === 'new'; }).reduce(function (a, l) { return a + l.qty; }, 0);
  }

  function itemRow(it, t, mode) {
    var tags = '';
    if (it.stop) tags += '<span class="tag stop">STOP</span>';
    if (it.form && it.form !== 'тарелка') tags += '<span class="tag form">' + esc(it.form) + '</span>';
    if ((it.tags || []).indexOf('new') >= 0) tags += '<span class="tag new">NEW</span>';
    if ((it.tags || []).indexOf('pits') >= 0 || (it.tags || []).indexOf('bones') >= 0) tags += '<span class="tag">🦴</span>';
    if ((it.tags || []).indexOf('spicy') >= 0) tags += '<span class="tag">🌶</span>';
    if (it.unverified) tags += '<span class="tag unv">⚠ check</span>';
    if (S.favorites.indexOf(it.id) >= 0) tags += '<span class="tag">★</span>';
    var q = mode === 'pick' ? inOrderQty(t, it.id) : 0;
    var price = it.price == null ? '?' : (it.options && it.options.some(function (o) { return o.choices.some(function (c) { return c.price != null; }); }) ? 'от ' : '') + it.price.toLocaleString('ru-RU');
    var action = mode === 'pick' ? 'pick' : 'editItem';
    return '<div class="irow ' + (it.stop ? 'stop' : '') + '">' +
      '<span class="stripe" style="background:' + catColor(it.cat) + '"></span>' +
      '<button class="irow-hit" data-a="' + action + '" data-id="' + it.id + '" style="all:unset;display:flex;flex:1;min-width:0;cursor:pointer">' +
        '<span class="ic">' + esc(it.icons || '') + '</span>' +
        '<span class="main">' + (it.pre ? '<span class="pre">' + esc(it.pre) + '</span>' : '') +
          '<span class="ru">' + tags + esc(it.ru) + '</span><div class="en">' + esc(it.en) + '</div></span>' +
        '<span class="side">' + (q ? '<span class="inorder">' + q + '</span>' : '<span class="p">' + price + '</span>') +
          '<span class="w">' + esc(it.w) + '</span></span>' +
      '</button>' +
      '<button class="info" data-a="info" data-id="' + it.id + '" aria-label="details">ⓘ</button></div>';
  }

  function quickList() {
    var all = L.allItems(S.menu);
    var byId = {}; all.forEach(function (it) { byId[it.id] = it; });
    var fav = S.favorites.map(function (id) { return byId[id]; }).filter(Boolean);
    var freq = Object.keys(S.usage).sort(function (a, b) { return S.usage[b] - S.usage[a]; })
      .filter(function (id) { return byId[id] && S.favorites.indexOf(id) < 0; }).slice(0, 14).map(function (id) { return byId[id]; });
    return { fav: fav, freq: freq };
  }

  function pickerListHTML() {
    var p = ui.picker, t = cur();
    var all = L.allItems(S.menu);
    var h = '';
    if (p.q) {
      var res = L.search(all, p.q).slice(0, 60);
      if (!res.length) h += '<div class="empty">Nothing for “' + esc(p.q) + '”.<br><span class="small">Try Russian, English, or part of a word.</span></div>';
      h += res.map(function (it) { return itemRow(it, t, 'pick'); }).join('');
      return h;
    }
    if (p.cat === '★') {
      var ql = quickList();
      if (!ql.fav.length && !ql.freq.length) h += '<div class="empty">Favourites and your most-ordered items appear here.<br><span class="small">Star an item via ⓘ.</span></div>';
      if (ql.fav.length) h += '<div class="cat-h">★ Favourites</div>' + ql.fav.map(function (it) { return itemRow(it, t, 'pick'); }).join('');
      if (ql.freq.length) h += '<div class="cat-h">Most ordered</div>' + ql.freq.map(function (it) { return itemRow(it, t, 'pick'); }).join('');
      return h;
    }
    var list = all.filter(function (it) { return it.cat === p.cat || (it.alsoIn || []).indexOf(p.cat) >= 0; });
    var c = L.cat(p.cat);
    h += '<div class="cat-h">' + esc(c ? c.ru + ' · ' + c.en : '') + '</div>';
    if (p.cat === 'vareniki') h += '<div class="note">Menu recommends with any vareniki: Мясная поджарка +140 / Грибная +110 (offered on the line).</div><div class="mt"></div>';
    if (p.cat === 'pot') h += '<div class="note">Pots already include поджарка — they are separate items, not “plate + поджарка”.</div><div class="mt"></div>';
    if (p.cat === 'pelmeni') h += '<div class="note">Menu recommends chicken broth 100 г +35 ₽ for Siberian & Ural pelmeni.</div><div class="mt"></div>';
    if (p.cat === 'mains') h += '<div class="note">“Заменить гарнир +35₽” — side swap is in the line editor.</div><div class="mt"></div>';
    h += list.map(function (it) { return itemRow(it, t, 'pick'); }).join('');
    return h;
  }

  function pickerChipsHTML() {
    var p = ui.picker;
    var cats = MENU.CATS.filter(function (c) { return c.group === p.group; });
    return '<div class="seg">' + MENU.GROUPS.map(function (g) {
        return '<button data-a="pGroup" data-g="' + g.id + '" class="' + (p.group === g.id && p.cat !== '★' ? 'on' : '') + '">' + g.label + '</button>';
      }).join('') + '<button data-a="pCat" data-c="★" class="' + (p.cat === '★' ? 'on' : '') + '">★</button></div>' +
      (p.cat === '★' ? '' : '<div class="strip" style="margin-top:8px">' + cats.map(function (c) {
        return '<button class="chip ' + (p.cat === c.id && !p.q ? 'on' : '') + '" data-a="pCat" data-c="' + c.id + '">' + esc(c.ru) + '</button>';
      }).join('') + '</div>') +
      (S.settings.seats ? '<div class="seatrow"><span class="lbl">Guest:</span>' + ['', 1, 2, 3, 4, 5, 6, 7, 8].map(function (s) {
        return '<button class="chip ' + ((p.seat || '') === s ? 'on' : '') + '" data-a="pSeat" data-s="' + s + '">' + (s || '—') + '</button>';
      }).join('') + '</div>' : '');
  }

  function renderPicker() {
    var el = document.getElementById('picker');
    if (!ui.picker) { if (el) el.remove(); return; }
    var t = cur();
    if (!el) {
      el = document.createElement('div');
      el.id = 'picker'; el.className = 'picker';
      el.innerHTML = '<div class="head"><div class="searchrow">' +
        '<input id="psearch" class="search" type="search" placeholder="Search: пельм, borsch, gtkm…" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search">' +
        '<button class="iconbtn" data-a="pClear" aria-label="clear">✕</button></div><div id="pchips"></div></div>' +
        '<div class="list" id="plist"></div>' +
        '<div class="foot"><button class="btn primary" data-a="closePicker" id="pdone"></button></div>';
      document.body.appendChild(el);
      var inp = el.querySelector('#psearch');
      inp.value = ui.picker.q || '';
      inp.addEventListener('input', function () {
        ui.picker.q = inp.value;
        document.getElementById('pchips').innerHTML = pickerChipsHTML();
        document.getElementById('plist').innerHTML = pickerListHTML();
        document.getElementById('plist').scrollTop = 0;
      });
    }
    document.getElementById('pchips').innerHTML = pickerChipsHTML();
    var list = document.getElementById('plist');
    var st = list.scrollTop;
    list.innerHTML = pickerListHTML();
    list.scrollTop = st;
    var n = t ? t.lines.filter(function (l) { return l.status === 'new'; }).reduce(function (a, l) { return a + l.qty; }, 0) : 0;
    document.getElementById('pdone').textContent = (isPractice() ? 'Done · Practice' : 'Done · Стол ' + (t ? t.num : '')) + (n ? ' · ' + n + ' new' : '');
  }

  // ---------------------------------------------------------------- sheets
  function openSheet(s) { ui.sheet = s; renderSheet(); }
  // In-app confirmation (native confirm() is blocked in some web views and is
  // easy to tap through on iOS). `fn` runs only when the user taps OK.
  function ask(msg, okLabel, fn) { openSheet({ type: 'confirm', msg: msg, ok: okLabel, fn: fn }); }
  function guard(cond, msg, okLabel, fn) { if (cond) ask(msg, okLabel, fn); else fn(); }
  function closeSheet() { ui.sheet = null; renderSheet(); }

  function renderSheet() {
    var s = ui.sheet;
    if (!s) { $sheet.innerHTML = ''; return; }
    var body = '';
    if (s.type === 'line') body = sheetLine(s);
    else if (s.type === 'info') body = sheetInfo(s);
    else if (s.type === 'newTable') body = sheetNewTable(s);
    else if (s.type === 'tableMenu') body = sheetTableMenu(s);
    else if (s.type === 'editItem') body = sheetEditItem(s);
    else if (s.type === 'custom') body = sheetCustom(s);
    else if (s.type === 'history') body = sheetHistory(s);
    else if (s.type === 'restore') body = sheetRestore(s);
    else if (s.type === 'confirm') body = '<h2>' + esc(s.msg) + '</h2><div class="foot"><button class="btn" data-a="closeSheet">Cancel</button>' +
      '<button class="btn primary" data-a="confirmOk">' + esc(s.ok) + '</button></div>';
    else if (s.type === 'backupText') body = sheetBackupText(s);
    var keepScroll = $sheet.querySelector('.sheet');
    var st = keepScroll ? keepScroll.scrollTop : 0;
    $sheet.innerHTML = '<div class="backdrop" data-a="backdrop"><div class="sheet' + (s.keepScroll ? '' : ' anim') + '" role="dialog"><div class="grab"></div>' + body + '</div></div>';
    if (s.keepScroll) $sheet.querySelector('.sheet').scrollTop = st;
    s.keepScroll = true;
  }

  // --- line editor / options (add + edit) ---
  function sheetLine(s) {
    var it = item(s.d.itemId);
    var d = s.d;
    var u = L.unitPrice(d, it);
    var h = '<h2>' + (it.pre ? '<span class="small muted">' + esc(it.pre) + '</span><br>' : '') + esc(it.ru) + '</h2><div class="en">' + esc(it.en) + ' · ' + esc(it.w) + '</div>';
    if (it.desc) h += '<div class="desc mt">' + esc(it.desc) + '</div>';
    if (it.note) h += '<div class="note">' + esc(it.note) + '</div>';
    if (it.unverified) h += '<div class="note unv">⚠ ' + esc(it.unverified) + '</div>';
    if (it.stop) h += '<div class="issue block mt">STOP-LIST — marked unavailable</div>';

    (it.options || []).forEach(function (opt) {
      var sel = d.opts[opt.id];
      h += '<h3>' + esc(opt.label) + (opt.required ? ' *' : '') + (opt.want ? ' — choose ' + opt.want + ' (' + ((sel || []).length) + ')' : '') + (opt.multi && !opt.want ? ' — one or more' : '') + '</h3><div class="choices">' +
        opt.choices.map(function (c) {
          var on = opt.multi ? (sel || []).indexOf(c.id) >= 0 : sel === c.id;
          return '<button class="chip ' + (on ? 'on' : '') + '" data-a="lOpt" data-o="' + opt.id + '" data-c="' + c.id + '">' + esc(c.label) + (c.price != null ? ' · ' + c.price : '') + '</button>';
        }).join('') + '</div>';
    });

    h += '<h3>Quantity</h3><div class="stepper"><button class="iconbtn" data-a="lQty" data-d="-1">−</button><span class="v">' + d.qty + '</span>' +
      '<button class="iconbtn" data-a="lQty" data-d="1">+</button>' +
      '<span class="price" style="margin-left:auto;font-weight:800;font-size:20px">' + rub(u == null ? null : u * d.qty) + '</span></div>';

    if (it.side) {
      h += '<h3>Side — printed in name: ' + esc(it.side.name) + '</h3><div class="choices">' +
        '<button class="chip ' + (d.sideOk && !d.sideSwap ? 'on' : '') + '" data-a="lSide" data-v="ok">✓ As listed</button>' +
        MENU.ITEMS.filter(function (x) { return x.cat === 'sides' && L.norm(x.ru) !== L.norm(it.side.name); }).map(function (x) {
          return '<button class="chip ' + (d.sideSwap === x.id ? 'on' : '') + '" data-a="lSide" data-v="' + x.id + '">→ ' + esc(x.ru) + ' +' + MENU.RULES.sideSwapPrice + '</button>';
        }).join('') + '</div><div class="small muted mt">' + esc(MENU.RULES.sideSwap) + ' Which dishes it applies to is not printed — check with manager.</div>';
    } else if (it.sideUnknown) {
      h += '<h3>Side</h3><div class="small muted">Menu weight lists several parts but does not name the side.</div><div class="choices mt">' +
        '<button class="chip ' + (d.sideOk ? 'on' : '') + '" data-a="lSide" data-v="ok">✓ Checked with guest</button></div>';
    }

    var groups = (it.mods || []).slice();
    var suggested = it.suggest || [];
    if (suggested.length) {
      h += '<h3>Menu recommends (ask the guest)</h3><div class="choices">' + suggested.map(function (mid) {
        var m = MENU.MODS[mid];
        return '<button class="chip sug ' + (d.mods[mid] ? 'on' : '') + '" data-a="lMod" data-m="' + mid + '">' + esc(m.ru) + ' +' + m.price + '</button>';
      }).join('') + (suggested.some(function (m) { return d.dismissed.indexOf(m) >= 0; }) ? '' : '<button class="chip" data-a="lDecline">Guest declined</button>') + '</div>';
    }
    groups.forEach(function (gid) {
      var g = MENU.MOD_GROUPS.filter(function (x) { return x.id === gid; })[0];
      var mods = Object.keys(MENU.MODS).map(function (k) { return MENU.MODS[k]; }).filter(function (m) { return m.group === gid && suggested.indexOf(m.id) < 0; });
      if (!mods.length) return;
      var open = s.open && s.open[gid];
      var count = mods.filter(function (m) { return d.mods[m.id]; }).length;
      h += '<h3><button class="btn ghost sm" style="padding:0" data-a="lGroup" data-g="' + gid + '">' + (open || count ? '▾ ' : '▸ ') + esc(g ? g.label : gid) + (count ? ' (' + count + ')' : '') + '</button></h3>';
      if (open || count) {
        h += '<div class="choices">' + mods.map(function (m) {
          return '<button class="chip ' + (d.mods[m.id] ? 'on' : '') + '" data-a="lMod" data-m="' + m.id + '">' + esc(m.ru) + ' +' + m.price + '</button>';
        }).join('') + '</div>';
      }
    });

    if (S.settings.seats) {
      h += '<h3>Guest / seat</h3><div class="choices">' + ['', 1, 2, 3, 4, 5, 6, 7, 8].map(function (x) {
        return '<button class="chip ' + ((d.seat || '') === x ? 'on' : '') + '" data-a="lSeat" data-s="' + x + '">' + (x || '—') + '</button>';
      }).join('') + '</div>';
    }

    h += '<h3>Note for kitchen / bar</h3><div class="choices">' +
      ['сначала', 'позже', 'вместе с горячим', 'соус отдельно', 'без льда', 'с собой', 'без лука'].map(function (n) {
        return '<button class="chip ' + ((d.note || '').indexOf(n) >= 0 ? 'on' : '') + '" data-a="lNote" data-n="' + n + '">' + n + '</button>';
      }).join('') +
      (L.isDrink(it) ? '<button class="chip ' + (d.free ? 'on' : '') + '" data-a="lFree">🎁 gift (0 ₽)</button>' : '') +
      '</div><input class="field mt" id="lnote" value="' + esc(d.note) + '" placeholder="Free text…" autocomplete="off">';

    if (s.mode === 'edit') {
      h += '<h3>Status</h3><div class="choices">' +
        '<button class="chip ' + (d.status === 'new' ? 'on' : '') + '" data-a="lStatus" data-v="new">Not in POS yet</button>' +
        '<button class="chip ' + (d.status === 'sent' ? 'on' : '') + '" data-a="lStatus" data-v="sent">Entered in POS</button></div>';
    }
    var blocking = L.lineIssues(d, it).filter(function (i) { return i.level === 'block' && i.code !== 'stop'; });
    h += '<div class="foot">' + (s.mode === 'edit' ? '<button class="btn danger" data-a="lDelete">Delete</button>' : '<button class="btn" data-a="closeSheet">Cancel</button>') +
      '<button class="btn primary" data-a="lSave"' + (blocking.length ? ' disabled' : '') + '>' +
      (blocking.length ? esc(blocking[0].text) : (s.mode === 'edit' ? 'Save' : 'Add ' + d.qty + ' · ' + rub(u == null ? null : u * d.qty))) + '</button></div>';
    return h;
  }

  function sheetInfo(s) {
    var it = item(s.id);
    var c = L.cat(it.cat);
    var h = '<h2>' + (it.pre ? '<span class="small muted">' + esc(it.pre) + '</span><br>' : '') + esc(it.ru) + '</h2>' +
      '<div class="en">' + esc(it.en) + '</div>' +
      '<div class="kv mt"><span>' + esc(c.ru) + ' · ' + esc(c.en) + '</span><b class="price">' + rub(it.price) + (it.w ? ' · ' + esc(it.w) : '') + '</b></div>';
    if (it.desc) h += '<h3>Composition (printed)</h3><div class="desc">' + esc(it.desc) + '</div>' + (it.descEn ? '<div class="small muted">' + esc(it.descEn) + '</div>' : '');
    (it.options || []).forEach(function (o) {
      h += '<h3>' + esc(o.label) + '</h3><div class="small">' + o.choices.map(function (x) { return esc(x.label) + (x.price != null ? ' — ' + x.price + ' ₽' : ''); }).join(' · ') + '</div>';
    });
    if (it.side) h += '<div class="note">Side printed in name: ' + esc(it.side.name) + '</div>';
    if (it.note) h += '<div class="note">' + esc(it.note) + '</div>';
    if ((it.tags || []).indexOf('pits') >= 0) h += '<div class="note">Menu: «Осторожно, могут попадаться косточки»</div>';
    if ((it.tags || []).indexOf('bones') >= 0) h += '<div class="note">Menu: «Осторожно, кости!»</div>';
    if (it.unverified) h += '<div class="note unv">⚠ ' + esc(it.unverified) + '</div>';
    if (it.priceEdited) h += '<div class="note">Price edited by you (photo: ' + rub(L.getItem(it.id).price) + ')</div>';
    var conf = MENU.CONFUSABLES.filter(function (g) { return g.ids.indexOf(it.id) >= 0; });
    if (conf.length) {
      h += '<h3>Don’t confuse</h3>' + conf.map(function (g) {
        return '<div class="note"><b>' + esc(g.title) + '</b><br>' + esc(g.diff) + '</div>';
      }).join('');
    }
    h += '<div class="choices mt">' +
      '<button class="chip ' + (S.favorites.indexOf(it.id) >= 0 ? 'on' : '') + '" data-a="fav" data-id="' + it.id + '">★ Favourite</button>' +
      '<button class="chip ' + (S.training.hard[it.id] ? 'on' : '') + '" data-a="hard" data-id="' + it.id + '">🧠 Hard to remember</button>' +
      '<button class="chip ' + (it.stop ? 'on' : '') + '" data-a="stop" data-id="' + it.id + '">⛔ Stop-list</button></div>';
    h += '<div class="foot"><button class="btn" data-a="closeSheet">Close</button>' +
      (ui.picker ? '<button class="btn primary" data-a="pickFromInfo" data-id="' + it.id + '">Add</button>' : '') + '</div>';
    return h;
  }

  function sheetNewTable(s) {
    var exists = S.tables.filter(function (t) { return String(t.num) === String(s.num); })[0];
    var h = '<h2>New table</h2><div class="display">' + (esc(s.num) || '<span class="muted">№</span>') + '</div>';
    if (exists) h += '<div class="issue warn" style="text-align:center">Table ' + esc(s.num) + ' is already open — will open it</div>';
    h += '<div class="keypad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return '<button data-a="kp" data-k="' + n + '">' + n + '</button>'; }).join('') +
      '<button data-a="kp" data-k="C">C</button><button data-a="kp" data-k="0">0</button><button data-a="kp" data-k="⌫">⌫</button></div>';
    h += '<h3>Guests (optional)</h3><div class="choices">' + [1, 2, 3, 4, 5, 6, 7, 8, 10, 12].map(function (g) {
      return '<button class="chip ' + (s.guests === g ? 'on' : '') + '" data-a="kpGuests" data-g="' + g + '">' + g + '</button>';
    }).join('') + '</div>';
    h += '<input class="field mt" id="tlabel" placeholder="…or a name: Бар 2, Веранда 5" value="' + esc(/^\d*$/.test(s.num) ? '' : s.num) + '" autocomplete="off">';
    h += '<div class="foot"><button class="btn" data-a="closeSheet">Cancel</button><button class="btn primary" data-a="createTable"' + (s.num ? '' : ' disabled') + '>' + (exists ? 'Open table ' : 'Open table ') + esc(s.num) + '</button></div>';
    return h;
  }

  function sheetTableMenu() {
    var t = cur();
    return '<h2>Стол ' + esc(t.num) + '</h2><div class="en">Opened ' + timeStr(t.openedAt) + '</div>' +
      '<h3>Table number / name</h3><input class="field" id="tm_num" value="' + esc(t.num) + '" autocomplete="off">' +
      '<h3>Guests</h3><div class="choices">' + [1, 2, 3, 4, 5, 6, 7, 8, 10, 12].map(function (g) {
        return '<button class="chip ' + (t.guests === g ? 'on' : '') + '" data-a="tmGuests" data-g="' + g + '">' + g + '</button>';
      }).join('') + '</div>' +
      '<h3>Table note (allergy, birthday, waiting for friend…)</h3><input class="field" id="tm_note" value="' + esc(t.note || '') + '" autocomplete="off">' +
      '<div class="foot"><button class="btn" data-a="tmSave">Save</button><button class="btn primary" data-a="closeTable">Close table (paid)</button></div>' +
      '<button class="btn ghost danger block mt" data-a="deleteTable">Delete table (opened by mistake)</button>';
  }

  function sheetHistory(s) {
    var t = S.history.filter(function (x) { return x.id === s.id; })[0];
    if (!t) return '<div>Not found</div>';
    var txt = L.summaryText(t, S.menu, false);
    return '<h2>Стол ' + esc(t.num) + ' (closed)</h2><div class="en">' + new Date(t.closedAt).toLocaleString('ru-RU') + '</div>' +
      '<pre style="white-space:pre-wrap;font:inherit" class="mt">' + esc(txt) + '</pre>' +
      '<div class="foot"><button class="btn" data-a="closeSheet">Close</button><button class="btn primary" data-a="reopen" data-id="' + t.id + '">Reopen table</button></div>';
  }

  function sheetEditItem(s) {
    var it = item(s.id);
    var base = L.getItem(s.id);
    return '<h2>' + esc(L.displayName(it)) + '</h2><div class="en">' + esc(it.en) + '</div>' +
      (it.unverified ? '<div class="note unv">⚠ ' + esc(it.unverified) + '</div>' : '') +
      '<h3>Price ₽ (photo: ' + rub(base ? base.price : null) + ')</h3><input class="field" id="ei_price" inputmode="numeric" value="' + (it.price == null ? '' : it.price) + '">' +
      '<h3>Russian name</h3><input class="field" id="ei_ru" value="' + esc(it.ru) + '">' +
      '<h3>My note</h3><input class="field" id="ei_note" value="' + esc((S.menu.overrides[s.id] || {}).myNote || '') + '" placeholder="e.g. comes with mashed potato">' +
      '<div class="choices mt"><button class="chip ' + (it.stop ? 'on' : '') + '" data-a="stop" data-id="' + it.id + '">⛔ Stop-list</button>' +
      '<button class="chip ' + (it.hidden ? 'on' : '') + '" data-a="hide" data-id="' + it.id + '">Hide (no longer on menu)</button></div>' +
      '<div class="foot"><button class="btn" data-a="resetItem" data-id="' + it.id + '">Reset to photo</button><button class="btn primary" data-a="saveItem" data-id="' + it.id + '">Save</button></div>';
  }

  function sheetCustom() {
    return '<h2>Add item missing from photos</h2>' +
      '<h3>Russian name</h3><input class="field" id="cu_ru" autocomplete="off">' +
      '<h3>English (optional)</h3><input class="field" id="cu_en" autocomplete="off">' +
      '<h3>Price ₽</h3><input class="field" id="cu_price" inputmode="numeric">' +
      '<h3>Section</h3><select class="field" id="cu_cat">' + MENU.CATS.map(function (c) { return '<option value="' + c.id + '">' + esc(c.ru) + '</option>'; }).join('') + '</select>' +
      '<div class="foot"><button class="btn" data-a="closeSheet">Cancel</button><button class="btn primary" data-a="saveCustom">Add to menu</button></div>';
  }

  function sheetRestore() {
    var snaps = store.listSnapshots();
    return '<h2>Restore a snapshot</h2><div class="en">Taken automatically every 2 min while you work, and on every table close.</div>' +
      (snaps.length ? '<ul class="list-plain mt">' + snaps.map(function (s) {
        return '<li class="kv"><span>' + new Date(s.at).toLocaleString('ru-RU') + '<br><span class="small muted">' + s.tables + ' tables · ' + s.lines + ' lines</span></span>' +
          '<button class="btn sm" data-a="doRestore" data-k="' + esc(s.key) + '">Restore</button></li>';
      }).join('') + '</ul>' : '<div class="empty">No snapshots yet.</div>') +
      '<div class="foot"><button class="btn" data-a="closeSheet">Close</button></div>';
  }

  // ---------------------------------------------------------------- learn
  function viewLearn() {
    var lr = ui.learn;
    var items = L.allItems(S.menu);
    var pr = T.progress(items, S.training);
    var h = '<div class="top"><h1>Learn the menu</h1><span class="savedot">' + pr.learned + '/' + pr.total + ' learned</span></div>';
    h += '<div class="strip">' + [['drill', '🗣 Practice order'], ['quiz', 'Quiz'], ['flash', 'Cards'], ['confuse', 'Look-alikes'], ['hard', 'Hard 🧠']].map(function (m) {
      return '<button class="chip ' + (lr.mode === m[0] ? 'on' : '') + '" data-a="lrMode" data-m="' + m[0] + '">' + m[1] + '</button>';
    }).join('') + '</div>';
    if (lr.mode === 'drill') return h + viewDrill(items);
    if (lr.mode === 'quiz' || lr.mode === 'flash') {
      h += '<div class="strip mt">' + [['all', 'Everything'], ['food', 'Food'], ['drinks', 'Drinks'], ['bar', 'Bar'], ['hard', 'Only 🧠']].map(function (g) {
        return '<button class="chip ' + (lr.group === g[0] ? 'on' : '') + '" data-a="lrGroup" data-g="' + g[0] + '">' + g[1] + '</button>';
      }).join('') + '</div>';
    }
    if (lr.mode === 'quiz') {
      if (!lr.q) lr.q = T.question(items, S.training, { group: lr.group });
      var q = lr.q;
      if (!q) return h + '<div class="empty">Not enough items here yet' + (lr.group === 'hard' ? ' — mark some as 🧠 hard (ⓘ on any item).' : '.') + '</div>';
      h += '<div class="card mt"><div class="small muted">' + esc(q.prompt) + '</div><div style="font-size:20px;font-weight:800;margin-top:4px">' + esc(q.sub) + '</div></div>';
      h += q.choices.map(function (c, i) {
        var cls = '';
        if (lr.answered != null) { if (c.correct) cls = 'right'; else if (i === lr.answered) cls = 'wrong'; }
        return '<button class="answer ' + cls + '" data-a="answer" data-i="' + i + '">' + esc(c.label) + '</button>';
      }).join('');
      if (lr.answered != null) {
        h += '<div class="note">' + esc(q.explain) + '</div>' +
          '<div class="row mt"><button class="btn" data-a="hard" data-id="' + q.itemId + '">' + (S.training.hard[q.itemId] ? '🧠 Unmark hard' : '🧠 Mark hard') + '</button>' +
          '<button class="btn primary" style="flex:1" data-a="nextQ">Next ›</button></div>';
      }
      h += '<div class="stat mt">Right ' + S.training.stats.right + ' · wrong ' + S.training.stats.wrong + '</div>';
    } else if (lr.mode === 'flash') {
      if (!lr.flash) lr.flash = (T.nextFlash(items, S.training, lr.group) || {}).id;
      var it = lr.flash && item(lr.flash);
      if (!it) return h + '<div class="empty">Nothing here yet.</div>';
      h += '<button class="card flash mt" style="width:100%" data-a="flip">' +
        (it.pre ? '<div class="small muted">' + esc(it.pre) + '</div>' : '') +
        '<div class="big">' + esc(it.ru) + '</div><div style="font-size:26px">' + esc(it.icons || '') + '</div>' +
        (lr.flipped ? '<div style="font-size:17px">' + esc(it.en) + '</div><div><b>' + rub(it.price) + '</b> · ' + esc(it.w) + ' · ' + esc(L.cat(it.cat).ru) + '</div>' +
          (it.desc ? '<div class="small">' + esc(it.desc) + '</div>' : '') + (it.side ? '<div class="small">Гарнир: ' + esc(it.side.name) + '</div>' : '') +
          (it.unverified ? '<div class="small" style="color:var(--warn)">⚠ ' + esc(it.unverified) + '</div>' : '')
          : '<div class="muted small">Tap to reveal English, price, composition</div>') + '</button>';
      h += '<div class="row"><button class="btn danger" style="flex:1" data-a="flashGrade" data-r="0">✗ Didn’t know</button>' +
        '<button class="btn ok" style="flex:1" data-a="flashGrade" data-r="1">✓ Knew it</button></div>' +
        '<button class="btn ghost block mt" data-a="hard" data-id="' + it.id + '">' + (S.training.hard[it.id] ? '🧠 Unmark hard' : '🧠 Mark hard') + '</button>';
    } else if (lr.mode === 'confuse') {
      h += '<div class="small muted mt">Groups that are easy to mix up on this menu. Differences are taken from the printed menu.</div>';
      h += MENU.CONFUSABLES.map(function (g) {
        return '<div class="card mt"><b>' + esc(g.title) + '</b><ul class="list-plain">' + g.ids.map(function (id) {
          var x = item(id);
          return '<li class="kv"><span>' + esc(x.icons || '') + ' ' + (x.form && x.form !== 'тарелка' ? '<span class="tag form">' + esc(x.form) + '</span>' : '') + esc(L.displayName(x)) + '</span><b class="price">' + rub(x.price) + '</b></li>';
        }).join('') + '</ul><div class="small mt">' + esc(g.diff) + '</div></div>';
      }).join('');
    } else if (lr.mode === 'hard') {
      var hard = items.filter(function (x) { return S.training.hard[x.id]; });
      h += '<div class="small muted mt">Items you marked 🧠. They appear 3× more often in quiz and cards. Mark items via ⓘ anywhere.</div>';
      h += hard.length ? '<div class="mt">' + hard.map(function (x) { return itemRow(x, null, 'learn'); }).join('') + '</div>' : '<div class="empty">None yet.</div>';
    }
    return h;
  }

  function viewDrill(items) {
    var pr = ui.practice;
    var h = '';
    if (!pr) {
      var st = S.training.drill || { done: 0, perfect: 0 };
      h += '<div class="card mt"><b>Practice a real order</b><div class="small muted mt">A guest orders 2–4 things in English, often look-alike dishes. ' +
        'Enter it with the normal menu screen (search, sizes, sides, offers), then tap Check. Practice orders are never mixed with your real tables.</div>' +
        '<div class="stat mt">' + st.done + ' practised · ' + st.perfect + ' perfect</div></div>' +
        '<div class="actionbar"><button class="btn primary grow" data-a="drillStart">Start practice order</button></div>';
      return h;
    }
    h += '<div class="card mt"><div class="small muted">Guest says:</div><ul class="list-plain">' + pr.sc.phrases.map(function (ph) {
      return '<li style="font-size:17px;font-weight:650">“' + esc(ph) + '”</li>';
    }).join('') + '</ul></div>';
    if (pr.result) {
      var ok = pr.result.filter(function (r) { return r.ok; }).length;
      var exp = pr.sc.lines.length;
      h += '<div class="section-h"><span>Result · ' + ok + '/' + exp + ' correct · ' + Math.round((pr.checkedAt - pr.startedAt) / 1000) + ' s</span></div>';
      h += '<div class="tableissues">' + pr.result.map(function (r) {
        return '<div class="issue ' + (r.ok ? 'ok' : 'block') + '">' + (r.ok ? '✓ ' : '✗ ') + esc(r.text) + '</div>';
      }).join('') + '</div>';
      h += '<div class="section-h"><span>Correct entry</span></div><div class="note" style="white-space:pre-line">' +
        esc(pr.sc.lines.map(function (l) {
          var it = item(l.itemId);
          var d = L.lineDetail(Object.assign(L.newLine(l.itemId), l, { sideOk: !l.sideSwap }), it);
          return l.qty + ' × ' + L.displayName(it) + (d.length ? ' — ' + d.join('; ') : '');
        }).join('\n')) + '</div>';
      h += '<div class="actionbar"><button class="btn" data-a="drillStop">Stop</button><button class="btn primary grow" data-a="drillStart">Next order ›</button></div>';
      return h;
    }
    var t = pr.table;
    if (!t.lines.length) h += '<div class="empty">Tap <b>+ Add</b> and enter what the guest said.</div>';
    else h += '<div class="lines mt">' + t.lines.map(function (l) { return lineRow(l, { issues: true }); }).join('') + '</div>';
    h += '<div class="actionbar"><button class="btn" data-a="drillCheck"' + (t.lines.length ? '' : ' disabled') + '>Check ✓</button>' +
      '<button class="btn primary grow" data-a="openPicker">+ Add</button></div>';
    return h;
  }

  // ---------------------------------------------------------------- menu & data
  function viewMenu() {
    var m = ui.menu;
    var all = MENU.ITEMS.map(function (x) { return L.getItem(x.id, S.menu); }).concat(S.menu.custom.map(function (c) { return L.getItem(c.id, S.menu); }));
    var unv = all.filter(function (x) { return x.unverified; });
    var stop = all.filter(function (x) { return x.stop; });
    var h = '<div class="top"><h1>Menu &amp; data</h1>' + saveDot() + '</div>';
    h += '<input class="search" style="width:100%" id="msearch" type="search" placeholder="Find item to edit price / stop-list…" value="' + esc(m.q) + '" autocomplete="off">';
    h += '<div class="strip mt">' + [['all', 'Search'], ['stop', '⛔ Stop-list (' + stop.length + ')'], ['unv', '⚠ To verify (' + unv.length + ')'], ['data', 'Backup & settings']].map(function (f) {
      return '<button class="chip ' + (m.filter === f[0] ? 'on' : '') + '" data-a="mFilter" data-f="' + f[0] + '">' + f[1] + '</button>';
    }).join('') + '</div>';
    h += '<div id="mlist">' + menuListHTML(all, unv, stop) + '</div>';
    return h;
  }

  function menuListHTML(all, unv, stop) {
    var m = ui.menu;
    if (m.filter === 'data') return dataHTML();
    if (m.filter === 'stop') {
      return '<div class="small muted mt">Items marked unavailable for this shift. Adding them shows a red warning.</div>' +
        (stop.length ? stop.map(function (x) { return itemRow(x, null, 'menu'); }).join('') + '<button class="btn block mt" data-a="clearStop">Clear stop-list (new shift)</button>' : '<div class="empty">Stop-list is empty.</div>');
    }
    if (m.filter === 'unv') {
      return '<div class="small muted mt">These could not be read with certainty from the photos. Check against the real menu / POS and fix the price here.</div>' +
        unv.map(function (x) { return itemRow(x, null, 'menu') + '<div class="small" style="margin:-2px 4px 10px;color:var(--warn)">⚠ ' + esc(x.unverified) + '</div>'; }).join('');
    }
    var list = m.q ? L.search(all.filter(function (x) { return !x.isExtra; }), m.q) : [];
    if (!m.q) {
      return '<div class="small muted mt">' + all.length + ' items transcribed from the 22 menu photos (menu ' + MENU.VERSION + '). Search to edit one.</div>' +
        '<button class="btn block mt" data-a="custom">+ Add item missing from the photos</button>';
    }
    return list.slice(0, 50).map(function (x) { return itemRow(x, null, 'menu'); }).join('') || '<div class="empty">No match.</div>';
  }

  function dataHTML() {
    var openLines = S.tables.reduce(function (a, t) { return a + t.lines.length; }, 0);
    return '<div class="card mt"><b>Backup</b><div class="small muted">Everything is saved on this phone after every tap. Export a file now and then (e.g. to Files / Telegram) so a lost phone or cleared Safari data does not lose anything.</div>' +
      '<div class="row wrap mt"><button class="btn" data-a="export">⬇ Export backup</button>' +
      '<label class="btn">⬆ Import<input type="file" id="importfile" accept="application/json,.json" hidden></label>' +
      '<button class="btn" data-a="restore">⟲ Snapshots</button><button class="btn" data-a="backupText">⧉ Copy as text</button></div>' +
      '<div class="small muted mt" id="persist"></div></div>' +
      '<div class="card"><b>End of shift</b><div class="small muted">Closes all ' + S.tables.length + ' open tables (' + openLines + ' lines) into history and clears the stop-list. A snapshot is taken first.</div>' +
      '<button class="btn danger block mt" data-a="endShift">End shift</button></div>' +
      '<div class="card"><b>Settings</b>' +
      '<div class="kv mt"><span>Guest / seat numbers on lines</span><button class="btn sm" data-a="toggleSeats">' + (S.settings.seats ? 'On' : 'Off') + '</button></div>' +
      '<div class="kv mt"><span>Theme</span><span class="row">' + [['', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(function (th) {
        return '<button class="btn sm ' + ((S.settings.theme || '') === th[0] ? 'primary' : '') + '" data-a="theme" data-t="' + th[0] + '">' + th[1] + '</button>';
      }).join('') + '</span></div>' +
      '<div class="kv mt"><span>Reset training progress</span><button class="btn sm" data-a="resetTraining">Reset</button></div></div>' +
      '<div class="card small muted">Install: in Safari tap Share → <b>Add to Home Screen</b>. It then opens full-screen and works offline. Data stays on this phone only.</div>';
  }

  // ---------------------------------------------------------------- actions
  var A = {};
  A.tab = function (d) {
    if (d.v === 'table' && !findTable(ui.tableId)) return nav('tables');
    nav(d.v);
  };
  A.undo = function () {
    if (!toastUndo) return;
    S = JSON.parse(toastUndo);
    toastUndo = null; $toast.hidden = true;
    store.save(S);
    if (!findTable(ui.tableId) && (ui.view === 'table' || ui.view === 'review')) ui.view = 'tables';
    render();
  };
  A.open = function (d) { ui.picker = null; nav('table', d.id); };
  A.newTable = function () { openSheet({ type: 'newTable', num: '', guests: null }); };
  A.kp = function (d) {
    var s = ui.sheet;
    if (d.k === 'C') s.num = '';
    else if (d.k === '⌫') s.num = String(s.num).slice(0, -1);
    else if (String(s.num).length < 4) s.num = (/^\d*$/.test(s.num) ? s.num : '') + d.k;
    renderSheet();
  };
  A.kpGuests = function (d) { ui.sheet.guests = ui.sheet.guests === +d.g ? null : +d.g; renderSheet(); };
  A.createTable = function () {
    var s = ui.sheet;
    var num = String(s.num).trim();
    if (!num) return;
    var ex = S.tables.filter(function (t) { return String(t.num) === num; })[0];
    closeSheet();
    if (ex) { toast('Table ' + num + ' was already open'); return nav('table', ex.id); }
    var t = { id: L.uid('t'), num: num, guests: s.guests, note: '', openedAt: Date.now(), updatedAt: Date.now(), lines: [] };
    commit(null, function () { S.tables.push(t); ui.view = 'table'; ui.tableId = t.id; });
    A.openPicker();
  };
  A.tableMenu = function () { openSheet({ type: 'tableMenu' }); };
  A.tmGuests = function (d) {
    var t = cur(); var g = +d.g;
    commit(null, function () { t.guests = t.guests === g ? null : g; });
  };
  A.tmSave = function () {
    var t = cur();
    var num = document.getElementById('tm_num').value.trim();
    var note = document.getElementById('tm_note').value.trim();
    var clash = S.tables.filter(function (x) { return x !== t && String(x.num) === num; })[0];
    if (clash) { toast('Table ' + num + ' is already open — pick another number'); return; }
    closeSheet();
    commit('Saved', function () { if (num) t.num = num; t.note = note; }, { undo: false });
  };
  A.closeTable = function () {
    var t = cur();
    var n = t.lines.filter(function (l) { return l.status === 'new'; }).length;
    closeSheet();
    guard(n, n + ' line(s) are NOT marked as entered in POS. Close table anyway?', 'Close table', function () { commit('Стол ' + t.num + ' closed', function () {
      S.tables = S.tables.filter(function (x) { return x !== t; });
      t.closedAt = Date.now();
      S.history.unshift(t);
      ui.view = 'tables'; ui.tableId = null;
    }, { snapshot: true }); });
  };
  A.deleteTable = function () {
    var t = cur();
    closeSheet();
    guard(t.lines.length, 'Delete table ' + t.num + ' with ' + t.lines.length + ' lines?', 'Delete', function () {
      commit('Стол ' + t.num + ' deleted', function () {
        S.tables = S.tables.filter(function (x) { return x !== t; });
        ui.view = 'tables'; ui.tableId = null;
      }, { snapshot: true });
    });
  };
  A.histOpen = function (d) { openSheet({ type: 'history', id: d.id }); };
  A.reopen = function (d) {
    var t = S.history.filter(function (x) { return x.id === d.id; })[0];
    if (S.tables.some(function (x) { return String(x.num) === String(t.num); })) { toast('Table ' + t.num + ' is open again already — close it first'); return; }
    closeSheet();
    commit('Стол ' + t.num + ' reopened', function () {
      S.history = S.history.filter(function (x) { return x !== t; });
      delete t.closedAt;
      S.tables.push(t);
      ui.view = 'table'; ui.tableId = t.id;
    });
  };

  // picker
  A.openPicker = function () {
    var hasQuick = S.favorites.length || Object.keys(S.usage).length > 3;
    ui.picker = { q: '', group: L.cat(ui.lastCat).group, cat: hasQuick ? '★' : ui.lastCat, seat: '' };
    if (hasQuick) ui.picker.group = 'food';
    renderPicker();
  };
  A.closePicker = function () { ui.picker = null; $toast.hidden = true; render(); };
  A.pClear = function () {
    var inp = document.getElementById('psearch');
    if (ui.picker.q) { ui.picker.q = ''; inp.value = ''; renderPicker(); inp.focus(); } else A.closePicker();
  };
  A.pGroup = function (d) {
    var first = MENU.CATS.filter(function (c) { return c.group === d.g; })[0];
    ui.picker.group = d.g; ui.picker.cat = first.id; ui.lastCat = first.id;
    clearSearch(); renderPicker(); document.getElementById('plist').scrollTop = 0;
  };
  A.pCat = function (d) {
    ui.picker.cat = d.c;
    if (d.c !== '★') ui.lastCat = d.c;
    clearSearch(); renderPicker(); document.getElementById('plist').scrollTop = 0;
  };
  A.pSeat = function (d) { ui.picker.seat = d.s === '' ? '' : +d.s; renderPicker(); };
  function clearSearch() { ui.picker.q = ''; var i = document.getElementById('psearch'); if (i) { i.value = ''; i.blur(); } }

  function needsSheet(it) { return (it.options || []).some(function (o) { return o.required; }); }

  A.pick = function (d) {
    var it = item(d.id), t = cur();
    if (!t || !it) return;
    if (it.stop && !d.force) return ask(it.ru + ' is on the STOP-LIST. Add anyway?', 'Add anyway', function () { A.pick({ id: d.id, force: true }); });
    if (needsSheet(it)) {
      var draft = L.newLine(it.id, { seat: ui.picker && ui.picker.seat || null });
      return openSheet({ type: 'line', mode: 'add', d: draft });
    }
    var prev = JSON.stringify(S);
    var res;
    commit(null, function () {
      res = L.addItem(t, it.id, { seat: ui.picker && ui.picker.seat || null }, S.menu);
      track(it.id);
    });
    var extra = it.side ? ' · side: ' + it.side.name + '?' : (it.suggest ? ' · offer ' + MENU.MODS[it.suggest[0]].ru.toLowerCase() : '');
    toast('+1 ' + it.ru + (res.merged ? ' (×' + res.line.qty + ')' : '') + extra, prev);
  };
  A.pickFromInfo = function (d) { closeSheet(); A.pick(d); };
  function track(id) {
    if (isPractice()) return;
    S.usage[id] = (S.usage[id] || 0) + 1;
    S.recent = [id].concat(S.recent.filter(function (x) { return x !== id; })).slice(0, 20);
  }

  // line editor
  A.editLine = function (d) {
    var t = cur();
    var l = t && t.lines.filter(function (x) { return x.id === d.id; })[0];
    if (!l) return;
    if (!item(l.itemId)) return ask('This item is no longer in the menu data. Delete the line?', 'Delete', function () { commit('Deleted', function () { t.lines = t.lines.filter(function (x) { return x !== l; }); }); });
    openSheet({ type: 'line', mode: 'edit', id: l.id, d: JSON.parse(JSON.stringify(l)) });
  };
  A.lOpt = function (d) {
    var s = ui.sheet, it = item(s.d.itemId);
    var opt = it.options.filter(function (o) { return o.id === d.o; })[0];
    if (opt.multi) {
      var arr = (s.d.opts[d.o] || []).slice();
      var i = arr.indexOf(d.c);
      if (i >= 0) arr.splice(i, 1); else if (!opt.want || arr.length < opt.want) arr.push(d.c);
      s.d.opts[d.o] = arr;
    } else {
      s.d.opts[d.o] = s.d.opts[d.o] === d.c ? null : d.c;
      if (s.d.opts[d.o] == null) delete s.d.opts[d.o];
    }
    renderSheet();
  };
  A.lQty = function (d) { var s = ui.sheet; s.d.qty = Math.max(1, s.d.qty + (+d.d)); renderSheet(); };
  A.lSide = function (d) {
    var x = ui.sheet.d;
    if (d.v === 'ok') { x.sideOk = !(x.sideOk && !x.sideSwap); x.sideSwap = null; }
    else { x.sideSwap = x.sideSwap === d.v ? null : d.v; x.sideOk = false; }
    renderSheet();
  };
  A.lMod = function (d) {
    var x = ui.sheet.d;
    if (x.mods[d.m]) delete x.mods[d.m]; else x.mods[d.m] = 1;
    renderSheet();
  };
  A.lDecline = function () {
    var x = ui.sheet.d, it = item(x.itemId);
    (it.suggest || []).forEach(function (m) { if (x.dismissed.indexOf(m) < 0) x.dismissed.push(m); });
    renderSheet();
  };
  A.lGroup = function (d) { var s = ui.sheet; s.open = s.open || {}; s.open[d.g] = !s.open[d.g]; renderSheet(); };
  A.lSeat = function (d) { ui.sheet.d.seat = d.s === '' ? null : +d.s; renderSheet(); };
  A.lNote = function (d) {
    var x = ui.sheet.d;
    syncNote();
    var parts = (x.note || '').split(/\s*,\s*/).filter(Boolean);
    var i = parts.indexOf(d.n);
    if (i >= 0) parts.splice(i, 1); else parts.push(d.n);
    x.note = parts.join(', ');
    renderSheet();
  };
  A.lFree = function () { syncNote(); ui.sheet.d.free = !ui.sheet.d.free; renderSheet(); };
  A.lStatus = function (d) { syncNote(); ui.sheet.d.status = d.v; if (d.v === 'sent' && !ui.sheet.d.sentAt) ui.sheet.d.sentAt = Date.now(); renderSheet(); };
  function syncNote() { var n = document.getElementById('lnote'); if (n && ui.sheet && ui.sheet.d) ui.sheet.d.note = n.value.trim(); }
  A.lSave = function () {
    syncNote();
    var s = ui.sheet, t = cur(), x = s.d, it = item(x.itemId);
    closeSheet();
    if (s.mode === 'add') {
      var prev = JSON.stringify(S);
      var res;
      commit(null, function () {
        res = L.addItem(t, x.itemId, { qty: x.qty, opts: x.opts, mods: x.mods, seat: x.seat, note: x.note, free: x.free }, S.menu);
        if (x.sideOk) res.line.sideOk = true;
        if (x.sideSwap) res.line.sideSwap = x.sideSwap;
        res.line.dismissed = x.dismissed.slice();
        track(x.itemId);
      });
      toast('+' + x.qty + ' ' + it.ru + (res.merged ? ' (×' + res.line.qty + ')' : ''), prev);
    } else {
      commit('Saved', function () {
        t.lines = t.lines.map(function (l) { return l.id === s.id ? x : l; });
        t.updatedAt = Date.now();
      });
    }
  };
  A.lDelete = function () {
    var s = ui.sheet, t = cur();
    closeSheet();
    var it = item(s.d.itemId);
    commit('Deleted ' + (it ? it.ru : ''), function () { t.lines = t.lines.filter(function (l) { return l.id !== s.id; }); });
  };
  A.inc = function (d) {
    var t = cur(); var l = t.lines.filter(function (x) { return x.id === d.id; })[0];
    commit(null, function () { l.qty++; t.updatedAt = Date.now(); });
  };
  A.dec = function (d) {
    var t = cur(); var l = t.lines.filter(function (x) { return x.id === d.id; })[0];
    var it = item(l.itemId);
    if (l.qty > 1) commit(null, function () { l.qty--; t.updatedAt = Date.now(); });
    else commit('Removed ' + (it ? it.ru : ''), function () { t.lines = t.lines.filter(function (x) { return x !== l; }); });
  };
  A.addMod = function (d) {
    var t = cur(); var l = t.lines.filter(function (x) { return x.id === d.line; })[0];
    var m = MENU.MODS[d.mod];
    commit('+ ' + m.ru + ' on ' + item(l.itemId).ru, function () { l.mods[d.mod] = 1; });
  };
  A.merge = function (d) { var t = cur(); commit('Merged', function () { L.mergeDuplicates(t, d.item); }); };

  // review
  A.review = function () { ui.review.onlyNew = cur().lines.some(function (l) { return l.status === 'new'; }); nav('review'); };
  A.rvNew = function () { ui.review.onlyNew = true; render(); };
  A.rvAll = function () { ui.review.onlyNew = false; render(); };
  A.rvGroup = function (d) { ui.review.bySeat = d.g === 'seat'; render(); };
  A.bigText = function () { ui.review.big = !ui.review.big; render(); };
  A.tick = function (d) { ui.review.ticked[d.id] = !ui.review.ticked[d.id]; render(); };
  A.markSent = function () {
    var t = cur();
    var ids = Object.keys(ui.review.ticked).filter(function (k) { return ui.review.ticked[k]; });
    var blocked = t.lines.filter(function (l) {
      return l.status === 'new' && (!ids.length || ids.indexOf(l.id) >= 0) &&
        L.lineIssues(l, item(l.itemId)).some(function (i) { return i.level === 'block'; });
    });
    guard(blocked.length, blocked.length + ' line(s) still have a red problem (e.g. size not chosen). Mark as entered anyway?', 'Mark entered', function () { commit(ids.length ? ids.length + ' line(s) marked entered' : 'All marked entered', function () {
      L.markSent(t, ids.length ? ids : null);
      ui.review.ticked = {};
      if (!t.lines.some(function (l) { return l.status === 'new'; })) ui.view = 'table';
    }); });
  };
  A.copy = function () {
    var t = cur();
    var txt = L.summaryText(t, S.menu, ui.review.onlyNew);
    copyText(txt).then(function () { toast('Copied'); }, function () { toast('Copy failed — long-press to select'); });
  };
  function copyText(txt) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(txt);
    return new Promise(function (res, rej) {
      var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? res() : rej(); } catch (e) { rej(e); }
      ta.remove();
    });
  }

  // item info / flags
  A.info = function (d) { openSheet({ type: 'info', id: d.id }); };
  A.fav = function (d) {
    commit(null, function () {
      var i = S.favorites.indexOf(d.id);
      if (i >= 0) S.favorites.splice(i, 1); else S.favorites.push(d.id);
    });
  };
  A.hard = function (d) { commit(null, function () { if (S.training.hard[d.id]) delete S.training.hard[d.id]; else S.training.hard[d.id] = true; }); };
  function setOverride(id, patch) {
    var ov = S.menu.overrides[id] = Object.assign({}, S.menu.overrides[id] || {}, patch);
    Object.keys(ov).forEach(function (k) { if (ov[k] == null || ov[k] === false || ov[k] === '') delete ov[k]; });
    if (!Object.keys(ov).length) delete S.menu.overrides[id];
  }
  A.stop = function (d) {
    var it = item(d.id);
    commit(it.stop ? it.ru + ' back on menu' : '⛔ ' + it.ru + ' on stop-list', function () { setOverride(d.id, { stop: !it.stop }); });
  };
  A.hide = function (d) { var it = item(d.id); commit(null, function () { setOverride(d.id, { hidden: !it.hidden }); }); };
  A.editItem = function (d) { openSheet({ type: 'editItem', id: d.id }); };
  A.saveItem = function (d) {
    var p = document.getElementById('ei_price').value.trim();
    var ru = document.getElementById('ei_ru').value.trim();
    var note = document.getElementById('ei_note').value.trim();
    var base = L.getItem(d.id);
    var price = p === '' ? null : parseInt(p, 10);
    if (p !== '' && (isNaN(price) || price < 0)) { toast('Price must be a whole number of rubles'); return; }
    closeSheet();
    commit('Item updated', function () {
      setOverride(d.id, {
        price: base && price === base.price ? null : price,
        ru: base && ru === base.ru ? null : ru,
        myNote: note,
        note: note ? note + (base && base.note ? ' · ' + base.note : '') : null,
      });
    });
  };
  A.resetItem = function (d) { closeSheet(); commit('Reset to photo', function () { delete S.menu.overrides[d.id]; }); };
  A.custom = function () { openSheet({ type: 'custom' }); };
  A.saveCustom = function () {
    var ru = document.getElementById('cu_ru').value.trim();
    var en = document.getElementById('cu_en').value.trim();
    var price = parseInt(document.getElementById('cu_price').value, 10);
    var cat = document.getElementById('cu_cat').value;
    if (!ru) { toast('Enter the Russian name first'); return; }
    closeSheet();
    commit('Added ' + ru, function () {
      S.menu.custom.push({ id: L.uid('cu_'), cat: cat, ru: ru, en: en || ru, price: isNaN(price) ? null : price, w: '', icons: '✚', custom: true,
        unverified: isNaN(price) ? 'Price not set' : null, note: 'Added by you' });
    });
  };
  A.clearStop = function () {
    commit('Stop-list cleared', function () { Object.keys(S.menu.overrides).forEach(function (id) { setOverride(id, { stop: null }); }); });
  };
  A.mFilter = function (d) { ui.menu.filter = d.f; render(); };

  // data
  A.export = function () {
    var json = store.exportJSON(S);
    var name = 'waiter-backup-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json';
    var blob = new Blob([json], { type: 'application/json' });
    if (navigator.canShare && window.File) {
      var file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: name }).catch(function () {}); return; }
    }
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  };
  A.restore = function () { openSheet({ type: 'restore' }); };
  A.doRestore = function (d) {
    var s = store.restore(d.k);
    if (!s) { toast('That snapshot could not be read'); return; }
    ask('Replace current data with this snapshot? Current state is snapshotted first.', 'Restore', function () {
      store.snapshot(S, true);
      commit('Snapshot restored', function () { S = s; ui.view = 'tables'; ui.tableId = null; });
    });
  };
  A.endShift = function () {
    var n = S.tables.length;
    var pending = S.tables.reduce(function (a, t) { return a + t.lines.filter(function (l) { return l.status === 'new'; }).length; }, 0);
    ask('Close all ' + n + ' tables' + (pending ? ' (' + pending + ' lines NOT entered in POS!)' : '') + ' and clear stop-list?', 'End shift', function () {
    store.snapshot(S, true);
    commit('Shift ended — ' + n + ' tables to history', function () {
      var now = Date.now();
      S.tables.forEach(function (t) { t.closedAt = now; S.history.unshift(t); });
      S.tables = [];
      Object.keys(S.menu.overrides).forEach(function (id) { setOverride(id, { stop: null }); });
      ui.tableId = null;
    }, { snapshot: true });
    });
  };
  A.toggleSeats = function () { commit(null, function () { S.settings.seats = !S.settings.seats; }); };
  A.theme = function (d) { commit(null, function () { S.settings.theme = d.t; }); };
  A.resetTraining = function () {
    ask('Reset quiz progress and hard marks?', 'Reset', function () {
      commit('Training reset', function () { S.training = { box: {}, hard: {}, stats: { right: 0, wrong: 0 } }; });
    });
  };

  // learn
  A.lrMode = function (d) { ui.learn.mode = d.m; ui.learn.q = null; ui.learn.answered = null; ui.learn.flash = null; ui.learn.flipped = false; render(); };
  A.lrGroup = function (d) { ui.learn.group = d.g; ui.learn.q = null; ui.learn.answered = null; ui.learn.flash = null; render(); };
  A.answer = function (d) {
    var lr = ui.learn;
    if (lr.answered != null) return;
    lr.answered = +d.i;
    var right = lr.q.choices[lr.answered].correct;
    commit(null, function () { T.grade(S.training, lr.q.itemId, right); });
  };
  A.drillStart = function () {
    var sc = T.scenario(L.allItems(S.menu), S.training);
    ui.practice = { sc: sc, table: { id: 'practice', num: 'Practice', lines: [], openedAt: Date.now() }, startedAt: Date.now(), result: null };
    render(); window.scrollTo(0, 0);
  };
  A.drillStop = function () { ui.practice = null; render(); };
  A.drillCheck = function () {
    var pr = ui.practice;
    pr.result = T.gradeScenario(pr.sc, pr.table.lines);
    pr.checkedAt = Date.now();
    var perfect = pr.result.every(function (r) { return r.ok; });
    commit(null, function () {
      pr.result.forEach(function (r) { if (!r.extra) T.grade(S.training, r.itemId, r.ok); });
      var st = S.training.drill = S.training.drill || { done: 0, perfect: 0 };
      st.done++; if (perfect) st.perfect++;
    });
    window.scrollTo(0, 0);
  };
  A.nextQ = function () { ui.learn.q = null; ui.learn.answered = null; render(); window.scrollTo(0, 0); };
  A.flip = function () { ui.learn.flipped = !ui.learn.flipped; render(); };
  A.flashGrade = function (d) {
    var id = ui.learn.flash;
    commit(null, function () { T.grade(S.training, id, d.r === '1'); });
    ui.learn.flash = null; ui.learn.flipped = false; render();
  };

  A.confirmOk = function () { var fn = ui.sheet.fn; closeSheet(); fn(); };
  A.backdrop = function (d, el, e) { if (e.target === el) closeSheet(); };
  A.closeSheet = function () { closeSheet(); };

  // ---------------------------------------------------------------- events
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-a]');
    if (!el || el.disabled) return;
    var fn = A[el.dataset.a];
    if (!fn) return;
    if (el.dataset.a !== 'backdrop') e.preventDefault();
    fn(el.dataset, el, e);
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'msearch') {
      ui.menu.q = e.target.value;
      if (ui.menu.filter !== 'all') { ui.menu.filter = 'all'; }
      var all = MENU.ITEMS.map(function (x) { return L.getItem(x.id, S.menu); }).concat(S.menu.custom.map(function (c) { return L.getItem(c.id, S.menu); }));
      document.getElementById('mlist').innerHTML = menuListHTML(all, [], []);
    }
    if (e.target.id === 'tlabel' && ui.sheet && ui.sheet.type === 'newTable') {
      ui.sheet.num = e.target.value.trim();
      var btn = $sheet.querySelector('[data-a="createTable"]');
      if (btn) { btn.disabled = !ui.sheet.num; btn.textContent = 'Open table ' + ui.sheet.num; }
      var disp = $sheet.querySelector('.display'); if (disp) disp.textContent = ui.sheet.num || '№';
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'importfile' && e.target.files[0]) {
      var f = e.target.files[0];
      f.text().then(importText);
      e.target.value = '';
    }
  });

  function importText(txt) {
    var s;
    try { s = store.importJSON(txt); } catch (err) { toast('Import failed: ' + err.message); return; }
    ask('Replace current data with this backup (' + s.tables.length + ' open tables)? Current state is snapshotted first.', 'Import', function () {
      store.snapshot(S, true);
      commit('Backup imported', function () { S = s; ui.view = 'tables'; ui.tableId = null; });
    });
  }
  A.backupText = function () { openSheet({ type: 'backupText' }); };
  A.copyBackup = function () {
    copyText(store.exportJSON(S)).then(function () { toast('Backup copied — paste it into Notes or a chat to yourself'); },
      function () { var ta = document.getElementById('bk_out'); ta.focus(); ta.select(); toast('Select all and copy'); });
  };
  A.pasteBackup = function () { importText(document.getElementById('bk_in').value); };
  function sheetBackupText() {
    return '<h2>Backup as text</h2><div class="en">Works where file downloads are blocked. Copy it to Notes or Telegram; paste it back here to restore.</div>' +
      '<textarea class="field mt" id="bk_out" readonly rows="4">' + esc(store.exportJSON(S)) + '</textarea>' +
      '<button class="btn block mt" data-a="copyBackup">Copy backup</button>' +
      '<h3>Restore from text</h3><textarea class="field" id="bk_in" rows="4" placeholder="Paste a backup here"></textarea>' +
      '<div class="foot"><button class="btn" data-a="closeSheet">Close</button><button class="btn primary" data-a="pasteBackup">Restore pasted backup</button></div>';
  }

  window.addEventListener('storage', function (e) {
    if (e.key === store.KEY && e.newValue) { S = store.load().state; render(); toast('Updated from another tab'); }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) store.save(S); else render(); });
  window.addEventListener('pagehide', function () { store.save(S); });
  setInterval(function () { if (!ui.sheet && !ui.picker && (ui.view === 'tables' || ui.view === 'table')) render(); }, 30000);

  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(function (granted) { S.settings.persisted = granted; }).catch(function () {});
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  store.save(S);
  render();
  window.__waiter = { get state() { return S; }, ui: ui, L: L };
})();
