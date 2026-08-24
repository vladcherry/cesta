// Small helpers shared by the scripts. No dependencies: Node 20+ has fetch.

import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (const token of argv) {
    if (token.startsWith('--')) {
      const [key, value] = token.slice(2).split('=');
      args[key] = value === undefined ? true : value;
    } else {
      args._.push(token);
    }
  }
  return args;
}

// Prices are money: two decimals. Unit prices keep three, because 0.995 EUR/l
// and 1.005 EUR/l are a real difference over a year of shopping.
export const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
export const round3 = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);

export function toNumber(value) {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(n) ? n : null;
}

// The basket is bought in Spain, so the shopping day is the Spanish one.
export function today(tz = 'Europe/Madrid') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function readJson(path, fallback = undefined) {
  const full = resolve(ROOT, path);
  if (!existsSync(full)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing file: ${path}`);
  }
  return JSON.parse(await readFile(full, 'utf8'));
}

export async function writeJson(path, value) {
  const full = resolve(ROOT, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

// NDJSON append: one line per product per day. Keeps the git diff readable and
// lets the file be read line by line without parsing all of it.
export async function appendNdjson(path, rows) {
  if (!rows.length) return;
  const full = resolve(ROOT, path);
  await mkdir(dirname(full), { recursive: true });
  await appendFile(full, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.url = url;
  }
}

export async function fetchJson(url, { timeoutMs = 15000, retries = 2, headers = {} } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (!response.ok) {
        // 404 means the product id is gone; retrying will not bring it back.
        if (response.status === 404 || response.status === 410) {
          throw new HttpError(response.status, url);
        }
        throw new HttpError(response.status, url);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && (error.status === 404 || error.status === 410)) throw error;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export function log(...parts) {
  process.stdout.write(`${parts.join(' ')}\n`);
}
