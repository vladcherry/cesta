// Settings and the offline copy of the data, both in localStorage.
// Every access is wrapped: private windows and blocked site data throw here.

(function (global) {
  'use strict';

  var PREFIX = 'cesta.';
  var SNAPSHOT_KEY = PREFIX + 'snapshot';
  var HISTORY_KEY = PREFIX + 'history';
  var SETTINGS_KEY = PREFIX + 'settings';

  // Keep the cached history bounded; the charts never look further back.
  var HISTORY_DAYS = 400;

  function read(key) {
    try {
      var raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function write(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false; // quota or blocked storage: the app still works, just not offline
    }
  }

  var DEFAULTS = {
    lang: null, // null -> follow the browser
    theme: 'system',
    compare: 'per_unit',
    range: 90,
    bgSync: false,
  };

  var settings = Object.assign({}, DEFAULTS, read(SETTINGS_KEY) || {});

  global.Store = {
    settings: settings,

    set: function (key, value) {
      settings[key] = value;
      write(SETTINGS_KEY, settings);
      return value;
    },

    loadSnapshot: function () {
      return read(SNAPSHOT_KEY);
    },

    saveSnapshot: function (snapshot) {
      return write(SNAPSHOT_KEY, snapshot);
    },

    // History is stored already parsed and trimmed: rows are
    // [date, price, perUnit] per item per store.
    loadHistory: function () {
      return read(HISTORY_KEY);
    },

    saveHistory: function (history, todayIso) {
      var cutoff = new Date(Date.parse(todayIso || new Date().toISOString()) - HISTORY_DAYS * 86400000)
        .toISOString()
        .slice(0, 10);
      var trimmed = {};
      Object.keys(history).forEach(function (item) {
        trimmed[item] = {};
        Object.keys(history[item]).forEach(function (store) {
          var rows = history[item][store].filter(function (row) {
            return row[0] >= cutoff;
          });
          if (rows.length) trimmed[item][store] = rows;
        });
        if (!Object.keys(trimmed[item]).length) delete trimmed[item];
      });
      return write(HISTORY_KEY, trimmed);
    },

    clear: function () {
      try {
        global.localStorage.removeItem(SNAPSHOT_KEY);
        global.localStorage.removeItem(HISTORY_KEY);
      } catch (error) {
        /* nothing to do */
      }
    },
  };
})(window);
