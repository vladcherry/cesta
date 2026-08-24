#!/usr/bin/env node
// Icon generator. No libraries: the PNGs are encoded here (zlib comes from
// node:zlib) and the artwork is drawn with signed distance fields, 3x3
// supersampled. Run after changing the mark:
//
//   node tools/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'icons');

const BLUE = [42, 120, 214]; // --store-mercadona, light step
const INK = [252, 252, 251];

// --- PNG encoder ----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- distance fields ------------------------------------------------------

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function sdRoundRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const h = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(wx - vx * h, wy - vy * h);
}

// Convex polygon, points clockwise: positive outside.
function sdConvex(px, py, points) {
  let inside = true;
  let best = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (cross > 0) inside = false;
    best = Math.min(best, sdSegment(px, py, ax, ay, bx, by));
  }
  return inside ? -best : best;
}

// The mark: a basket outline with a handle and three slats, on a rounded
// square. `inset` shrinks the glyph for the maskable safe zone.
function draw(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 24; // the artwork is authored on a 24x24 grid
  const glyphScale = maskable ? 0.74 : 1;
  const stroke = 1.7 * s * glyphScale;
  const half = stroke / 2;

  const cx = 12 * s;
  const cy = 12.4 * s;
  const g = (x, y) => [cx + (x - 12) * s * glyphScale, cy + (y - 12.4) * s * glyphScale];

  const body = [g(3.2, 8.2), g(20.8, 8.2), g(18.6, 19.6), g(5.4, 19.6)];
  const handleR = 5.1 * s * glyphScale;
  const [hx, hy] = g(12, 8.2);
  const slats = [
    [g(8.8, 11.4), g(8.8, 16.8)],
    [g(12, 11.4), g(12, 16.8)],
    [g(15.2, 11.4), g(15.2, 16.8)],
  ];
  const rim = [g(2.6, 8.2), g(21.4, 8.2)];

  const samples = 3;
  const step = 1 / samples;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) * step;
          const py = y + (sy + 0.5) * step;

          // background plate
          const plate = maskable
            ? -1
            : sdRoundRect(px, py, size / 2, size / 2, size / 2, size / 2, size * 0.22);
          if (plate <= 0) bg += 1;

          // glyph: outline of the basket + rim + handle + slats
          let d = Math.abs(sdConvex(px, py, body)) - half;
          d = Math.min(d, sdSegment(px, py, rim[0][0], rim[0][1], rim[1][0], rim[1][1]) - half);
          const toHandle = Math.hypot(px - hx, py - hy);
          if (py <= hy) d = Math.min(d, Math.abs(toHandle - handleR) - half * 0.95);
          for (const [a, b] of slats) {
            d = Math.min(d, sdSegment(px, py, a[0], a[1], b[0], b[1]) - half * 0.85);
          }
          if (d <= 0) fg += 1;
        }
      }

      const total = samples * samples;
      const bgA = bg / total;
      const fgA = fg / total;
      const i = (y * size + x) * 4;
      // Plate first, glyph on top.
      const alpha = maskable ? 1 : bgA;
      const r = INK[0] * fgA + BLUE[0] * (1 - fgA);
      const g2 = INK[1] * fgA + BLUE[1] * (1 - fgA);
      const b = INK[2] * fgA + BLUE[2] * (1 - fgA);
      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g2);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = Math.round(255 * Math.max(alpha, fgA));
    }
  }
  return encodePng(size, size, rgba);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" role="img" aria-label="Cesta">
  <rect width="24" height="24" rx="5.3" fill="#2a78d6"/>
  <g fill="none" stroke="#fcfcfb" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3.2 8.2h17.6L18.6 19.6H5.4L3.2 8.2Z"/>
    <path d="M2.6 8.2h18.8"/>
    <path d="M7.4 8.2a4.6 4.6 0 0 1 9.2 0"/>
    <path d="M8.8 11.4v5.4M12 11.4v5.4M15.2 11.4v5.4"/>
  </g>
</svg>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'icon.svg'), SVG);
writeFileSync(resolve(OUT, 'icon-192.png'), draw(192));
writeFileSync(resolve(OUT, 'icon-512.png'), draw(512));
writeFileSync(resolve(OUT, 'icon-maskable-512.png'), draw(512, { maskable: true }));
process.stdout.write('icons: icon.svg, icon-192.png, icon-512.png, icon-maskable-512.png\n');
