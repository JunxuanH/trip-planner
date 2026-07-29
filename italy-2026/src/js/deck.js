/* ── Italy 2026 · the presentation ─────────────────────────────────────── */

import TRIP from '../../data/itinerary.json';
import GEO from '../geo/italy.json';
import STREETS from '../geo/streets.json';
import { createMap, groupStops, frameAspect, PIN_COLORS } from './mapengine.js';
import { createGlobe } from './globe.js';
import { IMAGES } from './images.js';

const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') {
      // Object.assign silently drops CSS custom properties (--k, --c, ...):
      // CSSStyleDeclaration only applies them through setProperty(), never
      // through plain property assignment.
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) n.style.setProperty(sk, sv); else n.style[sk] = sv;
      }
    }
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
      ...TRIP.meta.routeChain.map((c) => h('i', {}, c))),
  ),
  h('div', { class: 'scroll-cue' }, 'Scroll'),
), { clear: true, mode: 'hero', route: 'new', label: 'Italy 2026' });

/* 2…15 — one per day */
const dayMaps = [];
TRIP.days.forEach((d, di) => {
  const c = accentOf(d.city);
  const stops = groupStops(d.items);
  // By the specific hotel, not just the city: Rome alone has two (Trame,
  // then The St. Regis on the finale), each with its own illustration.
  const prevHotel = di ? TRIP.days[di - 1].hotel : null;
  const stayHotel = d.hotel && d.hotel !== prevHotel && TRIP.hotels.find((ht) => ht.name === d.hotel);
  const art = stayHotel ? IMAGES[stayHotel.img] : null;

  const mapBox = h('div', { class: 'deck-map in' });
  mapBox.style.setProperty('--c', c);
  mapBox.style.aspectRatio = String(frameAspect(d.items.map((i) => i.coord), 0.75, 1.35));

  const node = h('section', { class: 'day-slide', style: { '--c': c } },
    h('div', {},
      h('div', { class: 'day-meta in' },
        h('span', { class: 'n' }, `DAY ${String(d.n).padStart(2, '0')}`),
        h('span', { class: 'dt' }, fmt(d.date, { weekday: 'long', day: 'numeric', month: 'long' })),
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
    h('div', { class: 'day-right' },
      art ? h('figure', { class: 'slide-art in' },
        h('img', { src: art, alt: `Illustration of ${TRIP.cities[d.city].name}`, loading: 'lazy' }),
        h('figcaption', {}, h('span', { class: 'art-tag' }, 'Illustration'), d.hotel),
      ) : null,
      mapBox,
    ),
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
    ...TRIP.hotels.map((ht, i) => h('div', {
      class: 'chain-card', style: { '--c': accentOf(ht.cityKey), '--i': i },
    },
      h('div', { class: 'chain-art' },
        h('img', { src: IMAGES[ht.img], alt: `Illustration of ${ht.city}`, loading: 'lazy' }),
        h('span', { class: 'c' }, ht.city)),
      h('div', { class: 'chain-body' },
        h('h4', {}, ht.name),
        h('div', { class: 'b' }, ht.brand),
        h('div', { class: 'd' }, `${fmt(ht.checkIn, { day: 'numeric', month: 'short' })} → ${fmt(ht.checkOut, { day: 'numeric', month: 'short' })}`),
        h('div', { class: 'n' }, `${ht.nights} night${ht.nights > 1 ? 's' : ''} · ${money(ht.total)}`)),
    ))),
), { label: 'Hotels' });

/* 19 — logistics */
addSlide(h('section', {},
  h('div', { class: 'in' },
    h('div', { class: 'eyebrow' }, 'Self-drive, FCO to FCO'),
    h('h2', { class: 'big' }, 'Getting between them')),
  h('div', { class: 'legs in' },
    ...TRIP.drivers.map((dv) => h('div', { class: 'leg' },
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
    h('div', { class: 'sub' }, 'Late-August dates sell out fast — lock these in first.')),
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
    createMap(rec.box, { stops: rec.stops, geo: GEO, streets: STREETS, alt: `Map of day ${rec.d.n}` });
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
      new: ['rome', 'florence', 'tuscany', 'naples', 'amalfi', 'rome'],
    },
  });
  globe.resize();
  addEventListener('resize', () => globe.resize());
} catch (err) {
  // No WebGL: the deck still works, the hero slide just sits on the flat palette.
  console.warn('3D stage unavailable:', err.message);
  stage.remove();
  document.documentElement.classList.add('no-webgl');
}

/* ── hero place names, positioned over the 3D map ────────────────────────
   Projected from each city marker's world position through the live camera
   every frame, so the labels track the model as it turns. Only shown while
   the hero slide (the only slide using the globe now) is on screen. */

const HERO_STOPS = ['rome', 'florence', 'tuscany', 'naples', 'amalfi'];
const labelHost = $('#map-labels');
let isHeroSlide = false;

if (globe && labelHost) {
  // Florence/Val d'Orcia and Amalfi/Naples sit close together on the model;
  // stagger alternate labels upward so their text doesn't collide.
  const labelEls = new Map(HERO_STOPS.map((key, i) => {
    const span = h('span', { class: 'geo-label-3d' }, TRIP.cities[key].name);
    if (i % 2) span.style.setProperty('--dy', '-260%');
    labelHost.append(span);
    return [key, span];
  }));

  const tickLabels = () => {
    requestAnimationFrame(tickLabels);
    if (!isHeroSlide) return;
    for (const p of globe.getLabelPoints(HERO_STOPS)) {
      const span = labelEls.get(p.key);
      if (!span) continue;
      span.style.left = `${(p.x * 100).toFixed(2)}%`;
      span.style.top = `${(p.y * 100).toFixed(2)}%`;
      span.style.opacity = p.visible ? '1' : '0';
    }
  };
  tickLabels();
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
  isHeroSlide = mode === 'hero';
  labelHost?.classList.toggle('is-on', isHeroSlide);

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
isHeroSlide = slides[0].dataset.mode === 'hero';
labelHost?.classList.toggle('is-on', isHeroSlide);
globe?.start();

$('#corner-label').textContent = TRIP.meta.title;
