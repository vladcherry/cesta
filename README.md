# Cesta

Home grocery price tracker. Once a day it pulls prices for one fixed basket
from Spanish supermarkets and keeps the history in this repository, so it can
answer two questions:

1. **Where is the whole basket cheaper this week?**
2. **How did the price of one item move over the last months?**

The frontend is a small PWA (no build step, no dependencies) served from
GitHub Pages; the collector is a GitHub Action writing JSON into `data/`.
No backend, no database, €0/month.

Live: **https://vladcherry.github.io/cesta/** · layout preview without data:
[`?demo=1`](https://vladcherry.github.io/cesta/?demo=1)

## Principles

This is a personal project, not a product. Everything else follows from that.

- **No map.** The shops are known by heart.
- **No catalogue search.** The basket is fixed, ~70 items, assembled by hand once.
- **No automatic product matching.** "my item → shop SKU" is written by hand in
  `basket.json`. With private labels everywhere (Hacendado, Consum, Milbona)
  it is the only way to get a comparison that means anything.
- **No backend, no database.** GitHub Actions plus JSON in the repository.
- **Price history is the git log.** `data/prices.ndjson` grows one line per
  item per shop per day, so a diff shows exactly what moved.

## Shops

| Shop | Source | How it works |
|---|---|---|
| Mercadona | online shop API | `scripts/adapters/mercadona.mjs`, prices bound to a **warehouse** derived from the postal code |
| Consum | online shop API | `scripts/adapters/consum.mjs` — endpoint **not verified against the live site yet**, see Limitations |
| Lidl | typed by hand | no online grocery catalogue in Spain → `data/manual/lidl.json`, from the weekly folleto |
| Aldi | typed by hand | same as Lidl → `data/manual/aldi.json` |

Hand-entered prices carry the date they were seen. Anything older than 21 days
is shown as stale rather than as a current price.

## What the app shows

- **Basket** — the shops ranked by what the whole basket costs. The ranking
  uses only the items priced by *every* shop, because comparing different
  coverage is meaningless; the full per-shop total is shown next to it as a
  separate figure. Below that, the basket total per shop over time.
- **Items** — a table of item × shop with the cheapest cell marked (a check
  mark and a label, not just a colour), a 90-day sparkline per cell, and the
  30-day change. Both the unit price (€/kg, €/l) and the pack price are always
  visible, and the comparison switches between them.
- **Item detail** — full price history per shop for 30/90/180/365 days, with
  min / max / average per shop.

Three languages: English, Spanish, Ukrainian. The language follows the
browser, can be forced with the header button and is remembered. Light and
dark themes, both explicitly designed.

## Running locally

No toolchain, no dependencies — any static server will do:

```sh
python3 -m http.server 8099   # then open http://localhost:8099/
npx http-server -p 8099       # same thing, if node is closer to hand
```

Add `?demo=1` for synthetic data (deterministic, works offline, useful before
the collector has any history).

Collector scripts need Node 20+ and nothing else:

```sh
node scripts/fetch.mjs --dry-run          # collect, touch no files
node scripts/fetch.mjs --only=mercadona   # one shop
node scripts/discover.mjs                 # dump the Mercadona catalogue
node scripts/match.mjs "leche semi"       # find candidate ids in the dump
node tools/make-icons.mjs                 # regenerate the icons
node scripts/rotate.mjs --keep=550        # archive old history rows
```

## Setting it up for yourself

**1. Find your Mercadona warehouse.** Prices are bound to a warehouse, not to a
shop, and the warehouse comes from the postal code. Open `tienda.mercadona.es`,
enter the postal code, then DevTools → Network → filter `api` and read the `wh`
parameter of any request (`alz1`, `vlc1`, …). Put it in `scripts/config.mjs`.
Changing `wh` changes prices **and product ids** — that is the main trap in
this project.

**2. Dump the catalogue.** `node scripts/discover.mjs` writes `catalog.json`
(gitignored: large, and only needed while building the basket).

**3. Fill in the basket.** Do not invent a list. Mercadona emails digital
receipts — take 50–80 lines from what is actually bought and find each id in
the dump: `node scripts/match.mjs` prints candidates for every item still
missing a sku. One evening of work; after that the file barely changes.

**4. Type in Lidl and Aldi** as you see them, in `data/manual/<shop>.json`.
Items you never buy there simply stay absent.

**5. Let the cron run.** `.github/workflows/daily.yml` runs once a day and
commits the new rows. `workflow_dispatch` is enabled — trigger it by hand while
debugging.

## Deploying to GitHub Pages

The site is the repository root (`index.html`, `css/`, `js/`, `data/`), all
paths are relative so it works from the `/cesta/` subfolder. `.nojekyll` is in
place so files starting with `_` are served as-is.

**What to click:** *Settings → Pages → Build and deployment → Source:*
**Deploy from a branch**, branch `main`, folder `/ (root)` → *Save*.
GitHub builds it; nothing else is needed.

If you prefer *Source: GitHub Actions* instead, run the **Deploy Pages**
workflow (`.github/workflows/pages.yml`, `workflow_dispatch`) once. Note that
Pages cannot be enabled from a workflow — `GITHUB_TOKEN` has no permission to
create the Pages site, so the switch above has to be flipped by hand first.

Final address: **https://vladcherry.github.io/cesta/**

## Offline and installation

- The service worker caches the shell (cache-first) and the data
  (network-first with a cache fallback), so the app opens with the last
  snapshot when there is no network.
- The last snapshot and a trimmed history are also kept in `localStorage`, so
  the first paint has data even before the caches answer.
- "Add to home screen" works through `manifest.json`; `start_url` and `scope`
  are relative.
- **Daily background check** (Info → settings) uses Periodic Background Sync:
  it checks once a day whether a new snapshot appeared and posts a
  notification. Be honest about what this is: **Chromium only, only for an
  installed app, only after notification permission, and the browser decides
  whether to run it at all.** Everywhere else the button says "not supported"
  and the app just refreshes when opened.

## Repository layout

```
index.html            app shell
css/app.css           one stylesheet, light + dark tokens
js/i18n.js            every user-facing string (en / es / uk)
js/store.js           settings and the offline copy (localStorage)
js/format.js          money, numbers, dates
js/data.js            loading, history parsing, deltas, basket series
js/demo.js            synthetic data for ?demo=1
js/charts.js          sparklines and line charts, hand-written SVG
js/app.js             state, rendering, events
sw.js                 service worker
manifest.json         PWA manifest
icons/                generated (see tools/make-icons.mjs)

basket.json           the fixed basket and the hand-written shop ids
data/latest.json      today's snapshot, what the app loads first
data/prices.ndjson    the history, one line per item per shop per day
data/manual/*.json    hand-entered prices for Lidl and Aldi
data/archive/         rotated history (never fetched by the app)

scripts/config.mjs    warehouse, shops, request pacing
scripts/adapters/     one module per source, all with the same interface
scripts/discover.mjs  one-off catalogue dump
scripts/match.mjs     suggests catalogue ids for basket items
scripts/fetch.mjs     the daily collector
scripts/rotate.mjs    archives old history rows
tools/make-icons.mjs  PNG + SVG icon generator, no libraries
```

Adding a shop means writing one adapter with the same interface —
`fetchPrices(skus, region) -> [{ sku, ok, price, per_unit, unit, name }]` — and
one entry in `scripts/config.mjs`. Do that only after the existing ones have
run for a couple of weeks without falling over.

## Limitations

Honest list; most of these are structural, not bugs to be fixed later.

- **The adapters have not yet run against the live sites from this repository.**
  They were written against the documented request/response shapes, but the
  environment they were authored in had no network access to those hosts. Run
  `node scripts/fetch.mjs --only=mercadona --dry-run` once and read the log
  before trusting the cron. The Consum endpoint in particular is a best guess
  and very likely needs the URL and field paths adjusted from DevTools.
- **`unit_price` is not the unit price.** In the Mercadona API `unit_price` is
  the price of the package and `bulk_price` is the price per kg/l. The names
  invite exactly the wrong reading. Everything downstream compares `per_unit`,
  and the UI always shows both numbers.
- **Compare per unit, not per pack.** 900 ml against 1 l otherwise shows a
  saving that does not exist.
- **Product ids rot.** Mercadona changes a SKU when the supplier or the format
  changes; it shows up as a 404 in the run log and is marked as a dead id in
  the app. Expect to fix one or two ids in `basket.json` every couple of months.
- **Online price ≠ shelf price.** Small for Mercadona, larger elsewhere: store
  format changes the price. Do not treat the comparison as exact to the cent.
- **Lidl and Aldi are only as fresh as the last time someone typed them in**,
  and a folleto price is often a promotion rather than the normal shelf price.
- **Coverage differs per shop**, so the headline ranking only counts items
  priced everywhere. With few such items the ranking is thin — the app says how
  many it used.
- **No private-label equivalence guarantee.** "Semi-skimmed milk" maps to a
  different product in each shop, chosen by hand. That is the point, but it is
  a judgement call, not a fact.
- **Everything is public.** The repository holds the basket, the prices and the
  history; there is no auth and nothing is secret.
- **The history file grows** (~7 MB a year with two API shops) and the app
  downloads it whole. `scripts/rotate.mjs` archives old rows when that starts
  to matter.
- **Chart interaction assumes a pointer.** Touch works (tap moves the
  crosshair), but the charts are more comfortable with a mouse.
