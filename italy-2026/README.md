# Italy 2026 — itinerary

Rome → Florence → Tuscany (Il Castelfalfi) → Amalfi Coast → Naples → Rome.
Mon 24 Aug – Sun 6 Sep 2026 · 13 nights · 2 travellers. Self-drive, FCO to FCO.

## Deliverables

| File | What it is |
|---|---|
| `dist/plan.html` | The working plan. Day-by-day timelines paired with interactive street maps, every booking link, illustrated hotel cards, a self-drive log, a prioritised booking list, budget. Prints to PDF. |
| `dist/presentation.html` | A 20-slide deck for sharing. Opens on a 3D Italy with the route drawn on, then one slide per day, the six hotels, logistics, budget, and a booking checklist. |
| `dist/Italy 2026 (revised).xlsx` | The same seven tabs as the original workbook, with corrected booking URLs. |

Both HTML files are **single self-contained files** — CSS, JavaScript, the
itinerary, the map geometry, the illustrations and three.js are all inlined,
and nothing is fetched at runtime. They open by double-click, work offline,
and survive being emailed. Your `Downloads` copy of the original workbook is
untouched; an archive copy sits in `data/`.

## Maps

Each day's map is drawn from real OpenStreetMap geometry for that place — the
street network, named piazzas, parks and water (building footprints are
deliberately not fetched: in a dense city centre they can outweigh every
other layer combined, for texture the streets and piazzas already supply).
Drag to pan, scroll to zoom; how much is drawn depends on the scale, so
zooming into Rome brings up alleys and street names, while a transfer day
shows the through-roads and the coast. Pins that would collide are merged
and split apart again as you zoom in — click any pin, or any timeline item
on `plan.html`, for a popup with what the place is and links to it. Clicking
a timeline item also flies the map in to that stop specifically. Nothing is
fetched at runtime — the vector data is embedded, which is why the files are
a few megabytes.

## Illustrations

The six hotel cards and the arrival-day banners carry **original
screen-print-style artwork**, generated for this document and labelled
*Illustration* wherever it appears. They evoke each place; they are **not
photographs of the properties**. Every card links through to the hotel's real
Trip.com gallery for actual photos.

## Rebuilding

```bash
npm install
npm run build      # verify, then both HTML files and the workbook
```

Individually: `npm run verify`, `npm run build:html`, `npm run build:xlsx`.

`data/itinerary.json` is the single source of truth — all three outputs are
generated from it. Edit it, then rebuild.

`scripts/verify.mjs` asserts the things that are easy to break when dates or
stops change: 14 days with strictly increasing dates and correct weekdays, a
contiguous hotel chain summing to 13 nights, every activity geocoded inside
Italy, each day's named hotel matching the chain for that night, times
running forward within a day, and every Trip.com URL's `checkIn`/`checkOut`
matching its hotel row. `scripts/build.mjs` additionally fails the build if
either page picks up a reference to the network.

## Map data

Country outline from **Natural Earth** 1:50m (public domain), in
`src/geo/italy.json`. Everything else — the street network, named piazzas,
parks, water, the coastline and the rivers — comes from **OpenStreetMap** via
Overpass (© OpenStreetMap contributors,
[ODbL](https://www.openstreetmap.org/copyright)), simplified with
Douglas–Peucker and stored in `src/geo/streets.json`.

Positions are true Web Mercator, so relative geography is honest; the styling
is deliberately illustrative. There are no map tiles — tiles would need the
network, and these files have to work offline.

To refresh the street data:

```bash
node scripts/fetch-streets.mjs
```

It clusters the itinerary's stops into map areas, queries one area at a time,
and checkpoints after each — so it is safe to interrupt and re-run, and it
skips areas it already has. Public Overpass mirrors are frequently overloaded;
the script rotates between four of them.
