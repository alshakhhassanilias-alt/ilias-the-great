/*
 * Pure order logic — no DOM, no storage. Unit-tested in tests/logic.test.js.
 */
(function (root) {
  'use strict';

  function uid(prefix) {
    return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function createLogic(MENU) {
    var itemIndex = {};
    MENU.ITEMS.forEach(function (it) { itemIndex[it.id] = it; });
    var catIndex = {};
    MENU.CATS.forEach(function (c, i) { catIndex[c.id] = Object.assign({ order: i }, c); });
    var DRINK_GROUPS = { drinks: true, bar: true };

    // Menu = base data + user overrides (price fixes, stop-list, renames) + custom items.
    function getItem(id, menuState) {
      var base = itemIndex[id];
      var custom = null;
      if (!base && menuState && menuState.custom) {
        custom = menuState.custom.filter(function (c) { return c.id === id; })[0] || null;
      }
      var it = base || custom;
      if (!it) return null;
      var ov = menuState && menuState.overrides && menuState.overrides[id];
      if (!ov) return it;
      var merged = Object.assign({}, it, ov);
      if (ov.price != null && it.price !== ov.price) merged.priceEdited = true;
      if (ov.price != null && it.unverified && /price/i.test(it.unverified)) merged.unverified = null;
      return merged;
    }

    function allItems(menuState) {
      var list = MENU.ITEMS.map(function (it) { return getItem(it.id, menuState); });
      if (menuState && menuState.custom) {
        menuState.custom.forEach(function (c) { list.push(getItem(c.id, menuState)); });
      }
      return list.filter(function (it) { return it && !it.hidden; });
    }

    function isDrink(item) {
      var c = item && catIndex[item.cat];
      return !!(c && DRINK_GROUPS[c.group]);
    }

    function displayName(item) {
      if (!item) return '?';
      return (item.pre ? item.pre + ': ' : '') + item.ru;
    }

    // ---- Pricing -------------------------------------------------------------
    function unitPrice(line, item) {
      if (!item) return null;
      if (line.free) return 0;
      var price = item.price;
      (item.options || []).forEach(function (opt) {
        var sel = line.opts && line.opts[opt.id];
        if (sel == null || opt.multi) return;
        var ch = opt.choices.filter(function (c) { return c.id === sel; })[0];
        if (ch && ch.price != null) price = ch.price;
      });
      if (price == null) return null;
      Object.keys(line.mods || {}).forEach(function (mid) {
        var m = MENU.MODS[mid];
        if (m) price += m.price * (line.mods[mid] || 0);
      });
      if (line.sideSwap) price += MENU.RULES.sideSwapPrice;
      return price;
    }

    function lineTotal(line, item) {
      var u = unitPrice(line, item);
      return u == null ? null : u * line.qty;
    }

    function tableTotal(table, menuState) {
      var sum = 0, unknown = 0, count = 0;
      table.lines.forEach(function (l) {
        var t = lineTotal(l, getItem(l.itemId, menuState) || l.snap);
        count += l.qty;
        if (t == null) unknown++; else sum += t;
      });
      return { sum: sum, unknown: unknown, count: count };
    }

    // ---- Lines ---------------------------------------------------------------
    function newLine(itemId, init) {
      init = init || {};
      return {
        id: uid('l'),
        itemId: itemId,
        qty: init.qty || 1,
        opts: Object.assign({}, init.opts || {}),
        mods: Object.assign({}, init.mods || {}),
        seat: init.seat || null,
        note: init.note || '',
        sideOk: false,
        sideSwap: null,
        free: !!init.free,
        dismissed: [],
        status: 'new',
        addedAt: init.now || Date.now(),
        sentAt: null,
        snap: null,
      };
    }

    function sameConfig(a, b) {
      return a.itemId === b.itemId &&
        JSON.stringify(a.opts || {}) === JSON.stringify(b.opts || {}) &&
        JSON.stringify(a.mods || {}) === JSON.stringify(b.mods || {}) &&
        (a.seat || null) === (b.seat || null) &&
        (a.note || '') === (b.note || '') &&
        (a.sideSwap || null) === (b.sideSwap || null) &&
        !!a.free === !!b.free;
    }

    // Adds an item to a table. If an identical NEW (not yet entered) line exists,
    // its quantity is increased instead of creating a near-duplicate line.
    // Returns { line, merged }.
    function addItem(table, itemId, init, menuState) {
      var item = getItem(itemId, menuState);
      var candidate = newLine(itemId, init);
      if (item) candidate.snap = { ru: displayName(item), en: item.en, price: item.price, cat: item.cat };
      for (var i = table.lines.length - 1; i >= 0; i--) {
        var l = table.lines[i];
        if (l.status === 'new' && sameConfig(l, candidate)) {
          l.qty += candidate.qty;
          table.updatedAt = Date.now();
          return { line: l, merged: true };
        }
      }
      table.lines.push(candidate);
      table.updatedAt = Date.now();
      return { line: candidate, merged: false };
    }

    // ---- Checks ----------------------------------------------------------------
    // level: 'block' = must fix before entering into the POS
    //        'warn'  = confirm with guest
    //        'info'  = reminder / offer, never required
    function lineIssues(line, item) {
      var out = [];
      if (!item) {
        out.push({ level: 'warn', code: 'missing', text: 'Item no longer in menu data — check name in POS' });
        return out;
      }
      if (item.stop) out.push({ level: 'block', code: 'stop', text: 'STOP-LIST: marked unavailable' });
      (item.options || []).forEach(function (opt) {
        var sel = line.opts && line.opts[opt.id];
        var empty = sel == null || (Array.isArray(sel) && sel.length === 0);
        if (opt.required && empty) out.push({ level: 'block', code: 'opt:' + opt.id, text: 'Choose ' + opt.label.toLowerCase() });
        if (opt.want && Array.isArray(sel) && sel.length && sel.length !== opt.want) {
          out.push({ level: 'warn', code: 'want:' + opt.id, text: sel.length + ' of ' + opt.want + ' chosen' });
        }
      });
      if (!line.free && item.price == null && unitPrice(line, item) == null) out.push({ level: 'warn', code: 'price', text: 'Price unknown — check POS' });
      if (item.side && !line.sideOk && !line.sideSwap) {
        out.push({ level: 'warn', code: 'side', text: 'Side: ' + item.side.name + ' — confirm or swap' });
      }
      if (item.sideUnknown && !line.sideOk) {
        out.push({ level: 'info', code: 'sideunk', text: 'Side not named on menu — ask what comes with it' });
      }
      (item.suggest || []).forEach(function (mid) {
        if ((line.mods && line.mods[mid]) || (line.dismissed || []).indexOf(mid) >= 0) return;
        var anyFromGroup = Object.keys(line.mods || {}).some(function (k) {
          return MENU.MODS[k] && MENU.MODS[mid] && MENU.MODS[k].group === MENU.MODS[mid].group;
        });
        if (anyFromGroup) return;
        var m = MENU.MODS[mid];
        if (m) out.push({ level: 'info', code: 'offer:' + mid, mod: mid, text: 'Offer ' + m.ru + ' +' + m.price + ' ₽' });
      });
      var tags = item.tags || [];
      if (tags.indexOf('pits') >= 0) out.push({ level: 'info', code: 'pits', text: 'Tell guest: may contain pits (косточки)' });
      if (tags.indexOf('bones') >= 0) out.push({ level: 'info', code: 'bones', text: 'Tell guest: careful, bones (кости)' });
      if (item.unverified) out.push({ level: 'info', code: 'unverified', text: '⚠ ' + item.unverified });
      return out;
    }

    function hasHour(ts, before) {
      return new Date(ts).getHours() < before;
    }

    function tableIssues(table, menuState, now) {
      now = now || Date.now();
      var out = [];
      var breakfast = 0, food = 0, drinks = 0, vodkaMl = 0, freebies = 0;
      var byItem = {};
      table.lines.forEach(function (l) {
        var it = getItem(l.itemId, menuState);
        if (!it) return;
        if ((it.tags || []).indexOf('breakfast') >= 0 && hasHour(l.addedAt, 12)) breakfast += l.qty;
        if (isDrink(it)) drinks += l.qty; else if (!it.isExtra) food += l.qty;
        if (it.vodka) vodkaMl += (it.ml || 0) * l.qty;
        if (l.free) freebies += l.qty;
        (byItem[l.itemId] = byItem[l.itemId] || []).push(l);
      });
      if (breakfast > 0) {
        out.push({ level: 'warn', code: 'bfgift', text: 'Breakfast before 12:00 ×' + breakfast + ' → free espresso / americano / tea. Asked the guest? (' + freebies + ' gift line' + (freebies === 1 ? '' : 's') + ' so far)' });
      }
      if (vodkaMl >= 1000) {
        out.push({ level: 'warn', code: 'vodka', text: 'Vodka ' + vodkaMl + ' мл ≥ 1 L → 3 L juice gift (apple or tomato) per menu' });
      }
      if (food > 0 && drinks === 0) out.push({ level: 'info', code: 'nodrinks', text: 'No drinks yet — ask about drinks' });
      Object.keys(byItem).forEach(function (id) {
        var ls = byItem[id];
        var news = ls.filter(function (l) { return l.status === 'new'; });
        var sent = ls.filter(function (l) { return l.status === 'sent'; });
        var it = getItem(id, menuState);
        if (news.length && sent.length) {
          out.push({ level: 'warn', code: 'repeat:' + id, text: displayName(it) + ' was already entered ×' + sum(sent) + ' — new ×' + sum(news) + ' is a second order?' });
        } else if (news.length > 1) {
          var plain = news.filter(function (l) { return !l.seat && !l.note && !Object.keys(l.mods || {}).length; });
          if (plain.length > 1) out.push({ level: 'info', code: 'dup:' + id, text: displayName(it) + ' appears on ' + plain.length + ' lines — merge?', merge: id });
        }
      });
      return out;
    }

    function sum(lines) { return lines.reduce(function (a, l) { return a + l.qty; }, 0); }

    function optionText(line, item) {
      var parts = [];
      (item && item.options || []).forEach(function (opt) {
        var sel = line.opts && line.opts[opt.id];
        if (sel == null) return;
        var ids = Array.isArray(sel) ? sel : [sel];
        var labels = ids.map(function (id) {
          var ch = opt.choices.filter(function (c) { return c.id === id; })[0];
          return ch ? ch.label : id;
        });
        if (labels.length) parts.push(labels.join(', '));
      });
      return parts;
    }

    function lineDetail(line, item) {
      var parts = optionText(line, item);
      Object.keys(line.mods || {}).forEach(function (mid) {
        var m = MENU.MODS[mid];
        if (m && line.mods[mid]) parts.push('+ ' + m.ru + (line.mods[mid] > 1 ? ' ×' + line.mods[mid] : ''));
      });
      if (item && item.side) {
        if (line.sideSwap) {
          var sw = getItem(line.sideSwap);
          parts.push('гарнир → ' + (sw ? sw.ru : line.sideSwap) + ' (+' + MENU.RULES.sideSwapPrice + ')');
        } else if (line.sideOk) parts.push('гарнир: ' + item.side.name);
      }
      if (line.free) parts.push('🎁 ПОДАРОК');
      if (line.seat) parts.push('гость ' + line.seat);
      if (line.note) parts.push('«' + line.note + '»');
      return parts;
    }

    // Lines sorted the way they are printed on the menu — handy for POS entry.
    function sortedLines(table, menuState) {
      return table.lines.slice().sort(function (a, b) {
        var ia = getItem(a.itemId, menuState), ib = getItem(b.itemId, menuState);
        var ca = ia && catIndex[ia.cat] ? catIndex[ia.cat].order : 999;
        var cb = ib && catIndex[ib.cat] ? catIndex[ib.cat].order : 999;
        return ca - cb || a.addedAt - b.addedAt;
      });
    }

    function summaryText(table, menuState, onlyNew) {
      var lines = sortedLines(table, menuState).filter(function (l) { return !onlyNew || l.status === 'new'; });
      var head = 'Стол ' + table.num + (table.guests ? ' (' + table.guests + ' гост.)' : '');
      var rows = lines.map(function (l) {
        var it = getItem(l.itemId, menuState);
        var d = lineDetail(l, it);
        return l.qty + ' × ' + (it ? displayName(it) : (l.snap && l.snap.ru) || l.itemId) + (d.length ? ' — ' + d.join('; ') : '');
      });
      return [head].concat(rows).join('\n');
    }

    function markSent(table, lineIds, now) {
      now = now || Date.now();
      table.lines.forEach(function (l) {
        if (l.status === 'new' && (!lineIds || lineIds.indexOf(l.id) >= 0)) { l.status = 'sent'; l.sentAt = now; }
      });
      table.updatedAt = now;
    }

    function mergeDuplicates(table, itemId) {
      var keep = null;
      table.lines = table.lines.filter(function (l) {
        if (l.itemId !== itemId || l.status !== 'new' || l.seat || l.note || Object.keys(l.mods || {}).length) return true;
        if (!keep) { keep = l; return true; }
        if (JSON.stringify(l.opts) !== JSON.stringify(keep.opts) || l.sideSwap !== keep.sideSwap) return true;
        keep.qty += l.qty;
        keep.sideOk = keep.sideOk || l.sideOk;
        return false;
      });
    }

    // ---- Search ----------------------------------------------------------------
    var EN_RU = { q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з', '[': 'х', ']': 'ъ',
      a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л', l: 'д', ';': 'ж', "'": 'э',
      z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь', ',': 'б', '.': 'ю', '`': 'ё' };

    function norm(s) {
      return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”'’().,:;!?\-–—\/]/g, ' ').replace(/\s+/g, ' ').trim();
    }
    function layoutFix(q) {
      // “gtkmvtyb” typed on the English layout → “пельмени”
      return String(q || '').toLowerCase().split('').map(function (ch) { return EN_RU[ch] || ch; }).join('');
    }
    function lev1(a, b) {
      // true if edit distance <= 1 (cheap check, used for tokens >= 4 chars)
      if (a === b) return true;
      var la = a.length, lb = b.length;
      if (Math.abs(la - lb) > 1) return false;
      var i = 0, j = 0, edits = 0;
      while (i < la && j < lb) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++edits > 1) return false;
        if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
      }
      return edits + (la - i) + (lb - j) <= 1;
    }
    function haystack(it) {
      var h = it._hay;
      if (!h) {
        h = {
          name: norm((it.pre || '') + ' ' + it.ru).split(' '),
          en: norm(it.en).split(' '),
          rest: norm((it.desc || '') + ' ' + (it.descEn || '') + ' ' + (it.alias || []).join(' ') + ' ' + (it.form || '') + ' ' + (catIndex[it.cat] ? catIndex[it.cat].ru + ' ' + catIndex[it.cat].en : '')).split(' '),
        };
        try { Object.defineProperty(it, '_hay', { value: h, enumerable: false }); } catch (e) { /* frozen */ }
      }
      return h;
    }
    function tokenScore(tok, words, weight) {
      var best = 0;
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (!w) continue;
        if (w === tok) return weight * 3;
        if (w.indexOf(tok) === 0) best = Math.max(best, weight * 2);
        else if (tok.length >= 3 && w.indexOf(tok) > 0) best = Math.max(best, weight);
        else if (tok.length >= 4 && (lev1(tok, w) || lev1(tok, w.slice(0, tok.length)) || lev1(tok, w.slice(0, tok.length + 1)))) {
          best = Math.max(best, weight * 0.8);
        }
      }
      return best;
    }
    function scoreItem(it, tokens) {
      var h = haystack(it), total = 0;
      for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        var s = Math.max(tokenScore(t, h.name, 5), tokenScore(t, h.en, 4), tokenScore(t, h.rest, 1));
        if (!s) return 0;
        total += s;
      }
      return total;
    }
    function search(items, query) {
      var q = norm(query);
      if (!q) return [];
      var variants = [q];
      var fixed = norm(layoutFix(query));
      if (fixed !== q && /[a-z]/.test(q)) variants.push(fixed);
      var results = [];
      items.forEach(function (it) {
        var best = 0;
        variants.forEach(function (v) { best = Math.max(best, scoreItem(it, v.split(' '))); });
        if (best > 0) results.push({ it: it, s: best });
      });
      results.sort(function (a, b) { return b.s - a.s || a.it.ru.length - b.it.ru.length; });
      return results.map(function (r) { return r.it; });
    }

    return {
      uid: uid, getItem: getItem, allItems: allItems, isDrink: isDrink, displayName: displayName,
      unitPrice: unitPrice, lineTotal: lineTotal, tableTotal: tableTotal,
      newLine: newLine, addItem: addItem, lineIssues: lineIssues, tableIssues: tableIssues,
      lineDetail: lineDetail, sortedLines: sortedLines, summaryText: summaryText, markSent: markSent,
      mergeDuplicates: mergeDuplicates, search: search, norm: norm, layoutFix: layoutFix, cat: function (id) { return catIndex[id]; },
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createLogic: createLogic };
  else root.createLogic = createLogic;
})(this);
