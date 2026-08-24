// Static project configuration.
//
// Mercadona prices are bound to a WAREHOUSE, not to a shop. The warehouse is
// derived from the postal code by the shop itself. Find yours once:
//   tienda.mercadona.es -> enter postal code -> DevTools -> Network -> filter
//   "api" -> read the `wh` query parameter of any request.
// Changing `wh` changes prices AND product ids. Treat it as a hard pin.

export const CONFIG = {
  postalCode: '03580', // Alfas del Pi (Alicante)

  stores: {
    mercadona: {
      label: 'Mercadona',
      // "api"  -> scraped from the online shop by scripts/adapters/
      // "manual" -> hand-entered from data/manual/<store>.json (no online catalog)
      source: 'api',
      adapter: 'mercadona',
      region: 'alz1', // warehouse code, see note above
      enabled: true,
    },
    lidl: {
      label: 'Lidl',
      // Lidl Spain has no online grocery catalog: prices come from the weekly
      // folleto and are typed into data/manual/lidl.json by hand.
      source: 'manual',
      region: 'es',
      enabled: true,
    },
    consum: {
      label: 'Consum',
      source: 'api',
      adapter: 'consum',
      region: '03580',
      enabled: true,
    },
    aldi: {
      label: 'Aldi',
      // Same story as Lidl: folleto only.
      source: 'manual',
      region: 'es',
      enabled: true,
    },
  },

  currency: 'EUR',

  // Be a good citizen: one run per day, 400 ms between requests.
  // 60 products = about half a minute of work. There is no reason to go faster.
  requestDelayMs: 400,
  requestTimeoutMs: 15000,
  requestRetries: 2,

  userAgent:
    'cesta/1.0 (personal grocery price tracker; https://github.com/vladcherry/cesta)',
};

export const STORE_IDS = Object.keys(CONFIG.stores);

export function enabledStores() {
  return STORE_IDS.filter((id) => CONFIG.stores[id].enabled);
}
