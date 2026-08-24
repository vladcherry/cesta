#!/usr/bin/env node
// Dump the whole Mercadona catalogue once, so there is something to search
// while building basket.json. Run it again only when ids start going 404.
//
//   node scripts/discover.mjs                 -> catalog.json
//   node scripts/discover.mjs --wh=vlc1 --out=catalog-vlc1.json
//
// catalog.json is gitignored: it is large and only needed at basket time.

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as mercadona from './adapters/mercadona.mjs';
import { CONFIG } from './config.mjs';
import { ROOT, parseArgs, sleep, log, toNumber } from './lib/util.mjs';

const args = parseArgs();
const region = args.wh || CONFIG.stores.mercadona.region;
const out = args.out || 'catalog.json';

function collectLeafCategories(nodes, trail = []) {
  const leaves = [];
  for (const node of nodes || []) {
    const path = [...trail, node.name];
    if (node.categories && node.categories.length) {
      leaves.push(...collectLeafCategories(node.categories, path));
    } else {
      leaves.push({ id: node.id, path });
    }
  }
  return leaves;
}

const tree = await mercadona.fetchCategoryTree(region);
const leaves = collectLeafCategories(tree.results || tree.categories || []);
log(`warehouse ${region}: ${leaves.length} leaf categories`);

const products = new Map();
let done = 0;

for (const leaf of leaves) {
  done += 1;
  try {
    const detail = await mercadona.fetchCategory(leaf.id, region);
    for (const sub of detail.categories || [detail]) {
      for (const product of sub.products || []) {
        const p = product.price_instructions || {};
        products.set(String(product.id), {
          id: String(product.id),
          name: product.display_name,
          packaging: product.packaging || null,
          category: leaf.path.join(' / '),
          price: toNumber(p.unit_price),
          per_unit: toNumber(p.bulk_price),
          unit: p.reference_format || p.size_format || null,
          size: toNumber(p.unit_size),
        });
      }
    }
  } catch (error) {
    log(`  ! ${leaf.path.join(' / ')}: ${error.message}`);
  }
  if (done % 10 === 0) log(`  ${done}/${leaves.length} categories, ${products.size} products`);
  await sleep(CONFIG.requestDelayMs);
}

const catalog = {
  store: 'mercadona',
  warehouse: region,
  fetched_at: new Date().toISOString(),
  products: [...products.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')),
};

await writeFile(resolve(ROOT, out), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
log(`wrote ${out}: ${catalog.products.length} products`);
