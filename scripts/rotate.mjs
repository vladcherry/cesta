#!/usr/bin/env node
// The frontend downloads data/prices.ndjson whole, so the file should not grow
// forever: ~140 rows a day is roughly 7 MB a year. This moves everything older
// than a cutoff into data/archive/prices-<year>.ndjson, which git keeps and the
// app never fetches.
//
//   node scripts/rotate.mjs            -> keep the last 550 days
//   node scripts/rotate.mjs --keep=365

import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, parseArgs, today, log } from './lib/util.mjs';

const args = parseArgs();
const keepDays = Number(args.keep || 550);
const cutoff = new Date(Date.parse(today() + 'T12:00:00Z') - keepDays * 86400000)
  .toISOString()
  .slice(0, 10);

const file = resolve(ROOT, 'data/prices.ndjson');
if (!existsSync(file)) {
  log('nothing to rotate');
  process.exit(0);
}

const lines = (await readFile(file, 'utf8')).split('\n').filter((line) => line.length > 1);
const keep = [];
const archive = new Map();

for (const line of lines) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    continue;
  }
  if (row.date >= cutoff) {
    keep.push(line);
  } else {
    const year = row.date.slice(0, 4);
    if (!archive.has(year)) archive.set(year, []);
    archive.get(year).push(line);
  }
}

if (!archive.size) {
  log(`nothing older than ${cutoff}`);
  process.exit(0);
}

await mkdir(resolve(ROOT, 'data/archive'), { recursive: true });
for (const [year, rows] of archive) {
  await appendFile(resolve(ROOT, `data/archive/prices-${year}.ndjson`), rows.join('\n') + '\n', 'utf8');
  log(`archived ${rows.length} rows to data/archive/prices-${year}.ndjson`);
}
await writeFile(file, keep.length ? keep.join('\n') + '\n' : '', 'utf8');
log(`kept ${keep.length} rows since ${cutoff}`);
