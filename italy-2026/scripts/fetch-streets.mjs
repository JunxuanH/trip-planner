/**
 * Pulls real street geometry from OpenStreetMap for every place the trip
 * actually visits, and writes it to src/geo/streets.json.
 *
 * Stops are clustered, one Overpass query is issued per cluster, and the
 * detail level is chosen from how much ground the cluster covers — a dense
 * city centre gets alleys and pedestrian ways, a rural sweep gets only the
 * roads that matter at that scale. Building footprints are deliberately
 * never fetched: for one city centre they can outweigh every other layer
 * combined, for texture the streets and named piazzas already supply.
 *
 * Run manually (it hits a public API and takes a few minutes):
 *   node scripts/fetch-streets.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const trip = JSON.parse(readFileSync(join(root, 'data/itinerary.json'), 'utf8'));

// Public mirrors, tried in turn — one is usually healthy when another is not.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const UA = 'italy-2026-trip-planner/1.0 (personal itinerary map build)';
const OUT = join(root, 'src/geo/streets.json');

/* ── 1 · cluster the stops ──────────────────────────────────────────────── */

const KM_LAT = 111.32;
const kmBetween = (a, b) => {
  const dLat = (a[0] - b[0]) * KM_LAT;
  const dLng = (a[1] - b[1]) * KM_LAT * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
};

const coords = [];
for (const d of trip.days) for (const it of d.items) coords.push(it.coord);
for (const ht of trip.hotels) coords.push(ht.coord);

// Single-linkage: anything within 4 km joins the same map area.
const JOIN_KM = 4;
const clusters = [];
for (const c of coords) {
  const hit = clusters.find((cl) => cl.some((p) => kmBetween(p, c) <= JOIN_KM));
  if (hit) hit.push(c); else clusters.push([c]);
}
// Merge clusters that ended up adjacent.
let merged = true;
while (merged) {
  merged = false;
  outer:
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      if (clusters[i].some((a) => clusters[j].some((b) => kmBetween(a, b) <= JOIN_KM))) {
        clusters[i] = clusters[i].concat(clusters[j]);
        clusters.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
}

const areas = clusters.map((pts, i) => {
  const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1]);
  let s = Math.min(...lats), n = Math.max(...lats);
  let w = Math.min(...lngs), e = Math.max(...lngs);
  // Enough padding to pan into (~2 km around a single stop), but not so much
  // that a city-wide cluster balloons into a whole province.
  const padLat = Math.max((n - s) * 0.22, 0.009);
  const padLng = Math.max((e - w) * 0.22, 0.012);
  s -= padLat; n += padLat; w -= padLng; e += padLng;
  const widthKm = kmBetween([s, w], [s, e]);
  const heightKm = kmBetween([s, w], [n, w]);
  return { id: `a${i}`, bbox: [s, w, n, e], widthKm, heightKm, count: pts.length };
});

console.log(`${coords.length} stops → ${areas.length} areas`);
areas.forEach((a) => console.log(
  `  ${a.id}: ${a.widthKm.toFixed(1)} × ${a.heightKm.toFixed(1)} km, ${a.count} stops`));

/* ── 2 · geometry helpers ───────────────────────────────────────────────── */

const perp = (p, a, b) => {
  const [x, y] = p, [x1, y1] = a, [x2, y2] = b;
  const dx = x2 - x1, dy = y2 - y1;
  const d = dx * dx + dy * dy;
  if (d === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / d));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
};
const simplify = (pts, tol) => {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perp(pts[i], pts[lo], pts[hi]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([lo, idx], [idx, hi]); }
  }
  return pts.filter((_, i) => keep[i]);
};
const r5 = (v) => Math.round(v * 100000) / 100000;

/* Coordinates are stored as integers relative to each area's south-west
   corner, at 1e5 degrees (~1 m). "1234,567" instead of "12.48123,41.90045"
   roughly halves the file; the renderer adds the origin back. */
const SCALE_INT = 100000;
let ORIGIN = [0, 0];
const enc = (pts) => pts.map(([x, y]) => [
  Math.round((x - ORIGIN[0]) * SCALE_INT),
  Math.round((y - ORIGIN[1]) * SCALE_INT),
]);

/* ── 3 · road classes we care about ─────────────────────────────────────── */

// `service` (driveways, parking aisles) and `track` are deliberately absent:
// in a city centre they are the bulk of the ways and add nothing readable.
const ROAD_CLASS = {
  motorway: 0, motorway_link: 0, trunk: 0, trunk_link: 0,
  primary: 1, primary_link: 1,
  secondary: 2, secondary_link: 2,
  tertiary: 3, tertiary_link: 3,
  residential: 4, unclassified: 4, living_street: 4,
  pedestrian: 5,
  footway: 6, path: 6, steps: 6,
};

/** Rough length of a polyline in degrees, for dropping stubs. */
const spanOf = (pts) => {
  const [x0, y0, x1, y1] = [
    Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])),
    Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])),
  ];
  return Math.hypot(x1 - x0, y1 - y0);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let epIndex = 0;

async function overpass(query, label, tries = ENDPOINTS.length * 2) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const url = ENDPOINTS[epIndex % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA, Accept: 'application/json',
        },
        signal: AbortSignal.timeout(300000),
      });
      if (res.ok) return res.json();
      console.log(`    ${label}: ${res.status} from ${new URL(url).host}`);
    } catch (err) {
      console.log(`    ${label}: ${err.message.slice(0, 60)} (${new URL(url).host})`);
    }
    epIndex++;                       // rotate to the next mirror
    await sleep(8000 + attempt * 7000);
  }
  throw new Error(`overpass failed for ${label}`);
}

/* ── 4 · fetch each area (resumable) ────────────────────────────────────── */

const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const save = () => writeFileSync(OUT, JSON.stringify(out));

for (const area of areas) {
  if (out[area.id]) { console.log(`\n${area.id} — already fetched, skipping`); continue; }

  const [s, w, n, e] = area.bbox;
  const bb = `${s},${w},${n},${e}`;
  const big = area.widthKm > 18 || area.heightKm > 18;

  // Rural sweeps get through-roads only; city centres get everything.
  const highwayFilter = big
    ? '["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"]'
    : '["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian|footway|path|steps)(_link)?$"]';

  console.log(`\n${area.id} — ${big ? 'roads only (large area)' : 'full detail'}, ${area.widthKm.toFixed(1)}×${area.heightKm.toFixed(1)} km`);

  // Three lighter requests beat one that times out.
  const elements = [];

  let roadsData;
  try {
    roadsData = await overpass(
      `[out:json][timeout:280];(way${highwayFilter}(${bb}););out geom;`, `${area.id} roads`);
  } catch {
    console.log(`  ! roads unavailable for ${area.id} — leaving it for a later run`);
    continue; // no checkpoint, so re-running picks this area up again
  }
  elements.push(...roadsData.elements);
  console.log(`  roads query: ${roadsData.elements.length}`);
  await sleep(4000);

  try {
    const polyData = await overpass(
      `[out:json][timeout:280];(` +
      `way["natural"="water"](${bb});way["waterway"="riverbank"](${bb});` +
      `way["leisure"~"^(park|garden)$"](${bb});` +
      `way["landuse"~"^(grass|forest|cemetery|vineyard)$"](${bb});` +
      `way["place"="square"](${bb});` +
      `);out geom;`, `${area.id} polygons`, 4);
    elements.push(...polyData.elements);
    console.log(`  polygon query: ${polyData.elements.length}`);
  } catch {
    console.log(`  polygons unavailable — continuing with roads only`);
  }
  // Building footprints are deliberately NOT fetched: for a dense city centre
  // they outweigh every other layer combined (Rome alone ran ~900 KB of the
  // ~934 KB fetched), for texture the streets and named piazzas already supply.

  const data = { elements };
  console.log(`  ${data.elements.length} elements total`);

  ORIGIN = [w, s]; // integer encoding is relative to this area's SW corner
  const roads = [], green = [], water = [], squares = [];

  // Tolerances scale with the area so a wide rural map isn't stored at 3 m.
  const tolRoad = big ? 0.0004 : 0.00004;
  const tolPoly = big ? 0.0005 : 0.00005;

  for (const el of data.elements) {
    if (!el.geometry || el.geometry.length < 2) continue;
    const t = el.tags || {};
    const pts = el.geometry.map((g) => [g.lon, g.lat]);

    if (t.highway != null) {
      const cls = ROAD_CLASS[t.highway];
      if (cls == null) continue;
      // Drop unnamed footpath stubs — thousands of them, none legible.
      if (cls === 6 && !t.name && spanOf(pts) < 0.0006) continue;
      const line = simplify(pts, tolRoad);
      if (line.length < 2) continue;
      const rec = [cls, enc(line)];
      // Keep names only for streets big enough to label.
      if (t.name && cls <= 5) rec.push(t.name);
      roads.push(rec);
      continue;
    }
    if (t.place === 'square') {
      const poly = simplify(pts, tolPoly);
      if (poly.length >= 4) squares.push([enc(poly), t.name || '']);
      continue;
    }
    if (t.natural === 'water' || t.waterway === 'riverbank') {
      const poly = simplify(pts, tolPoly);
      if (poly.length >= 4) water.push(enc(poly));
      continue;
    }
    const poly = simplify(pts, tolPoly);
    if (poly.length >= 4) green.push(enc(poly));
  }

  out[area.id] = {
    origin: [r5(w), r5(s)],
    bbox: [r5(w), r5(s), r5(e), r5(n)],
    roads, green, water, squares,
  };
  console.log(`  kept: roads ${roads.length} · green ${green.length} · water ${water.length} · squares ${squares.length}`);

  save(); // checkpoint, so a mid-run failure doesn't cost the earlier areas
  await sleep(5000);
}

save();
const kb = (Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(0);
console.log(`\n✓ src/geo/streets.json — ${Object.keys(out).length} areas, ${kb} KB`);
