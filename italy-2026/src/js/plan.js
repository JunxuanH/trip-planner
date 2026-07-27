/* ── Italy 2026 · the plan document ────────────────────────────────────── */

import TRIP from '../../data/itinerary.json';
import GEO from '../geo/italy.json';
import { createMap, groupStops, frameAspect, PIN_COLORS, PIN_LABELS } from './mapengine.js';

/* ── helpers ────────────────────────────────────────────────────────────── */

const $ = (sel, root = document) => root.querySelector(sel);
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

/* ── the change panel ───────────────────────────────────────────────────── */

function renderChange() {
  const c = TRIP.change;
  $('#change-head').textContent = c.headline;
  $('#change-sum').textContent = c.summary;

  const chain = (list, hi) => h('div', { class: 'route-chain' },
    list.flatMap((name, i) => [
      i ? h('b', {}, '→') : null,
      h('i', { class: hi.includes(name) ? 'hi' : '' }, name),
    ]).filter(Boolean));

  $('#routes').append(
    h('div', { class: 'route-row is-old' }, h('div', { class: 'tag' }, 'Was'), chain(c.oldRoute, [])),
    h('div', { class: 'route-row is-new' }, h('div', { class: 'tag' }, 'Now'), chain(c.newRoute, ['Florence', "Val d'Orcia"])),
  );

  $('#change-wins').append(...c.wins.map((t) => h('li', {}, t)));
  $('#change-costs').append(...c.costs.map((t) => h('li', {}, t)));
}

/* ── days ───────────────────────────────────────────────────────────────── */

const maps = new Map();

function renderDays() {
  const host = $('#days');

  TRIP.days.forEach((d) => {
    const c = accentOf(d.city);
    const stops = groupStops(d.items);

    const sec = h('section', { class: 'day reveal', id: `day-${d.n}`, style: { '--c': c } });

    /* head */
    const idx = h('div', { class: 'day-index' },
      h('span', { class: 'num' }, `DAY ${String(d.n).padStart(2, '0')}`),
      h('span', { class: 'date' }, fmt(d.date, { weekday: 'long', day: 'numeric', month: 'long' })),
      d.changed ? h('span', { class: 'badge moved' }, 'Rescheduled') : null,
      d.transfer ? h('span', { class: 'badge newleg' }, 'Travel day') : null,
    );

    const head = h('div', { class: 'day-head' },
      idx,
      h('h3', {}, d.title),
      h('div', { class: 'kicker' }, d.kicker),
      d.note ? h('p', { class: 'note' }, d.note) : null,
      d.changeNote ? h('div', { class: 'callout change' },
        h('span', { class: 'ic' }, '⇄'), h('div', {}, h('b', {}, 'What moved. '), d.changeNote)) : null,
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
        onMouseenter: () => maps.get(d.n)?.select(stopIdx),
        onMouseleave: () => maps.get(d.n)?.select(activeStop.get(d.n) ?? -1),
      },
        h('div', { class: 'tl-time tnum' }, it.time),
        h('div', { class: 'tl-main' },
          h('div', { class: 'tl-title' }, h('span', { class: 'idx' }, i + 1), it.title),
          it.detail ? h('div', { class: 'tl-detail' }, it.detail) : null,
          it.how ? h('div', { class: 'tl-how' }, it.how) : null,
          h('div', { class: 'tl-tags' },
            it.moved ? h('span', { class: 'mini moved' }, 'Moved') : null,
            it.isNew ? h('span', { class: 'mini newer' }, 'New') : null,
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
      h('button', { type: 'button', title: 'Zoom in', 'aria-label': 'Zoom in', onClick: () => maps.get(d.n).zoomIn() }, '+'),
      h('button', { type: 'button', title: 'Zoom out', 'aria-label': 'Zoom out', onClick: () => maps.get(d.n).zoomOut() }, '−'),
      h('button', { type: 'button', title: 'Reset view', 'aria-label': 'Reset view', onClick: () => { maps.get(d.n).reset(); clearStop(d.n); } }, '⟲'),
    );
    const hint = h('div', { class: 'map-hint' }, 'Drag to pan · scroll to zoom');
    frame.append(cap, tools, hint, info);

    const kinds = [...new Set(d.items.map((i) => i.kind))];
    const legend = h('div', { class: 'legend' },
      ...kinds.map((k) => h('i', { style: { '--k': PIN_COLORS[k] } }, PIN_LABELS[k] || k)));

    const mapWrap = h('div', { class: 'map-wrap' }, frame, legend);

    sec.append(head, h('div', { class: 'day-body' }, tl, mapWrap));
    host.append(sec);

    /* build the map once the element has a size */
    const api = createMap(frame, {
      stops, geo: GEO, alt: `Map of day ${d.n}: ${d.title}`,
      onPick: (i) => {
        if (i == null) return clearStop(d.n);
        const first = stops[i].nums[0] - 1;
        focusStop(d.n, i, first, false);
      },
    });
    frame.style.setProperty('--c', c);
    maps.set(d.n, api);
    mapInfo.set(d.n, { info, stops });
  });
}

/* ── linking the timeline and the map ───────────────────────────────────── */

const activeStop = new Map();
const mapInfo = new Map();

function focusStop(dayN, stopIdx, itemIdx, scroll = true) {
  const map = maps.get(dayN);
  if (!map || stopIdx < 0) return;
  activeStop.set(dayN, stopIdx);
  map.revealStop(stopIdx);

  const sec = document.getElementById(`day-${dayN}`);
  sec.querySelectorAll('.tl').forEach((r) => r.classList.toggle('is-active', Number(r.dataset.i) === itemIdx));

  const { info, stops } = mapInfo.get(dayN);
  const s = stops[stopIdx];
  info.textContent = '';
  info.append(
    h('span', { class: 'tnum' }, s.items.map((it) => it.time).join(' · ')),
    h('b', {}, s.label),
    s.items[0].detail ? h('div', {}, s.items[0].detail) : null,
  );
  info.classList.add('is-on');

  if (scroll) {
    const row = sec.querySelector(`.tl[data-i="${itemIdx}"]`);
    if (row && !isInView(row)) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function clearStop(dayN) {
  activeStop.delete(dayN);
  maps.get(dayN)?.select(-1);
  const sec = document.getElementById(`day-${dayN}`);
  sec?.querySelectorAll('.tl').forEach((r) => r.classList.remove('is-active'));
  mapInfo.get(dayN)?.info.classList.remove('is-on');
}

const isInView = (el) => {
  const r = el.getBoundingClientRect();
  return r.top >= 60 && r.bottom <= innerHeight - 20;
};

/* ── hotels ─────────────────────────────────────────────────────────────── */

function renderHotels() {
  const host = $('#hotels');
  TRIP.hotels.forEach((ht) => {
    host.append(h('div', { class: 'card reveal', style: { '--c': accentOf(ht.cityKey) } },
      h('div', { class: 'city' }, ht.city),
      h('h4', {}, ht.name),
      h('div', { class: 'brand' }, ht.brand),
      h('div', { class: 'blurb' }, ht.blurb),
      h('div', { class: 'dates' },
        h('b', { class: 'tnum' }, `${dayLabel(ht.checkIn)} → ${dayLabel(ht.checkOut)}`),
        h('span', {}, `${ht.nights} night${ht.nights > 1 ? 's' : ''}`)),
      ht.moved ? h('div', { class: 'was' },
        'Moved from ', h('s', {}, `${dayLabel(ht.wasCheckIn)} → ${dayLabel(ht.wasCheckOut)}`), ' — rebook') : null,
      h('div', { class: 'foot' },
        h('div', { class: 'price tnum' }, money(ht.total), ' ', h('small', {}, `· ${money(ht.nightly)}/night`)),
        h('a', { class: 'lk', href: ht.link, target: '_blank', rel: 'noopener noreferrer' }, 'Trip.com')),
    ));
  });

  const total = TRIP.hotels.reduce((s, x) => s + x.total, 0);
  $('#hotels-total').textContent = money(total);
}

/* ── logistics ──────────────────────────────────────────────────────────── */

function renderDrivers() {
  const body = $('#drivers-body');
  TRIP.drivers.forEach((dv) => {
    body.append(h('tr', { class: dv.isNew ? 'is-new' : dv.changed ? 'is-changed' : '' },
      h('td', {}, h('b', { class: 'tnum' }, dayLabel(dv.date))),
      h('td', {}, dv.service,
        dv.isNew ? h('span', { class: 'mini newer', style: { marginLeft: '.4rem' } }, 'New') : null,
        dv.changed ? h('span', { class: 'mini moved', style: { marginLeft: '.4rem' } }, 'Moved') : null),
      h('td', {}, dv.route, dv.note ? h('div', { class: 'sub' }, dv.note) : null),
      h('td', { class: 'tnum' }, dv.hours),
      h('td', {}, h('a', { class: 'lk', href: dv.link, target: '_blank', rel: 'noopener noreferrer' }, 'Quote')),
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
    const delta = b.was != null ? b.amount - b.was : 0;
    host.append(h('div', { class: 'brow', style: { '--k': k } },
      h('div', { class: 'cat' }, b.category, h('span', { class: 'sub' }, b.note)),
      h('div', { class: 'bar' }, h('i', { style: { width: (b.amount / max * 100).toFixed(1) + '%' } })),
      h('div', { class: 'amt tnum' }, money(b.amount),
        delta ? h('span', { class: 'delta' }, (delta > 0 ? '+' : '−') + money(Math.abs(delta))) : null),
    ));
  });

  $('#budget-total').textContent = money(total);
  $('#budget-note').textContent =
    TRIP.budget.filter((b) => b.fixNote).map((b) => `${b.category}: ${b.fixNote}`).join('  ');
}

/* ── photographers, flags, portals ──────────────────────────────────────── */

function renderPhotographers() {
  const body = $('#photo-body');
  TRIP.photographers.forEach((p) => {
    body.append(h('tr', { class: p.moved ? 'is-changed' : '' },
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

const FLAG_TICK = { fixed: '✓', note: '·', watch: '⚠' };

function renderFlags() {
  const host = $('#flags');
  TRIP.flags.forEach((f) => {
    host.append(h('div', { class: `flag f-${f.level} reveal` },
      h('div', { class: 'tick' }, FLAG_TICK[f.level] || '·'),
      h('div', {}, h('h4', {}, f.title), h('p', {}, f.detail)),
    ));
  });
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
  set(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
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
renderChange();
renderDays();
renderHotels();
renderDrivers();
renderBookings();
renderBudget();
renderPhotographers();
renderFlags();
renderPortals();
initTheme();
initSpy();
initReveal();

$('#revised').textContent = fmt(TRIP.meta.revised, { day: 'numeric', month: 'long', year: 'numeric' });
