#!/usr/bin/env node
// Daily collector. Reads basket.json, asks every enabled shop for its prices,
// appends one NDJSON line per product per shop per day, and rewrites the
// snapshot the frontend loads.
//
//   node scripts/fetch.mjs
//   node scripts/fetch.mjs --only=mercadona
//   node scripts/fetch.mjs --dry-run          -> no files touched
//   node scripts/fetch.mjs --force            -> append even if today is present

import { CONFIG, enabledStores } from './config.mjs';
import * as manual from './adapters/manual.mjs';
import {
  parseArgs, readJson, writeJson, appendNdjson, today, log, round2,
} from './lib/util.mjs';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './lib/util.mjs';

const args = parseArgs();
const date = args.date || today();
const dryRun = Boolean(args['dry-run']);
const only = args.only ? String(args.only).split(',') : null;

const basket = await readJson('basket.json');
const items = basket.items;
const byId = new Map(items.map((i) => [i.id, i]));

const stores = enabledStores().filter((id) => !only || only.includes(id));
if (!stores.length) {
  log('no stores selected');
  process.exit(1);
}

const adapters = new Map();
for (const storeId of stores) {
  const store = CONFIG.stores[storeId];
  if (store.source === 'api') {
    adapters.set(storeId, await import(`./adapters/${store.adapter}.mjs`));
  }
}

// Rows already written for this date, so a second run of the day is a no-op.
const priceFile = 'data/prices.ndjson';
const seenToday = new Set();
if (!args.force && existsSync(resolve(ROOT, priceFile))) {
  const text = await readFile(resolve(ROOT, priceFile), 'utf8');
  for (const line of text.split('\n')) {
    if (!line.includes(`"${date}"`)) continue;
    try {
      const row = JSON.parse(line);
      if (row.date === date) seenToday.add(`${row.store}:${row.item}`);
    } catch {
      /* half-written line: ignore */
    }
  }
}

const rows = [];
const errors = [];
const prices = new Map(); // itemId -> { storeId -> row }

for (const storeId of stores) {
  const store = CONFIG.stores[storeId];
  const started = Date.now();
  let results = [];

  if (store.source === 'manual') {
    results = await manual.fetchPrices(items.map((i) => i.id), storeId, { date });
  } else {
    const targets = items
      .map((item) => ({ item: item.id, sku: String(item.skus?.[storeId] || '').trim() }))
      .filter((t) => t.sku);
    if (!targets.length) {
      log(`${storeId}: no skus in basket.json — nothing to fetch`);
      continue;
    }
    const adapter = adapters.get(storeId);
    const fetched = await adapter.fetchPrices(targets.map((t) => t.sku), store.region);
    const itemBySku = new Map(targets.map((t) => [t.sku, t.item]));
    results = fetched.map((r) => ({ ...r, item: itemBySku.get(r.sku) }));
  }

  let ok = 0;
  for (const result of results) {
    const item = byId.get(result.item);
    if (!item) continue;
    if (!result.ok) {
      errors.push({ store: storeId, item: result.item, sku: result.sku || null, gone: Boolean(result.gone), error: result.error });
      continue;
    }
    ok += 1;
    const row = {
      date,
      store: storeId,
      item: item.id,
      sku: result.sku || null,
      price: result.price,
      per_unit: result.per_unit,
      unit: result.unit || item.unit,
      name: result.name,
    };
    if (result.manual) {
      row.manual = true;
      row.seen = result.seen;
    }
    if (!prices.has(item.id)) prices.set(item.id, {});
    prices.get(item.id)[storeId] = { ...row, stale: Boolean(result.stale), age_days: result.age_days ?? 0, was: result.was ?? null };
    if (!seenToday.has(`${storeId}:${item.id}`)) rows.push(row);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  log(`${storeId}: ${ok} priced, ${results.length - ok} failed, ${seconds}s`);
}

// --- snapshot -------------------------------------------------------------

const storeList = stores.map((id) => ({ id, label: CONFIG.stores[id].label, source: CONFIG.stores[id].source }));

const snapshotItems = items.map((item) => ({
  id: item.id,
  name: item.name,
  category: item.category,
  unit: item.unit,
  size: item.size,
  qty: item.qty,
  prices: Object.fromEntries(
    Object.entries(prices.get(item.id) || {}).map(([storeId, row]) => [
      storeId,
      {
        sku: row.sku,
        name: row.name,
        price: row.price,
        per_unit: row.per_unit,
        unit: row.unit,
        was: row.was,
        manual: Boolean(row.manual),
        seen: row.seen || null,
        stale: Boolean(row.stale),
      },
    ]),
  ),
}));

// Two totals on purpose:
//   total      — everything that shop actually prices (its coverage differs)
//   comparable — only items priced by every shop, which is the fair ranking
const storesWithData = storeList.filter((s) => snapshotItems.some((i) => i.prices[s.id]));
const comparableItems = storesWithData.length
  ? snapshotItems.filter((i) => storesWithData.every((s) => i.prices[s.id]))
  : [];

const totals = {};
for (const store of storeList) {
  const priced = snapshotItems.filter((i) => i.prices[store.id]);
  const hasData = priced.length > 0;
  totals[store.id] = {
    total: hasData ? round2(priced.reduce((sum, i) => sum + i.prices[store.id].price * i.qty, 0)) : null,
    covered: priced.length,
    missing: snapshotItems.length - priced.length,
    comparable: hasData
      ? round2(comparableItems.reduce((sum, i) => sum + i.prices[store.id].price * i.qty, 0))
      : null,
  };
}

const snapshot = {
  generated_at: new Date().toISOString(),
  date,
  currency: CONFIG.currency,
  region: basket.region || { postal_code: CONFIG.postalCode },
  stores: storeList,
  comparable_items: comparableItems.length,
  basket_items: snapshotItems.length,
  totals,
  items: snapshotItems,
  errors,
};

if (dryRun) {
  log(`\n[dry run] ${rows.length} rows, ${errors.length} errors`);
  log(JSON.stringify(totals, null, 2));
} else {
  await appendNdjson(priceFile, rows);
  await writeJson('data/latest.json', snapshot);
  log(`\nappended ${rows.length} rows to ${priceFile}`);
  log(`wrote data/latest.json (${comparableItems.length}/${snapshotItems.length} items comparable)`);
}

for (const error of errors.slice(0, 10)) {
  log(`  ! ${error.store} ${error.item} ${error.sku || ''} ${error.gone ? '(GONE - fix the id)' : ''} ${error.error}`);
}
if (errors.length > 10) log(`  ... ${errors.length - 10} more`);
