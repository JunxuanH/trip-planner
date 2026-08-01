/**
 * Invariant checks for data/itinerary.json.
 *
 * The reorder moves dates across six hotels, thirteen driver legs and a hundred-odd
 * timed activities. These assertions are the cheap way to know nothing drifted.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const trip = JSON.parse(readFileSync(join(root, 'data/itinerary.json'), 'utf8'));

const problems = [];
const fail = (msg) => problems.push(msg);

const DAY_MS = 86400000;
const toUTC = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const nightsBetween = (a, b) => (toUTC(b) - toUTC(a)) / DAY_MS;

/* ---------- days ---------- */

if (trip.days.length !== 14) fail(`expected 14 days, found ${trip.days.length}`);

trip.days.forEach((day, i) => {
  if (day.n !== i + 1) fail(`day at index ${i} is numbered ${day.n}`);
  if (!trip.cities[day.city]) fail(`day ${day.n} references unknown city "${day.city}"`);

  if (i > 0) {
    const gap = nightsBetween(trip.days[i - 1].date, day.date);
    if (gap !== 1) fail(`day ${day.n} is ${gap} day(s) after day ${day.n - 1}; expected exactly 1`);
  }

  const dow = new Date(toUTC(day.date)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  if (dow !== day.dow) fail(`day ${day.n} (${day.date}) is a ${dow}, but is labelled ${day.dow}`);

  if (!day.items?.length) fail(`day ${day.n} has no items`);
  day.items.forEach((item, j) => {
    const c = item.coord;
    if (!Array.isArray(c) || c.length !== 2 || !c.every(Number.isFinite)) {
      fail(`day ${day.n} item ${j + 1} ("${item.title}") has no usable coord`);
      return;
    }
    // Everything on this trip sits inside a generous box around Italy.
    if (c[0] < 36 || c[0] > 47 || c[1] < 6 || c[1] > 19) {
      fail(`day ${day.n} item ${j + 1} ("${item.title}") coord ${c} falls outside Italy`);
    }
    if (!item.time || !item.title) fail(`day ${day.n} item ${j + 1} is missing time or title`);
  });

  // Times must run forward within a day (all entries are same-day; none cross midnight).
  const mins = day.items.map((it) => {
    const m = /^(\d{1,2}):(\d{2})(am|pm)$/.exec(it.time.trim());
    if (!m) { fail(`day ${day.n}: unparseable time "${it.time}"`); return null; }
    let h = Number(m[1]) % 12;
    if (m[3] === 'pm') h += 12;
    return h * 60 + Number(m[2]);
  });
  for (let k = 1; k < mins.length; k++) {
    if (mins[k] !== null && mins[k - 1] !== null && mins[k] < mins[k - 1]) {
      fail(`day ${day.n}: "${day.items[k].title}" (${day.items[k].time}) runs before the previous item`);
    }
  }
});

if (trip.days[0].date !== trip.meta.start) fail('day 1 does not match meta.start');
if (trip.days.at(-1).date !== trip.meta.end) fail('day 14 does not match meta.end');

/* ---------- hotels: contiguous chain, 13 nights, no gaps or overlaps ---------- */

let totalNights = 0;
trip.hotels.forEach((h, i) => {
  const n = nightsBetween(h.checkIn, h.checkOut);
  if (n !== h.nights) fail(`${h.name}: ${h.checkIn}→${h.checkOut} is ${n} nights, declared ${h.nights}`);
  // Cents don't always divide evenly across nights — allow a penny of rounding slack.
  if (Math.abs(h.nightly * h.nights - h.total) > 0.02) fail(`${h.name}: ${h.nightly} × ${h.nights} ≠ ${h.total}`);
  totalNights += n;

  if (i > 0) {
    const prev = trip.hotels[i - 1];
    if (prev.checkOut !== h.checkIn) {
      fail(`gap or overlap: ${prev.name} checks out ${prev.checkOut}, ${h.name} checks in ${h.checkIn}`);
    }
  }
});

if (totalNights !== trip.meta.nights) fail(`hotel nights sum to ${totalNights}, meta says ${trip.meta.nights}`);
if (trip.hotels[0].checkIn !== trip.meta.start) fail('first check-in is not the arrival date');
if (trip.hotels.at(-1).checkOut !== trip.meta.end) fail('last check-out is not the departure date');

const lodging = trip.hotels.reduce((s, h) => s + h.total, 0);
const budgetLodging = trip.budget.find((b) => b.category === 'Lodging')?.amount;
if (lodging !== budgetLodging) fail(`hotel rows total ${lodging}, budget says ${budgetLodging}`);

/* ---------- every day's hotel matches the chain for that night ---------- */

trip.days.forEach((day) => {
  if (day.n === 14) return; // departure morning: no hotel that night
  const stay = trip.hotels.find((h) => day.date >= h.checkIn && day.date < h.checkOut);
  if (!stay) { fail(`day ${day.n} (${day.date}) falls outside every hotel stay`); return; }
  if (day.hotel !== stay.name) {
    fail(`day ${day.n} says "${day.hotel}", but ${day.date} is a ${stay.name} night`);
  }
});

/* ---------- booking URLs must carry the dates they claim ---------- */

const checkUrlDates = (url, where, expectIn, expectOut) => {
  if (!url || !url.includes('checkIn=')) return;
  const q = new URL(url).searchParams;
  if (q.get('checkIn') !== expectIn) fail(`${where}: URL checkIn=${q.get('checkIn')}, expected ${expectIn}`);
  if (q.get('checkOut') !== expectOut) fail(`${where}: URL checkOut=${q.get('checkOut')}, expected ${expectOut}`);
};

trip.hotels.forEach((h) => checkUrlDates(h.link, `${h.name} (hotels)`, h.checkIn, h.checkOut));

// The same booking URLs are repeated inside day items and the bookings list — they must agree.
const scanForHotelUrls = (link, where) => {
  if (!link?.includes('checkIn=')) return;
  const hotel = trip.hotels.find((h) => {
    try { return new URL(h.link).pathname === new URL(link).pathname; } catch { return false; }
  });
  if (hotel) checkUrlDates(link, where, hotel.checkIn, hotel.checkOut);
};
trip.days.forEach((d) => d.items.forEach((it, j) => scanForHotelUrls(it.link, `day ${d.n} item ${j + 1}`)));
trip.bookings.forEach((b) => scanForHotelUrls(b.link, `booking #${b.priority}`));

/* ---------- the reorder actually happened ---------- */

const order = trip.hotels.map((h) => h.cityKey);
const expected = ['rome', 'florence', 'tuscany', 'sorrento', 'rome'];
if (order.join('>') !== expected.join('>')) {
  fail(`hotel order is ${order.join(' → ')}, expected ${expected.join(' → ')}`);
}
// Checked by city slot, not hotel name — the specific property booked there can change.
const byCityKey = (key) => trip.hotels.find((h) => h.cityKey === key);
if (byCityKey('florence')?.checkIn !== '2026-08-27') fail('Florence stay did not start Aug 27');
if (byCityKey('tuscany')?.checkIn !== '2026-08-29') fail('Tuscany stay did not start Aug 29');

// The whole point of the replan: one bed for the working stretch, Aug 31 → Sep 5.
const coast = byCityKey('sorrento');
if (coast?.checkIn !== '2026-08-31' || coast?.checkOut !== '2026-09-05') {
  fail(`the coast base must run 2026-08-31 → 2026-09-05, found ${coast?.checkIn} → ${coast?.checkOut}`);
}
const workNights = trip.days.filter((d) => d.date >= '2026-08-31' && d.date < '2026-09-05');
if (new Set(workNights.map((d) => d.hotel)).size !== 1) {
  fail('the Aug 31 – Sep 5 stretch is split across more than one hotel');
}

/* ---------- links are well-formed ---------- */

const walkLinks = (obj, path = '') => {
  if (Array.isArray(obj)) return obj.forEach((v, i) => walkLinks(v, `${path}[${i}]`));
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if ((k === 'link' || k === 'url' || k === 'xhsLink') && typeof v === 'string') {
        try {
          if (!/^https:\/\//.test(v)) fail(`${path}.${k} is not https`);
          new URL(v);
        } catch { fail(`${path}.${k} is not a valid URL: ${v}`); }
      } else walkLinks(v, `${path}.${k}`);
    }
  }
};
walkLinks(trip, 'trip');

/* ---------- report ---------- */

const stops = trip.hotels.map((h) => `${h.city} ${h.nights}n`).join(' · ');
if (problems.length) {
  console.error(`\n  ✗ ${problems.length} problem${problems.length > 1 ? 's' : ''} in itinerary.json\n`);
  problems.forEach((p) => console.error(`    · ${p}`));
  console.error('');
  process.exit(1);
}

console.log(`
  ✓ itinerary.json is consistent

    14 days, ${trip.meta.start} → ${trip.meta.end}
    ${stops}
    ${totalNights} nights, hotel chain contiguous
    ${trip.days.reduce((s, d) => s + d.items.length, 0)} activities, all geocoded
    lodging $${lodging.toLocaleString()} reconciles with the budget
`);
