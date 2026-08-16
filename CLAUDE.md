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

**`plan.html` itself is gated now, not just editing.** Unlike `presentation.html` and
`shopping.html` (which still bundle `itinerary.json` at build time and stay fully
offline), `plan.js` no longer imports the itinerary at all — it fetches it live from
`GET /api/itinerary` after a valid `edit`-scope sign-in and renders nothing until
that succeeds (`boot()` at the bottom of `plan.js`; `overlay.js`'s `fetchItinerary()`/
`setTrip()`). This is a deliberate, page-scoped exception to the single-file/offline
design: this one page now needs one live API call before it can render anything, and
loses the "opens from `file://`, works on a plane with no signal" property for that
first load (a cached `sessionStorage` token skips the login screen on a same-session
reload, but not the fetch). See *The itinerary source: gated, and out of git* below
for where the data itself now lives.

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
`time`/`title`/`detail`/`how`/`skipped` and `day.N.note` are editable; coordinates,
dates, hotels and prices are not, because `verify.mjs` invariants depend on them and
it would never see a browser overlay. The server stamps `at`/`by` itself so
authorship cannot be forged. `/api/edit` sends **one day** to the model (~1–2k
tokens), not the whole file, and returns a proposal — it writes nothing (and does
not currently write `skipped` either — deleting a stop is a direct-manipulation-only
action, same restriction subitems' `deleted` has).

Client side: `src/js/overlay.js` (state, persistence, sync), `edit-ui.js` (inline
fields, review tray, ask box), `comments.js` (anchors, panel). They decorate what
`plan.js` already rendered, keyed off `data-path` / `data-anchor` attributes, rather
than owning the render — so the document still works in full with Vercel down.

**Overlays and comments live in Redis, not in git.** `dist/` is committed; anything
typed on the site is not. Fold accepted edits back into `itinerary.json` through
chat periodically, or the two sources drift.

**A stop's subitems live the same open-path way, with no fixed array slot.**
A subitem is a lightweight, timestamped aside nested under a stop — no
coord/kind/how/link of its own, since it shares its parent's map pin and
never gets one. Created live via a "+ Add subitem" button in edit mode, not a
rebuild: `day.N.items.I.subitems.<id>.{time,title,detail,deleted}` overlay
paths, `<id>` a client-minted string rather than an array index, discovered by
scanning path keys (`subitemsFor()` in `overlay.js`) rather than bounded by a
count the way item indices are. `deleted` is a tombstone flag, same mechanism
as an item's `done`/`skipped` — nothing is ever really removed from Redis.
The per-item cap (`MAX_SUBITEMS_PER_ITEM`, `api/_lib/schema.ts`) is enforced
in `api/overlay.ts` rather than inside `validatePatch` itself, because that
function is pure and has no view of the store. Folding one back into
`itinerary.json` means adding it to that item's optional `subitems` array
(`{id, time, title, detail?}`) — preserve the `s_...` id it was created with
if you can, though every read site tolerates a hand-written entry that
forgot to (falling back to a position-derived id).

**Deleting a top-level item reuses that same tombstone idea, on a field that
already existed.** Unlike a subitem, an item is a fixed array slot — there is
no id to mint or discard, so `deleteItem()`/`restoreItem()` in `overlay.js`
just set `day.N.items.I.skipped` true/false through the normal draft flow.
`edit-ui.js`'s `syncItemVisibility()` toggles a `.tl.is-skipped` class off
that flag (structural, like `syncSubitems()` — it hides time/title/detail/
subitems/tags together, so it can't be `repaint()`'s per-field sweep). CSS
does the rest: to a plain viewer the row is just gone; in edit mode it
collapses to a one-line "Removed — Undo" ghost instead, so the undo stays
reachable without knowing the path. A skipped item's map pin does not
move or disappear — `groupStops()` runs once over the static base
`TRIP.days[].items` at initial render and isn't overlay-reactive, the same
limitation coordinates/dates/prices have generally; folding the delete back
into `itinerary.json` (removing the array entry, or leaving `skipped: true`
if you'd rather keep the history) is what actually drops the pin.

Secrets are set in the Vercel dashboard and **never written to the repo** (it is
public, and GitHub auto-revokes Anthropic keys pushed to public repos):
`ANTHROPIC_API_KEY`, `EDIT_PASSPHRASE`, `TOKEN_SECRET` (optional; falls back to the
passphrase), `ALLOWED_ORIGIN` (defaults to the Pages origin), `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS` and `BLOB_READ_WRITE_TOKEN` (see below),
plus the Upstash vars.

### Auth scopes and the ticket vault

Signing in (`/api/session`, passphrase only) grants the `edit` scope — comments and
inline edits. A second factor upgrades that token to also carry `tickets`:
`/api/auth/google.ts` requires an existing `edit` token, exchanges an OAuth code for
a Google id token server-side (no Google SDK in the bundle — that would fail the
single-file build gate), and re-issues the token with `tickets` added only if the
verified email is on the `ALLOWED_EMAILS` allowlist. `requireAuth(req, res, need)` in
`api/_lib/auth.ts` is the gate every endpoint calls; missing the required scope is a
**403** (authenticated, just not upgraded), missing a token entirely is **401**.

The `tickets` scope guards `api/tickets.ts`, which streams booking PDFs (order
numbers, a GetYourGuide PIN, a Vatican voucher code — enough to cancel the trip) out
of Vercel Blob. The PDFs are **never in git** — `.gitignore` blocks `tickets-in/`
and `*.pdf` — and never inlined into `dist/`; they're the one part of the plan that
isn't self-contained, because they can't be. `api/tickets.ts` proxies the bytes
rather than redirecting to the blob URL, so `plan.html` still only ever talks to its
two allowlisted hosts. Labels/day-ordering live in `LABELS` in `api/_lib/tickets.ts`,
keyed by an id embedded in the blob pathname; `scripts/upload-tickets.mjs` maps a
provider's own downloaded filename to that id (see the table in
`TICKET-VAULT-SETUP.md`) and is idempotent — re-running replaces a ticket by id
rather than duplicating it.

Client side, `src/js/tickets.js` caches each opened PDF in IndexedDB so the drawer
keeps working offline after a first open on wifi — the ticket vault and the
itinerary fetch below (`GET /api/itinerary`) are the only network-dependent parts of
the plan.

`TICKET-VAULT-SETUP.md` is the one-time infra runbook (Google OAuth consent screen,
the four Vercel env vars, connecting Blob storage, uploading the PDFs) — it's
console/CLI work, not a code change, and says as much: if you find yourself editing
`api/` or `italy-2026/src/` to make the vault "work," stop, the feature is already
built.

### The itinerary source: gated, and out of git

`plan.html` no longer bundles `itinerary.json` — see *`plan.html` itself is gated
now* above. The real data also stopped being tracked in git entirely, for the same
reason the ticket PDFs aren't: this repo is public.

- **`italy-2026/data/itinerary.json` is local-only**, gitignored. It stays exactly
  where it always was on disk, and `npm run verify`/`build:html`/`build:xlsx` all
  keep reading it from that same path with no change — only its presence in git
  changed. `presentation.html`/`shopping.html` are still built from it and still
  ship the real data inlined, same as before; this gate is `plan.html`-only.
- **`italy-2026/data/itinerary.sample.json` is the committed placeholder** — same
  top-level shape, no real dates/hotels/prices, purely so the repo stays
  self-documenting about the schema. It is not read by any build script and not
  checked by `verify.mjs`.
- **The real data lives in Redis** for `api/itinerary.ts` to serve (key
  `italy2026:itinerary`, `readItinerary()`/`writeItinerary()` in
  `api/_lib/store.ts`) — `api/` deploys from this same repo, so anything it could
  `import` from a file would by definition be committed and public, the same
  reasoning that puts the ticket PDFs in Blob rather than in git.
- **`node --env-file=.env.local scripts/upload-itinerary.mjs`** is how a local edit
  reaches the live page: it pushes the current local `itinerary.json` into Redis.
  Run it after every content change you want live — a `git push` alone no longer
  does anything for `plan.html`'s content, only for `presentation.html`/
  `shopping.html`/`dist/` and the code itself.
- **Residual limit, explicit:** untracking the file did not rewrite git history —
  every earlier commit that touched `data/itinerary.json`, and every earlier
  `dist/plan.html` commit (from before this change) with old itinerary content
  inlined, still has it in the log. A real scrub needs `git filter-repo` or
  equivalent plus a force-push and everyone re-cloning; that has not been done.

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
- Booking PDFs never go in git. `.gitignore` blocks `tickets-in/` and `*.pdf`; they
  go to Vercel Blob via `scripts/upload-tickets.mjs` instead (see *Auth scopes and
  the ticket vault*).
- The real `italy-2026/data/itinerary.json` never goes in git either. `.gitignore`
  blocks it by exact path; it goes to Redis via `scripts/upload-itinerary.mjs`
  instead (see *The itinerary source: gated, and out of git*). The committed
  `itinerary.sample.json` alongside it is a placeholder, not the real file.
