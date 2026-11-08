/* BurstBlastCrazyness — mod system.
 *
 * A mod is a plain object registered with BBC.mods.register({...}).
 * When a game starts, every enabled mod's setup(api) runs and the mod
 * hooks in through two mechanisms:
 *
 *   api.filter(name, fn, priority)  – transform a value the game asks for
 *   api.on(event, fn)               – react to something that happened
 *
 * See MODDING.md for the full list of filters, events and the api object.
 */
(function (BBC) {
  'use strict';

  var PREFS_KEY = 'bbc.mods.prefs.v1';
  var CUSTOM_KEY = 'bbc.mods.custom.v1';

  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage may be unavailable */ }
    return null;
  }

  var mods = {
    registry: [],
    byId: {},
    prefs: { enabled: {}, settings: {} },
    custom: [],          // [{ code, ids: [...] }]
    _filters: {},
    _events: {},
    _active: [],
    _source: 'builtin',
    _customIndex: -1,
    errors: []
  };

  /* ---------- registration ---------- */

  mods.register = function (def) {
    if (!def || typeof def !== 'object') throw new Error('Mod must be an object');
    if (!def.id || !/^[a-z0-9][a-z0-9-_.]*$/i.test(def.id)) {
      throw new Error('Mod needs an id made of letters, numbers, - _ .');
    }
    if (typeof def.setup !== 'function') throw new Error('Mod "' + def.id + '" needs a setup(api) function');
    if (mods.byId[def.id]) {
      // Re-registering replaces the old definition (handy while developing a mod).
      mods.registry = mods.registry.filter(function (m) { return m.id !== def.id; });
    }
    var mod = {
      id: def.id,
      name: def.name || def.id,
      version: def.version || '1.0.0',
      author: def.author || 'unknown',
      description: def.description || '',
      type: def.type === 'cosmetic' ? 'cosmetic' : 'gameplay',
      defaultEnabled: !!def.defaultEnabled,
      settings: Array.isArray(def.settings) ? def.settings : [],
      conflicts: Array.isArray(def.conflicts) ? def.conflicts : [],
      setup: def.setup,
      source: mods._source,
      customIndex: mods._customIndex
    };
    mods.registry.push(mod);
    mods.byId[mod.id] = mod;
    if (mods._customIndex >= 0 && mods.custom[mods._customIndex]) {
      mods.custom[mods._customIndex].ids.push(mod.id);
    }
    if (BBC.ui && BBC.ui.onModsChanged) BBC.ui.onModsChanged();
    return mod;
  };

  /* ---------- preferences ---------- */

  mods.loadPrefs = function () {
    var p = store(PREFS_KEY);
    if (p && p.enabled) mods.prefs = { enabled: p.enabled || {}, settings: p.settings || {} };
  };

  mods.savePrefs = function () {
    store(PREFS_KEY, mods.prefs);
  };

  mods.isEnabled = function (id) {
    var m = mods.byId[id];
    if (!m) return false;
    if (id in mods.prefs.enabled) return !!mods.prefs.enabled[id];
    return m.defaultEnabled;
  };

  mods.setEnabled = function (id, on) {
    var m = mods.byId[id];
    if (!m) return;
    mods.prefs.enabled[id] = !!on;
    if (on) {
      // Turning a mod on switches off anything it declares a conflict with (both directions).
      mods.registry.forEach(function (other) {
        if (other.id === id) return;
        if (m.conflicts.indexOf(other.id) >= 0 || other.conflicts.indexOf(id) >= 0) {
          mods.prefs.enabled[other.id] = false;
        }
      });
    }
    mods.savePrefs();
  };

  mods.getSetting = function (id, key) {
    var m = mods.byId[id];
    var saved = mods.prefs.settings[id];
    if (saved && key in saved) return saved[key];
    if (m) {
      for (var i = 0; i < m.settings.length; i++) {
        if (m.settings[i].key === key) return m.settings[i].default;
      }
    }
    return undefined;
  };

  mods.setSetting = function (id, key, value) {
    if (!mods.prefs.settings[id]) mods.prefs.settings[id] = {};
    mods.prefs.settings[id][key] = value;
    mods.savePrefs();
  };

  mods.enabledIds = function (type) {
    return mods.registry
      .filter(function (m) { return mods.isEnabled(m.id) && (!type || m.type === type); })
      .map(function (m) { return m.id; });
  };

  /** Gameplay settings are part of the ruleset (they change the game); cosmetic ones aren't. */
  mods.rulesetFor = function (ids) {
    return ids.slice().sort().map(function (id) {
      var m = mods.byId[id];
      var s = m && m.settings.length
        ? m.settings.map(function (st) { return st.key + '=' + mods.getSetting(id, st.key); }).join(',')
        : '';
      return s ? id + '(' + s + ')' : id;
    });
  };

  /* ---------- runtime: filters & events ---------- */

  /**
   * Activate the given gameplay mods plus every enabled cosmetic mod.
   * Gameplay mods are fixed for the length of a game; cosmetic mods can
   * be toggled live.
   */
  mods.activate = function (gameplayIds) {
    mods._filters = {};
    mods._events = {};
    mods._active = [];
    var ids = (gameplayIds || []).concat(mods.enabledIds('cosmetic'));
    ids.forEach(function (id) {
      var m = mods.byId[id];
      if (!m) return;
      try {
        m.setup(makeApi(m));
        mods._active.push(id);
      } catch (e) {
        reportError(m, 'setup', e);
      }
    });
  };

  mods.isActive = function (id) {
    return mods._active.indexOf(id) >= 0;
  };

  mods.applyFilter = function (name, value, ctx) {
    var list = mods._filters[name];
    if (!list) return value;
    for (var i = 0; i < list.length; i++) {
      try {
        var out = list[i].fn(value, ctx || {});
        if (out !== undefined) value = out;
      } catch (e) {
        reportError(list[i].mod, 'filter "' + name + '"', e);
      }
    }
    return value;
  };

  mods.emit = function (name, payload) {
    var list = mods._events[name];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try {
        list[i].fn(payload || {});
      } catch (e) {
        reportError(list[i].mod, 'event "' + name + '"', e);
      }
    }
  };

  function reportError(mod, where, err) {
    var msg = (mod ? mod.name : 'Mod') + ' failed in ' + where + ': ' + (err && err.message ? err.message : err);
    mods.errors.push(msg);
    if (window.console) console.error('[BBC mods]', msg, err);
    if (BBC.ui && BBC.ui.toast) BBC.ui.toast(msg, 'error');
  }

  function makeApi(mod) {
    var api = {
      id: mod.id,
      filter: function (name, fn, priority) {
        var list = mods._filters[name] || (mods._filters[name] = []);
        list.push({ fn: fn, mod: mod, priority: priority == null ? 10 : priority });
        list.sort(function (a, b) { return a.priority - b.priority; });
      },
      on: function (name, fn) {
        (mods._events[name] || (mods._events[name] = [])).push({ fn: fn, mod: mod });
      },
      setting: function (key) {
        return mods.getSetting(mod.id, key);
      },
      get game() {
        return BBC.game;
      },
      pieces: BBC.Pieces,
      storage: {
        get: function (key, fallback) {
          var v = store('bbc.mod.' + mod.id + '.' + key);
          return v === null ? fallback : v;
        },
        set: function (key, value) {
          store('bbc.mod.' + mod.id + '.' + key, value);
        }
      },
      ui: {
        toast: function (msg, kind) {
          if (BBC.ui && BBC.ui.toast) BBC.ui.toast(msg, kind);
        },
        refresh: function () {
          if (BBC.ui && BBC.ui.renderAll) BBC.ui.renderAll();
        }
      }
    };
    return api;
  }

  /* ---------- custom (pasted) mods ---------- */

  mods.loadCustom = function () {
    var saved = store(CUSTOM_KEY);
    if (!Array.isArray(saved)) return;
    saved.forEach(function (entry) {
      mods.runCustom(entry.code, false);
    });
  };

  /** Runs mod source code. Returns the ids it registered. */
  mods.runCustom = function (code, persist) {
    var entry = { code: String(code), ids: [] };
    mods.custom.push(entry);
    mods._source = 'custom';
    mods._customIndex = mods.custom.length - 1;
    try {
      /* The code is the player's own mod; it gets the same BBC object built-in mods use. */
      new Function('BBC', entry.code)(BBC);
    } catch (e) {
      mods.custom.pop();
      mods._source = 'builtin';
      mods._customIndex = -1;
      throw e;
    }
    mods._source = 'builtin';
    mods._customIndex = -1;
    if (!entry.ids.length) {
      mods.custom.pop();
      throw new Error('That code ran but did not call BBC.mods.register(...)');
    }
    if (persist) saveCustom();
    return entry.ids;
  };

  mods.removeCustom = function (id) {
    var m = mods.byId[id];
    if (!m || m.source !== 'custom') return;
    var entry = mods.custom[m.customIndex];
    if (entry) {
      entry.ids.forEach(function (rid) {
        delete mods.byId[rid];
        delete mods.prefs.enabled[rid];
      });
      mods.registry = mods.registry.filter(function (x) { return entry.ids.indexOf(x.id) < 0; });
      entry.removed = true;
    }
    saveCustom();
    mods.savePrefs();
  };

  function saveCustom() {
    store(CUSTOM_KEY, mods.custom.filter(function (e) { return !e.removed; }).map(function (e) {
      return { code: e.code };
    }));
  }

  /* ---------- loading mod files ---------- */

  mods.loadFiles = function (files) {
    return files.reduce(function (p, src) {
      return p.then(function () {
        return new Promise(function (resolve) {
          var s = document.createElement('script');
          s.src = src;
          s.onload = resolve;
          s.onerror = function () {
            mods.errors.push('Could not load ' + src);
            resolve();
          };
          document.head.appendChild(s);
        });
      });
    }, Promise.resolve());
  };

  BBC.mods = mods;
})((window.BBC = window.BBC || {}));
