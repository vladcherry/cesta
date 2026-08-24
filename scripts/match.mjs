#!/usr/bin/env node
// Helper for the one evening of work: suggest catalogue ids for basket items
// that still have no sku. It only prints candidates — the choice stays manual,
// because automatic matching is exactly what makes private-label comparisons
// meaningless.
//
//   node scripts/match.mjs                    -> candidates for every empty sku
//   node scripts/match.mjs "leche semi"       -> free search in the catalogue
//   node scripts/match.mjs --item=olive-oil-1l
//   node scripts/match.mjs --catalog=catalog-vlc1.json --top=8

import { parseArgs, readJson, log } from './lib/util.mjs';

const args = parseArgs();
const top = Number(args.top || 5);
const catalogFile = args.catalog || 'catalog.json';

const catalog = await readJson(catalogFile, null);
if (!catalog) {
  log(`no ${catalogFile} — run: node scripts/discover.mjs`);
  process.exit(1);
}

const fold = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

const index = catalog.products.map((p) => ({ product: p, tokens: new Set(fold(`${p.name} ${p.category}`)) }));

function search(query) {
  const wanted = fold(query);
  return index
    .map(({ product, tokens }) => {
      let score = 0;
      for (const token of wanted) {
        if (tokens.has(token)) score += 2;
        else if ([...tokens].some((t) => t.startsWith(token) || token.startsWith(t))) score += 1;
      }
      return { product, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.product.name.length - b.product.name.length)
    .slice(0, top);
}

function print(query, label) {
  const hits = search(query);
  log(`\n${label}  <- "${query}"`);
  if (!hits.length) {
    log('   (nothing)');
    return;
  }
  for (const { product: p } of hits) {
    const per = p.per_unit ? ` | ${p.per_unit} EUR/${p.unit || '?'}` : '';
    log(`   ${p.id.padEnd(7)} ${p.price ?? '?'} EUR${per}  ${p.name}  [${p.category}]`);
  }
}

if (args._.length) {
  print(args._.join(' '), 'search');
} else {
  const basket = await readJson('basket.json');
  const items = basket.items.filter((i) => (args.item ? i.id === args.item : !i.skus?.mercadona));
  if (!items.length) log('every item already has a Mercadona sku');
  for (const item of items) print(item.search || item.name, `${item.id} (${item.name})`);
  log('\nPaste the chosen id into basket.json -> items[].skus.mercadona');
}
