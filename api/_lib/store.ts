/**
 * Storage for the two shared documents: the overlay and the comment threads.
 *
 * Both merge without coordination, which is the point — either traveller can be
 * offline for a day and reconnect without a lock, a transaction, or a lost
 * edit. They merge differently because they are different shapes:
 *
 *   overlay   per-path last-write-wins register map — newest `at` wins
 *   comments  append-only log — union by id, so appends commute
 *
 * The second is why comments are not modelled as overlay values: two people
 * commenting on the same stop would overwrite each other under LWW.
 */
import { Redis } from '@upstash/redis';
import type { Overlay, Comment } from './schema.js';

const KEY_OVERLAY = 'italy2026:overlay';
const KEY_COMMENTS = 'italy2026:comments';

let client: Redis | null = null;
function redis(): Redis {
  if (!client) client = Redis.fromEnv();
  return client;
}

/* ── overlay ─────────────────────────────────────────────────────────────── */

export async function readOverlay(): Promise<Overlay> {
  return (await redis().get<Overlay>(KEY_OVERLAY)) ?? {};
}

/** Newest write wins per path. Ties go to the incoming write. */
export function mergeOverlay(base: Overlay, incoming: Overlay): Overlay {
  const out: Overlay = { ...base };
  for (const [path, entry] of Object.entries(incoming)) {
    const held = out[path];
    if (!held || entry.at >= held.at) out[path] = entry;
  }
  return out;
}

export async function writeOverlay(incoming: Overlay): Promise<Overlay> {
  const merged = mergeOverlay(await readOverlay(), incoming);
  await redis().set(KEY_OVERLAY, merged);
  return merged;
}

/** An empty string clears a field back to what itinerary.json says. */
export async function clearPaths(paths: string[]): Promise<Overlay> {
  const overlay = await readOverlay();
  for (const p of paths) delete overlay[p];
  await redis().set(KEY_OVERLAY, overlay);
  return overlay;
}

/* ── comments ────────────────────────────────────────────────────────────── */

export type CommentDoc = Record<string, Comment[]>;

export async function readComments(): Promise<CommentDoc> {
  return (await redis().get<CommentDoc>(KEY_COMMENTS)) ?? {};
}

/**
 * Union by id, newest-resolved-state wins on a comment both sides know about.
 * No conflict is possible on the append itself — that is what makes an
 * offline-first comment thread safe without any merge policy.
 */
export function mergeComments(base: CommentDoc, incoming: CommentDoc): CommentDoc {
  const out: CommentDoc = {};
  for (const anchor of new Set([...Object.keys(base), ...Object.keys(incoming)])) {
    const byId = new Map<string, Comment>();
    for (const c of base[anchor] ?? []) byId.set(c.id, c);
    for (const c of incoming[anchor] ?? []) {
      const held = byId.get(c.id);
      byId.set(c.id, held ? { ...held, ...c } : c);
    }
    out[anchor] = [...byId.values()].sort((a, b) => a.at - b.at);
  }
  return out;
}

export async function appendComments(incoming: CommentDoc): Promise<CommentDoc> {
  const merged = mergeComments(await readComments(), incoming);
  await redis().set(KEY_COMMENTS, merged);
  return merged;
}

export const appendComment = (c: Comment) => appendComments({ [c.anchor]: [c] });

export async function setResolved(
  anchor: string,
  id: string,
  resolved: boolean,
): Promise<CommentDoc> {
  const doc = await readComments();
  const thread = doc[anchor];
  const target = thread?.find((c) => c.id === id);
  if (target) {
    target.resolved = resolved;
    await redis().set(KEY_COMMENTS, doc);
  }
  return doc;
}
