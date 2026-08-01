/* ── mapengine ─────────────────────────────────────────────────────────────
   A small SVG cartography engine. No tiles, no network — the page has to work
   offline and from a file:// URL, so everything is drawn from vector geometry
   embedded at build time: Natural Earth for the country outline, and OSM for
   the street network, buildings, parks, water and piazzas of every place the
   trip actually visits.

   Positions are true Web Mercator. What gets drawn depends on how much ground
   is in view — a country-scale view shows the coastline, a street-scale view
   shows alleys and building footprints.
   ------------------------------------------------------------------------ */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Web Mercator, in degrees-ish units so x stays comparable to longitude. */
export function project([lat, lng]) {
  const y = (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [lng, -y]; // negate: SVG y grows downward
}
const projY = (lat) => -(180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

const el = (name, attrs = {}) => {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  return n;
};

export const PIN_COLORS = {
  sight:     'var(--terracotta)',
  meal:      'var(--gold)',
  wine:      'var(--olive)',
  opera:     'var(--plum)',
  photo:     'var(--tyrrhenian)',
  hotel:     'var(--ink)',
  transport: 'var(--ink-3)',
  rest:      'var(--ink-3)',
  work:      'var(--ink-2)',
};

export const PIN_LABELS = {
  sight: 'Sight', meal: 'Food & drink', wine: 'Wine', opera: 'Music',
  photo: 'Photo stop', hotel: 'Hotel', transport: 'Travel', rest: 'Downtime',
  work: 'Desk hours',
};

/* ── geometry helpers ───────────────────────────────────────────────────── */

const bboxOf = (pts) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
};

const boxesOverlap = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

const toPath = (pts, close = false) => {
  let d = '';
  for (let i = 0; i < pts.length; i++) d += `${i ? 'L' : 'M'}${pts[i][0].toFixed(5)} ${pts[i][1].toFixed(5)}`;
  return d + (close ? 'Z' : '');
};

const arcPath = (a, b, bow = 0.18) => {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const cx = mx - dy * bow, cy = my + dx * bow;
  return `M${a[0].toFixed(4)} ${a[1].toFixed(4)}Q${cx.toFixed(4)} ${cy.toFixed(4)} ${b[0].toFixed(4)} ${b[1].toFixed(4)}`;
};

/* ── one-time preparation, shared by every map on the page ──────────────── */

let PREPPED = null;
function prepGeo(geo) {
  if (PREPPED) return PREPPED;
  const conv = (line) => line.map(([lng, lat]) => [lng, projY(lat)]);
  const withBox = (pts) => ({ pts, box: bboxOf(pts) });
  PREPPED = {
    land:   (geo.italy || []).map((r) => withBox(conv(r))),
    coast:  (geo.coast || []).map((s) => withBox(conv(s))),
    rivers: Object.entries(geo.rivers || {}).flatMap(([name, segs]) =>
      segs.map((s) => ({ name, ...withBox(conv(s)) }))),
  };
  return PREPPED;
}

let STREETS = null;

/**
 * Street geometry ships as integers relative to each area's south-west corner
 * at 1e5 degrees (~1 m) — roughly half the bytes of decimal strings. Decode
 * once, project once, and cache boxes so drawing can cull by viewport.
 */
const INT_SCALE = 1e5;

function prepStreets(streets) {
  if (STREETS || !streets) return STREETS;
  const withBox = (pts) => ({ pts, box: bboxOf(pts) });
  STREETS = {};
  for (const [id, a] of Object.entries(streets)) {
    const [ox, oy] = a.origin;
    const conv = (line) => line.map(([x, y]) => [ox + x / INT_SCALE, projY(oy + y / INT_SCALE)]);
    const [w, s, e, n] = a.bbox;
    STREETS[id] = {
      box: [w, projY(n), e, projY(s)],
      roads: a.roads.map(([cls, line, name]) => ({ cls, name, ...withBox(conv(line)) })),
      buildings: (a.buildings || []).map((p) => withBox(conv(p))),
      green: (a.green || []).map((p) => withBox(conv(p))),
      water: (a.water || []).map((p) => withBox(conv(p))),
      squares: (a.squares || []).map(([p, name]) => ({ name, ...withBox(conv(p)) })),
    };
  }
  return STREETS;
}

/* ── how much detail belongs at a given scale ───────────────────────────── */

// view.w is the horizontal span in degrees of longitude. ~0.012° ≈ 1 km.
// Classes: 0 motorway · 1 primary · 2 secondary · 3 tertiary · 4 residential
//          5 pedestrian · 6 footway/steps
//
// The thresholds matter as much as the widths: draw every residential street
// of central Rome at a 3 km view and ten thousand strokes merge into a solid
// mat. Minor roads only appear once there is room for them to read as roads.
const SCALE = [
  { max: 0.008, classes: 6, buildings: true,  labels: true,  squares: true,
    w: [10, 8, 6.5, 5, 3.6, 3.6, 1.4] },
  { max: 0.025, classes: 6, buildings: true,  labels: true,  squares: true,
    w: [7, 5.5, 4.2, 3.2, 2.2, 2.2, 1.0] },
  { max: 0.07,  classes: 3, buildings: false, labels: true,  squares: true,
    w: [4.5, 3.4, 2.4, 1.6] },
  { max: 0.2,   classes: 2, buildings: false, labels: false, squares: false,
    w: [3, 2.2, 1.4] },
  { max: 0.7,   classes: 1, buildings: false, labels: false, squares: false,
    w: [2.4, 1.6] },
];
const levelFor = (span) => SCALE.find((l) => span <= l.max) || null;

/* ── the map ────────────────────────────────────────────────────────────── */

export function createMap(host, opts) {
  const { stops, geo, streets, onPick } = opts;
  const G = prepGeo(geo);
  const S = prepStreets(streets);

  const svg = el('svg', { class: 'map-svg', role: 'img', 'aria-label': opts.alt || 'Map of the day' });
  const gBase  = el('g', { class: 'map-base' });
  const gRoute = el('g', { class: 'map-route' });
  const gLabel = el('g', { class: 'map-labels' });
  const gPins  = el('g', { class: 'map-pins' });
  svg.append(gBase, gRoute, gLabel, gPins);
  host.append(svg);

  const P = stops.map((s) => project(s.coord));

  /* — initial view — */
  let [x0, y0, x1, y1] = bboxOf(P);
  let w = x1 - x0, h = y1 - y0;
  const minSpan = 0.012;
  if (w < minSpan) { const c = (x0 + x1) / 2; x0 = c - minSpan / 2; x1 = c + minSpan / 2; w = minSpan; }
  if (h < minSpan) { const c = (y0 + y1) / 2; y0 = c - minSpan / 2; y1 = c + minSpan / 2; h = minSpan; }
  const pad = Math.max(w, h) * 0.22;
  const HOME = { x: x0 - pad, y: y0 - pad, w: w + pad * 2, h: h + pad * 2 };

  let view = { ...HOME };

  /** Stretch `box` to the host's on-screen aspect ratio without mutating it —
      shared by the initial fit (which does mutate `view`) and reset() (which
      flies to a target computed independently of whatever `view` is right now). */
  function fittedBox(box) {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return { ...box };
    const target = r.width / r.height;
    const cur = box.w / box.h;
    const out = { ...box };
    if (cur < target) { const nw = out.h * target; out.x -= (nw - out.w) / 2; out.w = nw; }
    else              { const nh = out.w / target; out.y -= (nh - out.h) / 2; out.h = nh; }
    return out;
  }
  const fitAspect = () => { view = fittedBox(view); };

  /* — which OSM area(s) cover what we're looking at —
     A day's stops can span two fetched areas more than the clustering radius
     apart (a resort and a village 19 km away, say): picking only the single
     area under the view's centre left the other stop's surroundings blank,
     with just a sliver of the wrong area's ground tint bleeding into frame.
     Drawing every area that overlaps the view fixes both stops at once. */
  function areasForView() {
    if (!S) return [];
    // An area with almost nothing in it (an airport apron, say) would paint a
    // blank slab over the coastline — better to fall through to the outline.
    const usable = Object.values(S).filter((a) => a.roads.length >= 8);
    const vb = [view.x, view.y, view.x + view.w, view.y + view.h];
    return usable.filter((a) => boxesOverlap(a.box, vb));
  }

  /* — basemap — */
  let drawnFor = null; // the view we last painted, so panning can reuse it

  function drawBase() {
    const span = view.w;
    const grow = 0.45;
    const vbPad = [
      view.x - view.w * grow, view.y - view.h * grow,
      view.x + view.w * (1 + grow), view.y + view.h * (1 + grow),
    ];

    gBase.textContent = '';
    gLabel.textContent = '';

    drawGraticule();

    const level = levelFor(span);
    const areas = level ? areasForView() : [];

    if (!areas.length) {
      // No street data here (or we're zoomed way out): country outline + coast.
      if (span > 0.5) {
        for (const { pts, box } of G.land) {
          if (!boxesOverlap(box, vbPad)) continue;
          gBase.append(el('path', { d: toPath(pts, true), class: 'geo-land' }));
        }
      } else {
        drawCoastAndRivers(vbPad);
      }
      drawnFor = { ...view };
      return;
    }

    /* Every layer is emitted as ONE path holding many subpaths. Ten thousand
       separate <path> nodes brings the main thread to a halt; one node per
       layer draws the same picture and stays interactive. */
    const r = host.getBoundingClientRect();
    const u = r.width ? view.w / r.width : view.w / 400;
    const tiny = u * 1.6; // anything under ~1.6 px across is not worth a subpath

    const batch = (feats, cls, closed = true, minSize = tiny) => {
      let d = '';
      for (const f of feats) {
        if (!boxesOverlap(f.box, vbPad)) continue;
        if (minSize && Math.max(f.box[2] - f.box[0], f.box[3] - f.box[1]) < minSize) continue;
        d += toPath(f.pts, closed);
      }
      if (d) gBase.append(el('path', { d, class: cls }));
    };

    /* land tint under everything, so streets read as carved out of a block —
       one rect per area, so the (possibly empty) gap between two areas stays
       untinted instead of one giant rect implying coverage that isn't there */
    for (const area of areas) {
      gBase.append(el('rect', {
        x: area.box[0], y: area.box[1],
        width: area.box[2] - area.box[0], height: area.box[3] - area.box[1],
        class: 'st-ground',
      }));
    }

    batch(areas.flatMap((a) => a.green), 'st-green');
    batch(areas.flatMap((a) => a.water), 'st-water');
    drawCoastAndRivers(vbPad);
    if (level.squares) batch(areas.flatMap((a) => a.squares), 'st-square', true, 0);
    if (level.buildings) batch(areas.flatMap((a) => a.buildings), 'st-buildings');

    /* roads: a casing pass then a fill pass, so junctions knit together */
    const byClass = new Map();
    for (const area of areas) {
      for (const rd of area.roads) {
        if (rd.cls > level.classes) continue;
        if (!boxesOverlap(rd.box, vbPad)) continue;
        if (Math.max(rd.box[2] - rd.box[0], rd.box[3] - rd.box[1]) < tiny) continue;
        if (!byClass.has(rd.cls)) byClass.set(rd.cls, '');
        byClass.set(rd.cls, byClass.get(rd.cls) + toPath(rd.pts));
      }
    }
    const classes = [...byClass.keys()].sort((a, b) => b - a); // minor first
    for (const pass of ['case', 'fill']) {
      const g = el('g', { class: pass === 'case' ? 'st-road-case' : 'st-road-fill' });
      for (const cls of classes) {
        const width = level.w[cls] ?? 1;
        // A casing under a hairline just thickens it into mush.
        if (pass === 'case' && width < 1.3) continue;
        g.append(el('path', {
          d: byClass.get(cls), class: `rc rc-${cls}`,
          'stroke-width': pass === 'case' ? width + Math.min(1.4, width * 0.5) : width,
        }));
      }
      gBase.append(g);
    }

    if (level.labels) for (const area of areas) drawLabels(area, vbPad, level);
    drawnFor = { ...view };
  }

  function drawCoastAndRivers(vbPad) {
    for (const { pts, box } of G.coast) {
      if (!boxesOverlap(box, vbPad)) continue;
      const d = toPath(pts);
      gBase.append(el('path', { d, class: 'geo-coast-halo' }));
      gBase.append(el('path', { d, class: 'geo-coast' }));
    }
    if (view.w <= 0.5) {
      for (const { pts, box } of G.rivers) {
        if (!boxesOverlap(box, vbPad)) continue;
        const d = toPath(pts);
        gBase.append(el('path', { d, class: 'geo-river-halo' }));
        gBase.append(el('path', { d, class: 'geo-river' }));
      }
    }
  }

  /* — street and piazza names —
     Deliberately NOT <textPath>: a reference that fails to resolve drops its
     text at (0,0), tens of user units away from the map, which inflates the
     SVG's content box so far that the browser stops painting whole layers.
     A rotated <text> at the road's midpoint is simpler and can't do that. */
  function drawLabels(area, vbPad, level) {
    const r = host.getBoundingClientRect();
    const u = r.width ? view.w / r.width : view.w / 400;
    const seen = new Set();
    let placed = 0;

    /* Piazzas first. A piazza is usually tagged twice — as a square polygon
       and as a named pedestrian way — so claiming the name here stops the
       road pass from stamping it a second time at an angle. */
    for (const sq of area.squares) {
      if (!sq.name || seen.has(sq.name) || !boxesOverlap(sq.box, vbPad)) continue;
      const cx = (sq.box[0] + sq.box[2]) / 2, cy = (sq.box[1] + sq.box[3]) / 2;
      if ((sq.box[2] - sq.box[0]) / u < 26) continue;
      if (cx < view.x || cx > view.x + view.w || cy < view.y || cy > view.y + view.h) continue;
      seen.add(sq.name);
      const t = el('text', {
        class: 'st-label st-square-label', x: cx, y: cy,
        'text-anchor': 'middle', 'font-size': 10 * u,
      });
      t.textContent = sq.name;
      gLabel.append(t);
    }

    // Longest roads first: they carry the names worth showing.
    const named = area.roads
      .filter((rd) => rd.name && rd.cls <= 5 && boxesOverlap(rd.box, vbPad))
      .map((rd) => ({ rd, len: (rd.box[2] - rd.box[0]) + (rd.box[3] - rd.box[1]) }))
      .sort((a, b) => b.len - a.len);

    for (const { rd, len } of named) {
      if (placed > 22) break;
      if (seen.has(rd.name)) continue;
      // Only label a street long enough to carry the text.
      if (len / u < rd.name.length * 6.4) continue;

      const pts = rd.pts;
      const mid = Math.max(1, Math.floor(pts.length / 2));
      const a = pts[mid - 1], b = pts[mid];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if (mx < view.x || mx > view.x + view.w || my < view.y || my > view.y + view.h) continue;

      let deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      if (deg > 90) deg -= 180;
      if (deg < -90) deg += 180;

      seen.add(rd.name);
      const t = el('text', {
        class: 'st-label', x: mx, y: my, 'text-anchor': 'middle',
        'font-size': 10.5 * u, dy: -2.6 * u,
        transform: `rotate(${deg.toFixed(1)} ${mx} ${my})`,
      });
      t.textContent = rd.name;
      gLabel.append(t);
      placed++;
    }
  }

  const NICE = [10, 5, 2, 1, .5, .25, .1, .05, .025, .01, .005, .002, .001];
  function drawGraticule() {
    if (view.w < 0.05) return; // pointless once streets are the grid
    const step = NICE.find((s) => view.w / s <= 9) ?? NICE[NICE.length - 1];
    const g = el('g', { class: 'geo-grid' });
    const gx = Math.floor(view.x / step) * step;
    const gy = Math.floor(view.y / step) * step;
    for (let x = gx; x <= view.x + view.w; x += step) {
      g.append(el('line', { x1: x, y1: view.y, x2: x, y2: view.y + view.h }));
    }
    for (let y = gy; y <= view.y + view.h; y += step) {
      g.append(el('line', { x1: view.x, y1: y, x2: view.x + view.w, y2: y }));
    }
    gBase.append(g);
  }

  /* — scale bar — */
  const scaleEl = document.createElement('div');
  scaleEl.className = 'map-scale';
  scaleEl.innerHTML = '<i></i><b></b>';
  host.append(scaleEl);

  const KM_PER_DEG = 111.32;
  const ROUND = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
  function drawScale() {
    const r = host.getBoundingClientRect();
    if (!r.width) return;
    const latRad = 2 * Math.atan(Math.exp((-(view.y + view.h / 2) * Math.PI) / 180)) - Math.PI / 2;
    const kmAcross = view.w * KM_PER_DEG * Math.cos(latRad);
    const km = ROUND.find((v) => v >= kmAcross * 0.25) ?? ROUND[ROUND.length - 1];
    const frac = km / kmAcross;
    scaleEl.querySelector('i').style.width = `${(frac * 100).toFixed(1)}%`;
    scaleEl.querySelector('b').textContent = km < 1 ? `${Math.round(km * 1000)} m` : `${km} km`;
    scaleEl.style.opacity = frac > 0.85 ? '0' : '1';
  }

  /* — route — */
  const legs = [];
  for (let i = 1; i < P.length; i++) legs.push([i - 1, i]);
  const useArcs = Math.max(HOME.w, HOME.h) > 0.25;

  function drawRoute() {
    gRoute.textContent = '';
    for (const [a, b] of legs) {
      const d = useArcs ? arcPath(P[a], P[b]) : toPath([P[a], P[b]]);
      gRoute.append(el('path', { d, class: 'route-line' + (useArcs ? ' is-arc' : '') }));
    }
  }

  /* — pins, merged when they'd collide on screen — */
  const MERGE_PX = 30;
  let clusters = [];
  let activeStopIdx = -1;

  function buildClusters(u) {
    const tol = MERGE_PX * u;
    const out = [];
    stops.forEach((s, i) => {
      const [x, y] = P[i];
      const near = out.find((c) => Math.hypot(c.x - x, c.y - y) <= tol);
      if (near) {
        near.idx.push(i);
        near.x = near.idx.reduce((a, k) => a + P[k][0], 0) / near.idx.length;
        near.y = near.idx.reduce((a, k) => a + P[k][1], 0) / near.idx.length;
        if (rank(s.kind) > rank(near.kind)) { near.kind = s.kind; near.label = s.label; }
      } else out.push({ x, y, idx: [i], kind: s.kind, label: s.label });
    });
    for (const c of out) {
      const nums = c.idx.flatMap((k) => stops[k].nums).sort((a, b) => a - b);
      c.nums = nums;
      c.text = nums.length === 1 ? String(nums[0])
        : nums.length === nums[nums.length - 1] - nums[0] + 1 ? `${nums[0]}–${nums[nums.length - 1]}`
        : `${nums[0]}+`;
    }
    return out;
  }

  function renderPins(u) {
    clusters = buildClusters(u);
    gPins.textContent = '';
    const R = 13 * u, RH = 21 * u;
    clusters.forEach((c) => {
      const many = c.idx.length > 1;
      const g = el('g', {
        class: 'pin' + (many ? ' is-cluster' : ''), tabindex: '0', role: 'button',
        'aria-label': many ? `Stops ${c.nums.join(', ')} — open details` : `${c.nums.join(', ')}. ${c.label}`,
        transform: `translate(${c.x.toFixed(5)} ${c.y.toFixed(5)})`,
      });
      g.style.setProperty('--pin', PIN_COLORS[c.kind] || 'var(--terracotta)');
      g.append(el('circle', { class: 'pin-halo', r: RH }));
      g.append(el('circle', { class: 'pin-dot', r: many ? R * 1.15 : R }));
      const t = el('text', {
        class: 'pin-num', y: 4.6 * u, 'text-anchor': 'middle',
        'font-size': (c.text.length > 3 ? 10.5 : 13) * u,
      });
      t.textContent = c.text;
      g.append(t);
      if (c.idx.includes(activeStopIdx)) g.classList.add('is-active');

      const pick = () => { showPopup(c); onPick?.(many ? null : c.idx[0]); };
      g.addEventListener('click', (e) => { e.stopPropagation(); pick(); });
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
      gPins.append(g);
    });
  }

  /* — info popup —
     Click any pin (single stop or merged cluster) for a card with what the
     place is, plus a Google Maps link (always available, built from the
     stop's own coordinates) and the itinerary's own booking/info link when
     there is one. Appended to <body> with position:fixed rather than into
     `host` — the frame has overflow:hidden for the map itself, which would
     otherwise clip a popup that opens near an edge. */

  const popupEl = document.createElement('div');
  popupEl.className = 'pin-popup';
  popupEl.hidden = true;
  document.body.append(popupEl);

  let openStopIdx = null;
  let openClusterKey = null;

  const gmapsUrl = ([lat, lng]) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

  function popupRow(it) {
    const row = document.createElement('div');
    row.className = 'pin-popup-item';

    const head = document.createElement('div');
    head.className = 'pin-popup-head';
    const time = document.createElement('span');
    time.className = 'pin-popup-time';
    time.textContent = it.time;
    const kind = document.createElement('span');
    kind.className = 'pin-popup-kind';
    kind.textContent = PIN_LABELS[it.kind] || it.kind;
    head.append(time, kind);

    const title = document.createElement('div');
    title.className = 'pin-popup-title';
    title.textContent = it.title;
    row.append(head, title);

    if (it.detail) {
      const d = document.createElement('div');
      d.className = 'pin-popup-detail';
      d.textContent = it.detail;
      row.append(d);
    }

    const links = document.createElement('div');
    links.className = 'pin-popup-links';
    const gm = document.createElement('a');
    gm.href = gmapsUrl(it.coord);
    gm.target = '_blank';
    gm.rel = 'noopener noreferrer';
    gm.textContent = 'Google Maps';
    links.append(gm);
    if (it.link) {
      const site = document.createElement('a');
      site.href = it.link;
      site.target = '_blank';
      site.rel = 'noopener noreferrer';
      site.textContent = it.linkLabel || 'Website';
      links.append(site);
    }
    row.append(links);
    return row;
  }

  function showPopup(c) {
    openStopIdx = c.idx[0];
    openClusterKey = c.idx.join(',');

    popupEl.textContent = '';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pin-popup-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', (e) => { e.stopPropagation(); hidePopup(); });
    popupEl.append(close);

    const body = document.createElement('div');
    body.className = 'pin-popup-body';
    // A cluster's `idx` points into `stops`; each stop already carries the
    // original itinerary item(s) that share its exact coordinates.
    c.idx.flatMap((k) => stops[k].items).forEach((it) => body.append(popupRow(it)));
    popupEl.append(body);

    if (c.idx.length > 1) {
      const zoomBtn = document.createElement('button');
      zoomBtn.type = 'button';
      zoomBtn.className = 'pin-popup-zoom';
      zoomBtn.textContent = `Zoom in to see all ${c.idx.length} ↗`;
      zoomBtn.addEventListener('click', (e) => { e.stopPropagation(); zoomToCluster(c); });
      popupEl.append(zoomBtn);
    }

    popupEl.hidden = false;
    positionPopup(c);
  }

  function hidePopup() {
    openStopIdx = null;
    openClusterKey = null;
    popupEl.hidden = true;
  }

  function positionPopup(c) {
    const r = host.getBoundingClientRect();
    if (!r.width) return;
    const px = r.left + ((c.x - view.x) / view.w) * r.width;
    const py = r.top + ((c.y - view.y) / view.h) * r.height;
    const above = py - 170 > 8; // enough headroom above in the viewport
    const half = 140;
    const clampedX = Math.min(Math.max(px, half + 8), innerWidth - half - 8);
    popupEl.style.left = `${clampedX}px`;
    popupEl.style.top = `${py}px`;
    popupEl.classList.toggle('is-above', above);
    popupEl.classList.toggle('is-below', !above);
  }

  /** Called after every pan/zoom so an open popup tracks its pin. */
  function updateOpenPopup() {
    if (openStopIdx == null) return;
    const c = clusters.find((cl) => cl.idx.includes(openStopIdx));
    if (!c) { hidePopup(); return; }
    if (c.idx.join(',') !== openClusterKey) { showPopup(c); return; }
    positionPopup(c);
  }

  const closeOnScroll = () => hidePopup();
  document.addEventListener('scroll', closeOnScroll, { capture: true, passive: true });
  addEventListener('resize', closeOnScroll);
  const closeOnEscape = (e) => { if (e.key === 'Escape') hidePopup(); };
  document.addEventListener('keydown', closeOnEscape);

  /* — flying the view somewhere, instead of snapping —
     An SVG viewBox can't be handed to a CSS transition, so panning to a stop
     picked from the timeline is tweened by hand: interpolate x/y/w/h over a
     few hundred ms and repaint pins every frame. The (possibly expensive)
     basemap redraw stays on its normal debounce and only snaps in once, on
     the settled final frame — repainting streets every frame of a fly would
     just be wasted work under motion nobody can read anyway. */
  let flyToken = 0;
  function flyTo(target, duration = 520) {
    const from = { ...view };
    const token = ++flyToken;
    const t0 = performance.now();
    const ease = (t) => 1 - (1 - t) ** 3;
    (function step(now) {
      if (token !== flyToken) return; // a newer flight took over
      const t = Math.min(1, (now - t0) / duration);
      const k = ease(t);
      view.x = from.x + (target.x - from.x) * k;
      view.y = from.y + (target.y - from.y) * k;
      view.w = from.w + (target.w - from.w) * k;
      view.h = from.h + (target.h - from.h) * k;
      apply(t >= 1);
      if (t < 1) requestAnimationFrame(step);
    })(t0);
  }

  function zoomToCluster(c) {
    const pts = c.idx.map((k) => P[k]);
    const [bx0, by0, bx1, by1] = bboxOf(pts);
    const r = host.getBoundingClientRect();
    const wanted = Math.max(bx1 - bx0, by1 - by0) * (r.width / (MERGE_PX * 3.2)) || view.w / 3;
    const nw = clampZoom(Math.min(Math.max(wanted, HOME.w / 200), view.w / 1.6));
    const nh = nw * (view.h / view.w);
    flyTo({ w: nw, h: nh, x: (bx0 + bx1) / 2 - nw / 2, y: (by0 + by1) / 2 - nh / 2 });
  }

  /* — flying to a single stop —
     A day's overview shows every pin at once; picking one item out of the
     timeline should feel like walking up to it — a tight, street-scale crop
     centred on that stop. A few stops (a fuel stop, an isolated viewpoint)
     have no nearby OSM roads at all, so the target radius widens in steps
     until it lands somewhere with real geometry, rather than flying in on
     an empty tile. */
  const FOCUS_SPAN = () => Math.min(0.01, Math.max(0.004, HOME.w / 8));

  function focusSpanFor(cx, cy) {
    let span = FOCUS_SPAN();
    for (let i = 0; i < 5; i++) {
      const vb = [cx - span / 2, cy - span / 2, cx + span / 2, cy + span / 2];
      const covered = S && Object.values(S).some(
        (a) => a.roads.length >= 8 && boxesOverlap(a.box, vb));
      if (covered) return span;
      span *= 2.2;
    }
    return span;
  }

  function focusOn(i) {
    const [cx, cy] = P[i];
    const w = clampZoom(focusSpanFor(cx, cy));
    const h = w * (view.h / view.w || 1);
    flyTo({ x: cx - w / 2, y: cy - h / 2, w, h });
  }

  /* — the frame loop —
     Panning just moves the viewBox; the basemap is only repainted when the
     view has drifted far enough out of what was drawn, or the zoom changed. */

  let baseTimer = 0;
  function needsRepaint() {
    if (!drawnFor) return true;
    if (Math.abs(drawnFor.w - view.w) / view.w > 0.02) return true;
    const dx = Math.abs(view.x - drawnFor.x), dy = Math.abs(view.y - drawnFor.y);
    return dx > view.w * 0.28 || dy > view.h * 0.28;
  }

  function apply(immediate = false) {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    const r = host.getBoundingClientRect();
    const u = r.width ? view.w / r.width : view.w / 400;
    renderPins(u);
    drawScale();
    updateOpenPopup();
    if (!needsRepaint()) return;
    clearTimeout(baseTimer);
    if (immediate) drawBase();
    else baseTimer = setTimeout(drawBase, 90);
  }

  /* — interaction — */
  const clampZoom = (nw) => Math.min(Math.max(nw, HOME.w / 260), HOME.w * 6);

  function zoomAt(factor, cx, cy) {
    const nw = clampZoom(view.w * factor);
    const k = nw / view.w;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.w = nw; view.h *= k;
    apply();
  }

  const toUser = (clientX, clientY) => {
    const r = svg.getBoundingClientRect();
    return [
      view.x + ((clientX - r.left) / r.width) * view.w,
      view.y + ((clientY - r.top) / r.height) * view.h,
    ];
  };

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [cx, cy] = toUser(e.clientX, e.clientY);
    zoomAt(Math.exp(e.deltaY * 0.0016), cx, cy);
  }, { passive: false });

  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.pin')) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('is-dragging');
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = svg.getBoundingClientRect();
    view.x -= ((e.clientX - drag.x) / r.width) * view.w;
    view.y -= ((e.clientY - drag.y) / r.height) * view.h;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) drag.moved = true;
    drag.x = e.clientX; drag.y = e.clientY;
    apply();
  });
  const endDrag = (e) => {
    if (!drag) return;
    if (!drag.moved && !e.target?.closest?.('.pin')) { onPick?.(null); hidePopup(); }
    drag = null;
    svg.classList.remove('is-dragging');
    apply();
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  let pinchDist = 0;
  svg.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
    }
  }, { passive: true });
  svg.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !pinchDist) return;
    e.preventDefault();
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY);
    const [cx, cy] = toUser(
      (e.touches[0].clientX + e.touches[1].clientX) / 2,
      (e.touches[0].clientY + e.touches[1].clientY) / 2);
    zoomAt(pinchDist / d, cx, cy);
    pinchDist = d;
  }, { passive: false });
  svg.addEventListener('touchend', () => { pinchDist = 0; }, { passive: true });

  /* — public API — */
  const api = {
    svg,
    reset() { flyTo(fittedBox(HOME)); },
    zoomIn()  { zoomAt(1 / 1.6, view.x + view.w / 2, view.y + view.h / 2); },
    zoomOut() { zoomAt(1.6,     view.x + view.w / 2, view.y + view.h / 2); },
    select(i) {
      activeStopIdx = i ?? -1;
      [...gPins.children].forEach((g, k) => {
        g.classList.toggle('is-active', clusters[k]?.idx.includes(activeStopIdx));
      });
    },
    /** Called when a timeline row is clicked: fly to that stop specifically
        (a merged cluster instead zooms just far enough to split its pins). */
    revealStop(i) {
      const c = clusters.find((cl) => cl.idx.includes(i));
      if (c && c.idx.length > 1) zoomToCluster(c);
      else if (P[i]) focusOn(i);
      api.select(i);
    },
    destroy() {
      ro.disconnect();
      clearTimeout(baseTimer);
      document.removeEventListener('scroll', closeOnScroll, true);
      removeEventListener('resize', closeOnScroll);
      document.removeEventListener('keydown', closeOnEscape);
      popupEl.remove();
    },
  };

  drawRoute();
  fitAspect();
  apply(true);

  const ro = new ResizeObserver(() => {
    const cx = view.x + view.w / 2, cy = view.y + view.h / 2;
    const ratio = view.w / HOME.w;
    view = { ...HOME };
    fitAspect();
    view.w *= ratio; view.h *= ratio;
    view.x = cx - view.w / 2; view.y = cy - view.h / 2;
    drawnFor = null;
    apply(true);
  });
  ro.observe(host);

  return api;
}

/**
 * The shape a day's map frame should be, so a north–south run gets a tall
 * frame instead of being padded out sideways into empty land.
 */
export function frameAspect(coords, min = 0.78, max = 1.55) {
  const pts = coords.map(project);
  const [x0, y0, x1, y1] = bboxOf(pts);
  const minSpan = 0.012;
  const w = Math.max(x1 - x0, minSpan);
  const h = Math.max(y1 - y0, minSpan);
  const pad = Math.max(w, h) * 0.22;
  return Math.min(max, Math.max(min, (w + pad * 2) / (h + pad * 2)));
}

/**
 * Collapse activities that share a location into one pin, so a day spent
 * largely at one hotel doesn't stack six markers on the same spot.
 */
export function groupStops(items) {
  const out = [];
  const seen = new Map();
  items.forEach((it, i) => {
    const key = it.coord.map((v) => v.toFixed(4)).join(',');
    if (seen.has(key)) {
      const s = out[seen.get(key)];
      s.nums.push(i + 1);
      s.items.push(it);
      if (rank(it.kind) > rank(s.kind)) { s.kind = it.kind; s.label = it.title; }
      return;
    }
    seen.set(key, out.length);
    out.push({ coord: it.coord, label: it.title, kind: it.kind, nums: [i + 1], items: [it] });
  });
  return out;
}

const RANK = { rest: 0, transport: 1, meal: 2, photo: 3, wine: 4, opera: 5, hotel: 6, sight: 7 };
const rank = (k) => RANK[k] ?? 0;
