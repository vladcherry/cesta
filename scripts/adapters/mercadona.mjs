// Mercadona online shop adapter.
//
// Endpoint: https://tienda.mercadona.es/api/products/{id}/?lang=es&wh={warehouse}
//
// GOTCHA, and the one that costs the most time:
//   price_instructions.unit_price  -> price of the PACKAGE (what you pay)
//   price_instructions.bulk_price  -> price per kg / l / unit (what you compare)
// The names suggest the opposite. Comparing `unit_price` across shops silently
// rewards smaller packages, so everything downstream compares `per_unit`.

import { fetchJson, sleep, toNumber, round2, round3, HttpError } from '../lib/util.mjs';
import { CONFIG } from '../config.mjs';

export const id = 'mercadona';

const API = 'https://tienda.mercadona.es/api';

const headers = {
  accept: 'application/json',
  'accept-language': 'es-ES,es;q=0.9',
  'user-agent': CONFIG.userAgent,
};

export function productUrl(sku, region) {
  return `${API}/products/${encodeURIComponent(sku)}/?lang=es&wh=${encodeURIComponent(region)}`;
}

export function normalize(product) {
  const p = product.price_instructions || {};
  const packPrice = toNumber(p.unit_price);
  const perUnit = toNumber(p.bulk_price) ?? toNumber(p.reference_price) ?? packPrice;
  return {
    name: product.display_name || product.slug || null,
    price: round2(packPrice),
    per_unit: round3(perUnit),
    unit: (p.reference_format || p.size_format || '').toLowerCase() || null,
    size: toNumber(p.unit_size),
    packaging: product.packaging || null,
    was: round2(toNumber(p.previous_unit_price)),
  };
}

// skus: string[]  ->  [{ sku, ok, ... }]
export async function fetchPrices(skus, region, options = {}) {
  const delay = options.delayMs ?? CONFIG.requestDelayMs;
  const out = [];
  for (let i = 0; i < skus.length; i += 1) {
    const sku = skus[i];
    if (i > 0) await sleep(delay);
    try {
      const product = await fetchJson(productUrl(sku, region), {
        headers,
        timeoutMs: CONFIG.requestTimeoutMs,
        retries: CONFIG.requestRetries,
      });
      const row = normalize(product);
      if (row.price === null) {
        out.push({ sku, ok: false, error: 'no price in response' });
      } else {
        out.push({ sku, ok: true, ...row });
      }
    } catch (error) {
      // A 404 here means the product id is dead. Mercadona rotates ids when a
      // supplier or a format changes; fix it in basket.json when it shows up.
      const gone = error instanceof HttpError && (error.status === 404 || error.status === 410);
      out.push({ sku, ok: false, gone, error: error.message });
    }
  }
  return out;
}

// Used by scripts/discover.mjs to dump the catalogue once.
export async function fetchCategoryTree(region) {
  return fetchJson(`${API}/categories/?lang=es&wh=${encodeURIComponent(region)}`, {
    headers,
    timeoutMs: CONFIG.requestTimeoutMs,
    retries: CONFIG.requestRetries,
  });
}

export async function fetchCategory(categoryId, region) {
  return fetchJson(
    `${API}/categories/${encodeURIComponent(categoryId)}/?lang=es&wh=${encodeURIComponent(region)}`,
    { headers, timeoutMs: CONFIG.requestTimeoutMs, retries: CONFIG.requestRetries },
  );
}
