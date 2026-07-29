# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A generator for a single travel plan. `italy-2026/` holds the whole project: one
JSON file describes a 14-day Italy trip, and three build scripts turn it into
two self-contained HTML documents and an Excel workbook. There is no server, no
framework, and no runtime data fetching.

## Commands

All commands run from `italy-2026/` (not the repo root).

```bash
npm install
npm run build        # verify → build:html → build:xlsx (the normal path)

npm run verify       # invariant checks on data/itinerary.json only; needs no deps
npm run build:html   # dist/plan.html + dist/presentation.html
npm run build:xlsx   # dist/Italy 2026 (revised).xlsx

node scripts/fetch-streets.mjs   # refresh src/geo/streets.json from Overpass
```

There is no test runner, linter, or formatter. `scripts/verify.mjs` is the test
suite — it exits non-zero with a list of problems, so run `npm run verify` after
any edit to `data/itinerary.json`. `fetch-streets.mjs` hits a public API and takes
minutes; run it only when stops move, and never as part of `npm run build`.

## Architecture

**`data/itinerary.json` is the single source of truth.** All three outputs are
generated from it; nothing downstream holds its own copy of a date, price, or
coordinate. Change the trip by editing that file and rebuilding — never by
patching `dist/`.

Its top-level keys are `meta`, `cities`, `days`, `hotels`, `drivers`, `bookings`,
`bookingsRuledOut`, `budget`, `photographers`, `portals`. The two that matter most:

- `cities` is a keyed map (`rome`, `florence`, `tuscany`, …) carrying each place's
  display name, `accent` colour and `center` coord. `days[].city` and
  `hotels[].cityKey` reference these keys; the accent colour drives per-day theming
  in both documents.
- `days[].items[]` are timed stops with `coord` (lat/lng) and `kind`. `kind` is the
  join to `PIN_COLORS` / `PIN_LABELS` in `src/js/mapengine.js` — adding a new kind
  means adding it there too, or pins render unstyled.

### The build

`scripts/build.mjs` esbuild-bundles each page's JS entry with `bundle: true` and a
`dataurl` loader for images, then substitutes the result plus concatenated CSS into
`__JS__` / `__CSS__` placeholders in the page's template. Because the bundler
resolves `import TRIP from '../../data/itinerary.json'` and the `.webp` imports in
`src/js/images.js`, the itinerary, the map geometry, three.js and the artwork all
end up inlined in a single file.

**The self-contained constraint is load-bearing and enforced.** Both documents must
open from `file://`, work offline, and survive being emailed. `build.mjs` greps its
own output for external `<script src>`, stylesheet `<link>`, `@import`, remote
`url()`/`<img>`, runtime `fetch()`, WebSocket and `<iframe>`, and fails the build if
any appear. Do not add a CDN dependency, a web font, or a runtime request — the
multi-megabyte `dist/` files are the deliberate cost of that rule.

### The two pages

Both entries (`src/js/plan.js`, `src/js/deck.js`) render imperatively from `TRIP`
using a local `h()` DOM helper — no templating library. They intentionally each
carry their own copy of that helper rather than sharing one; keep them in sync by
hand if you change it. Shared logic lives in the two real modules:

- `src/js/mapengine.js` (the biggest file) — an SVG cartography engine. Web Mercator
  projection, no tiles. Which layers it draws is a function of how much ground is in
  view, so a country-scale frame shows coastline while a street-scale frame shows
  alleys and street names. `createMap()` is the entry point; `groupStops()` merges
  colliding pins and splits them again on zoom.
- `src/js/globe.js` — the deck's three.js hero: Italy extruded from Natural Earth
  geometry with the route arc drawn on it.

Both pages build their maps lazily (14 SVG maps at once is wasteful). On
`plan.html`, clicking a timeline item flies the day's map to that stop —
`focusStop()` / `clearStop()` in `plan.js` are the link between the two.

### Geometry

`src/geo/italy.json` is the Natural Earth 1:50m country outline (public domain).
`src/geo/streets.json` is OSM data (© OpenStreetMap contributors, ODbL) fetched via
Overpass and simplified with Douglas–Peucker, stored as areas `a0…a18` with
quantised integer coordinates relative to each area's `origin`. `fetch-streets.mjs`
clusters the itinerary's stops into those areas, picks a detail level from the
cluster's span, queries one area at a time and checkpoints after each — so it is
safe to interrupt and re-run, and it skips areas it already has. Building footprints
are deliberately never fetched: in a dense centre they outweigh every other layer.

## Conventions

- **Dates are handled in UTC throughout.** Every script and page parses `YYYY-MM-DD`
  by hand into `Date.UTC(...)` and formats with `timeZone: 'UTC'`. Using local-time
  `new Date(iso)` will shift days for anyone west of Greenwich — don't introduce it.
- **`dist/` is committed.** It is the published artifact: pushing changed
  `italy-2026/dist/**` to `main` triggers `.github/workflows/pages.yml`, which deploys
  that directory to GitHub Pages. A data change is not complete until the rebuilt
  `dist/` is committed alongside it.
- **`data/Italy 2026 (original).xlsx` is an untouched archive** of the source
  workbook. `build:xlsx` writes only to `dist/`, reproducing the original's seven tab
  names and column order.
- Hotel-card artwork is original illustration, not photography, and is labelled
  *Illustration* wherever it appears; each card links to the real gallery. Keep that
  distinction if you touch those cards.
