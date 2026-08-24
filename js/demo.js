// Synthetic data for ?demo=1 — enough to see the layout without a network and
// before the collector has any history. Deterministic: the same seed gives the
// same charts on every reload, so a screenshot is reproducible.

(function (global) {
  'use strict';

  var DAYS = 210;

  // id | name | category | unit | size | qty | base pack price | shops
  var ITEMS = [
    ['milk-semi-1l', 'Semi-skimmed milk', 'dairy', 'l', 1, 6, 0.89, 'mlca'],
    ['eggs-12', 'Eggs, dozen', 'dairy', 'unit', 12, 1, 2.35, 'mlca'],
    ['butter-250g', 'Butter', 'dairy', 'kg', 0.25, 1, 2.15, 'mlc'],
    ['cheese-cured-250g', 'Cured cheese wedge', 'dairy', 'kg', 0.25, 1, 3.4, 'mc'],
    ['yogurt-natural-4', 'Natural yoghurt, 4-pack', 'dairy', 'kg', 0.5, 2, 1.1, 'mlca'],
    ['bread-loaf-500g', 'Sliced bread', 'bakery', 'kg', 0.5, 1, 1.25, 'mlca'],
    ['oats-1kg', 'Rolled oats', 'bakery', 'kg', 1, 1, 1.65, 'mla'],
    ['bananas-1kg', 'Bananas', 'produce', 'kg', 1, 1, 1.49, 'mlca'],
    ['apples-1kg', 'Apples', 'produce', 'kg', 1, 1, 1.85, 'mca'],
    ['tomatoes-1kg', 'Tomatoes', 'produce', 'kg', 1, 1, 1.99, 'mlca'],
    ['potatoes-2kg', 'Potatoes', 'produce', 'kg', 2, 1, 1.79, 'mlc'],
    ['onions-1kg', 'Onions', 'produce', 'kg', 1, 1, 1.15, 'mlca'],
    ['salad-bag-150g', 'Bagged salad', 'produce', 'kg', 0.15, 2, 1.1, 'mc'],
    ['chicken-breast-1kg', 'Chicken breast', 'meat', 'kg', 1, 1, 6.5, 'mlca'],
    ['minced-beef-500g', 'Minced beef', 'meat', 'kg', 0.5, 1, 4.2, 'mlc'],
    ['serrano-ham-100g', 'Serrano ham', 'meat', 'kg', 0.1, 2, 2.1, 'mc'],
    ['salmon-500g', 'Salmon fillet', 'fish', 'kg', 0.5, 1, 6.9, 'mc'],
    ['tuna-cans-3', 'Canned tuna, 3-pack', 'fish', 'kg', 0.24, 2, 2.45, 'mlca'],
    ['olive-oil-1l', 'Extra virgin olive oil', 'pantry', 'l', 1, 1, 8.9, 'mlca'],
    ['pasta-500g', 'Spaghetti', 'pantry', 'kg', 0.5, 2, 0.95, 'mlca'],
    ['rice-1kg', 'Rice', 'pantry', 'kg', 1, 1, 1.45, 'mlc'],
    ['coffee-250g', 'Ground coffee', 'pantry', 'kg', 0.25, 1, 2.99, 'mlca'],
    ['tomato-fried-400g', 'Fried tomato sauce', 'pantry', 'kg', 0.4, 2, 0.85, 'mlc'],
    ['chocolate-125g', 'Dark chocolate', 'pantry', 'kg', 0.125, 2, 1.35, 'mla'],
    ['peas-frozen-750g', 'Frozen peas', 'frozen', 'kg', 0.75, 1, 1.55, 'mlc'],
    ['ice-cream-1l', 'Ice cream', 'frozen', 'l', 1, 1, 2.65, 'mca'],
    ['water-6x1-5l', 'Still water, 6 x 1.5 l', 'drinks', 'l', 9, 1, 1.62, 'mlca'],
    ['orange-juice-1l', 'Orange juice', 'drinks', 'l', 1, 2, 1.29, 'mlc'],
    ['beer-6x330', 'Beer, 6-pack', 'drinks', 'l', 1.98, 1, 2.4, 'mlca'],
    ['detergent-2l', 'Laundry detergent', 'household', 'l', 2, 1, 4.5, 'mlc'],
    ['toilet-paper-12', 'Toilet paper, 12 rolls', 'household', 'unit', 12, 1, 4.95, 'mlca'],
    ['shampoo-400ml', 'Shampoo', 'personal', 'l', 0.4, 1, 2.25, 'mca'],
  ];

  var STORES = [
    { id: 'mercadona', label: 'Mercadona', source: 'api', key: 'm', factor: 1.0, weekly: false },
    { id: 'lidl', label: 'Lidl', source: 'manual', key: 'l', factor: 0.96, weekly: true },
    { id: 'consum', label: 'Consum', source: 'api', key: 'c', factor: 1.07, weekly: false },
    { id: 'aldi', label: 'Aldi', source: 'manual', key: 'a', factor: 0.94, weekly: true },
  ];

  // Small deterministic PRNG (mulberry32) so the demo never flickers.
  function rng(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function isoDay(offsetFromToday) {
    var date = new Date(Date.now() + offsetFromToday * 86400000);
    return date.toISOString().slice(0, 10);
  }

  function build() {
    var today = isoDay(0);
    var history = {};
    var snapshotItems = [];

    ITEMS.forEach(function (row) {
      var id = row[0];
      var item = {
        id: id,
        name: row[1],
        category: row[2],
        unit: row[3],
        size: row[4],
        qty: row[5],
        prices: {},
      };
      var base = row[6];
      var shops = row[7];
      history[id] = {};

      STORES.forEach(function (store) {
        if (shops.indexOf(store.key) === -1) return;
        var random = rng(hash(id + store.id));
        var level = base * store.factor * (0.94 + random() * 0.12);
        var rows = [];
        var last = null;

        for (var day = DAYS; day >= 0; day -= 1) {
          var date = isoDay(-day);
          // Hand-entered shops only get a reading when the folleto changes.
          if (store.weekly && day % 7 !== 0) continue;
          // Slow drift plus the occasional step change, as real shelf prices go.
          level *= 1 + (random() - 0.48) * 0.004;
          if (random() < 0.012) level *= random() < 0.5 ? 0.93 : 1.06;
          var promo = !store.weekly && random() < 0.03 ? 0.85 : 1;
          var price = Math.round(level * promo * 100) / 100;
          var perUnit = Math.round((price / (item.size || 1)) * 1000) / 1000;
          rows.push([date, price, perUnit]);
          last = { price: price, per_unit: perUnit, date: date };
        }

        if (!rows.length) return;
        history[id][store.id] = rows;
        var age = Math.round((Date.parse(today) - Date.parse(last.date)) / 86400000);
        item.prices[store.id] = {
          sku: store.source === 'api' ? String(10000 + (hash(id + store.id) % 80000)) : null,
          name: item.name,
          price: last.price,
          per_unit: last.per_unit,
          unit: item.unit,
          was: null,
          manual: store.source === 'manual',
          seen: store.source === 'manual' ? last.date : null,
          stale: store.source === 'manual' && age > 21,
        };
      });

      snapshotItems.push(item);
    });

    var storeList = STORES.map(function (store) {
      return { id: store.id, label: store.label, source: store.source };
    });
    var comparable = snapshotItems.filter(function (item) {
      return storeList.every(function (store) {
        return item.prices[store.id];
      });
    });

    var totals = {};
    storeList.forEach(function (store) {
      var priced = snapshotItems.filter(function (item) {
        return item.prices[store.id];
      });
      var sum = function (list) {
        return Math.round(
          list.reduce(function (acc, item) {
            return acc + item.prices[store.id].price * item.qty;
          }, 0) * 100,
        ) / 100;
      };
      totals[store.id] = {
        total: sum(priced),
        covered: priced.length,
        missing: snapshotItems.length - priced.length,
        comparable: sum(comparable),
      };
    });

    return {
      snapshot: {
        generated_at: new Date().toISOString(),
        date: today,
        currency: 'EUR',
        demo: true,
        region: { postal_code: '03580', mercadona_wh: 'alz1' },
        stores: storeList,
        comparable_items: comparable.length,
        basket_items: snapshotItems.length,
        totals: totals,
        items: snapshotItems,
        errors: [],
      },
      history: history,
    };
  }

  global.Demo = { build: build };
})(window);
