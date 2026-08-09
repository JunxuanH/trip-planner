/**
 * The editable surface, and the validator that enforces it.
 *
 * This is the security boundary. Everything that can change the plan — a field
 * a person typed, a patch Claude proposed — goes through `validatePatch` before
 * it is stored, and Claude's output is treated as exactly as untrusted as a
 * hand-rolled HTTP request. The model is asked for a shape; it is not trusted
 * to have produced one.
 *
 * What is deliberately NOT editable here: coordinates, dates, hotel rows,
 * prices, budget figures. Those are load-bearing for scripts/verify.mjs — the
 * contiguous hotel chain, the weekday/date agreement, the lodging total
 * reconciling with the budget — and a value edited in a browser overlay would
 * never be seen by it. Structural changes stay a rebuild.
 */
// The attribute is required: Vercel runs these as real ESM on Node rather than
// bundling them, and Node refuses a JSON import without it. esbuild bundles the
// browser side, which is why plan.js can import the same file bare.
import TRIP from '../../italy-2026/data/itinerary.json' with { type: 'json' };

/** Text fields on a timeline item that a traveller may reword or re-time. */
export const ITEM_TEXT_FIELDS = ['time', 'title', 'detail', 'how'] as const;
/** Boolean flags on a timeline item. */
export const ITEM_FLAG_FIELDS = ['done', 'skipped'] as const;

export type ItemTextField = (typeof ITEM_TEXT_FIELDS)[number];
export type ItemFlagField = (typeof ITEM_FLAG_FIELDS)[number];

export const MAX_TEXT = { time: 12, title: 160, detail: 900, how: 80, note: 1200 };
/** Same grammar verify.mjs parses; an unparseable time would break its ordering check. */
const TIME_RE = /^\d{1,2}:\d{2}(am|pm)$/;

/**
 * A subitem is a lightweight, timestamped aside nested under a stop — e.g. a
 * 4pm gelato break during a 3-5pm walk. Deliberately lighter than a full item:
 * no coord/kind/how/link, because it shares its parent's pin and never gets
 * its own. Created live (a "+ Add subitem" button), not by a rebuild, so it
 * has no fixed array index — it is addressed by a client-minted id instead,
 * same open-path-space trick as everything else in this overlay.
 */
export const SUBITEM_TEXT_FIELDS = ['time', 'title', 'detail'] as const;
export type SubitemTextField = (typeof SUBITEM_TEXT_FIELDS)[number];
export const SUBITEM_MAX_TEXT = { time: 12, title: 120, detail: 400 };
/** A soft-ish cap — see subitemIdsFor()/api/overlay.ts for where it's enforced. */
export const MAX_SUBITEMS_PER_ITEM = 8;

export type Entry = { value: string | boolean; at: number; by: string };
export type Overlay = Record<string, Entry>;

const DAY_COUNT = TRIP.days.length;
const ITEM_COUNT = TRIP.days.map((d: { items: unknown[] }) => d.items.length);

export type PathKind =
  | { kind: 'item-text'; day: number; item: number; field: ItemTextField }
  | { kind: 'item-flag'; day: number; item: number; field: ItemFlagField }
  | { kind: 'day-note'; day: number }
  | { kind: 'subitem-text'; day: number; item: number; id: string; field: SubitemTextField }
  | { kind: 'subitem-flag'; day: number; item: number; id: string };

/**
 * Parse an overlay path, rejecting anything outside the editable surface.
 * Indices are checked against the real itinerary, so `day.99.items.400.title`
 * fails here rather than creating an orphan entry nothing will ever render.
 */
export function parsePath(path: string): PathKind | null {
  let m = /^day\.(\d+)\.note$/.exec(path);
  if (m) {
    const day = Number(m[1]);
    return day >= 1 && day <= DAY_COUNT ? { kind: 'day-note', day } : null;
  }

  // Checked before the generic item-field branch below: that branch's
  // `[a-z]+$` can't match a `.subitems.<id>.<field>` tail (extra dots), so
  // there's no collision either way — this just keeps the file's existing
  // most-specific-first shape.
  m = /^day\.(\d+)\.items\.(\d+)\.subitems\.([a-z0-9_]{1,40})\.([a-z]+)$/.exec(path);
  if (m) {
    const day = Number(m[1]);
    const item = Number(m[2]);
    const id = m[3];
    const field = m[4];
    if (day < 1 || day > DAY_COUNT) return null;
    if (item < 0 || item >= ITEM_COUNT[day - 1]) return null;
    if ((SUBITEM_TEXT_FIELDS as readonly string[]).includes(field)) {
      return { kind: 'subitem-text', day, item, id, field: field as SubitemTextField };
    }
    if (field === 'deleted') return { kind: 'subitem-flag', day, item, id };
    return null;
  }

  m = /^day\.(\d+)\.items\.(\d+)\.([a-z]+)$/.exec(path);
  if (!m) return null;
  const day = Number(m[1]);
  const item = Number(m[2]);
  const field = m[3];
  if (day < 1 || day > DAY_COUNT) return null;
  if (item < 0 || item >= ITEM_COUNT[day - 1]) return null;

  if ((ITEM_TEXT_FIELDS as readonly string[]).includes(field)) {
    return { kind: 'item-text', day, item, field: field as ItemTextField };
  }
  if ((ITEM_FLAG_FIELDS as readonly string[]).includes(field)) {
    return { kind: 'item-flag', day, item, field: field as ItemFlagField };
  }
  return null;
}

/**
 * Distinct subitem ids already under one item — base (folded into
 * itinerary.json, where a hand-written entry that forgot to copy its id
 * still counts, keyed by array position) union whatever the shared overlay
 * already knows. Used only to cap creation of new ids; never gates an edit
 * to an id that already exists — see api/overlay.ts.
 */
export function subitemIdsFor(day: number, item: number, overlay: Overlay): Set<string> {
  const ids = new Set<string>();
  const base = (TRIP.days[day - 1]?.items[item] as { subitems?: { id?: string }[] } | undefined)?.subitems ?? [];
  base.forEach((s, i) => ids.add(s?.id ?? `b_${i}`));
  const prefix = `day.${day}.items.${item}.subitems.`;
  for (const path of Object.keys(overlay)) {
    if (path.startsWith(prefix)) ids.add(path.slice(prefix.length).split('.')[0]);
  }
  // A tombstoned id doesn't count against the cap — deleting one is meant to
  // free its slot back up, same as it disappears from subitemsFor() client-side.
  for (const id of ids) {
    if (overlay[`${prefix}${id}.deleted`]?.value === true) ids.delete(id);
  }
  return ids;
}

export type Rejection = { path: string; reason: string };
export type ValidationResult = { ok: Overlay; rejected: Rejection[] };

/**
 * `detail` and `note` may hold a short bullet list — see `richNodes()` in
 * `src/js/dom.js` for the grammar this stores for. The client normalizes the
 * same way before it ever sends a patch; this exists because this endpoint
 * also receives Claude's proposed edits (`api/edit.ts`) and would accept a
 * hand-built HTTP request just as readily, and `CLAUDE.md` is explicit that
 * neither gets more trust than a person typing.
 *
 * Newlines are the one thing this must never collapse — that was the whole
 * bug this feature fixes. Leading whitespace on a line survives untouched too:
 * it is what tells a sub-bullet from a top-level one.
 */
function normalizeMultiline(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const m = /^(\s*)(.*)$/.exec(line)!;
      return m[1].replace(/\t/g, '  ') + m[2].replace(/[ \t]+/g, ' ').trimEnd();
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Filter a proposed patch down to what is allowed. Never throws on bad input —
 * a caller gets the clean subset plus a list of what was dropped and why, so a
 * partly-wrong Claude patch degrades to its good half instead of failing whole.
 */
export function validatePatch(patch: unknown, by: string, now = Date.now()): ValidationResult {
  const ok: Overlay = {};
  const rejected: Rejection[] = [];

  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok, rejected: [{ path: '(root)', reason: 'patch must be an object' }] };
  }

  for (const [path, raw] of Object.entries(patch as Record<string, unknown>)) {
    const parsed = parsePath(path);
    if (!parsed) {
      rejected.push({ path, reason: 'not an editable path' });
      continue;
    }

    // Accept either a bare value or a full {value,...} entry; ignore any
    // client-supplied `at`/`by` — the server stamps those itself so a client
    // cannot forge authorship or win a merge by claiming a future timestamp.
    const value =
      raw !== null && typeof raw === 'object' && 'value' in (raw as object)
        ? (raw as { value: unknown }).value
        : raw;

    if (parsed.kind === 'item-flag' || parsed.kind === 'subitem-flag') {
      const flagField = parsed.kind === 'item-flag' ? parsed.field : 'deleted';
      if (typeof value !== 'boolean') {
        rejected.push({ path, reason: `${flagField} must be true or false` });
        continue;
      }
      ok[path] = { value, at: now, by };
      continue;
    }

    if (typeof value !== 'string') {
      rejected.push({ path, reason: 'value must be a string' });
      continue;
    }

    if (parsed.kind === 'subitem-text') {
      const text = parsed.field === 'detail' ? normalizeMultiline(value) : value.trim();
      const cap = SUBITEM_MAX_TEXT[parsed.field];
      if (text.length > cap) {
        rejected.push({ path, reason: `${parsed.field} is longer than ${cap} characters` });
        continue;
      }
      if (parsed.field === 'time' && text && !TIME_RE.test(text)) {
        rejected.push({ path, reason: 'time must look like 9:30am or 12:05pm' });
        continue;
      }
      ok[path] = { value: text, at: now, by };
      continue;
    }

    const field = parsed.kind === 'day-note' ? 'note' : parsed.field;
    const text = field === 'detail' || field === 'note' ? normalizeMultiline(value) : value.trim();
    const cap = MAX_TEXT[field as keyof typeof MAX_TEXT];
    if (text.length > cap) {
      rejected.push({ path, reason: `${field} is longer than ${cap} characters` });
      continue;
    }
    if (field === 'time' && text && !TIME_RE.test(text)) {
      rejected.push({ path, reason: 'time must look like 9:30am or 12:05pm' });
      continue;
    }
    ok[path] = { value: text, at: now, by };
  }

  return { ok, rejected };
}

/* ── comments ───────────────────────────────────────────────────────────────
   Anchors are wider than editable paths: you can discuss the hotel and the
   booking list, not just the timeline rows you can edit. */

export const MAX_COMMENT = 2000;

export function isValidAnchor(anchor: string): boolean {
  if (parsePath(anchor)) return true;
  let m = /^day\.(\d+)$/.exec(anchor);
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= DAY_COUNT;
  m = /^day\.(\d+)\.items\.(\d+)$/.exec(anchor);
  if (m) {
    const day = Number(m[1]);
    return day >= 1 && day <= DAY_COUNT && Number(m[2]) < ITEM_COUNT[day - 1];
  }
  // No server-side registry of valid subitem ids to check against (same
  // laxness hotel.I/booking.I already have relative to their array bound) —
  // day/item bounds only. A comment on a since-deleted subitem is harmless.
  m = /^day\.(\d+)\.items\.(\d+)\.subitems\.([a-z0-9_]{1,40})$/.exec(anchor);
  if (m) {
    const day = Number(m[1]);
    return day >= 1 && day <= DAY_COUNT && Number(m[2]) < ITEM_COUNT[day - 1];
  }
  m = /^hotel\.(\d+)$/.exec(anchor);
  if (m) return Number(m[1]) < TRIP.hotels.length;
  m = /^booking\.(\d+)$/.exec(anchor);
  if (m) return Number(m[1]) < TRIP.bookings.length;
  return false;
}

export type Comment = {
  id: string;
  anchor: string;
  by: string;
  at: number;
  text: string;
  resolved?: boolean;
};

/** One day, shaped for the model — the only trip data /api/edit ever sends. */
export function dayContext(dayN: number) {
  const day = TRIP.days[dayN - 1];
  if (!day) return null;
  return {
    n: day.n,
    date: day.date,
    title: day.title,
    note: day.note ?? null,
    items: day.items.map((it: Record<string, unknown>, i: number) => ({
      index: i,
      time: it.time,
      title: it.title,
      detail: it.detail ?? '',
      how: it.how ?? '',
      // Read-only context for Claude — v1 never lets it create/edit one (see
      // api/edit.ts's SYSTEM prompt, which deliberately omits subitem paths
      // from what it may write).
      subitems: ((it.subitems as Record<string, unknown>[] | undefined) ?? []).map((s, j) => ({
        id: (s.id as string | undefined) ?? `b_${j}`,
        time: s.time,
        title: s.title,
      })),
    })),
  };
}
