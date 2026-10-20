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

    return { question: question, grade: grade, nextFlash: nextFlash, progress: progress };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createTrainer: createTrainer };
  else root.createTrainer = createTrainer;
})(this);
