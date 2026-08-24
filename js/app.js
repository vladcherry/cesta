// Cesta — app shell: state, rendering and events.

(function (global) {
  'use strict';

  var t = function (key, params) {
    return I18N.t(key, params);
  };

  var state = {
    snapshot: null,
    history: {},
    source: null,
    view: 'basket',
    filter: '',
    category: 'all',
    detail: null,
    demo: new URLSearchParams(location.search).get('demo') === '1',
  };

  // --- helpers ------------------------------------------------------------

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var KNOWN_STORES = ['mercadona', 'lidl', 'consum', 'aldi'];

  function storeColorVar(id) {
    return KNOWN_STORES.indexOf(id) === -1 ? '--store-other' : '--store-' + id;
  }

  function storeColor(id) {
    return getComputedStyle(document.documentElement).getPropertyValue(storeColorVar(id)).trim() || '#898781';
  }

  function compareKey() {
    return Store.settings.compare === 'price' ? 'price' : 'per_unit';
  }

  function categoryLabel(code) {
    var key = 'cat.' + code;
    var label = t(key);
    return label === key ? code : label;
  }

  function $(selector) {
    return document.querySelector(selector);
  }

  function money(value, digits) {
    return Fmt.money(value, { digits: digits === undefined ? 2 : digits });
  }

  // Unit prices below a euro are the ones worth three decimals.
  function unitMoney(value) {
    return Fmt.money(value, { digits: value !== null && value < 1 ? 3 : 2 });
  }

  // --- rendering: basket --------------------------------------------------

  function renderBasket() {
    var view = $('#view-basket');
    var snapshot = state.snapshot;
    view.innerHTML = '';

    var stores = snapshot.stores.filter(function (store) {
      return snapshot.totals[store.id] && snapshot.totals[store.id].covered > 0;
    });

    if (!stores.length) {
      view.appendChild(emptyCard());
      return;
    }

    var hasComparable = snapshot.comparable_items > 0;
    var sortKey = hasComparable ? 'comparable' : 'total';
    var ranked = stores.slice().sort(function (a, b) {
      return snapshot.totals[a.id][sortKey] - snapshot.totals[b.id][sortKey];
    });
    var cheapest = ranked[0];

    var card = document.createElement('section');
    card.className = 'card';
    card.innerHTML =
      '<h2>' + esc(t('basket.heading')) + '</h2>' +
      '<p class="sub">' + esc(t('common.updated', { date: Fmt.date(snapshot.date) })) + '</p>';

    var ranking = document.createElement('div');
    ranking.className = 'ranking';
    ranking.style.marginTop = '14px';

    ranked.forEach(function (store) {
      var totals = snapshot.totals[store.id];
      var value = totals[sortKey];
      var best = store.id === cheapest.id;
      var deltaText = '';
      if (!best) {
        var diff = value - snapshot.totals[cheapest.id][sortKey];
        var pct = (diff / snapshot.totals[cheapest.id][sortKey]) * 100;
        deltaText = t('basket.vsCheapest', {
          delta: money(diff) + ' (' + Fmt.percent(pct) + ')',
          store: cheapest.label,
        });
      }

      var row = document.createElement('article');
      row.className = 'rank' + (best ? ' best' : '');
      row.style.setProperty('--store-color', 'var(' + storeColorVar(store.id) + ')');
      row.innerHTML =
        '<div class="stripe"></div>' +
        '<div>' +
          '<div class="name">' + esc(store.label) +
            (best ? '<span class="badge good">✓ ' + esc(t('basket.cheapest')) + '</span>' : '') +
            (store.source === 'manual' ? '<span class="badge">' + esc(t('common.manual')) + '</span>' : '') +
          '</div>' +
          '<div class="meta">' +
            esc(t('basket.coverage', { covered: totals.covered, total: snapshot.basket_items })) +
            (deltaText ? ' · ' + esc(deltaText) : '') +
          '</div>' +
        '</div>' +
        '<div class="amount">' +
          '<span class="full">' + esc(hasComparable ? t('basket.total') : t('basket.fullTotal')) + '</span>' +
          '<b>' + esc(money(value)) + '</b>' +
          (hasComparable
            ? '<span class="full">' + esc(t('basket.fullTotal')) + ': ' + esc(money(totals.total)) + '</span>'
            : '') +
        '</div>';
      ranking.appendChild(row);
    });

    card.appendChild(ranking);

    var note = document.createElement('p');
    note.className = 'tiny';
    note.style.marginTop = '12px';
    note.textContent = hasComparable
      ? t('basket.comparableNote', { count: snapshot.comparable_items })
      : t('basket.noComparable');
    card.appendChild(note);
    view.appendChild(card);

    // --- basket total over time ---
    var comparableIds = snapshot.items
      .filter(function (item) {
        return stores.every(function (store) {
          return item.prices[store.id];
        });
      })
      .map(function (item) {
        return item.id;
      });

    if (comparableIds.length) {
      var trend = document.createElement('section');
      trend.className = 'card';
      trend.innerHTML =
        '<div class="toolbar" style="justify-content:space-between">' +
          '<div><h2>' + esc(t('basket.trend')) + '</h2>' +
          '<p class="sub">' + esc(t('basket.trendNote')) + '</p></div>' +
          '<div class="range" id="basket-range"></div>' +
        '</div>' +
        '<div class="chart-box" id="basket-chart"></div>' +
        '<div class="legend" id="basket-legend"></div>';
      view.appendChild(trend);

      renderRangeChips($('#basket-range'), function () {
        drawBasketChart(comparableIds, stores);
      });
      drawBasketChart(comparableIds, stores);
    }
  }

  function renderRangeChips(container, onChange) {
    var options = [30, 90, 180, 365];
    container.innerHTML = '';
    options.forEach(function (days) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.textContent = t('detail.days', { n: days });
      button.setAttribute('aria-pressed', String(Store.settings.range === days));
      button.addEventListener('click', function () {
        Store.set('range', days);
        renderRangeChips(container, onChange);
        onChange();
      });
      container.appendChild(button);
    });
  }

  function drawBasketChart(itemIds, stores) {
    var box = $('#basket-chart');
    if (!box) return;
    var byStore = Data.basketSeries(
      state.snapshot,
      state.history,
      stores.map(function (store) {
        return store.id;
      }),
      itemIds,
      Store.settings.range,
    );
    var series = stores
      .map(function (store) {
        return {
          id: store.id,
          label: store.label,
          color: storeColor(store.id),
          points: byStore[store.id] || [],
        };
      })
      .filter(function (s) {
        return s.points.length > 1;
      });

    if (!series.length) {
      box.innerHTML = '<p class="muted" style="padding:18px 0">' + esc(t('detail.noHistory')) + '</p>';
      $('#basket-legend').innerHTML = '';
      return;
    }

    Charts.lines(box, {
      series: series,
      height: 260,
      label: t('basket.trend'),
      format: function (value) {
        return money(value, 0);
      },
    });
    renderLegend($('#basket-legend'), series);
  }

  function renderLegend(container, series) {
    if (!container) return;
    container.innerHTML = series
      .map(function (s) {
        return '<span><i class="dot" style="background:' + s.color + '"></i>' + esc(s.label) + '</span>';
      })
      .join('');
  }

  // --- rendering: items ---------------------------------------------------

  function renderItems() {
    var view = $('#view-items');
    var snapshot = state.snapshot;
    view.innerHTML = '';

    var stores = snapshot.stores.filter(function (store) {
      return snapshot.items.some(function (item) {
        return item.prices[store.id];
      });
    });
    if (!stores.length) {
      view.appendChild(emptyCard());
      return;
    }

    var categories = [];
    snapshot.items.forEach(function (item) {
      if (categories.indexOf(item.category) === -1) categories.push(item.category);
    });

    var toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.innerHTML =
      '<input type="search" id="filter" value="' + esc(state.filter) + '" placeholder="' +
        esc(t('items.search')) + '" aria-label="' + esc(t('items.search')) + '">' +
      '<select id="category" aria-label="' + esc(t('items.allCategories')) + '">' +
        '<option value="all">' + esc(t('items.allCategories')) + '</option>' +
        categories
          .map(function (code) {
            return '<option value="' + esc(code) + '"' +
              (state.category === code ? ' selected' : '') + '>' + esc(categoryLabel(code)) + '</option>';
          })
          .join('') +
      '</select>' +
      '<select id="compare" aria-label="' + esc(t('items.compare')) + '">' +
        '<option value="per_unit"' + (compareKey() === 'per_unit' ? ' selected' : '') + '>' +
          esc(t('items.perUnit')) + '</option>' +
        '<option value="price"' + (compareKey() === 'price' ? ' selected' : '') + '>' +
          esc(t('items.pack')) + '</option>' +
      '</select>';
    view.appendChild(toolbar);

    var needle = state.filter.trim().toLowerCase();
    var rows = snapshot.items.filter(function (item) {
      if (state.category !== 'all' && item.category !== state.category) return false;
      if (!needle) return true;
      return (item.name + ' ' + item.id).toLowerCase().indexOf(needle) !== -1;
    });

    var wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    var table = document.createElement('table');
    table.innerHTML =
      '<thead><tr><th class="col-item">' + esc(t('items.item')) + '</th>' +
      stores
        .map(function (store) {
          return '<th class="col-store"><i class="swatch" style="--store-color:var(' +
            storeColorVar(store.id) + ')"></i>' + esc(store.label) + '</th>';
        })
        .join('') +
      '</tr></thead>';

    var tbody = document.createElement('tbody');
    var key = compareKey();

    rows.forEach(function (item) {
      var best = Data.cheapestStore(item, key);
      var tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.dataset.item = item.id;

      var cells =
        '<td class="col-item"><div class="name">' + esc(item.name) + '</div>' +
        '<div class="tiny">' + esc(itemMeta(item)) + '</div></td>';

      stores.forEach(function (store) {
        cells += '<td class="col-store">' + itemCell(item, store, best, key) + '</td>';
      });

      tr.innerHTML = cells;
      tbody.appendChild(tr);
    });

    if (!rows.length) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="' + (stores.length + 1) + '" class="muted">' + esc(t('items.none')) + '</td>';
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    wrap.appendChild(table);
    view.appendChild(wrap);

    var count = document.createElement('p');
    count.className = 'tiny';
    count.textContent = t('items.showing', { shown: rows.length, total: snapshot.items.length });
    view.appendChild(count);
  }

  function itemMeta(item) {
    var size = item.size ? Fmt.number(item.size, item.size < 1 ? 3 : 0) + ' ' + Fmt.unit(item.unit) : '';
    return t('detail.packNote', { size: size || '—', unit: '', qty: item.qty }).replace(/\s+·/, ' ·');
  }

  function itemCell(item, store, best, key) {
    var price = item.prices[store.id];
    if (!price) return '<div class="cell na">' + esc(t('items.noPrice')) + '</div>';

    var isBest = best && best.store === store.id;
    var main = key === 'per_unit' ? price.per_unit : price.price;
    var alt = key === 'per_unit' ? price.price : price.per_unit;
    var mainText = key === 'per_unit'
      ? unitMoney(main) + '<span class="per"> /' + esc(Fmt.unit(price.unit || item.unit)) + '</span>'
      : money(main);
    var altText = key === 'per_unit'
      ? money(alt) + ' / ' + t('items.packShort')
      : unitMoney(alt) + ' /' + Fmt.unit(price.unit || item.unit);

    var points = Data.series(state.history, item.id, store.id, key, 90, state.snapshot.date);
    var spark = Charts.sparkline(points, { width: 58, height: 22 });
    var delta = Data.deltaPct(points, 30, state.snapshot.date);
    var deltaHtml = '';
    if (delta !== null && Math.abs(delta) >= 0.5) {
      var direction = delta > 0 ? 'up' : 'down';
      deltaHtml =
        ' <span class="delta ' + direction + '" title="' + esc(t('common.vs30')) + '">' +
        (delta > 0 ? '▲' : '▼') + ' ' + esc(Fmt.percent(Math.abs(delta), 1).replace('+', '')) + '</span>';
    }

    // A hand-typed price only needs its date shown when it is not today's.
    var flags = '';
    if (price.stale) {
      var age = Fmt.daysAgo(price.seen, state.snapshot.date);
      flags = '<div class="tiny">' + esc(t('common.stale', { days: age })) + '</div>';
    } else if (price.manual && price.seen && price.seen !== state.snapshot.date) {
      flags = '<div class="tiny">' + esc(t('common.seen', { date: Fmt.shortDate(price.seen) })) + '</div>';
    }

    return (
      '<div class="cell' + (isBest ? ' best' : '') + '" style="--store-color:var(' + storeColorVar(store.id) + ')">' +
        '<div class="price">' + mainText + '</div>' +
        (spark ? '<span class="spark">' + spark + '</span>' : '<span class="spark"></span>') +
        (isBest ? '<div class="alt"><span class="mark-best">✓ ' + esc(t('items.cheapestHere')) + '</span></div>' : '') +
        '<div class="alt">' + esc(altText) + deltaHtml + '</div>' +
        (flags ? '<div class="alt">' + flags + '</div>' : '') +
      '</div>'
    );
  }

  // --- rendering: item detail --------------------------------------------

  function openDetail(itemId) {
    var item = state.snapshot.items.filter(function (row) {
      return row.id === itemId;
    })[0];
    if (!item) return;
    state.detail = itemId;

    $('#sheet-title').textContent = item.name;
    $('#sheet-sub').textContent =
      itemMeta(item) + ' · ' + categoryLabel(item.category);

    var body = $('#sheet-body');
    body.innerHTML =
      '<div class="toolbar" style="justify-content:space-between">' +
        '<strong style="font-size:14px">' + esc(t('detail.history')) + '</strong>' +
        '<div class="range" id="detail-range"></div>' +
      '</div>' +
      '<div class="chart-box" id="detail-chart"></div>' +
      '<div class="legend" id="detail-legend"></div>' +
      '<div class="stats" id="detail-stats"></div>';

    renderRangeChips($('#detail-range'), function () {
      drawDetail(item);
    });
    drawDetail(item);

    var sheet = $('#sheet');
    sheet.hidden = false;
    $('#sheet-close').focus();
  }

  function drawDetail(item) {
    var key = compareKey();
    var stores = state.snapshot.stores;
    var series = stores
      .map(function (store) {
        return {
          id: store.id,
          label: store.label,
          color: storeColor(store.id),
          points: Data.series(state.history, item.id, store.id, key, Store.settings.range, state.snapshot.date),
        };
      })
      .filter(function (s) {
        return s.points.length;
      });

    var box = $('#detail-chart');
    var stats = $('#detail-stats');

    if (!series.length || series.every(function (s) { return s.points.length < 2; })) {
      box.innerHTML = '<p class="muted" style="padding:18px 0">' + esc(t('detail.noHistory')) + '</p>';
      $('#detail-legend').innerHTML = '';
    } else {
      Charts.lines(box, {
        series: series,
        height: 250,
        label: item.name,
        format: function (value) {
          return key === 'per_unit' ? unitMoney(value) : money(value);
        },
      });
      renderLegend($('#detail-legend'), series);
    }

    stats.innerHTML = stores
      .map(function (store) {
        var price = item.prices[store.id];
        var points = Data.series(state.history, item.id, store.id, key, Store.settings.range, state.snapshot.date);
        if (!price && !points.length) return '';
        var values = points.map(function (point) {
          return point.v;
        });
        var min = values.length ? Math.min.apply(null, values) : null;
        var max = values.length ? Math.max.apply(null, values) : null;
        var avg = values.length
          ? values.reduce(function (a, b) { return a + b; }, 0) / values.length
          : null;
        var latest = price ? (key === 'per_unit' ? price.per_unit : price.price) : null;
        var fmt = key === 'per_unit' ? unitMoney : money;
        return (
          '<div class="stat">' +
            '<div class="label"><i class="dot" style="background:' + storeColor(store.id) + '"></i>' +
              esc(store.label) + '</div>' +
            '<div class="value">' + esc(latest === null ? t('common.na') : fmt(latest)) + '</div>' +
            '<div class="range-text">' +
              (min === null ? '' :
                esc(t('detail.min')) + ' ' + esc(fmt(min)) + ' · ' +
                esc(t('detail.max')) + ' ' + esc(fmt(max)) + ' · ' +
                esc(t('detail.avg')) + ' ' + esc(fmt(avg))) +
            '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function closeDetail() {
    state.detail = null;
    $('#sheet').hidden = true;
  }

  // --- rendering: info ----------------------------------------------------

  function renderInfo() {
    var view = $('#view-info');
    var snapshot = state.snapshot;
    var errors = snapshot.errors || [];
    var gone = errors.filter(function (error) {
      return error.gone;
    }).length;

    var about = document.createElement('section');
    about.className = 'card';
    about.innerHTML =
      '<h2>' + esc(t('info.heading')) + '</h2>' +
      '<p class="sub" style="margin-top:6px">' +
        esc(t('info.sourceText', { items: snapshot.basket_items })) + '</p>' +
      '<div class="store-list">' +
        snapshot.stores
          .map(function (store) {
            var totals = snapshot.totals[store.id] || {};
            return '<div class="store-row">' +
              '<i class="swatch" style="--store-color:var(' + storeColorVar(store.id) + ')"></i>' +
              '<span class="grow">' + esc(store.label) + '</span>' +
              '<span class="badge">' + esc(store.source === 'manual' ? t('common.manual') : 'API') + '</span>' +
              '<span class="tiny">' + esc(t('basket.coverage', {
                covered: totals.covered || 0, total: snapshot.basket_items,
              })) + '</span>' +
            '</div>';
          })
          .join('') +
      '</div>' +
      (errors.length
        ? '<div class="field" style="margin-top:12px"><span class="label">' + esc(t('info.errors')) +
          '</span><span class="tiny">' + errors.length +
          (gone ? ' · ' + esc(t('info.deadIds', { n: gone })) : '') + '</span></div>'
        : '') +
      '<p class="tiny" style="margin-top:10px">' + esc(t('info.cacheText')) + '</p>';
    view.innerHTML = '';
    view.appendChild(about);

    var settings = document.createElement('section');
    settings.className = 'card';
    settings.innerHTML =
      '<h2>' + esc(t('info.settings')) + '</h2>' +
      '<div class="field"><span class="label">' + esc(t('info.language')) + '</span>' +
        '<select id="set-lang">' + I18N.order.map(function (code) {
          return '<option value="' + code + '"' + (I18N.lang === code ? ' selected' : '') + '>' +
            I18N.labels[code] + '</option>';
        }).join('') + '</select></div>' +
      '<div class="field"><span class="label">' + esc(t('info.theme')) + '</span>' +
        '<select id="set-theme">' +
          ['system', 'light', 'dark'].map(function (mode) {
            return '<option value="' + mode + '"' + (Store.settings.theme === mode ? ' selected' : '') + '>' +
              esc(t('info.theme.' + mode)) + '</option>';
          }).join('') +
        '</select></div>' +
      '<div class="field"><span class="label">' + esc(t('items.compare')) + '</span>' +
        '<select id="set-compare">' +
          '<option value="per_unit"' + (compareKey() === 'per_unit' ? ' selected' : '') + '>' +
            esc(t('items.perUnit')) + '</option>' +
          '<option value="price"' + (compareKey() === 'price' ? ' selected' : '') + '>' +
            esc(t('items.pack')) + '</option>' +
        '</select></div>' +
      '<div class="field"><span><span class="label">' + esc(t('info.bgSync')) + '</span>' +
        '<div class="hint">' + esc(t('info.bgSyncText')) + '</div></span>' +
        '<button type="button" class="chip" id="set-bgsync"></button></div>' +
      '<div class="field"><span><span class="label">' + esc(t('info.updated')) + '</span>' +
        '<div class="hint">' + esc(Fmt.date(snapshot.date)) + '</div></span>' +
        '<button type="button" class="chip" id="set-refresh">' + esc(t('info.refresh')) + '</button></div>';
    view.appendChild(settings);

    updateBgSyncButton();
  }

  function emptyCard() {
    var card = document.createElement('section');
    card.className = 'card empty';
    card.innerHTML =
      '<h2>' + esc(t('empty.heading')) + '</h2>' +
      '<p>' + esc(t('empty.text')) + '</p>' +
      '<a class="chip" href="?demo=1">' + esc(t('empty.demo')) + '</a>';
    return card;
  }

  // --- banner, theme, language -------------------------------------------

  function renderBanner() {
    var banner = $('#banner');
    var parts = [];
    if (state.demo) parts.push('<span class="badge warn">' + esc(t('common.demo')) + '</span>');
    if (state.source === 'cache') parts.push('<span>' + esc(t('common.offline')) + '</span>');
    if (state.demo) parts.push('<span>' + esc(t('info.demoOn')) + '</span>');
    banner.innerHTML = parts.join(' ');
    banner.hidden = !parts.length;
  }

  function applyTheme() {
    var mode = Store.settings.theme;
    document.documentElement.setAttribute('data-theme', mode === 'system' ? '' : mode);
  }

  function applyStaticText() {
    document.documentElement.lang = I18N.lang;
    document.title = 'Cesta — ' + t('app.tagline');
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (node) {
      node.textContent = t(node.dataset.i18n);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-title]'), function (node) {
      node.title = t(node.dataset.i18nTitle);
    });
    $('#lang-btn').textContent = I18N.labels[I18N.lang];
  }

  function renderAll() {
    applyStaticText();
    renderBanner();
    if (!state.snapshot) return;
    $('#foot-updated').textContent = t('common.updated', { date: Fmt.date(state.snapshot.date) });
    if (state.view === 'basket') renderBasket();
    if (state.view === 'items') renderItems();
    if (state.view === 'info') renderInfo();
    if (state.detail) openDetail(state.detail);
  }

  function setView(view) {
    state.view = view;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      var active = tab.dataset.view === view;
      tab.setAttribute('aria-selected', String(active));
    });
    ['basket', 'items', 'info'].forEach(function (name) {
      $('#view-' + name).hidden = name !== view;
    });
    renderAll();
  }

  // --- background sync ----------------------------------------------------

  function bgSyncSupported() {
    return 'serviceWorker' in navigator && 'periodicSync' in ServiceWorkerRegistration.prototype;
  }

  function updateBgSyncButton() {
    var button = $('#set-bgsync');
    if (!button) return;
    if (!bgSyncSupported()) {
      button.textContent = t('info.bgSyncUnsupported');
      button.disabled = true;
      return;
    }
    button.textContent = Store.settings.bgSync ? t('info.bgSyncOn') : t('info.bgSyncOff');
    button.setAttribute('aria-pressed', String(Boolean(Store.settings.bgSync)));
  }

  function enableBgSync() {
    if (!bgSyncSupported()) return;
    Notification.requestPermission()
      .then(function (permission) {
        if (permission !== 'granted') throw new Error('notifications denied');
        return navigator.serviceWorker.ready;
      })
      .then(function (registration) {
        return registration.periodicSync.register('cesta-daily', {
          minInterval: 24 * 60 * 60 * 1000,
        });
      })
      .then(function () {
        Store.set('bgSync', true);
        updateBgSyncButton();
      })
      .catch(function () {
        Store.set('bgSync', false);
        updateBgSyncButton();
      });
  }

  // --- events -------------------------------------------------------------

  function bind() {
    document.addEventListener('click', function (event) {
      var tab = event.target.closest('.tab');
      if (tab) return setView(tab.dataset.view);

      if (event.target.closest('#lang-btn')) {
        var next = I18N.next();
        Store.set('lang', next);
        I18N.set(next);
        return renderAll();
      }

      if (event.target.closest('#theme-btn')) {
        var order = ['system', 'light', 'dark'];
        var mode = order[(order.indexOf(Store.settings.theme) + 1) % order.length];
        Store.set('theme', mode);
        applyTheme();
        return renderAll();
      }

      if (event.target.closest('#sheet-close')) return closeDetail();
      if (event.target.id === 'sheet') return closeDetail();
      if (event.target.closest('#set-bgsync')) return enableBgSync();
      if (event.target.closest('#set-refresh')) return boot(true);

      var row = event.target.closest('tbody tr[data-item]');
      if (row) openDetail(row.dataset.item);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !$('#sheet').hidden) closeDetail();
      var row = event.target.closest ? event.target.closest('tbody tr[data-item]') : null;
      if (row && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        openDetail(row.dataset.item);
      }
    });

    document.addEventListener('input', function (event) {
      if (event.target.id === 'filter') {
        state.filter = event.target.value;
        renderItems();
        var input = $('#filter');
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      }
    });

    document.addEventListener('change', function (event) {
      var id = event.target.id;
      if (id === 'category') {
        state.category = event.target.value;
        renderItems();
      } else if (id === 'compare' || id === 'set-compare') {
        Store.set('compare', event.target.value);
        renderAll();
      } else if (id === 'set-lang') {
        Store.set('lang', event.target.value);
        I18N.set(event.target.value);
        renderAll();
      } else if (id === 'set-theme') {
        Store.set('theme', event.target.value);
        applyTheme();
        renderAll();
      }
    });

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderAll, 150);
    });

    window.addEventListener('online', function () {
      boot(true);
    });
  }

  // --- boot ---------------------------------------------------------------

  function boot(refresh) {
    if (!refresh) {
      I18N.set(Store.settings.lang || I18N.detect(Store.settings.lang));
      applyTheme();
      applyStaticText();
      bind();
    }

    var cached = state.demo ? null : Store.loadSnapshot();
    if (cached && !state.snapshot) {
      state.snapshot = cached;
      state.history = Store.loadHistory() || {};
      state.source = 'cache';
      renderAll();
    }

    return Data.load({ demo: state.demo })
      .then(function (result) {
        state.snapshot = result.snapshot;
        state.history = result.history;
        state.source = result.source;
        renderAll();
      })
      .catch(function () {
        if (!state.snapshot) {
          state.snapshot = {
            date: null,
            stores: [],
            items: [],
            totals: {},
            basket_items: 0,
            comparable_items: 0,
            errors: [],
          };
          renderAll();
          $('#view-' + state.view).innerHTML = '';
          $('#view-' + state.view).appendChild(emptyCard());
        }
      });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {
        /* offline support is optional */
      });
    });
  }

  boot(false);
})(window);
