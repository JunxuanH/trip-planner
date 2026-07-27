/* ── Italy 2026 · the presentation ─────────────────────────────────────── */

import TRIP from '../../data/itinerary.json';
import GEO from '../geo/italy.json';
import { createMap, groupStops, frameAspect, PIN_COLORS } from './mapengine.js';
import { createGlobe } from './globe.js';

const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
};

const utc = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (iso, o) => utc(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
const money = (n) => '$' + n.toLocaleString('en-US');
const accentOf = (k) => TRIP.cities[k]?.accent || 'var(--terracotta)';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const deck = $('#deck');

/* Which activities earn a line on a day slide: the memorable ones, in order. */
const SKIP = new Set(['transport', 'rest']);
function moments(day, max = 4) {
  const good = day.items.filter((i) => !SKIP.has(i.kind));
  const pool = good.length >= 3 ? good : day.items;
  if (pool.length <= max) return pool;
  // Spread the picks across the day rather than taking the first four.
  const step = (pool.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => pool[Math.round(i * step)]);
}

/* ── slides ─────────────────────────────────────────────────────────────── */

const slides = [];
const addSlide = (node, opts = {}) => {
  node.classList.add('slide');
  node.classList.add(opts.clear ? 'is-clear' : 'is-solid');
  node.dataset.mode = opts.mode || '';
  node.dataset.route = opts.route || '';
  node.dataset.label = opts.label || '';
  deck.append(node);
  slides.push(node);
  return node;
};

/* 1 — hero */
addSlide(h('section', { class: 'hero-slide' },
  h('div', { class: 'hero' },
    h('div', { class: 'eyebrow in' }, 'Fourteen days · thirteen nights'),
    h('h1', { class: 'in' }, TRIP.meta.title),
    h('div', { class: 'dates in' }, TRIP.meta.window),
    h('div', { class: 'chain in' },
      ...TRIP.change.newRoute.map((c) => h('i', {}, c))),
  ),
  h('div', { class: 'scroll-cue' }, 'Scroll'),
), { clear: true, mode: 'hero', route: 'new', label: 'Italy 2026' });

/* 2 — the old route */
addSlide(h('section', {},
  h('div', { class: 'compare' },
    h('div', { class: 'eyebrow in' }, 'The problem'),
    h('h2', { class: 'in' }, 'The old order doubled back'),
    h('p', { class: 'in' }, TRIP.change.summary),
    h('div', { class: 'vs in' },
      h('div', { class: 'vs-row was' },
        h('div', { class: 'tag' }, 'Was'),
        h('div', { class: 'vs-chain' },
          ...TRIP.change.oldRoute.flatMap((c, i) => [i ? h('b', {}, '→') : null, h('i', {}, c)]).filter(Boolean))),
    ),
  ),
), { clear: true, mode: 'compare', route: 'old', label: 'Before' });

/* 3 — the new route */
addSlide(h('section', {},
  h('div', { class: 'compare' },
    h('div', { class: 'eyebrow in' }, 'The fix'),
    h('h2', { class: 'in' }, 'Rome → Florence → Val d’Orcia'),
    h('div', { class: 'vs in' },
      h('div', { class: 'vs-row now' },
        h('div', { class: 'tag' }, 'Now'),
        h('div', { class: 'vs-chain' },
          ...TRIP.change.newRoute.flatMap((c, i) => [
            i ? h('b', {}, '→') : null,
            h('i', { class: ['Florence', "Val d'Orcia"].includes(c) ? 'hi' : '' }, c),
          ]).filter(Boolean))),
    ),
    h('div', { class: 'in' }, ...TRIP.change.wins.map((w) => h('div', { class: 'win' }, w))),
  ),
), { clear: true, mode: 'compare', route: 'new', label: 'After' });

/* 4…17 — one per day */
const dayMaps = [];
TRIP.days.forEach((d) => {
  const c = accentOf(d.city);
  const stops = groupStops(d.items);

  const mapBox = h('div', { class: 'deck-map in' });
  mapBox.style.setProperty('--c', c);
  mapBox.style.aspectRatio = String(frameAspect(d.items.map((i) => i.coord), 0.75, 1.35));

  const node = h('section', { class: 'day-slide', style: { '--c': c } },
    h('div', {},
      h('div', { class: 'day-meta in' },
        h('span', { class: 'n' }, `DAY ${String(d.n).padStart(2, '0')}`),
        h('span', { class: 'dt' }, fmt(d.date, { weekday: 'long', day: 'numeric', month: 'long' })),
        d.changed ? h('span', { class: 'tag' }, 'Rescheduled') : null,
        d.transfer ? h('span', { class: 'tag new' }, 'Travel day') : null),
      h('h2', { class: 'in' }, d.title),
      h('div', { class: 'where in' }, d.kicker),
      d.note ? h('p', { class: 'note in' }, d.note) : null,
      h('ul', { class: 'moments in' },
        ...moments(d).map((it) => h('li', {},
          h('span', { class: 't' }, it.time),
          h('span', { class: 'x' }, h('b', {}, it.title),
            it.detail ? h('span', {}, it.detail) : null)))),
      d.hotel ? h('div', { class: 'stay in' }, 'Sleeping at ', h('b', {}, d.hotel)) : null,
    ),
    mapBox,
  );

  addSlide(node, { label: `Day ${d.n}` });
  dayMaps.push({ box: mapBox, stops, d });
});

/* 18 — the hotels */
addSlide(h('section', {},
  h('div', { class: 'in' },
    h('div', { class: 'eyebrow' }, 'Six hotels, six programmes'),
    h('h2', { class: 'big' }, 'Where you sleep'),
    h('div', { class: 'sub' }, TRIP.meta.chainStory)),
  h('div', { class: 'chain-grid in' },
    ...TRIP.hotels.map((ht) => h('div', {
      class: 'chain-card' + (ht.moved ? ' moved' : ''), style: { '--c': accentOf(ht.cityKey) },
    },
      h('div', { class: 'c' }, ht.city),
      h('h4', {}, ht.name),
      h('div', { class: 'b' }, ht.brand),
      h('div', { class: 'd' }, `${fmt(ht.checkIn, { day: 'numeric', month: 'short' })} → ${fmt(ht.checkOut, { day: 'numeric', month: 'short' })}`),
      h('div', { class: 'n' }, `${ht.nights} night${ht.nights > 1 ? 's' : ''} · ${money(ht.total)}`),
      ht.moved ? h('div', { class: 'mv' }, 'Rebook — dates moved') : null,
    ))),
), { label: 'Hotels' });

/* 19 — logistics */
addSlide(h('section', {},
  h('div', { class: 'in' },
    h('div', { class: 'eyebrow' }, 'Drivers and trains'),
    h('h2', { class: 'big' }, 'Getting between them'),
    h('div', { class: 'sub' }, 'Green = new leg · orange = moved')),
  h('div', { class: 'legs in' },
    ...TRIP.drivers.map((dv) => h('div', { class: 'leg ' + (dv.isNew ? 'new' : dv.changed ? 'chg' : '') },
      h('span', { class: 'd' }, fmt(dv.date, { day: 'numeric', month: 'short' })),
      h('span', { class: 'r' }, dv.route),
      h('span', { class: 'h' }, dv.hours)))),
), { label: 'Logistics' });

/* 20 — budget */
const BUD_K = ['var(--terracotta)', 'var(--tyrrhenian)', 'var(--olive)', 'var(--gold)', 'var(--ink-3)'];
const budMax = Math.max(...TRIP.budget.map((b) => b.amount));
const budTotal = TRIP.budget.reduce((s, b) => s + b.amount, 0);
addSlide(h('section', {},
  h('div', { class: 'in' },
    h('div', { class: 'eyebrow' }, 'Estimates, cash, before points'),
    h('h2', { class: 'big' }, 'What it costs')),
  h('div', { class: 'bud in' },
    ...TRIP.budget.map((b, i) => h('div', { class: 'bud-row', style: { '--k': BUD_K[i % BUD_K.length] } },
      h('div', { class: 'c' }, b.category),
      h('div', { class: 'bar' }, h('i', { style: { width: (b.amount / budMax * 100).toFixed(1) + '%' } })),
      h('div', { class: 'a' }, money(b.amount))))),
  h('div', { class: 'bud-total in' }, h('span', {}, 'Total'), h('span', {}, money(budTotal))),
), { label: 'Budget' });

/* 21 — what to book */
addSlide(h('section', {},
  h('div', { class: 'in' },
    h('div', { class: 'eyebrow' }, `Departure is ${fmt(TRIP.meta.start, { day: 'numeric', month: 'long' })}`),
    h('h2', { class: 'big' }, 'Book these first'),
    h('div', { class: 'sub' }, 'The reorder invalidated two hotel bookings and four driver days.')),
  h('div', { class: 'todo in' },
    ...TRIP.bookings.filter((b) => b.urgency !== 'soon').slice(0, 8).map((b) =>
      h('div', { class: `todo-item ${b.urgency}` },
        h('span', { class: 'i' }, String(b.priority).padStart(2, '0')),
        h('span', { class: 'x' }, b.item, h('span', {}, b.detail))))),
), { label: 'Book now' });

/* 22 — closing */
addSlide(h('section', { class: 'closing' },
  h('div', { class: 'eyebrow in' }, 'Sun 6 September · FCO → IAH'),
  h('h2', { class: 'in' }, 'Arrivederci'),
  h('p', { class: 'in' }, 'Thirteen nights, six hotels, one very good reason to come back.'),
), { clear: true, mode: 'closing', route: 'new', label: 'Arrivederci' });

/* ── maps (built lazily; 14 SVG maps at once is wasteful) ───────────────── */

const mapIO = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const rec = dayMaps.find((m) => m.box === e.target);
    if (!rec || rec.built) return;
    rec.built = true;
    createMap(rec.box, { stops: rec.stops, geo: GEO, alt: `Map of day ${rec.d.n}` });
  });
}, { root: deck, rootMargin: '120% 0px' });
dayMaps.forEach((m) => mapIO.observe(m.box));

/* ── the 3D stage ───────────────────────────────────────────────────────── */

const stage = $('#stage');
const veil = $('#veil');
let globe = null;

try {
  const canvas = h('canvas');
  stage.append(canvas);
  globe = createGlobe(canvas, {
    cities: TRIP.cities,
    geo: GEO,
    reduced: REDUCED,
    routes: {
      new: ['rome', 'florence', 'tuscany', 'amalfi', 'naples', 'rome'],
      old: ['rome', 'tuscany', 'florence', 'amalfi', 'naples', 'rome'],
    },
  });
  globe.resize();
  addEventListener('resize', () => globe.resize());
} catch (err) {
  // No WebGL: the deck still works, the hero slides just sit on the flat palette.
  console.warn('3D stage unavailable:', err.message);
  stage.remove();
  document.documentElement.classList.add('no-webgl');
}

/* ── navigation ─────────────────────────────────────────────────────────── */

const dots = $('#dots');
slides.forEach((s, i) => {
  dots.append(h('button', {
    type: 'button', 'aria-label': `Go to ${s.dataset.label || `slide ${i + 1}`}`,
    title: s.dataset.label,
    onClick: () => goTo(i),
  }));
});
const dotEls = [...dots.children];
const bar = $('#bar i');

let current = 0;
function goTo(i) {
  current = Math.max(0, Math.min(slides.length - 1, i));
  slides[current].scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
}

function setActive(i) {
  if (i === current) return;
  current = i;
  dotEls.forEach((d, k) => d.classList.toggle('on', k === i));
  bar.style.width = `${((i + 1) / slides.length) * 100}%`;

  const s = slides[i];
  const mode = s.dataset.mode;
  stage?.classList.toggle('is-on', !!mode);
  veil.classList.toggle('is-on', !!mode);

  if (globe) {
    if (mode) {
      globe.start();
      globe.setMode(mode, s.dataset.route || 'new');
    } else {
      // Nothing to show — stop rendering rather than burn frames behind a panel.
      globe.stop();
    }
  }
}

const liveIO = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    e.target.classList.toggle('is-live', e.isIntersecting && e.intersectionRatio > 0.55);
    if (e.isIntersecting && e.intersectionRatio > 0.55) setActive(slides.indexOf(e.target));
  });
}, { root: deck, threshold: [0, 0.55, 0.9] });
slides.forEach((s) => liveIO.observe(s));

addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === 'ArrowDown' || k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); goTo(current + 1); }
  else if (k === 'ArrowUp' || k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); goTo(current - 1); }
  else if (k === 'Home') { e.preventDefault(); goTo(0); }
  else if (k === 'End') { e.preventDefault(); goTo(slides.length - 1); }
  else if (k === 'r' || k === 'R') globe?.replay();
});

// Kick off: the first slide is already on screen, so light it up directly.
slides[0].classList.add('is-live');
dotEls[0].classList.add('on');
bar.style.width = `${(1 / slides.length) * 100}%`;
stage?.classList.add('is-on');
veil.classList.add('is-on');
globe?.start();

$('#corner-label').textContent = TRIP.meta.title;
