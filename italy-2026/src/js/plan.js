/* ── Italy 2026 · the plan document ────────────────────────────────────── */

import TRIP from '../../data/itinerary.json';
import GEO from '../geo/italy.json';
import STREETS from '../geo/streets.json';
import { createMap, groupStops, frameAspect, PIN_COLORS, PIN_LABELS } from './mapengine.js';
import { IMAGES } from './images.js';

/* ── helpers ────────────────────────────────────────────────────────────── */

const $ = (sel, root = document) => root.querySelector(sel);
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
const dayLabel = (iso) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
const money = (n) => '$' + n.toLocaleString('en-US');

const accentOf = (key) => TRIP.cities[key]?.accent || 'var(--terracotta)';

/* ── masthead ───────────────────────────────────────────────────────────── */

function renderMast() {
  const m = TRIP.meta;
  $('#mast-title').textContent = m.title;
  $('#mast-sub').textContent = m.subtitle;

  const days = Math.ceil((utc(m.start) - Date.now()) / 86400000);
  const cd = days > 0 ? `${days}` : days === 0 ? 'Today' : '—';
  const cdNote = days > 1 ? 'days to departure'
    : days === 1 ? 'day to departure'
    : days === 0 ? 'departure day'
    : 'under way';

  $('#facts').append(
    h('div', { class: 'fact countdown' },
      h('div', { class: 'v tnum' }, cd, ' ', h('small', {}, cdNote))),
    h('div', { class: 'fact' }, h('div', { class: 'v' }, m.window)),
    h('div', { class: 'fact' }, h('div', { class: 'v tnum' }, m.nights, ' ', h('small', {}, 'nights'))),
    h('div', { class: 'fact' }, h('div', { class: 'v tnum' }, TRIP.hotels.length, ' ', h('small', {}, 'hotels'))),
    h('div', { class: 'fact' }, h('div', { class: 'v tnum' }, m.travelers, ' ', h('small', {}, 'travellers'))),
  );

  // A strip of the six stops, as posters.
  $('#mast-art').append(...TRIP.hotels.map((ht, i) => h('figure', {
    style: { '--c': accentOf(ht.cityKey), '--i': i },
  },
    h('img', { src: IMAGES[ht.img], alt: `Illustration of ${ht.city}` }),
    h('figcaption', {}, ht.city),
  )));
}

/* ── rail ───────────────────────────────────────────────────────────────── */

function renderRail() {
  const box = $('#rail-scroll');
  TRIP.days.forEach((d) => {
    const c = accentOf(d.city);
    box.append(h('button', {
      class: 'chip', 'data-day': d.n, style: { '--c': c },
      onClick: () => document.getElementById(`day-${d.n}`).scrollIntoView({ behavior: 'smooth', block: 'start' }),
      title: `${dayLabel(d.date)} — ${d.title}`,
    }, h('b', {}, d.n), h('span', {}, TRIP.cities[d.city].short.slice(0, 5))));
  });
}

/* ── days ───────────────────────────────────────────────────────────────── */

const maps = new Map();

function renderDays() {
  const host = $('#days');

  TRIP.days.forEach((d, di) => {
    const c = accentOf(d.city);
    const stops = groupStops(d.items);

    // A day you move in somewhere new gets the destination as a banner —
    // by the specific hotel, not just the city: Rome alone has two (Trame,
    // then The St. Regis on the finale), each with its own illustration.
    const prevHotel = di ? TRIP.days[di - 1].hotel : null;
    const arriving = d.hotel && d.hotel !== prevHotel;
    const stayHotel = arriving && TRIP.hotels.find((ht) => ht.name === d.hotel);
    const art = stayHotel ? IMAGES[stayHotel.img] : null;

    const sec = h('section', {
      class: 'day reveal' + (art ? ' has-art' : ''), id: `day-${d.n}`, style: { '--c': c },
      'data-n': String(d.n).padStart(2, '0'),
    });

    /* head */
    const idx = h('div', { class: 'day-index' },
      h('span', { class: 'num' }, `DAY ${String(d.n).padStart(2, '0')}`),
      h('span', { class: 'date' }, fmt(d.date, { weekday: 'long', day: 'numeric', month: 'long' })),
      d.transfer ? h('span', { class: 'badge newleg' }, 'Travel day') : null,
    );

    const banner = art ? h('div', { class: 'day-art' },
      h('img', { src: art, alt: `Illustration of ${TRIP.cities[d.city].name}`, loading: 'lazy' }),
      h('div', { class: 'day-art-cap' },
        h('span', { class: 'art-tag' }, 'Illustration'),
        h('b', {}, 'Checking in — ', d.hotel)),
    ) : null;

    const head = h('div', { class: 'day-head' },
      banner,
      idx,
      h('h3', {}, d.title),
      h('div', { class: 'kicker' }, d.kicker),
      d.note ? h('p', { class: 'note' }, d.note) : null,
      d.warn ? h('div', { class: 'callout warn' },
        h('span', { class: 'ic' }, '⚠'), h('div', {}, h('b', {}, 'Watch this. '), d.warn)) : null,
    );

    /* timeline */
    const tl = h('ol', { class: 'timeline' });
    d.items.forEach((it, i) => {
      const k = PIN_COLORS[it.kind] || 'var(--terracotta)';
      const stopIdx = stops.findIndex((s) => s.items.includes(it));
      const row = h('li', {
        class: 'tl', 'data-i': i, style: { '--k': k },
        onClick: () => focusStop(d.n, stopIdx, i),
        onMouseenter: () => ensureMap(d.n)?.select(stopIdx),
        onMouseleave: () => ensureMap(d.n)?.select(activeStop.get(d.n) ?? -1),
      },
        h('div', { class: 'tl-time tnum' }, it.time),
        h('div', { class: 'tl-main' },
          h('div', { class: 'tl-title' }, h('span', { class: 'idx' }, i + 1), it.title),
          it.detail ? h('div', { class: 'tl-detail' }, it.detail) : null,
          it.how ? h('div', { class: 'tl-how' }, it.how) : null,
          h('div', { class: 'tl-tags' },
            it.optional ? h('span', { class: 'mini opt' }, 'Optional') : null,
            it.link ? h('a', {
              class: 'lk', href: it.link, target: '_blank', rel: 'noopener noreferrer',
              onClick: (e) => e.stopPropagation(),
            }, it.linkLabel || 'Open') : null,
          ),
        ),
      );
      tl.append(row);
    });

    /* map */
    const frame = h('div', { class: 'map-frame' });
    // Let the frame take the shape of the day's route rather than a fixed box.
    frame.style.aspectRatio = String(frameAspect(d.items.map((i) => i.coord)));
    const cap = h('div', { class: 'map-cap' }, TRIP.cities[d.city].name);
    const info = h('div', { class: 'map-info' });
    const tools = h('div', { class: 'map-tools' },
      h('button', { type: 'button', title: 'Zoom in', 'aria-label': 'Zoom in', onClick: () => ensureMap(d.n)?.zoomIn() }, '+'),
      h('button', { type: 'button', title: 'Zoom out', 'aria-label': 'Zoom out', onClick: () => ensureMap(d.n)?.zoomOut() }, '−'),
      h('button', { type: 'button', title: 'Reset view', 'aria-label': 'Reset view', onClick: () => { ensureMap(d.n)?.reset(); clearStop(d.n); } }, '⟲'),
    );
    const coarse = matchMedia('(pointer: coarse)').matches;
    const hint = h('div', { class: 'map-hint' },
      coarse ? 'Two fingers to pan and zoom' : 'Drag to pan · scroll to zoom');
    frame.append(cap, tools, hint, info);

    const kinds = [...new Set(d.items.map((i) => i.kind))];
    const legend = h('div', { class: 'legend' },
      ...kinds.map((k) => h('i', { style: { '--k': PIN_COLORS[k] } }, PIN_LABELS[k] || k)));

    const mapWrap = h('div', { class: 'map-wrap' }, frame, legend);

    sec.append(head, h('div', { class: 'day-body' }, tl, mapWrap));
    host.append(sec);

    /* Building fourteen street maps up front is slow; each one is created the
       first time its day comes near the viewport (or is asked for). */
    frame.style.setProperty('--c', c);
    mapInfo.set(d.n, { info, stops });
    pendingMaps.set(d.n, () => createMap(frame, {
      stops, geo: GEO, streets: STREETS, alt: `Map of day ${d.n}: ${d.title}`,
      onPick: (i) => {
        if (i == null) return clearStop(d.n);
        focusStop(d.n, i, stops[i].nums[0] - 1, false);
      },
    }));
    mapIO.observe(sec);
  });
}

const pendingMaps = new Map();

function ensureMap(dayN) {
  if (maps.has(dayN)) return maps.get(dayN);
  const make = pendingMaps.get(dayN);
  if (!make) return null;
  pendingMaps.delete(dayN);
  const api = make();
  maps.set(dayN, api);
  return api;
}

const mapIO = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    ensureMap(Number(e.target.id.split('-')[1]));
    mapIO.unobserve(e.target);
  });
}, { rootMargin: '600px 0px' });

/* ── linking the timeline and the map ───────────────────────────────────── */

const activeStop = new Map();
const mapInfo = new Map();

function focusStop(dayN, stopIdx, itemIdx, scroll = true) {
  const map = ensureMap(dayN);
  if (!map || stopIdx < 0) return;
  activeStop.set(dayN, stopIdx);
  map.revealStop(stopIdx);

  const sec = document.getElementById(`day-${dayN}`);
  sec.querySelectorAll('.tl').forEach((r) => r.classList.toggle('is-active', Number(r.dataset.i) === itemIdx));

  const { info, stops } = mapInfo.get(dayN);
  const s = stops[stopIdx];
  info.textContent = '';
  // Element.append() stringifies non-Node arguments (including null, as the
  // literal text "null") rather than skipping them the way h()'s own kid
  // handling does — so the optional detail line can only be passed when real.
  info.append(
    h('span', { class: 'tnum' }, s.items.map((it) => it.time).join(' · ')),
    h('b', {}, s.label),
    ...(s.items[0].detail ? [h('div', {}, s.items[0].detail)] : []),
  );
  info.classList.add('is-on');
  // The strip covers the scale bar and the drag hint while it's up.
  info.closest('.map-frame')?.classList.add('info-on');

  if (scroll) {
    // On a phone the map sits below the whole timeline, so tapping a stop flies
    // a map you can't see. Bring the map up instead; on the two-column desktop
    // layout it's already beside you, so keep the row centred there.
    const stacked = matchMedia('(max-width: 900px)').matches;
    const target = stacked
      ? sec.querySelector('.map-frame')
      : sec.querySelector(`.tl[data-i="${itemIdx}"]`);
    if (target && !isInView(target)) {
      target.scrollIntoView({ behavior: 'smooth', block: stacked ? 'nearest' : 'center' });
    }
  }
}

function clearStop(dayN) {
  activeStop.delete(dayN);
  maps.get(dayN)?.select(-1);
  const sec = document.getElementById(`day-${dayN}`);
  sec?.querySelectorAll('.tl').forEach((r) => r.classList.remove('is-active'));
  const info = mapInfo.get(dayN)?.info;
  info?.classList.remove('is-on');
  info?.closest('.map-frame')?.classList.remove('info-on');
}

const isInView = (el) => {
  const r = el.getBoundingClientRect();
  return r.top >= 60 && r.bottom <= innerHeight - 20;
};

/* ── hotels ─────────────────────────────────────────────────────────────── */

function renderHotels() {
  const host = $('#hotels');
  TRIP.hotels.forEach((ht, i) => {
    const art = IMAGES[ht.img];
    host.append(h('div', { class: 'card hotel reveal', style: { '--c': accentOf(ht.cityKey) } },
      art ? h('div', { class: 'card-art' },
        h('img', { src: art, alt: `Illustration of ${ht.city}`, loading: i > 1 ? 'lazy' : null }),
        h('span', { class: 'art-tag' }, 'Illustration'),
        h('span', { class: 'art-city' }, ht.city),
      ) : null,
      h('div', { class: 'card-body' },
        h('h4', {}, ht.name),
        h('div', { class: 'brand' }, ht.brand),
        h('div', { class: 'blurb' }, ht.blurb),
        ht.address ? h('div', { class: 'addr' }, ht.address) : null,
        h('div', { class: 'dates' },
          h('b', { class: 'tnum' }, `${dayLabel(ht.checkIn)} → ${dayLabel(ht.checkOut)}`),
          h('span', {}, `${ht.nights} night${ht.nights > 1 ? 's' : ''}`)),
        h('div', { class: 'foot' },
          h('div', { class: 'price tnum' }, money(ht.total), ' ', h('small', {}, `· ${money(ht.nightly)}/night`)),
          h('div', { class: 'foot-links' },
            h('a', { class: 'lk', href: ht.link, target: '_blank', rel: 'noopener noreferrer' }, 'Photos & book'))),
      ),
    ));
  });

  const total = TRIP.hotels.reduce((s, x) => s + x.total, 0);
  $('#hotels-total').textContent = money(total);
}

/* ── logistics ──────────────────────────────────────────────────────────── */

function renderDrivers() {
  const body = $('#drivers-body');
  TRIP.drivers.forEach((dv) => {
    body.append(h('tr', {},
      h('td', {}, h('b', { class: 'tnum' }, dayLabel(dv.date))),
      h('td', {}, dv.service),
      h('td', {}, dv.route, dv.note ? h('div', { class: 'sub' }, dv.note) : null),
      h('td', { class: 'tnum' }, dv.hours),
      h('td', {}, h('a', { class: 'lk', href: dv.link, target: '_blank', rel: 'noopener noreferrer' }, 'Directions')),
    ));
  });
  $('#drivers-note').textContent = TRIP.driversNote;
}

/* ── bookings ───────────────────────────────────────────────────────────── */

const U_LABEL = { now: 'Do now', week: 'This week', soon: 'Before you go' };

function renderBookings() {
  const host = $('#bookings');
  TRIP.bookings.forEach((b) => {
    host.append(h('div', { class: `book-item u-${b.urgency} reveal` },
      h('div', { class: 'pri tnum' }, String(b.priority).padStart(2, '0')),
      h('div', {},
        h('h4', {}, b.item, h('span', { class: 'u-flag' }, U_LABEL[b.urgency])),
        h('p', {}, b.detail)),
      b.link ? h('a', { class: 'lk', href: b.link, target: '_blank', rel: 'noopener noreferrer' }, 'Open') : null,
    ));
  });

  $('#ruled-out').append(...TRIP.bookingsRuledOut.map((r) =>
    h('p', {}, h('b', {}, r.item), ' — ', r.reason)));
}

/* ── budget ─────────────────────────────────────────────────────────────── */

const BUDGET_COLORS = ['var(--terracotta)', 'var(--tyrrhenian)', 'var(--olive)', 'var(--gold)', 'var(--ink-3)'];

function renderBudget() {
  const host = $('#budget');
  const max = Math.max(...TRIP.budget.map((b) => b.amount));
  const total = TRIP.budget.reduce((s, b) => s + b.amount, 0);

  TRIP.budget.forEach((b, i) => {
    const k = BUDGET_COLORS[i % BUDGET_COLORS.length];
    host.append(h('div', { class: 'brow', style: { '--k': k } },
      h('div', { class: 'cat' }, b.category, h('span', { class: 'sub' }, b.note)),
      h('div', { class: 'bar' }, h('i', { style: { width: (b.amount / max * 100).toFixed(1) + '%' } })),
      h('div', { class: 'amt tnum' }, money(b.amount)),
    ));
  });

  $('#budget-total').textContent = money(total);
}

/* ── photographers, flags, portals ──────────────────────────────────────── */

function renderPhotographers() {
  const body = $('#photo-body');
  TRIP.photographers.forEach((p) => {
    body.append(h('tr', {},
      h('td', {}, h('b', {}, p.location), h('div', { class: 'sub' }, p.days)),
      h('td', {}, p.spots),
      h('td', {}, p.platform, h('div', { class: 'sub' }, '小红书: ', p.xhs)),
      h('td', { class: 'tnum' }, p.price),
      h('td', {},
        h('a', { class: 'lk', href: p.link, target: '_blank', rel: 'noopener noreferrer' }, 'Book'),
        ' ',
        h('a', { class: 'lk', href: p.xhsLink, target: '_blank', rel: 'noopener noreferrer' }, '小红书')),
    ));
  });
  $('#photo-note').textContent = TRIP.photographersNote;
}

function renderPortals() {
  $('#portals').append(...TRIP.portals.map((p) =>
    h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, p.name)));
}

/* ── chrome: theme, scroll spy, reveal ──────────────────────────────────── */

function initTheme() {
  const btn = $('#theme');
  const root = document.documentElement;
  const set = (t) => {
    root.dataset.theme = t;
    btn.textContent = t === 'dark' ? '☀' : '☾';
    btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    try { localStorage.setItem('italy26-theme', t); } catch {}
  };
  let saved = null;
  try { saved = localStorage.getItem('italy26-theme'); } catch {}
  set(saved || 'light');
  btn.addEventListener('click', () => set(root.dataset.theme === 'dark' ? 'light' : 'dark'));
}

function initSpy() {
  const chips = new Map([...document.querySelectorAll('.chip')].map((c) => [Number(c.dataset.day), c]));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const n = Number(e.target.id.split('-')[1]);
      chips.forEach((c, k) => c.classList.toggle('is-current', k === n));
      const chip = chips.get(n);
      if (chip) chip.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('.day').forEach((d) => io.observe(d));
}

function initReveal() {
  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      obs.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach((n) => io.observe(n));
}

/* ── go ─────────────────────────────────────────────────────────────────── */

renderMast();
renderRail();
renderDays();
renderHotels();
renderDrivers();
renderBookings();
renderBudget();
renderPhotographers();
renderPortals();
initTheme();
initSpy();
initReveal();

$('#revised').textContent = fmt(TRIP.meta.revised, { day: 'numeric', month: 'long', year: 'numeric' });
