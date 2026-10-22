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
    // Custom lines (requests not on the menu) carry their own name/price;
    // registerCustom() makes them resolvable like normal items.
    var adhoc = {};
    function registerCustom(line) {
      if (!line || !line.custom) return;
      adhoc[line.itemId] = { id: line.itemId, cat: 'custom', ru: line.custom.ru, en: 'Not on the menu', pre: 'Не из меню',
        price: line.custom.price == null ? null : line.custom.price, w: '', icons: '✚', isCustom: true };
    }

    // Menu = base data + user overrides (price fixes, stop-list, renames) + custom items.
    function getItem(id, menuState) {
      var base = itemIndex[id];
      var custom = null;
      if (!base && menuState && menuState.custom) {
        custom = menuState.custom.filter(function (c) { return c.id === id; })[0] || null;
      }
      var it = base || custom || adhoc[id];
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
        if (sel == null || opt.multi || opt.count) return;
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
        if (opt.count) {
          var n = countTotal(sel);
          if (n !== opt.count) out.push({ level: 'block', code: 'opt:' + opt.id, text: 'Choose ' + opt.count + ' (' + n + ' so far)' });
          return;
        }
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

    function countTotal(sel) {
      var n = 0;
      Object.keys(sel || {}).forEach(function (k) { n += sel[k] || 0; });
      return n;
    }
    function optionText(line, item) {
      var parts = [];
      (item && item.options || []).forEach(function (opt) {
        var sel = line.opts && line.opts[opt.id];
        if (sel == null) return;
        if (opt.count) {
          var bits = opt.choices.filter(function (c) { return sel[c.id]; }).map(function (c) { return c.label + (sel[c.id] > 1 ? ' ×' + sel[c.id] : ''); });
          if (bits.length) parts.push(bits.join(', '));
          return;
        }
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
    // Offline “smart” matching, scored per item. Layers, strongest first:
    //   learned shortcut (what you picked before for this exact query)
    //   initials / run-together word starts  (“пс”, “вкг”, “пелсиб”)
    //   exact word, word start, other word form (“пельменей”, “шуба”)
    //   inside a word, typo (1–2 letters), loose spelling (о/а, е/и, ь, doubles)
    // Every query is also tried as typed on the wrong keyboard layout and as
    // Latin transliteration (“pelmeni”).
    var EN_RU = { q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з', '[': 'х', ']': 'ъ',
      a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л', l: 'д', ';': 'ж', "'": 'э',
      z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь', ',': 'б', '.': 'ю', '`': 'ё' };
    var TRANSLIT = [['shch', 'щ'], ['sch', 'щ'], ['sh', 'ш'], ['ch', 'ч'], ['zh', 'ж'], ['kh', 'х'], ['ts', 'ц'],
      ['ya', 'я'], ['yu', 'ю'], ['yo', 'е'], ['ye', 'е'], ['ja', 'я'], ['ju', 'ю'],
      ['a', 'а'], ['b', 'б'], ['v', 'в'], ['w', 'в'], ['g', 'г'], ['d', 'д'], ['e', 'е'], ['z', 'з'], ['i', 'и'], ['j', 'й'],
      ['y', 'ы'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['r', 'р'], ['s', 'с'], ['t', 'т'],
      ['u', 'у'], ['f', 'ф'], ['h', 'х'], ['c', 'к'], ['x', 'кс'], ['q', 'к']];
    var STOP = { 'с': 1, 'со': 1, 'и': 1, 'в': 1, 'во': 1, 'по': 1, 'на': 1, 'из': 1, 'под': 1, 'для': 1, 'к': 1, 'а': 1, 'от': 1,
      'with': 1, 'and': 1, 'in': 1, 'of': 1, 'the': 1, 'a': 1, 'on': 1 };

    function norm(s) {
      return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”'’().,:;!?\-–—\/+*№]/g, ' ').replace(/\s+/g, ' ').trim();
    }
    function layoutFix(q) {
      // “gtkmvtyb” typed on the English layout → “пельмени”
      return String(q || '').toLowerCase().split('').map(function (ch) { return EN_RU[ch] || ch; }).join('');
    }
    function translit(q) {
      var s = String(q || '').toLowerCase(), out = '';
      for (var i = 0; i < s.length;) {
        var hit = null;
        for (var k = 0; k < TRANSLIT.length; k++) {
          if (s.substr(i, TRANSLIT[k][0].length) === TRANSLIT[k][0]) { hit = TRANSLIT[k]; break; }
        }
        if (hit) { out += hit[1]; i += hit[0].length; } else { out += s[i]; i++; }
      }
      return out;
    }
    // Spelling-insensitive key: drops ь/ъ, merges vowels people confuse when
    // unstressed, collapses doubled letters (“пелмени”, “пильмени”, “суфле”).
    function loose(w) {
      return w.replace(/[ьъ]/g, '').replace(/[ао]/g, 'а').replace(/[еэиыяй]/g, 'и').replace(/щ/g, 'ш')
        .replace(/(.)\1+/g, '$1');
    }
    // Optimal-string-alignment distance with an early cut-off.
    function dist(a, b, max) {
      if (Math.abs(a.length - b.length) > max) return max + 1;
      var prev2 = null, prev = [], cur, i, j;
      for (j = 0; j <= b.length; j++) prev[j] = j;
      for (i = 1; i <= a.length; i++) {
        cur = [i];
        var best = i;
        for (j = 1; j <= b.length; j++) {
          var cost = a[i - 1] === b[j - 1] ? 0 : 1;
          var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
          if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
          cur[j] = v;
          if (v < best) best = v;
        }
        if (best > max) return max + 1;
        prev2 = prev; prev = cur;
      }
      return prev[b.length];
    }
    var ENDING = /^(|а|я|о|е|ы|и|у|ю|ь|й|ой|ей|ий|ый|ая|яя|ое|ее|ые|ие|ую|юю|ом|ем|ам|ям|ах|ях|ов|ев|ами|ями|ого|его|ому|ему|ых|их|ым|им|ки|ка|ку|ке|ков)$/;
    function commonPrefix(a, b) {
      var n = Math.min(a.length, b.length), i = 0;
      while (i < n && a[i] === b[i]) i++;
      return i;
    }

    function haystack(it) {
      var h = it._hay;
      if (!h) {
        var nameWords = norm(it.ru).split(' ').filter(Boolean);
        var main = norm(it.ru).split(' ').filter(function (w) { return w && !STOP[w]; });
        h = {
          name: nameWords,
          pre: norm(it.pre || '').split(' ').filter(Boolean),
          en: norm(it.en).split(' ').filter(Boolean),
          rest: norm((it.desc || '') + ' ' + (it.descEn || '') + ' ' + (it.alias || []).join(' ') + ' ' + (it.form || '') + ' ' +
            (catIndex[it.cat] ? catIndex[it.cat].ru + ' ' + catIndex[it.cat].en : '')).split(' ').filter(Boolean),
          main: main,                                   // significant words of the printed name
          en2: norm(it.en).split(' ').filter(function (w) { return w && !STOP[w]; }),
        };
        h.looseName = h.name.map(loose);
        try { Object.defineProperty(it, '_hay', { value: h, enumerable: false }); } catch (e) { /* frozen */ }
      }
      return h;
    }

    function wordScore(tok, w, lw) {
      if (w === tok) return 3;
      if (w.indexOf(tok) === 0) return tok.length === 1 ? 0.6 : 2 + 0.3 * tok.length / w.length;
      // other word form: “пельменей” ~ “пельмени”, “шуба” ~ “шубой”, “сало” ~ “сала”
      if (tok.length >= 4) {
        var cp = commonPrefix(tok, w);
        if (cp >= 3 && tok.length - cp <= 3 && w.length - cp <= 3) {
          if (ENDING.test(tok.slice(cp)) && ENDING.test(w.slice(cp))) return 1.9;
          if (cp >= 5) return 1.4;
        }
      }
      if (tok.length >= 3 && w.indexOf(tok) > 0) return 1;
      if (tok.length >= 4 && lw) {
        var lt0 = loose(tok);
        if (lt0 === lw) return 1.6;                        // борш = борщ, пелмени = пельмени
        if (lt0.length >= 3 && lw.indexOf(lt0) === 0) return 0.9;
      }
      if (tok.length >= 4) {
        var max = tok.length >= 7 ? 2 : 1;
        if (dist(tok, w, max) <= max || dist(tok, w.slice(0, tok.length), max) <= max) return 0.8;
      }
      return 0;
    }
    function tokenScore(tok, words, weight, looseWords) {
      var best = 0;
      for (var i = 0; i < words.length; i++) {
        var s = wordScore(tok, words[i], looseWords && looseWords[i]);
        if (s > best) { best = s; if (s === 3) break; }
      }
      return best * weight;
    }

    // “пс”, “вкг”, “пелсиб”, “сибпел” → split the query into word starts of
    // the name’s significant words, in order (words may be skipped).
    function segScore(q, words) {
      if (q.length < 2 || q.length > 14 || !words.length) return 0;
      var best = -1;
      // Pieces must be all first letters (“вкг”) or all 2+ letters (“пел”+“сиб”);
      // mixing them would read real words as shortcuts (“сал”+“о” ≠ “сало”).
      (function walk(qi, wi, segs, skipped, minLen, maxLen0) {
        if (qi === q.length) {
          var tail = words.length - wi;
          var s = 10 + segs - skipped * 0.6 - tail * 0.3;
          if (segs >= 2 && (maxLen0 === 1 || minLen >= 2) && s > best) best = s;
          return;
        }
        for (var j = wi; j < words.length && j - wi <= 2; j++) {
          var w = words[j];
          var maxLen = Math.min(w.length, q.length - qi);
          for (var len = maxLen; len >= 1; len--) {
            if (q.substr(qi, len) === w.slice(0, len)) walk(qi + len, j + 1, segs + 1, skipped + (j - wi), Math.min(minLen, len), Math.max(maxLen0, len));
          }
        }
      })(0, 0, 0, 0, 99, 0);
      return Math.max(best, 0);
    }

    function scoreItem(it, q) {
      var h = haystack(it);
      var tokens = q.split(' ').filter(Boolean);
      var total = 0;
      for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        var s = Math.max(tokenScore(t, h.name, 5, h.looseName), tokenScore(t, h.pre, 3.5), tokenScore(t, h.en, 4), tokenScore(t, h.rest, 1));
        if (!s) { total = 0; break; }
        total += s;
      }
      var compact = q.replace(/ /g, '');
      var seg = Math.max(segScore(compact, h.main), segScore(compact, h.en2) - 1);
      if (tokens.length === 1 && h.main.length === 2) seg = Math.max(seg, segScore(compact, [h.main[1], h.main[0]]) - 0.5);
      if (tokens.length === 2) {
        seg = Math.max(seg, segScore(tokens[1] + tokens[0], h.main) - 1);
        if (tokens[0].length >= 3 && tokens[1].length >= 3) seg = Math.max(seg, segScore(compact, h.main.slice().reverse()) - 2);
      }
      return Math.max(total, seg);
    }

    // opts: { learned: {itemId: count} for this exact query, usage: {itemId: count} }
    function search(items, query, opts) {
      opts = opts || {};
      var q = norm(query);
      if (!q) return [];
      var variants = [q];
      if (/[a-z]/.test(q)) {
        var lf = norm(layoutFix(query)), tr = norm(translit(q));
        if (variants.indexOf(lf) < 0) variants.push(lf);
        if (variants.indexOf(tr) < 0) variants.push(tr);
      }
      var learned = opts.learned || {}, usage = opts.usage || {};
      var results = [];
      items.forEach(function (it) {
        var best = 0;
        variants.forEach(function (v, vi) { best = Math.max(best, scoreItem(it, v) * (vi === 0 ? 1 : 0.95)); });
        if (learned[it.id]) best += 15 + Math.min(5, learned[it.id]);  // your own shortcut wins
        if (best > 0) {
          best += Math.min(1, (usage[it.id] || 0) / 20); // tie-break by how often you order it
          if (it.isExtra) best -= 1;                    // sauces usually go on a line, not alone
          results.push({ it: it, s: best });
        }
      });
      results.sort(function (a, b) { return b.s - a.s || a.it.ru.length - b.it.ru.length; });
      // Drop weak leftovers far below the best match so the list stays clean.
      var top = results.length ? results[0].s : 0;
      return results.filter(function (r) { return r.s >= top * 0.3; }).map(function (r) { return r.it; });
    }

    return {
      uid: uid, getItem: getItem, registerCustom: registerCustom, countTotal: countTotal, allItems: allItems, isDrink: isDrink, displayName: displayName,
      unitPrice: unitPrice, lineTotal: lineTotal, tableTotal: tableTotal,
      newLine: newLine, addItem: addItem, lineIssues: lineIssues, tableIssues: tableIssues,
      lineDetail: lineDetail, sortedLines: sortedLines, summaryText: summaryText, markSent: markSent,
      mergeDuplicates: mergeDuplicates, search: search, norm: norm, layoutFix: layoutFix, cat: function (id) { return catIndex[id]; },
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createLogic: createLogic };
  else root.createLogic = createLogic;
})(this);
