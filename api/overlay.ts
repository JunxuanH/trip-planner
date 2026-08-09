/**
 * GET  → the shared overlay
 * PUT  { patch, clear? } → validate, merge, return the merged doc
 *
 * The client sends only what the traveller applied — drafts never reach here.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, requireAuth } from './_lib/auth.js';
import { validatePatch, parsePath, subitemIdsFor, MAX_SUBITEMS_PER_ITEM } from './_lib/schema.js';
import { readOverlay, writeOverlay, clearPaths } from './_lib/store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ overlay: await readOverlay() });
    }

    if (req.method === 'PUT') {
      const { patch, clear } = (req.body ?? {}) as { patch?: unknown; clear?: string[] };

      if (Array.isArray(clear) && clear.length) {
        const overlay = await clearPaths(clear.slice(0, 200));
        return res.status(200).json({ overlay, rejected: [] });
      }

      // Same validator the model's output goes through — a hand-crafted
      // request gets no more trust than a proposed patch.
      const { ok, rejected } = validatePatch(patch, session.by);

      // The per-item subitem cap can't live inside validatePatch — it's a
      // pure function with no view of the store, and api/edit.ts calls it
      // identically. So it's a second pass here, against the overlay this
      // request already needs to read anyway. Only blocks *new* ids past the
      // cap — editing an id already counted always passes.
      if (Object.keys(ok).length) {
        const current = await readOverlay();
        // Cache per (day,item) so a batched Apply carrying several fields for
        // the same new subitem doesn't re-count it — and so ids accepted
        // earlier in this same loop count against ids considered later, or a
        // batch creating several new subitems at once could each individually
        // pass a check against the pre-request count and collectively blow
        // past the cap.
        const known = new Map<string, Set<string>>();
        for (const path of Object.keys(ok)) {
          const parsed = parsePath(path);
          if (!parsed || (parsed.kind !== 'subitem-text' && parsed.kind !== 'subitem-flag')) continue;
          const key = `${parsed.day}.${parsed.item}`;
          const ids = known.get(key) ?? subitemIdsFor(parsed.day, parsed.item, current);
          known.set(key, ids);
          if (!ids.has(parsed.id)) {
            if (ids.size >= MAX_SUBITEMS_PER_ITEM) {
              delete ok[path];
              rejected.push({ path, reason: `at most ${MAX_SUBITEMS_PER_ITEM} subitems per stop` });
              continue;
            }
            ids.add(parsed.id);
          }
        }
      }

      const overlay = Object.keys(ok).length ? await writeOverlay(ok) : await readOverlay();
      return res.status(200).json({ overlay, rejected });
    }

    return res.status(405).json({ error: 'GET or PUT' });
  } catch (err) {
    console.error('[overlay]', err);
    return res.status(500).json({ error: 'could not reach the store' });
  }
}
