/* BurstBlastCrazyness — boot, new game, saving. */
(function (BBC) {
  'use strict';

  BBC.VERSION = '1.0.0';

  var SAVE_KEY = 'bbc.save.v1';
  var BEST_KEY = 'bbc.best.v1';
  var SETTINGS_KEY = 'bbc.settings.v1';

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function write(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* ignore */ }
  }

  BBC.settings = Object.assign({ sound: true, haptics: true }, read(SETTINGS_KEY) || {});
  BBC.saveSettings = function () { write(SETTINGS_KEY, BBC.settings); };

  /* ---------- best scores (one per ruleset, so modded games don't mix with classic) ---------- */

  BBC.bestKey = function (game) {
    return game.ruleset.length ? game.ruleset.join('|') : 'classic';
  };
  BBC.getBest = function (key) {
    var all = read(BEST_KEY) || {};
    return all[key] || 0;
  };
  BBC.updateBest = function (game) {
    var all = read(BEST_KEY) || {};
    var key = BBC.bestKey(game);
    if (game.score > (all[key] || 0)) {
      all[key] = game.score;
      write(BEST_KEY, all);
    }
  };
  BBC.resetBest = function () { write(BEST_KEY, {}); };

  /* ---------- save / resume ---------- */

  BBC.saveGame = function () {
    if (BBC.game) write(SAVE_KEY, BBC.game.toJSON());
  };

  /* ---------- game lifecycle ---------- */

  /**
   * opts.seed     – play a specific seed
   * opts.restore  – saved game object to resume
   */
  BBC.newGame = function (opts) {
    opts = opts || {};
    var saved = opts.restore;
    var modIds = saved ? saved.modIds || [] : BBC.mods.enabledIds('gameplay');
    if (saved && modIds.some(function (id) { return !BBC.mods.byId[id]; })) {
      saved = null; // a mod this save needs is gone → start fresh
      modIds = BBC.mods.enabledIds('gameplay');
    }
    var ruleset = saved ? saved.ruleset || [] : BBC.mods.rulesetFor(modIds);

    BBC.mods.activate(modIds);
    BBC.ui.applyTheme();

    var cfg = BBC.mods.applyFilter('config', { rows: 8, cols: 8, handSize: 3 }, {});
    if (saved) cfg = { rows: saved.rows, cols: saved.cols, handSize: saved.handSize };
    var catalog = BBC.mods.applyFilter('pieceCatalog', BBC.Pieces.classic(), {});

    var game = new BBC.Game({
      rows: clamp(cfg.rows, 4, 16),
      cols: clamp(cfg.cols, 4, 16),
      handSize: clamp(cfg.handSize, 1, 5),
      catalog: catalog,
      seed: saved ? saved.seed : opts.seed != null ? opts.seed : BBC.newSeed(),
      ruleset: ruleset,
      modIds: modIds
    });
    BBC.game = game;
    if (saved) game.restore(saved);
    else game.start();
    BBC.ui.setGame(game);
    BBC.saveGame();
    return game;
  };

  /** Re-run mod setup (after toggling a cosmetic mod) without touching the game. */
  BBC.reactivate = function () {
    if (!BBC.game) return;
    BBC.mods.activate(BBC.game.modIds);
    BBC.ui.applyTheme();
    BBC.ui.renderAll();
  };

  function clamp(v, lo, hi) {
    v = Math.round(+v || lo);
    return Math.max(lo, Math.min(hi, v));
  }

  BBC.boot = function () {
    BBC.ui.init();
    BBC.mods.loadFiles(BBC.MOD_FILES || [])
      .then(function () {
        try { BBC.mods.loadCustom(); } catch (e) { BBC.mods.errors.push('Custom mod failed: ' + e.message); }
        BBC.mods.loadPrefs();
        var saved = read(SAVE_KEY);
        if (saved && saved.v === 1 && !saved.over) BBC.newGame({ restore: saved });
        else BBC.newGame();
        document.body.classList.add('ready');
      });
  };

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) BBC.saveGame();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', BBC.boot);
  else BBC.boot();
})((window.BBC = window.BBC || {}));
