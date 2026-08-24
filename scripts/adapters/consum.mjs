// Consum online shop adapter.
//
// NOT VERIFIED AGAINST THE LIVE SITE. The endpoint below is the one the online
// shop calls for a product card, but Consum changes it more often than
// Mercadona does. Before trusting the cron with it:
//   1. open tienda.consum.es, open a product,
//   2. DevTools -> Network -> filter "product",
//   3. copy the request URL here and check the field names in `normalize`.
// Until then the adapter simply reports errors and the shop shows up empty in
// the UI, which is the honest outcome.

import { fetchJson, sleep, toNumber, round2, round3, HttpError } from '../lib/util.mjs';
import { CONFIG } from '../config.mjs';

export const id = 'consum';

const API = 'https://tienda.consum.es/api/rest/V1.0';

const headers = {
  accept: 'application/json',
  'accept-language': 'es-ES,es;q=0.9',
  'user-agent': CONFIG.userAgent,
};

export function productUrl(sku, region) {
  return `${API}/catalog/product/${encodeURIComponent(sku)}?postalCode=${encodeURIComponent(region)}`;
}

// Consum nests the numbers a level deeper than Mercadona and uses comma
// decimals in some fields, so pick defensively rather than by one fixed path.
function pick(object, paths) {
  for (const path of paths) {
    let node = object;
    for (const key of path.split('.')) {
      node = node?.[key];
      if (node === undefined || node === null) break;
    }
    const value = toNumber(node);
    if (value !== null) return value;
  }
  return null;
}

export function normalize(product) {
  const data = product?.data ?? product ?? {};
  const packPrice = pick(data, [
    'priceData.prices.0.value.centAmount',
    'priceData.prices.0.value',
    'price.amount',
    'unitPrice',
    'price',
  ]);
  // centAmount is in cents; anything above 1000 for a grocery item is cents.
  const price = packPrice !== null && packPrice > 1000 ? packPrice / 100 : packPrice;
  const perUnit = pick(data, [
    'priceData.prices.0.unitValue.centAmount',
    'pricePerUnit',
    'referencePrice',
    'bulkPrice',
  ]);
  const per = perUnit !== null && perUnit > 1000 ? perUnit / 100 : perUnit;
  return {
    name: data.name || data.description || data.productName || null,
    price: round2(price),
    per_unit: round3(per ?? price),
    unit: (data.unitMeasure || data.measureUnit || data.format || '').toLowerCase() || null,
    size: toNumber(data.size ?? data.quantity),
    packaging: data.packaging || null,
    was: null,
  };
}

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
        out.push({ sku, ok: false, error: 'no price in response (check field paths)' });
      } else {
        out.push({ sku, ok: true, ...row });
      }
    } catch (error) {
      const gone = error instanceof HttpError && (error.status === 404 || error.status === 410);
      out.push({ sku, ok: false, gone, error: error.message });
    }
  }
  return out;
}
