/* ── Italy 2026 · the tiled map ────────────────────────────────────────────
   A Leaflet map on CARTO Positron tiles, used by plan.html when there is a
   network. It is a drop-in for createMap() in mapengine.js — same options,
   same returned API — so plan.js can pick one or the other per frame without
   knowing which it got.

   The tiles are the ONE runtime network request either document makes. Leaflet
   itself is bundled, so the page is still a single file; only the tile images
   come from outside. When they can't be reached, mapFor() below falls back to
   the SVG engine, which is why streets.json is still carried.
   ------------------------------------------------------------------------ */

import L from 'leaflet';
import { createMap, PIN_COLORS, PIN_LABELS } from './mapengine.js';

/* CARTO's Positron: a pale basemap built to sit *under* data, so the numbered
   pins and the route stay the loudest things on it. Free, no key, attribution
   required — Leaflet's own control carries it. */
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIB =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, '
  + '&copy; <a href="https://carto.com/attributions">CARTO</a>';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* `stops` arrives already merged by groupStops() in plan.js — each entry is
   { coord, label, kind, nums, items }, where nums are the 1-based positions in
   the day's timeline. Indices into that array are the currency the caller uses
   for select()/revealStop()/onPick, so they are what this module speaks too. */
const stopText = (s) =>
  s.nums.length > 1 ? `${s.nums[0]}–${s.nums.at(-1)}` : String(s.nums[0]);

/** A numbered marker in the stop's own kind colour, matching the SVG engine. */
function pinIcon(stop, active) {
  const color = PIN_COLORS[stop.kind] || 'var(--terracotta)';
  const many = stop.nums.length > 1;
  return L.divIcon({
    className: 'tm-pin' + (active ? ' is-active' : ''),
    html: `<i style="--pin:${color}"${many ? ' data-many="1"' : ''}>${esc(stopText(stop))}</i>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function popupHtml(stop) {
  return stop.items.map((it) => `
    <div class="tm-pop-item">
      <div class="tm-pop-head">
        <span class="tm-pop-time">${esc(it.time)}</span>
        <span class="tm-pop-kind">${esc(PIN_LABELS[it.kind] || it.kind)}</span>
      </div>
      <div class="tm-pop-title">${esc(it.title)}</div>
      ${it.detail ? `<div class="tm-pop-detail">${esc(it.detail)}</div>` : ''}
      <div class="tm-pop-links">
        <a href="https://www.google.com/maps/search/?api=1&query=${it.coord[0]},${it.coord[1]}"
           target="_blank" rel="noopener noreferrer">Google Maps</a>
        ${it.link ? `<a href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">${esc(it.linkLabel || 'Open')}</a>` : ''}
      </div>
    </div>`).join('');
}

/** Build the tiled map. Returns the same shape createMap() does. */
export function createTileMap(host, opts) {
  const { stops, onPick, alt } = opts;
  const latlngs = stops.map((s) => [s.coord[0], s.coord[1]]);

  host.classList.add('is-tiled');

  const map = L.map(host, {
    zoomControl: false,          // plan.js already renders .map-tools
    attributionControl: true,
    scrollWheelZoom: false,      // the page owns the wheel; see below
    zoomSnap: 0.25,
  });
  host.setAttribute('aria-label', alt || 'Map of the day');

  const tiles = L.tileLayer(TILE_URL, {
    attribution: TILE_ATTRIB, subdomains: 'abcd', maxZoom: 19, detectRetina: true,
  }).addTo(map);

  /* Same bargain the SVG engine strikes: a bare wheel scrolls the page, the
     modifier zooms, two fingers pan. Leaflet has the hooks for all three. */
  map.on('wheel', (e) => {
    const oe = e.originalEvent;
    if (oe.ctrlKey || oe.metaKey) {
      oe.preventDefault();
      map.setZoom(map.getZoom() - Math.sign(oe.deltaY) * 0.5, { animate: true });
    }
  });
  if (map.dragging) map.dragging.disable();
  L.DomEvent.on(host, 'touchstart', (e) => {
    // one finger belongs to the page, two drive the map
    if (e.touches.length >= 2) map.dragging.enable();
  });
  L.DomEvent.on(host, 'touchend', (e) => {
    if (e.touches.length < 2) map.dragging.disable();
  });
  // A pointer device can drag freely — only touch needs the two-finger rule.
  if (!matchMedia('(pointer: coarse)').matches && map.dragging) map.dragging.enable();

  /* route: the day's order, drawn as a dashed line the way the SVG map does */
  if (latlngs.length > 1) {
    L.polyline(latlngs, {
      className: 'tm-route', dashArray: '6 7', weight: 2.5, opacity: 0.75,
      color: getComputedStyle(host).getPropertyValue('--c').trim() || '#C25A3A',
    }).addTo(map);
  }

  const HOME = latlngs.length > 1
    ? L.latLngBounds(latlngs).pad(0.18)
    : L.latLngBounds([latlngs[0]]).pad(0.02);

  const markers = stops.map((s, i) => {
    const m = L.marker(latlngs[i], { icon: pinIcon(s, false), keyboard: true, alt: s.label })
      .addTo(map);
    m.bindPopup(popupHtml(s), { className: 'tm-pop', maxWidth: 272, autoPanPadding: [24, 24] });
    m.on('click', () => onPick?.(i));
    return m;
  });

  /* The popup repeats the info strip word for word, so the frame yields to it —
     the same bargain mapengine's showPopup() strikes. */
  map.on('popupopen', () => host.classList.add('popup-open'));
  map.on('popupclose', () => host.classList.remove('popup-open'));

  const fitHome = () => {
    if (latlngs.length > 1) map.fitBounds(HOME, { animate: false });
    else map.setView(latlngs[0], 15, { animate: false });
  };
  fitHome();

  let activeIdx = -1;
  const paint = () => stops.forEach((s, i) => markers[i].setIcon(pinIcon(s, i === activeIdx)));

  return {
    isTiled: true,
    reset() { activeIdx = -1; paint(); map.closePopup(); fitHome(); },
    zoomIn()  { map.zoomIn(1); },
    zoomOut() { map.zoomOut(1); },
    select(i) { activeIdx = i; paint(); },
    revealStop(i) {
      if (!latlngs[i]) return;
      activeIdx = i;
      paint();
      // Close enough to read the streets, wide enough to keep the day around it.
      map.flyTo(latlngs[i], Math.max(map.getZoom(), 15), { duration: 0.6 });
    },
    destroy() { map.remove(); },
    _tiles: tiles,
    _map: map,
  };
}

/* ── choosing an engine ──────────────────────────────────────────────────────
   Tiles need the network. Rather than guess from navigator.onLine — which lies
   on captive portals and says nothing about whether CARTO in particular is
   reachable — build the tiled map, then watch whether any tile actually
   arrives. If none has after a moment, tear it down and hand the frame to the
   SVG engine, which needs nothing. */
export function mapFor(host, opts, { timeout = 3500 } = {}) {
  if (!navigator.onLine) return createMap(host, opts);

  let api;
  try {
    api = createTileMap(host, opts);
  } catch (err) {
    // Say why rather than silently degrading — a broken tile map and a missing
    // network look identical from the outside otherwise.
    console.warn('[map] tile layer failed, using the offline engine:', err);
    host.classList.remove('is-tiled');
    host.textContent = '';
    return createMap(host, opts);
  }

  let settled = false;
  const ok = () => { settled = true; cleanup(); };
  const giveUp = () => {
    if (settled) return;
    settled = true;
    cleanup();
    api.destroy();
    host.classList.remove('is-tiled');
    host.textContent = '';
    const fallback = createMap(host, opts);
    // Hand the caller's live reference the offline engine's behaviour.
    Object.assign(api, fallback, { isTiled: false });
  };
  const cleanup = () => {
    clearTimeout(timer);
    api._tiles.off('tileload', ok);
    api._tiles.off('tileerror', onErr);
  };
  let errors = 0;
  const onErr = () => { if (++errors >= 3) giveUp(); };
  api._tiles.on('tileload', ok);
  api._tiles.on('tileerror', onErr);
  const timer = setTimeout(giveUp, timeout);

  return api;
}
