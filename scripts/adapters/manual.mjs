// Manual price source for shops without an online grocery catalogue.
//
// Lidl and Aldi do not sell food online in Spain, so there is nothing to
// scrape: prices come from the weekly folleto or from a photo of the shelf and
// are typed into data/manual/<store>.json. The rest of the pipeline treats
// them like any other source, with one difference — every row carries the date
// it was actually seen, so the UI can say how old it is instead of pretending
// it was collected today.

import { readJson, round2, round3, toNumber } from '../lib/util.mjs';

// A hand-typed price older than this is shown as stale rather than current.
export const STALE_AFTER_DAYS = 21;

export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

// itemIds: string[]  ->  [{ item, ok, ... }]
export async function fetchPrices(itemIds, storeId, { date } = {}) {
  const file = await readJson(`data/manual/${storeId}.json`, { prices: {} });
  const table = file.prices || {};
  const out = [];
  for (const item of itemIds) {
    const entry = table[item];
    if (!entry) continue; // not sold there / not written down: simply absent
    const price = round2(toNumber(entry.price));
    if (price === null) {
      out.push({ item, ok: false, error: 'manual entry without a price' });
      continue;
    }
    const seen = entry.seen || file.updated || date;
    const age = date && seen ? daysBetween(seen, date) : 0;
    out.push({
      item,
      ok: true,
      name: entry.name || null,
      price,
      per_unit: round3(toNumber(entry.per_unit) ?? price),
      unit: entry.unit || null,
      size: toNumber(entry.size),
      packaging: entry.packaging || null,
      was: round2(toNumber(entry.was)),
      manual: true,
      seen: seen || null,
      stale: age > STALE_AFTER_DAYS,
      age_days: age,
    });
  }
  return out;
}
