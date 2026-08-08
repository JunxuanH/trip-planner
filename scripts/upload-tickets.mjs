/**
 * One-off: push the booking PDFs into Vercel Blob.
 *
 *   BLOB_READ_WRITE_TOKEN=... node scripts/upload-tickets.mjs ./tickets-in
 *
 * Run it from a machine that has the PDFs. They are never committed — this repo
 * is public, and the documents carry order numbers and a GetYourGuide PIN. The
 * staging directory is gitignored; keep it that way.
 *
 * Idempotent by id: re-running replaces a ticket rather than adding a second
 * copy, so a re-issued voucher is a re-run and nothing else.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { put, list, del } from '@vercel/blob';

const PREFIX = 'italy2026/tickets/';

/** The ids api/_lib/tickets.ts knows how to label. Order matters below. */
const IDS = ['vatican-voucher', 'borghese-reservation', 'duomo-pass-junxuan', 'duomo-pass-hanji'];

/**
 * Filename fragment → ticket id, for the providers' own download names, so the
 * files can be dropped in exactly as they arrive by email.
 *
 * The two Duomo receipts differ only in a trailing digit — 59465436 is
 * Junxuan's, 59465437 is Hanji's — which is the whole reason this table exists.
 */
const MATCH = [
  ['voucher', 'vatican-voucher'],
  ['booking_is_reserved', 'borghese-reservation'],
  ['59465436', 'duomo-pass-junxuan'],
  ['59465437', 'duomo-pass-hanji'],
];

/**
 * A file already named after its id wins outright. Without this, renaming
 * something to the obvious `borghese-reservation.pdf` would match nothing and
 * be silently skipped — the opposite of what anyone tidying up would expect.
 */
const idFor = (name) =>
  IDS.find((id) => name.includes(id)) ?? MATCH.find(([frag]) => name.includes(frag))?.[1];

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/upload-tickets.mjs <directory-of-pdfs>');
  process.exit(1);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN is not set — get it from the Vercel Blob integration');
  process.exit(1);
}

const files = (await readdir(dir)).filter((f) => extname(f).toLowerCase() === '.pdf');
if (!files.length) {
  console.error(`no PDFs in ${dir}`);
  process.exit(1);
}

const existing = (await list({ prefix: PREFIX })).blobs;

let done = 0;
for (const file of files) {
  const id = idFor(file);
  if (!id) {
    console.log(`  · ${file} — no id match, skipped`);
    continue;
  }

  // Drop any previous copy of this id first, so ids stay unique.
  const stale = existing.filter((b) => b.pathname.slice(PREFIX.length).startsWith(id));
  for (const b of stale) await del(b.url);

  const body = await readFile(join(dir, file));
  const { pathname } = await put(`${PREFIX}${id}.pdf`, body, {
    access: 'public',
    contentType: 'application/pdf',
    addRandomSuffix: true,
  });

  console.log(`  ✓ ${id.padEnd(22)} ${(body.length / 1024).toFixed(0).padStart(5)} KB  → ${pathname}`);
  done++;
}

console.log(`\n${done} ticket${done === 1 ? '' : 's'} uploaded.`);
console.log('The URLs stay server-side; /api/tickets streams the bytes to signed-in browsers.');
