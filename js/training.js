/*
 * Training: questions are generated only from verified menu fields.
 * Items with an `unverified` flag are excluded from price questions.
 * Leitner boxes (0–4): wrong answer → box 0, right → box+1. Low boxes and
 * items marked “hard” are picked more often.
 */
(function (root) {
  'use strict';

  function createTrainer(MENU, logic) {
    function rng() { return Math.random(); }
    function shuffle(a) {
      for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    }
    function name(it) { return logic.displayName(it); }

    function pool(items, group) {
      return items.filter(function (it) {
        if (it.isExtra) return false;
        if (!group || group === 'all') return true;
        if (group === 'hard') return false;
        var c = logic.cat(it.cat);
        return c && c.group === group;
      });
    }

    function weightOf(it, tr) {
      var box = tr.box[it.id] || 0;
      return (5 - box) * (tr.hard[it.id] ? 3 : 1);
    }

    function pickWeighted(list, tr) {
      var total = 0;
      list.forEach(function (it) { total += weightOf(it, tr); });
      var r = rng() * total;
      for (var i = 0; i < list.length; i++) { r -= weightOf(list[i], tr); if (r <= 0) return list[i]; }
      return list[list.length - 1];
    }

    function distractors(target, list, key, n) {
      var seen = {}; seen[key(target)] = true;
      var out = [];
      var same = shuffle(list.filter(function (x) { return x.cat === target.cat; }));
      var other = shuffle(list.filter(function (x) { return x.cat !== target.cat; }));
      same.concat(other).forEach(function (x) {
        var k = key(x);
        if (out.length < n && k != null && !seen[k]) { seen[k] = true; out.push(x); }
      });
      return out;
    }

    // Returns {prompt, sub, choices:[{label, correct}], itemId, explain}
    function question(items, tr, opts) {
      opts = opts || {};
      var list = pool(items, opts.group);
      if (opts.group === 'hard') list = items.filter(function (it) { return tr.hard[it.id]; });
      if (list.length < 4) return null;
      var kinds = opts.kind && opts.kind !== 'mix' ? [opts.kind] : ['price', 'name', 'ru2en', 'ingredients', 'confuse'];
      for (var attempt = 0; attempt < 20; attempt++) {
        var kind = kinds[Math.floor(rng() * kinds.length)];
        var q = build(kind, list, items, tr);
        if (q) return q;
      }
      return null;
    }

    function build(kind, list, all, tr) {
      var it, ds, priceOf = function (x) { return x.unverified || x.price == null ? null : x.price; };
      if (kind === 'price') {
        var priced = list.filter(function (x) { return priceOf(x) != null; });
        if (priced.length < 4) return null;
        it = pickWeighted(priced, tr);
        ds = distractors(it, priced, priceOf, 3);
        if (ds.length < 3) return null;
        return mk('How much is it?', name(it), [it].concat(ds).map(function (x) { return { label: x.price + ' ₽', correct: x === it }; }), it,
          it.ru + ' — ' + it.price + ' ₽' + (it.w ? ' · ' + it.w : ''));
      }
      if (kind === 'name') {
        it = pickWeighted(list, tr);
        ds = distractors(it, list, function (x) { return name(x); }, 3);
        return mk('Guest asks for:', it.en, [it].concat(ds).map(function (x) { return { label: name(x), correct: x === it }; }), it, name(it));
      }
      if (kind === 'ru2en') {
        it = pickWeighted(list, tr);
        ds = distractors(it, list, function (x) { return x.en; }, 3);
        return mk('What is this in English?', name(it), [it].concat(ds).map(function (x) { return { label: x.en, correct: x === it }; }), it, it.en);
      }
      if (kind === 'ingredients') {
        var withDesc = list.filter(function (x) { return x.desc; });
        if (withDesc.length < 4) return null;
        it = pickWeighted(withDesc, tr);
        ds = distractors(it, withDesc, function (x) { return name(x); }, 3);
        if (ds.length < 3) return null;
        return mk('Which dish / drink contains:', it.desc, [it].concat(ds).map(function (x) { return { label: name(x), correct: x === it }; }), it, name(it) + ': ' + it.desc);
      }
      if (kind === 'confuse') {
        var ids = {}; list.forEach(function (x) { ids[x.id] = x; });
        var groups = MENU.CONFUSABLES.filter(function (g) { return g.ids.filter(function (id) { return ids[id]; }).length >= 2; });
        if (!groups.length) return null;
        var g = groups[Math.floor(rng() * groups.length)];
        var members = g.ids.map(function (id) { return logic.getItem(id); }).filter(Boolean);
        var prices = members.map(priceOf);
        var unique = prices.every(function (p, i) { return p != null && prices.indexOf(p) === i; });
        it = members[Math.floor(rng() * members.length)];
        if (unique) {
          return mk(g.title, 'Which one costs ' + it.price + ' ₽?', shuffle(members.map(function (x) { return { label: name(x), correct: x === it }; })), it, g.diff, true);
        }
        return mk(g.title, it.en, shuffle(members.map(function (x) { return { label: name(x), correct: x === it }; })), it, g.diff, true);
      }
      return null;
    }

    function mk(prompt, sub, choices, it, explain, keepOrder) {
      return { prompt: prompt, sub: sub, choices: keepOrder ? choices : shuffle(choices), itemId: it.id, explain: explain };
    }

    function grade(tr, itemId, right) {
      var b = tr.box[itemId] || 0;
      tr.box[itemId] = right ? Math.min(4, b + 1) : 0;
      if (right) tr.stats.right++; else tr.stats.wrong++;
    }

    function nextFlash(items, tr, group) {
      var list = group === 'hard' ? items.filter(function (it) { return tr.hard[it.id]; }) : pool(items, group);
      return list.length ? pickWeighted(list, tr) : null;
    }

    function progress(items, tr) {
      var learned = 0, total = 0;
      items.forEach(function (it) { if (it.isExtra) return; total++; if ((tr.box[it.id] || 0) >= 3) learned++; });
      return { learned: learned, total: total };
    }

    // ---- Practice scenarios --------------------------------------------------
    // A guest “says” an order in English; the waiter enters it with the real
    // picker on a practice table; gradeScenario() compares line by line.
    function scenario(items, tr, opts) {
      opts = opts || {};
      var list = items.filter(function (it) { return !it.isExtra && it.price != null && !it.hidden; });
      var byId = {}; list.forEach(function (it) { byId[it.id] = it; });
      var n = opts.size || (2 + Math.floor(rng() * 3));
      var picked = [], used = {};
      var guard = 0;
      while (picked.length < n && guard++ < 200) {
        var it;
        if (rng() < 0.5) {
          // half the time pick from a look-alike group, to make it realistic
          var g = MENU.CONFUSABLES[Math.floor(rng() * MENU.CONFUSABLES.length)];
          it = byId[g.ids[Math.floor(rng() * g.ids.length)]];
        } else {
          it = pickWeighted(list, tr);
        }
        if (!it || used[it.id]) continue;
        used[it.id] = true;
        picked.push(it);
      }
      var lines = picked.map(function (it) {
        var line = { itemId: it.id, qty: rng() < 0.7 ? 1 : 2, opts: {}, mods: {}, sideSwap: null };
        var words = [];
        (it.options || []).forEach(function (o) {
          if (!o.required) return;
          if (o.multi) {
            var want = o.want || 1;
            var chosen = shuffle(o.choices.slice()).slice(0, want);
            line.opts[o.id] = chosen.map(function (c) { return c.id; });
            words.push(chosen.map(function (c) { return c.label; }).join(', '));
          } else {
            var c = o.choices[Math.floor(rng() * o.choices.length)];
            line.opts[o.id] = c.id;
            words.push(c.label);
          }
        });
        var phrase = line.qty + ' × ' + it.en + (words.length ? ' (' + words.join(', ') + ')' : '');
        if (it.side && it.side.swap && rng() < 0.35) {
          var sides = MENU.ITEMS.filter(function (x) { return x.cat === 'sides' && logic.norm(x.ru) !== logic.norm(it.side.name); });
          var sw = sides[Math.floor(rng() * sides.length)];
          line.sideSwap = sw.id;
          phrase += ' — with ' + sw.en.toLowerCase() + ' instead';
        }
        if (it.suggest && rng() < 0.4) {
          var m = MENU.MODS[it.suggest[Math.floor(rng() * it.suggest.length)]];
          line.mods[m.id] = 1;
          phrase += ' + ' + m.en.toLowerCase();
        }
        return { line: line, phrase: phrase };
      });
      return { lines: lines.map(function (l) { return l.line; }), phrases: lines.map(function (l) { return l.phrase; }) };
    }

    function sameOpts(a, b) {
      var ka = Object.keys(a || {}).filter(function (k) { return a[k] != null; });
      var kb = Object.keys(b || {}).filter(function (k) { return b[k] != null; });
      if (ka.length !== kb.length) return false;
      return ka.every(function (k) {
        var x = a[k], y = b[k];
        if (Array.isArray(x) || Array.isArray(y)) return JSON.stringify((x || []).slice().sort()) === JSON.stringify((y || []).slice().sort());
        return x === y;
      });
    }

    // Returns [{ok, text, itemId}] — one row per expected line plus extras.
    function gradeScenario(sc, actualLines) {
      var rows = [];
      var pool = actualLines.map(function (l) { return { l: l, used: false }; });
      sc.lines.forEach(function (exp) {
        var it = logic.getItem(exp.itemId);
        var same = pool.filter(function (p) { return !p.used && p.l.itemId === exp.itemId; });
        if (!same.length) {
          // Did they pick a look-alike instead?
          var groups = MENU.CONFUSABLES.filter(function (g) { return g.ids.indexOf(exp.itemId) >= 0; });
          var wrong = pool.filter(function (p) {
            return !p.used && groups.some(function (g) { return g.ids.indexOf(p.l.itemId) >= 0; });
          })[0];
          if (wrong) {
            wrong.used = true;
            var wi = logic.getItem(wrong.l.itemId);
            rows.push({ ok: false, itemId: exp.itemId, text: 'Picked ' + logic.displayName(wi) + ' instead of ' + logic.displayName(it) + '. ' +
              groups.filter(function (g) { return g.ids.indexOf(wrong.l.itemId) >= 0; })[0].diff });
          } else {
            rows.push({ ok: false, itemId: exp.itemId, text: 'Missing: ' + exp.qty + ' × ' + logic.displayName(it) });
          }
          return;
        }
        var qty = same.reduce(function (a, p) { return a + p.l.qty; }, 0);
        same.forEach(function (p) { p.used = true; });
        var problems = [];
        if (qty !== exp.qty) problems.push('quantity ' + qty + ', guest asked ' + exp.qty);
        if (!same.some(function (p) { return sameOpts(p.l.opts, exp.opts); })) problems.push('wrong size / choice');
        if (exp.sideSwap && !same.some(function (p) { return p.l.sideSwap === exp.sideSwap; })) problems.push('side swap not recorded');
        if (it.side && !exp.sideSwap && !same.some(function (p) { return p.l.sideOk || p.l.sideSwap; })) problems.push('side not confirmed');
        Object.keys(exp.mods).forEach(function (m) {
          if (!same.some(function (p) { return p.l.mods && p.l.mods[m]; })) problems.push('forgot ' + MENU.MODS[m].ru);
        });
        rows.push({ ok: !problems.length, itemId: exp.itemId, text: exp.qty + ' × ' + logic.displayName(it) + (problems.length ? ' — ' + problems.join('; ') : '') });
      });
      pool.filter(function (p) { return !p.used; }).forEach(function (p) {
        rows.push({ ok: false, itemId: p.l.itemId, extra: true, text: 'Not ordered by guest: ' + p.l.qty + ' × ' + logic.displayName(logic.getItem(p.l.itemId)) });
      });
      return rows;
    }

    return { question: question, grade: grade, nextFlash: nextFlash, progress: progress, scenario: scenario, gradeScenario: gradeScenario };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createTrainer: createTrainer };
  else root.createTrainer = createTrainer;
})(this);
