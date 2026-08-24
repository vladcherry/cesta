// Loading and shaping the data.
//
// Two files, both relative so the app survives living in /cesta/:
//   data/latest.json   — today's snapshot, required
//   data/prices.ndjson — the whole history, optional (charts degrade without it)
// Network first, cache second, localStorage third. The snapshot is small
// enough to keep in localStorage, the history is trimmed before it is stored.

(function (global) {
  'use strict';

  var LATEST_URL = 'data/latest.json';
  var HISTORY_URL = 'data/prices.ndjson';

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error(url + ': HTTP ' + response.status);
      return response.json();
    });
  }

  function fetchText(url) {
    return fetch(url, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error(url + ': HTTP ' + response.status);
      return response.text();
    });
  }

  // NDJSON -> { itemId: { storeId: [[date, price, perUnit], ...] } }
  function parseHistory(text) {
    var history = {};
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      if (line.length < 2) continue;
      var row;
      try {
        row = JSON.parse(line);
      } catch (error) {
        continue; // a truncated last line is not worth failing the app over
      }
      if (!row.item || !row.store || row.price === null || row.price === undefined) continue;
      if (!history[row.item]) history[row.item] = {};
      if (!history[row.item][row.store]) history[row.item][row.store] = [];
      history[row.item][row.store].push([
        row.date,
        row.price,
        row.per_unit === null || row.per_unit === undefined ? row.price : row.per_unit,
      ]);
    }
    Object.keys(history).forEach(function (item) {
      Object.keys(history[item]).forEach(function (store) {
        history[item][store].sort(function (a, b) {
          return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
        });
      });
    });
    return history;
  }

  function load(options) {
    var opts = options || {};
    if (opts.demo) {
      var demo = global.Demo.build();
      return Promise.resolve({ snapshot: demo.snapshot, history: demo.history, source: 'demo' });
    }

    return fetchJson(LATEST_URL)
      .then(function (snapshot) {
        // The history file is optional on purpose: it is the big one, and a
        // failure there should still leave a usable table of today's prices.
        return fetchText(HISTORY_URL)
          .then(function (text) {
            return { snapshot: snapshot, history: parseHistory(text) };
          })
          .catch(function () {
            return { snapshot: snapshot, history: global.Store.loadHistory() || {} };
          });
      })
      .then(function (result) {
        global.Store.saveSnapshot(result.snapshot);
        global.Store.saveHistory(result.history, result.snapshot.date);
        return { snapshot: result.snapshot, history: result.history, source: 'network' };
      })
      .catch(function (error) {
        var cached = global.Store.loadSnapshot();
        if (!cached) throw error;
        return {
          snapshot: cached,
          history: global.Store.loadHistory() || {},
          source: 'cache',
          error: error,
        };
      });
  }

  function iso(dateObject) {
    return dateObject.toISOString().slice(0, 10);
  }

  function cutoff(days, todayIso) {
    var base = todayIso ? Date.parse(todayIso + 'T12:00:00Z') : Date.now();
    return iso(new Date(base - days * 86400000));
  }

  // [[date, price, perUnit]] -> [{ d, v }] within the window
  function series(history, itemId, storeId, key, days, todayIso) {
    var rows = (history[itemId] || {})[storeId] || [];
    var from = days ? cutoff(days, todayIso) : '';
    var index = key === 'price' ? 1 : 2;
    var out = [];
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i][0] >= from) out.push({ d: rows[i][0], v: rows[i][index] });
    }
    return out;
  }

  // Percentage change against the oldest point at least `days` old.
  function deltaPct(points, days, todayIso) {
    if (!points || points.length < 2) return null;
    var target = cutoff(days, todayIso);
    var older = null;
    for (var i = 0; i < points.length; i += 1) {
      if (points[i].d <= target) older = points[i];
    }
    if (!older) older = points[0];
    var latest = points[points.length - 1];
    if (!older || older === latest || !older.v) return null;
    return ((latest.v - older.v) / older.v) * 100;
  }

  // Basket total per shop per day, over a fixed set of items so the line does
  // not jump when coverage changes.
  function basketSeries(snapshot, history, storeIds, itemIds, days) {
    var quantities = {};
    snapshot.items.forEach(function (item) {
      quantities[item.id] = item.qty || 1;
    });
    var from = cutoff(days, snapshot.date);
    var byStore = {};

    storeIds.forEach(function (storeId) {
      var perDate = {};
      var counts = {};
      itemIds.forEach(function (itemId) {
        var rows = (history[itemId] || {})[storeId] || [];
        for (var i = 0; i < rows.length; i += 1) {
          if (rows[i][0] < from) continue;
          var date = rows[i][0];
          perDate[date] = (perDate[date] || 0) + rows[i][1] * (quantities[itemId] || 1);
          counts[date] = (counts[date] || 0) + 1;
        }
      });
      // Only keep days where the shop priced (almost) the whole set, otherwise
      // a partial run would read as a sudden discount.
      var needed = Math.max(1, Math.floor(itemIds.length * 0.9));
      byStore[storeId] = Object.keys(perDate)
        .filter(function (date) {
          return counts[date] >= needed;
        })
        .sort()
        .map(function (date) {
          return { d: date, v: Math.round(perDate[date] * 100) / 100 };
        });
    });
    return byStore;
  }

  function cheapestStore(item, key) {
    var best = null;
    Object.keys(item.prices || {}).forEach(function (storeId) {
      var value = item.prices[storeId][key];
      if (value === null || value === undefined) return;
      if (!best || value < best.value) best = { store: storeId, value: value };
    });
    return best;
  }

  global.Data = {
    load: load,
    parseHistory: parseHistory,
    series: series,
    deltaPct: deltaPct,
    basketSeries: basketSeries,
    cheapestStore: cheapestStore,
    cutoff: cutoff,
  };
})(window);
