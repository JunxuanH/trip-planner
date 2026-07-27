/* ── mapengine ─────────────────────────────────────────────────────────────
   A small SVG cartography engine. No tiles, no network — the page has to work
   offline and from a file:// URL, so the basemap is drawn from vector geometry
   embedded at build time (Natural Earth for the country outline, OSM for the
   Campania coast and the two rivers).

   Positions are true Web Mercator, so relative geography is honest even though
   the styling is deliberately illustrative.
   ------------------------------------------------------------------------ */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Web Mercator, in degrees-ish units so x stays comparable to longitude. */
export function project([lat, lng]) {
  const y = (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [lng, -y]; // negate: SVG y grows downward
}

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
};

export const PIN_LABELS = {
  sight: 'Sight', meal: 'Food & drink', wine: 'Wine', opera: 'Music',
  photo: 'Photo stop', hotel: 'Hotel', transport: 'Travel', rest: 'Downtime',
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

const boxesOverlap = (a, b) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

const toPath = (pts, close = false) =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(4)} ${y.toFixed(4)}`).join('') + (close ? 'Z' : '');

/** Great-circle-ish arc between two projected points, bowed perpendicular. */
const arcPath = (a, b, bow = 0.18) => {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const cx = mx - dy * bow, cy = my + dx * bow;
  return `M${a[0].toFixed(4)} ${a[1].toFixed(4)}Q${cx.toFixed(4)} ${cy.toFixed(4)} ${b[0].toFixed(4)} ${b[1].toFixed(4)}`;
};

/* ── basemap prep (done once, shared by every map on the page) ───────────── */

let PREPPED = null;

function prepGeo(geo) {
  if (PREPPED) return PREPPED;
  const conv = (line) => line.map(([lng, lat]) => project([lat, lng]));
  const withBox = (pts) => ({ pts, box: bboxOf(pts) });

  PREPPED = {
    land:   (geo.italy  || []).map((r) => withBox(conv(r))),
    coast:  (geo.coast  || []).map((s) => withBox(conv(s))),
    rivers: Object.entries(geo.rivers || {}).flatMap(([name, segs]) =>
      segs.map((s) => ({ name, ...withBox(conv(s)) }))),
  };
  return PREPPED;
}

/* ── the map ────────────────────────────────────────────────────────────── */

/**
 * @param {HTMLElement} host
 * @param {object} opts
 *   stops   [{ coord:[lat,lng], label, kind, nums:[int], detail }]
 *   geo     the embedded geometry bundle
 *   legs    optional [[fromIdx, toIdx]] overriding sequential connection
 *   onPick  (stopIndex|null) => void
 */
export function createMap(host, opts) {
  const { stops, geo, onPick } = opts;
  const G = prepGeo(geo);

  const svg = el('svg', { class: 'map-svg', role: 'img', 'aria-label': opts.alt || 'Map of the day' });
  const gBase  = el('g', { class: 'map-base' });
  const gRoute = el('g', { class: 'map-route' });
  const gPins  = el('g', { class: 'map-pins' });
  svg.append(gBase, gRoute, gPins);
  host.append(svg);

  const P = stops.map((s) => project(s.coord));

  // Initial view: fit the stops, with padding that grows for tight clusters.
  let [x0, y0, x1, y1] = bboxOf(P);
  let w = x1 - x0, h = y1 - y0;
  const minSpan = 0.012; // never zoom closer than ~1 km across
  if (w < minSpan) { const c = (x0 + x1) / 2; x0 = c - minSpan / 2; x1 = c + minSpan / 2; w = minSpan; }
  if (h < minSpan) { const c = (y0 + y1) / 2; y0 = c - minSpan / 2; y1 = c + minSpan / 2; h = minSpan; }
  const pad = Math.max(w, h) * 0.22;
  const HOME = { x: x0 - pad, y: y0 - pad, w: w + pad * 2, h: h + pad * 2 };

  // Match the viewBox aspect to the element so nothing is squashed.
  let view = { ...HOME };
  const fitAspect = () => {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const target = r.width / r.height;
    const cur = view.w / view.h;
    if (cur < target) { const nw = view.h * target; view.x -= (nw - view.w) / 2; view.w = nw; }
    else              { const nh = view.w / target; view.y -= (nh - view.h) / 2; view.h = nh; }
  };

  /* — basemap ————————————————————————————————————————————————————
     Which layers make sense depends entirely on how much ground is in view.
     The country outline is only accurate enough to help at regional scale;
     the detailed OSM coast and the two rivers only exist close in. The two
     coastline sources are never drawn together — at 1:10m and 1:50m they
     disagree visibly.                                                       */

  const SPAN_LOCAL = 0.5; // ≈ 40 km across

  function drawBase() {
    gBase.textContent = '';
    const span = view.w;
    const grow = 0.3;
    const vbPad = [
      view.x - view.w * grow, view.y - view.h * grow,
      view.x + view.w * (1 + grow), view.y + view.h * (1 + grow),
    ];

    drawGraticule();

    if (span > SPAN_LOCAL) {
      for (const { pts, box } of G.land) {
        if (!boxesOverlap(box, vbPad)) continue;
        gBase.append(el('path', { d: toPath(pts, true), class: 'geo-land' }));
      }
    } else {
      for (const { pts, box } of G.coast) {
        if (!boxesOverlap(box, vbPad)) continue;
        const d = toPath(pts);
        gBase.append(el('path', { d, class: 'geo-coast-halo' }));
        gBase.append(el('path', { d, class: 'geo-coast' }));
      }
      for (const { pts, box } of G.rivers) {
        if (!boxesOverlap(box, vbPad)) continue;
        const d = toPath(pts);
        gBase.append(el('path', { d, class: 'geo-river-halo' }));
        gBase.append(el('path', { d, class: 'geo-river' }));
      }
    }
  }

  /** A faint graticule so an inland view still reads as a map, not a void. */
  const NICE = [10, 5, 2, 1, .5, .25, .1, .05, .025, .01, .005, .002, .001];
  function drawGraticule() {
    const step = NICE.find((s) => view.w / s <= 9) ?? NICE[NICE.length - 1];
    const g = el('g', { class: 'geo-grid' });
    const x0 = Math.floor(view.x / step) * step;
    const y0 = Math.floor(view.y / step) * step;
    for (let x = x0; x <= view.x + view.w; x += step) {
      g.append(el('line', { x1: x, y1: view.y, x2: x, y2: view.y + view.h }));
    }
    for (let y = y0; y <= view.y + view.h; y += step) {
      g.append(el('line', { x1: view.x, y1: y, x2: view.x + view.w, y2: y }));
    }
    gBase.append(g);
  }

  /* — scale bar, so distances on the map are readable — */
  const scaleEl = document.createElement('div');
  scaleEl.className = 'map-scale';
  scaleEl.innerHTML = '<i></i><b></b>';
  host.append(scaleEl);

  const KM_PER_DEG = 111.32;
  const ROUND_KM = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  function drawScale() {
    const r = host.getBoundingClientRect();
    if (!r.width) return;
    // Undo the Mercator stretch at this latitude to get true ground distance.
    const latRad = (2 * Math.atan(Math.exp((-(view.y + view.h / 2) * Math.PI) / 180)) - Math.PI / 2);
    const kmPerUnit = KM_PER_DEG * Math.cos(latRad);
    const kmAcross = view.w * kmPerUnit;
    const target = kmAcross * 0.25;
    const km = ROUND_KM.find((v) => v >= target) ?? ROUND_KM[ROUND_KM.length - 1];
    const frac = km / kmAcross;
    scaleEl.querySelector('i').style.width = `${(frac * 100).toFixed(1)}%`;
    scaleEl.querySelector('b').textContent = km < 1 ? `${km * 1000} m` : `${km} km`;
    scaleEl.style.opacity = frac > 0.85 ? '0' : '1';
  }

  /* — route between consecutive distinct stops — */
  const legs = [];
  for (let i = 1; i < P.length; i++) legs.push([i - 1, i]);
  const totalSpan = Math.max(HOME.w, HOME.h);
  const useArcs = totalSpan > 0.25;

  function drawRoute() {
    gRoute.textContent = '';
    for (const [a, b] of legs) {
      const d = useArcs ? arcPath(P[a], P[b]) : toPath([P[a], P[b]]);
      const p = el('path', { d, class: 'route-line' + (useArcs ? ' is-arc' : '') });
      gRoute.append(p);
    }
  }

  /* — pins ————————————————————————————————————————————————————————
     Stops that land within a pin's width of each other on screen are merged
     into one marker, so a transfer day doesn't stack five Florence pins into
     an unreadable blob. Zooming in splits them apart again.                */

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
        // Re-centre on the members so the marker sits amongst them.
        near.x = near.idx.reduce((a, k) => a + P[k][0], 0) / near.idx.length;
        near.y = near.idx.reduce((a, k) => a + P[k][1], 0) / near.idx.length;
        if (rank(s.kind) > rank(near.kind)) { near.kind = s.kind; near.label = s.label; }
      } else {
        out.push({ x, y, idx: [i], kind: s.kind, label: s.label });
      }
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
        'aria-label': many
          ? `Stops ${c.nums.join(', ')} — zoom in to separate`
          : `${c.nums.join(', ')}. ${c.label}`,
        transform: `translate(${c.x.toFixed(4)} ${c.y.toFixed(4)})`,
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

      const pick = () => {
        if (many) { zoomToCluster(c); return; }
        onPick?.(c.idx[0]);
      };
      g.addEventListener('click', (e) => { e.stopPropagation(); pick(); });
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
      gPins.append(g);
    });
  }

  /** Zoom until the members of a merged marker are far enough apart to read. */
  function zoomToCluster(c) {
    const pts = c.idx.map((k) => P[k]);
    let [bx0, by0, bx1, by1] = bboxOf(pts);
    let w = bx1 - bx0, hgt = by1 - by0;
    const r = host.getBoundingClientRect();
    // Target: the widest pair sits at least 3 marker-widths apart.
    const wanted = Math.max(w, hgt) * (r.width / (MERGE_PX * 3.2)) || view.w / 3;
    const nw = clampZoom(Math.min(Math.max(wanted, HOME.w / 60), view.w / 1.6));
    const k = nw / view.w;
    view.w = nw; view.h *= k;
    view.x = (bx0 + bx1) / 2 - view.w / 2;
    view.y = (by0 + by1) / 2 - view.h / 2;
    apply();
  }

  function apply() {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    const r = host.getBoundingClientRect();
    const u = r.width ? view.w / r.width : view.w / 400; // user units per CSS pixel
    drawBase();
    renderPins(u);
    drawScale();
  }

  /* — interaction: drag to pan, wheel to zoom — */
  const clampZoom = (nw) => Math.min(Math.max(nw, HOME.w / 60), HOME.w * 6);

  function zoomAt(factor, cx, cy) {
    const nw = clampZoom(view.w * factor);
    const k = nw / view.w;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.w = nw;
    view.h *= k;
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
    const dx = ((e.clientX - drag.x) / r.width) * view.w;
    const dy = ((e.clientY - drag.y) / r.height) * view.h;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) drag.moved = true;
    view.x -= dx; view.y -= dy;
    drag.x = e.clientX; drag.y = e.clientY;
    apply();
  });
  const endDrag = (e) => {
    if (!drag) return;
    if (!drag.moved && !e.target?.closest?.('.pin')) onPick?.(null);
    drag = null;
    svg.classList.remove('is-dragging');
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  // Pinch zoom
  const touches = new Map();
  let pinchDist = 0;
  svg.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      pinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY);
    }
  }, { passive: true });
  svg.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !pinchDist) return;
    e.preventDefault();
    const d = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY);
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const [cx, cy] = toUser(mx, my);
    zoomAt(pinchDist / d, cx, cy);
    pinchDist = d;
  }, { passive: false });
  svg.addEventListener('touchend', () => { pinchDist = 0; touches.clear(); }, { passive: true });

  /* — public API — */
  const api = {
    svg,
    reset() { view = { ...HOME }; fitAspect(); apply(); },
    zoomIn()  { zoomAt(1 / 1.5, view.x + view.w / 2, view.y + view.h / 2); },
    zoomOut() { zoomAt(1.5,     view.x + view.w / 2, view.y + view.h / 2); },
    select(i) {
      activeStopIdx = i ?? -1;
      [...gPins.children].forEach((g, k) => {
        g.classList.toggle('is-active', clusters[k]?.idx.includes(activeStopIdx));
      });
    },
    /** Highlight a stop, first zooming in if it is currently merged into a cluster. */
    revealStop(i) {
      const c = clusters.find((cl) => cl.idx.includes(i));
      if (c && c.idx.length > 1) zoomToCluster(c);
      api.select(i);
    },
    flyTo(i, factor = 0.35) {
      if (i == null || !P[i]) return;
      const nw = clampZoom(HOME.w * factor);
      const k = nw / view.w;
      view.w = nw; view.h *= k;
      view.x = P[i][0] - view.w / 2;
      view.y = P[i][1] - view.h / 2;
      apply();
    },
    relayout() { const c = { ...view }; fitAspect(); view = view.w ? view : c; apply(); },
    destroy() { ro.disconnect(); },
  };

  drawRoute();
  fitAspect();
  apply();

  const ro = new ResizeObserver(() => {
    // Preserve the centre and zoom ratio across resizes.
    const cx = view.x + view.w / 2, cy = view.y + view.h / 2;
    const ratio = view.w / HOME.w;
    view = { ...HOME };
    fitAspect();
    view.w *= ratio; view.h *= ratio;
    view.x = cx - view.w / 2; view.y = cy - view.h / 2;
    apply();
  });
  ro.observe(host);

  return api;
}

/**
 * The shape a day's map frame should be, so a north–south run like
 * Florence → Siena → Val d'Orcia gets a tall frame instead of being padded
 * out sideways into mostly empty land. Returns width / height.
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
      // A named place beats a generic "at the hotel" stop for the pin label.
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
