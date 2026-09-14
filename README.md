# IRPF

What is one more euro of income actually worth in Spain?

Not a payslip calculator. It computes the **annual settlement** — the monthly
retención is only a prepayment and says nothing about whether a raise is worth
taking — and it does it for every income in the range at once, every €100, so
the shape of the system is visible instead of a single number.

A small PWA: no build step, no dependencies, no backend, served from GitHub
Pages. Every rate lives in one JSON file.

Live: **https://vladcherry.github.io/cesta/**

## What it shows

- **Overview** — net against gross, the effective and the marginal rate, and a
  stacked split of where the money goes. The marginal line is the interesting
  one: it is the share of the *next* euro that never arrives.
- **Bad stretches** — the two ways income gets expensive. A **spike** is a
  stretch where the marginal rate jumps because something is being withdrawn
  rather than because a rate rose: between roughly €18k and €23k of salary the
  art. 20 earned-income reduction phases out and the marginal rate reaches
  **≈65 %**. A **trap** is worse — net income actually *falls*. Every RETA
  bracket edge is one: crossing it raises the quota by a fixed amount at once,
  so a €100 raise can cost €460 and it takes another €800 of gross just to get
  back to where you were.
- **Steps** — every stretch of flat marginal rate, with what changes at each
  edge (bracket, contribution ceiling, reduction withdrawal, RETA bracket).
- **Compare** — the same income across regional scales, and employment against
  self-employment.
- **Housing** — what the net income reaches as a mortgage. Banks size a loan
  two ways at once: the payment against net income (a third of it, give or
  take) and the buyer's own money against the price — 20 % down plus about
  11 % of purchase costs. The chart draws reachable price against income, one
  line per term, and the moment a line goes flat is the moment savings, not
  salary, became the limit: past it a raise buys nothing. Age matters because
  the loan has to be repaid by 75, which caps the term.

Employment and self-employment (RETA) are both modelled, with children, age,
pension contributions and — for the self-employed — an expense share. Age is a
number rather than a bracket: the tax code only cares about 65 and 75, a bank
cares about the exact year.

Every amount reads **per year or per month** — one switch in the header sets
the period for the cards, both axes of every chart, the tooltips and every
table; the headline figures carry the other reading in brackets.

Four languages: English, Spanish, Ukrainian, Russian. The language follows the
browser until you pick one with the header button; after that it is remembered.
Every input, the language, the theme, the period and the open tab are kept in
`localStorage`, so the app reopens where you left it, and the main ones also
ride in the URL — a finding can be sent to someone as a link. Light and dark
themes, both explicitly designed. Installable, and it opens offline.

## Where the numbers come from

Every rate, bracket, threshold and quota lives in **`data/es-2026.json`**; the
engine contains no hard-coded euros. Each scale carries its source and a
`verified` flag, shown in the app as *confirmed* or *needs checking*:

| Confirmed | Needs checking |
|---|---|
| State general scale (art. 63 LIRPF) | Cataluña scale (Decret llei 5/2025, limits above €33.000) |
| Madrid and Andalucía scales | Comunitat Valenciana scale (Ley 5/2026 cut every rate; not reproduced) |
| Art. 20 reduction, personal allowances | RETA bracket edges (2025 table, kept for 2026) |
| Contribution rates and bases (Orden PJC/297/2026) | Lending criteria — bank practice, not law |

The lending criteria (rate, term, LTV, payment ceiling, purchase costs) sit
under `hipoteca` and are editable in the page itself.

**This is an estimate for seeing the shape of the system, not tax advice.**
Individual filing, no regional deductions, no savings income, no irregular
income. Check anything you plan to act on against the Agencia Tributaria.

## Running it

No toolchain, no dependencies — any static server will do:

```sh
python3 -m http.server 8099   # then open http://localhost:8099/
npx http-server -p 8099       # same thing, if node is closer to hand
```

Node 20+ for the two scripts:

```sh
node scripts/check.mjs        # self-test for the tax and mortgage engines
node tools/bundle.mjs         # single-file build -> dist/irpf-standalone.html
node tools/bundle.mjs --fragment out.html   # without the document shell
node tools/make-icons.mjs     # regenerate the icons
```

`scripts/check.mjs` asserts the invariants that would otherwise fail silently:
the scales, the art. 20 phase-out, the identity *net + contributions + tax =
gross* at a dozen incomes, the annuity formula, and the presence of the shapes
the app exists to show. It runs in CI on every change to the engine or the
parameters — a wrong number is invisible otherwise, because a chart still
draws.

`tools/bundle.mjs` inlines the stylesheet, the scripts and the parameters into
one HTML file, so the app can travel without the repository. It reads the real
page and slices out its body, so there is no second copy of the markup.

## Deploying

The site is the repository root, all paths are relative so it works from the
`/cesta/` subfolder, and `.nojekyll` keeps files starting with `_` served
as-is.

**Settings → Pages → Build and deployment → Source: Deploy from a branch**,
branch `main`, folder `/ (root)`. GitHub builds it; nothing else is needed.
With *Source: GitHub Actions* instead, run the **Deploy Pages** workflow
(`.github/workflows/pages.yml`) once.

## Repository layout

```
index.html            the app shell
css/app.css           one stylesheet, light + dark tokens
js/i18n.js            every user-facing string (en / es / uk / ru)
js/engine.js          IRPF, contributions, RETA, mortgage — gross in, net out
js/analysis.js        steps, spikes and traps, read off the sampled curve
js/charts.js          charts with income on the x axis, hand-written SVG
js/app.js             state, views, events
data/es-2026.json     every rate and threshold, one file
sw.js                 service worker
manifest.json         PWA manifest
icons/                generated (see tools/make-icons.mjs)

scripts/check.mjs     self-test for the engines
tools/bundle.mjs      single-file build
tools/make-icons.mjs  PNG + SVG icon generator, no libraries
```

## How the numbers are computed

For an employee (arts. 17-20, 56-63 LIRPF):

```
gross
  - employee contributions      capped at the maximum base, plus the
                                solidarity quota above it
  - 2.000 EUR standard expense  art. 19.2.f
  = rendimiento neto del trabajo
  - art. 20 reduction           only below 19.747,50, and it phases out
                                steeply — this is where the worst marginal
                                rates in the whole system live
  = base imponible general
  - pension contributions
  = base liquidable
cuota = scale(BL) - scale(personal and family allowance), the state and the
        regional scale applied separately over the same base
```

For the self-employed the RETA quota replaces the payroll contribution, and it
is a *step* function of net income: crossing a bracket edge costs a fixed
amount at once, which is what makes some incomes strictly worse than a lower
one. That is not a rounding artefact, it is how the table is written.

Everything the app shows — the steps, the traps, the marginal rates — is read
off one sampled curve, so the charts and the tables cannot disagree.

## History

This repository used to hold **Cesta**, a fixed-basket grocery price tracker
for Spanish supermarkets. It was replaced by this app; the collector, the
basket and the price history are in the git history up to `113edc6`.
