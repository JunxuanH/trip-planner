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

**The single-file constraint is load-bearing and enforced.** Both documents are one
HTML file that opens from `file://` and survives being emailed. `build.mjs` greps its
own output for external `<script src>`, stylesheet `<link>`, `@import`, remote
`url()`/`<img>`, runtime `fetch()`, WebSocket and `<iframe>`, and fails the build if
any appear. Do not add a CDN dependency or a web font — the multi-megabyte `dist/`
files are the deliberate cost of that rule.

**`plan.html` may reach exactly two hosts, and both are allowlisted.** They are
listed in `PAGE_HOSTS` in `build.mjs`:

- `basemaps.cartocdn.com` — map tiles (CARTO Positron). Leaflet itself is bundled,
  so the page is still one file; only the tile images come from outside.
- `trip-planner-api-mu.vercel.app` — the editing endpoints (see *Editing on the site*).

`build.mjs` asserts this **positively in both directions**: `plan.html` must
reference both hosts, `presentation.html` must reference neither, and any `fetch()`
to a literal URL outside the page's allowlist fails the build. So the exception
cannot silently widen to a second provider or an analytics beacon, and a page that
*stops* requesting one gets caught too. `presentation.html` stays fully offline,
because a deck is shown full-screen and a grey grid mid-presentation is a bad
failure mode.

`src/js/tilemap.js` picks the engine per frame: it builds the Leaflet map, then
watches whether a tile actually arrives, and hands the frame to `mapengine.js`
if none has within ~3.5s or three error first. So `plan.html` still works on a
plane — that is why `streets.json` is still carried and still worth its size.
`navigator.onLine` is only a fast path; it lies on captive portals and says
nothing about whether CARTO in particular is reachable.

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
Overpass and simplified with Douglas–Peucker, stored with quantised integer
coordinates relative to each area's `origin`. `fetch-streets.mjs` queries one area
at a time and checkpoints after each — so it is safe to interrupt and re-run, and it
skips areas it already has. Building footprints are deliberately never fetched: in a
dense centre they outweigh every other layer.

There are two kinds of area:

- **town areas** (`a0…aN`) — clusters of stops within 4 km of each other, fetched at
  full detail down to footways and steps.
- **corridors** (`c0…cN`) — the gap between two consecutive stops in a day that are
  4–45 km apart. Without these a day like Sorrento → Positano → Amalfi was three
  islands of streets with 25 km of blank between them. They carry motorway/primary/
  secondary only, marked `coarse: true`, and no green/water/squares: `SCALE` in
  mapengine never draws past class 2 at a span wide enough to hold a corridor, and
  the polygons alone tripled the file. The renderer must not paint `st-ground` from
  a `coarse` area — a 40 km slab would claim coverage it doesn't have.

Below ~0.05° the street areas supply the ground; above it mapengine fills sea then
land from `italy.json`. Both are needed: a coastal day at 0.35° drew a bare
coastline with the same tone either side of it before the land fill existed.

**The resume cache is keyed by area index, and the indices come from clustering the
*current* stops.** So "skips areas it already has" is only correct while the stops
stay put. After a route change, `a7` no longer covers the ground the stored `a7`
does, and re-running is a silent no-op that leaves every map drawing the old city's
streets. Whenever stops move between towns, `rm src/geo/streets.json` first and let
it fetch the whole set — several minutes, but it's the only way to get real geometry.

## Editing on the site

`api/` is a **second deployment from the same repo** — Vercel serves it; Pages keeps
serving `italy-2026/dist`. It exists because the plan is used by two people while
travelling, and one of them does not hold the repo. Root `package.json`,
`tsconfig.json` and `vercel.json` belong to that deployment only; `italy-2026/` has
its own and is unaffected.

**Three layers, rendered as `base ⊕ applied ⊕ draft`.** `itinerary.json` is still the
source of truth and is never mutated in the browser:

- **applied** — the shared overlay, in Upstash Redis, synced through `/api/overlay`.
  A per-path last-write-wins register map, so two people merge without locking.
- **draft** — local only, never sent until Apply. Both edit paths, typing in a field
  and asking Claude, land here. This is what makes the Claude path safe to use
  casually: the model proposes into the same tray a person does and has no
  privileged route to the shared document.

Comments are a **separate append-only structure**, merged by union of ids. That is
deliberate — LWW is right for a time field and is data loss for a thread, and
appends commute, so two people commenting offline on the same stop both keep their
comments with no conflict policy at all. Comments post immediately; edits do not.

**`api/_lib/schema.ts` is the security boundary.** Every path — from Claude or from a
hand-made HTTP request — goes through `validatePatch` before it is stored. Only item
`time`/`title`/`detail`/`how` and `day.N.note` are editable; coordinates, dates,
hotels and prices are not, because `verify.mjs` invariants depend on them and it
would never see a browser overlay. The server stamps `at`/`by` itself so authorship
cannot be forged. `/api/edit` sends **one day** to the model (~1–2k tokens), not the
whole file, and returns a proposal — it writes nothing.

Client side: `src/js/overlay.js` (state, persistence, sync), `edit-ui.js` (inline
fields, review tray, ask box), `comments.js` (anchors, panel). They decorate what
`plan.js` already rendered, keyed off `data-path` / `data-anchor` attributes, rather
than owning the render — so the document still works in full with Vercel down.

**Overlays and comments live in Redis, not in git.** `dist/` is committed; anything
typed on the site is not. Fold accepted edits back into `itinerary.json` through
chat periodically, or the two sources drift.

Secrets are set in the Vercel dashboard and **never written to the repo** (it is
public, and GitHub auto-revokes Anthropic keys pushed to public repos):
`ANTHROPIC_API_KEY`, `EDIT_PASSPHRASE`, `TOKEN_SECRET` (optional; falls back to the
passphrase), `ALLOWED_ORIGIN` (defaults to the Pages origin), plus the Upstash vars.

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
