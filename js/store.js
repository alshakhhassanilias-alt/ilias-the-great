/*
 * Persistence. Strategy:
 *  - Whole state is written to localStorage synchronously after EVERY change
 *    (state is small; a busy shift is well under 1 MB).
 *  - A rolling set of snapshots (every 2 min while changing, and on every
 *    table close/delete) lives in separate keys, so a corrupted main record or
 *    a mistaken “end shift” can be undone from Settings → Restore.
 *  - Writes are verified by reading back; a failed write raises a visible
 *    “NOT SAVED” banner instead of failing silently.
 *  - Manual JSON export/import for off-device backup.
 */
(function (root) {
  'use strict';

  var KEY = 'waiter.state.v1';
  var SNAP_PREFIX = 'waiter.snap.';
  var SNAP_MAX = 12;
  var SNAP_EVERY_MS = 2 * 60 * 1000;

  function emptyState() {
    return {
      v: 1,
      tables: [],          // active tables (array keeps the user’s order)
      history: [],         // closed tables (kept 7 days)
      menu: { overrides: {}, custom: [] },
      favorites: [],
      usage: {},           // itemId -> times added (for “frequent”)
      recent: [],          // last added itemIds
      searchLearn: {},     // query -> {itemId: times picked} (learned shortcuts)
      training: { box: {}, hard: {}, stats: { right: 0, wrong: 0 } },
      settings: { seats: true },
      savedAt: 0,
    };
  }

  function migrate(s) {
    var base = emptyState();
    if (!s || typeof s !== 'object') return base;
    Object.keys(base).forEach(function (k) { if (s[k] == null) s[k] = base[k]; });
    s.menu.overrides = s.menu.overrides || {};
    s.menu.custom = s.menu.custom || [];
    s.training.box = s.training.box || {};
    s.training.hard = s.training.hard || {};
    s.training.stats = s.training.stats || { right: 0, wrong: 0 };
    s.tables.forEach(function (t) { t.lines = t.lines || []; });
    return s;
  }

  function createStore(storage, opts) {
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var lastSnap = 0;
    var listeners = [];
    var status = { ok: true, error: null, savedAt: 0 };

    function readJSON(key) {
      try {
        var raw = storage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    }

    function snapshotKeys() {
      var keys = [];
      for (var i = 0; i < storage.length; i++) {
        var k = storage.key(i);
        if (k && k.indexOf(SNAP_PREFIX) === 0) keys.push(k);
      }
      return keys.sort();
    }

    function listSnapshots() {
      return snapshotKeys().reverse().map(function (k) {
        var s = readJSON(k);
        return s ? { key: k, at: Number(k.slice(SNAP_PREFIX.length)), tables: (s.tables || []).length,
          lines: (s.tables || []).reduce(function (a, t) { return a + (t.lines || []).length; }, 0) } : null;
      }).filter(Boolean);
    }

    function load() {
      var s = readJSON(KEY);
      var recovered = false;
      if (!s) {
        // Main record missing or corrupt → newest readable snapshot.
        var keys = snapshotKeys().reverse();
        for (var i = 0; i < keys.length && !s; i++) s = readJSON(keys[i]);
        recovered = !!s;
      }
      var state = migrate(s);
      // Drop history older than 7 days.
      var cutoff = now() - 7 * 24 * 3600 * 1000;
      state.history = state.history.filter(function (t) { return (t.closedAt || 0) > cutoff; });
      return { state: state, recovered: recovered && (state.tables.length > 0) };
    }

    function snapshot(state, force) {
      var t = now();
      if (!force && t - lastSnap < SNAP_EVERY_MS) return;
      lastSnap = t;
      try {
        storage.setItem(SNAP_PREFIX + String(t).padStart(15, '0'), JSON.stringify(state));
      } catch (e) { /* quota: main save matters more */ }
      var keys = snapshotKeys();
      while (keys.length > SNAP_MAX) storage.removeItem(keys.shift());
    }

    function save(state, opts2) {
      state.savedAt = now();
      var json = JSON.stringify(state);
      try {
        storage.setItem(KEY, json);
        if (storage.getItem(KEY) !== json) throw new Error('read-back mismatch');
        status = { ok: true, error: null, savedAt: state.savedAt };
      } catch (e) {
        // Free space by dropping the oldest snapshots, then retry once.
        try {
          snapshotKeys().slice(0, 6).forEach(function (k) { storage.removeItem(k); });
          storage.setItem(KEY, json);
          status = { ok: true, error: null, savedAt: state.savedAt };
        } catch (e2) {
          status = { ok: false, error: String(e2 && e2.message || e2), savedAt: status.savedAt };
        }
      }
      snapshot(state, opts2 && opts2.snapshot);
      listeners.forEach(function (fn) { fn(status); });
      return status.ok;
    }

    function restore(key) {
      var s = readJSON(key);
      return s ? migrate(s) : null;
    }

    function exportJSON(state) {
      return JSON.stringify({ app: 'waiter-assistant', exportedAt: new Date(now()).toISOString(), state: state }, null, 1);
    }

    function importJSON(text) {
      var data = JSON.parse(text);
      var s = data && data.state ? data.state : data;
      if (!s || !Array.isArray(s.tables)) throw new Error('Not a waiter-assistant backup');
      return migrate(s);
    }

    return {
      load: load, save: save, snapshot: snapshot, listSnapshots: listSnapshots, restore: restore,
      exportJSON: exportJSON, importJSON: importJSON,
      onStatus: function (fn) { listeners.push(fn); },
      status: function () { return status; },
      KEY: KEY,
    };
  }

  var api = { createStore: createStore, emptyState: emptyState, migrate: migrate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WaiterStore = api;
})(this);
