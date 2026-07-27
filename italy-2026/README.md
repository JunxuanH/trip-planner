# Italy 2026 — revised itinerary

Rome → **Florence → Val d'Orcia** → Amalfi → Naples → Rome.
Mon 24 Aug – Sun 6 Sep 2026 · 13 nights · 2 travellers.

Rebuilt from `Italy 2026.xlsx` with the middle two stops swapped. The original
ran Rome → Val d'Orcia → Florence, which drove north past Florence, doubled
back up to it, then ran the length of the country south to Naples. Reversing
those two makes Florence the northernmost point and puts the Val d'Orcia
directly on the way south — roughly **two hours less driving**.

## Deliverables

| File | What it is |
|---|---|
| `dist/plan.html` | The working plan. Day-by-day timelines paired with interactive maps, every booking link, hotels, logistics, a prioritised booking list, budget. Prints to PDF. |
| `dist/presentation.html` | A 22-slide deck for sharing. Opens on a 3D Italy with the route drawn on, compares the old routing against the new, then one slide per day. |
| `dist/Italy 2026 (revised).xlsx` | The same seven tabs as the original workbook, reordered, with the booking URLs corrected. |

Both HTML files are **single self-contained files** — CSS, JavaScript, the
itinerary, the map geometry and three.js are all inlined, and nothing is
fetched at runtime. They open by double-click, work offline, and survive
being emailed. Your `Downloads` copy of the original workbook is untouched;
an archive copy sits in `data/`.

## What moved

| | Was | Now |
|---|---|---|
| Casa G. Firenze (Florence) | 30 Aug → 1 Sep | **27 Aug → 29 Aug** |
| Castello di Velona (Tuscany) | 27 Aug → 30 Aug | **29 Aug → 1 Sep** |

Night counts are unchanged: Rome 3 · Florence 2 · Val d'Orcia 3 · Amalfi 3 ·
Naples 1 · Rome 1.

**New legs.** Aug 29 Florence → **Siena** → Velona (Siena sits directly on the
road and cost nothing to add). Sep 1 Velona → Roma Termini, then Frecciarossa
Rome → Naples, replacing the old Florence → Naples train. The old Aug 30
Velona → Florence transfer is cancelled.

**Days 7 and 8 traded places.** A straight shift would have put the Brunello
winery day on Sunday 30 Aug, when most Montalcino estates are closed or
appointment-only. The town-based Val d'Orcia drive takes Sunday instead, and
the wineries take Monday.

**Reservations that moved dates.** Sostanza and the St. Mark's opera → 27 Aug ·
Il Santo Bevitore and Borgo San Jacopo → 28 Aug · Settimo Senso → 29 Aug ·
Latte di Luna and La Botte Piena → 30 Aug · Montalcino wineries → 31 Aug.

**Two casualties.** *Trattoria Mario* is lunch-only and no longer fits — 27 Aug
lunch is in Orvieto, 28 Aug lunch is in the Oltrarno — so it is kept only as an
alternate. And 27 Aug is the tightest evening of the trip: a 4.5-hour drive
with a stop, then an 8pm curtain. The fallback (move the opera to 28 Aug) is
noted inline on that day.

## Corrections found while reordering

These were already wrong in the source workbook, not caused by the swap:

- The Rome finale hotel was **"The Edition"** on the Hotels tab but **The St. Regis Rome** in the itinerary, the drivers tab and the booking URL. Normalised to St. Regis — still Marriott Bonvoy.
- The Budget tab carried lodging as **12,270** against the Hotels tab's **12,720**. The hotel rows add to 12,720; the budget line was the typo.
- The Photographers tab numbered Amalfi as days 4–6 and Florence as 11–12, matching no version of the route. Renumbered.
- The Overview route line **omitted Tuscany entirely**.
- The bookings tab referenced a *"Nomos Hotel Rome"* (the Rome hotel is Hotel Trame) and a doubled *"De Bonart Naples Naples"*.

Revised transport estimate is **$3,400** (was $3,100) — the Siena leg and the
Velona → Rome transfer are new, partly offset by two shorter train legs.
Revised total **$21,020**. All figures are estimates, cash, before points.

## Rebuilding

```bash
npm install
npm run build      # verify, then both HTML files and the workbook
```

Individually: `npm run verify`, `npm run build:html`, `npm run build:xlsx`.

`data/itinerary.json` is the single source of truth — all three outputs are
generated from it. Edit it, then rebuild.

`scripts/verify.mjs` asserts the things that are easy to break when dates move:
14 days with strictly increasing dates and correct weekdays, a contiguous hotel
chain summing to 13 nights, every activity geocoded inside Italy, each day's
named hotel matching the chain for that night, times running forward within a
day, and every Trip.com URL's `checkIn`/`checkOut` matching its hotel row.
`scripts/build.mjs` additionally fails the build if either page picks up a
reference to the network.

## Map data

Country outline from **Natural Earth** 1:50m (public domain). The Campania
coastline and the Tiber and Arno centrelines from **OpenStreetMap** via
Overpass (© OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright)),
simplified with Douglas–Peucker and stored in `src/geo/italy.json`.

Positions are true Web Mercator, so relative geography is honest; the styling
is deliberately illustrative. There are no map tiles — tiles would need the
network, and these files have to work offline.
