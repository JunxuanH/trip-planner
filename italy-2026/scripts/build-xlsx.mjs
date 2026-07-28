/**
 * Rebuilds the seven-tab workbook from data/itinerary.json.
 *
 * Keeps the original tab names, column order and link labels so it reads as the
 * same document, with the reordered dates and corrected booking URLs.
 */
import ExcelJS from 'exceljs';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const trip = JSON.parse(readFileSync(join(root, 'data/itinerary.json'), 'utf8'));

const utc = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const short = (iso) => utc(iso).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const md = (iso) => utc(iso).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

/* ── styling helpers ────────────────────────────────────────────────────── */

const INK = 'FF241F1A', MUTED = 'FF7A6E62', TERRA = 'FF9E4529';
const BAND = 'FFF3ECE0', HEADBG = 'FF241F1A';

const wb = new ExcelJS.Workbook();
wb.creator = 'Italy 2026 planner';
wb.created = new Date();

function sheet(name, widths) {
  const ws = wb.addWorksheet(name, {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 16 },
  });
  ws.columns = widths.map((w) => ({ width: w }));
  return ws;
}

const headerRow = (ws, cells) => {
  const r = ws.addRow(cells);
  r.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
  r.alignment = { vertical: 'middle' };
  r.height = 22;
  r.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADBG } };
  });
  return r;
};

const link = (text, url) => (url ? { text, hyperlink: url } : text);
const styleLinks = (row) => {
  row.eachCell((c) => {
    if (c.value && typeof c.value === 'object' && c.value.hyperlink) {
      c.font = { color: { argb: 'FF1F5F7A' }, underline: true, size: 10 };
    }
  });
};

const title = (ws, text, sub) => {
  const t = ws.addRow([text]);
  t.font = { bold: true, size: 16, color: { argb: INK } };
  t.height = 26;
  if (sub) {
    const s = ws.addRow([sub]);
    s.font = { size: 10, italic: true, color: { argb: MUTED } };
  }
  ws.addRow([]);
};

/* ── 1 · Overview ───────────────────────────────────────────────────────── */
{
  const ws = sheet('Overview', [30, 92]);
  title(ws, 'ITALY 2026 PLAN', `Updated ${short(trip.meta.revised)}`);

  const pairs = [
    ['Travelers', String(trip.meta.travelers)],
    ['On-ground window', `${trip.meta.window} (${trip.meta.nights} nights)`],
    ['Arrival', trip.meta.arrival],
    ['Departure', trip.meta.departure],
    ['Route', trip.meta.routeLine],
    ['Transport', trip.meta.transportLine],
    ['Chain story', trip.meta.chainStory],
  ];
  for (const [k, v] of pairs) {
    const r = ws.addRow([k, v]);
    r.getCell(1).font = { bold: true, size: 10, color: { argb: INK } };
    r.getCell(2).font = { size: 10 };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  }

  ws.addRow([]);
  const h2 = ws.addRow(['HOW TO READ THIS WORKBOOK']);
  h2.font = { bold: true, size: 11, color: { argb: INK } };
  const guide = [
    ['Itinerary tab', "Hour-by-hour plan. 'Getting there' = how to travel between stops; 'Link' opens tickets/reservations."],
    ['Hotels tab', '6 hotels with booking links.'],
    ['Budget tab', 'Estimated costs and totals.'],
    ['Drivers tab', 'Self-drive log, FCO to FCO, with a Google Maps link per leg.'],
    ['Opera & Bookings tab', 'What to reserve, in order, most urgent first.'],
    ['Photographers tab', '旅拍 options per stop.'],
  ];
  for (const [k, v] of guide) {
    const r = ws.addRow([k, v]);
    r.getCell(1).font = { bold: true, size: 10 };
    r.getCell(2).font = { size: 10 };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  }

  ws.addRow([]);
  const h3 = ws.addRow(['QUICK BOOKING PORTALS']);
  h3.font = { bold: true, size: 11, color: { argb: INK } };
  for (const p of trip.portals) {
    const r = ws.addRow([p.name, link(p.url, p.url)]);
    r.getCell(1).font = { bold: true, size: 10 };
    styleLinks(r);
  }
}

/* ── 2 · Itinerary ──────────────────────────────────────────────────────── */
{
  const ws = sheet('Itinerary', [6, 13, 10, 62, 34, 14]);
  headerRow(ws, ['Day', 'Date', 'Time', 'Activity / Plan', 'Getting there', 'Link']);

  for (const d of trip.days) {
    const head = ws.addRow([d.n, short(d.date), d.kicker]);
    head.font = { bold: true, size: 11, color: { argb: INK } };
    head.height = 20;
    head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } }; });
    head.getCell(3).alignment = { horizontal: 'left' };

    if (d.transfer) {
      head.getCell(6).value = 'TRAVEL DAY';
      head.getCell(6).font = { bold: true, size: 8, color: { argb: TERRA } };
    }

    if (d.warn) {
      const n = ws.addRow(['', '', '', 'Watch this: ' + d.warn]);
      n.getCell(4).font = { italic: true, size: 9, color: { argb: 'FF8A6D1F' } };
      n.getCell(4).alignment = { wrapText: true, vertical: 'top' };
    }

    for (const it of d.items) {
      const tags = [it.optional && '[optional]'].filter(Boolean).join(' ');
      const label = it.linkLabel ? `${it.linkLabel} ->` : null;
      const r = ws.addRow([
        '', '', it.time,
        (tags ? tags + ' ' : '') + it.title + (it.detail ? ` — ${it.detail}` : ''),
        it.how || '',
        it.link ? link(label, it.link) : '',
      ]);
      r.getCell(3).font = { size: 9, color: { argb: MUTED } };
      r.getCell(4).font = { size: 10 };
      r.getCell(4).alignment = { wrapText: true, vertical: 'top' };
      r.getCell(5).font = { size: 9, color: { argb: MUTED } };
      r.getCell(5).alignment = { wrapText: true, vertical: 'top' };
      styleLinks(r);
    }
    ws.addRow([]);
  }
}

/* ── 3 · Hotels ─────────────────────────────────────────────────────────── */
{
  const ws = sheet('Hotels', [16, 32, 28, 13, 13, 8, 14, 14, 30]);
  headerRow(ws, ['City', 'Hotel', 'Brand / Program', 'Check-in', 'Check-out', 'Nights',
    'Est. nightly (USD)', 'Est. total (USD)', 'Book (Trip.com)']);

  for (const ht of trip.hotels) {
    const r = ws.addRow([
      ht.city, ht.name, ht.brand, short(ht.checkIn), short(ht.checkOut),
      ht.nights, ht.nightly, ht.total, link('Trip.com ->', ht.link),
    ]);
    r.getCell(7).numFmt = '$#,##0';
    r.getCell(8).numFmt = '$#,##0';
    styleLinks(r);
  }

  const total = trip.hotels.reduce((s, x) => s + x.total, 0);
  const nights = trip.hotels.reduce((s, x) => s + x.nights, 0);
  const t = ws.addRow(['', '', '', '', 'TOTAL', nights, '', total]);
  t.font = { bold: true };
  t.getCell(8).numFmt = '$#,##0';
}

/* ── 4 · Budget ─────────────────────────────────────────────────────────── */
{
  const ws = sheet('Budget', [30, 18, 74]);
  headerRow(ws, ['Category', 'Estimate (USD)', 'Notes']);

  for (const b of trip.budget) {
    const note = b.note + (b.fixNote ? `  (${b.fixNote})` : '');
    const r = ws.addRow([b.category, b.amount, note]);
    r.getCell(2).numFmt = '$#,##0';
    r.getCell(3).font = { size: 10 };
    r.getCell(3).alignment = { wrapText: true, vertical: 'top' };
    if (b.was != null) r.getCell(2).font = { bold: true, color: { argb: TERRA } };
  }

  const total = trip.budget.reduce((s, b) => s + b.amount, 0);
  const t = ws.addRow(['TOTAL', total, 'Cash, before points. Two travellers.']);
  t.font = { bold: true };
  t.getCell(2).numFmt = '$#,##0';
}

/* ── 5 · Drivers ────────────────────────────────────────────────────────── */
{
  const ws = sheet('Drivers', [13, 20, 62, 14, 14]);
  headerRow(ws, ['Date', 'Service', 'Route', 'Approx hours', 'Directions link']);

  for (const dv of trip.drivers) {
    const r = ws.addRow([
      md(dv.date), dv.service, dv.route + (dv.note ? `  (${dv.note})` : ''),
      dv.hours, link('Directions ->', dv.link),
    ]);
    r.getCell(3).alignment = { wrapText: true, vertical: 'top' };
    styleLinks(r);
  }

  ws.addRow([]);
  const n = ws.addRow(['', '', trip.driversNote]);
  n.getCell(3).font = { size: 10 };
  n.getCell(3).alignment = { wrapText: true, vertical: 'top' };
  n.height = 44;
}

/* ── 6 · Opera & Bookings ───────────────────────────────────────────────── */
{
  const ws = sheet('Opera & Bookings', [6, 52, 68, 14, 14]);
  headerRow(ws, ['#', 'Item', 'Status / Detail', 'Urgency', 'Link']);

  const U = { now: 'DO NOW', week: 'THIS WEEK', soon: 'BEFORE YOU GO' };
  for (const b of trip.bookings) {
    const r = ws.addRow([b.priority, b.item, b.detail, U[b.urgency], link('Open ->', b.link)]);
    r.getCell(2).font = { bold: true, size: 10 };
    r.getCell(3).font = { size: 10 };
    r.getCell(3).alignment = { wrapText: true, vertical: 'top' };
    r.getCell(4).font = {
      bold: true, size: 9,
      color: { argb: b.urgency === 'now' ? TERRA : b.urgency === 'week' ? 'FF8A6D1F' : MUTED },
    };
    styleLinks(r);
  }

  ws.addRow([]);
  const h = ws.addRow(['', 'RULED OUT']);
  h.getCell(2).font = { bold: true, size: 10, color: { argb: MUTED } };
  for (const r0 of trip.bookingsRuledOut) {
    const r = ws.addRow(['', r0.item, r0.reason]);
    r.getCell(2).font = { size: 10 };
    r.getCell(3).font = { size: 10, italic: true, color: { argb: MUTED } };
  }
}

/* ── 7 · Photographers ──────────────────────────────────────────────────── */
{
  const ws = sheet('Photographers', [22, 12, 34, 54, 22, 16, 14, 14]);
  headerRow(ws, ['Location', 'Days', 'Recommended platform', 'Best spots & timing',
    'Chinese-speaking route', 'Est. price', 'Book', '小红书']);

  for (const p of trip.photographers) {
    const r = ws.addRow([
      p.location, p.days, p.platform, p.spots, '小红书: ' + p.xhs, p.price,
      link('Flytographer ->', p.link), link('小红书 ->', p.xhsLink),
    ]);
    r.getCell(4).alignment = { wrapText: true, vertical: 'top' };
    r.getCell(4).font = { size: 10 };
    styleLinks(r);
  }

  ws.addRow([]);
  const n = ws.addRow(['', '', '', trip.photographersNote]);
  n.getCell(4).font = { size: 10 };
  n.getCell(4).alignment = { wrapText: true, vertical: 'top' };
  n.height = 58;
}

/* ── write ──────────────────────────────────────────────────────────────── */

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', 'Italy 2026 (revised).xlsx');
await wb.xlsx.writeFile(out);
console.log(`  ✓ ${out.replace(root + '\\', '').replace(root + '/', '')}  (${wb.worksheets.length} tabs)`);
