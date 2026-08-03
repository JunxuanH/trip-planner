/**
 * GET  → the shared overlay
 * PUT  { patch, clear? } → validate, merge, return the merged doc
 *
 * The client sends only what the traveller applied — drafts never reach here.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, requireAuth } from './_lib/auth.js';
import { validatePatch } from './_lib/schema.js';
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
      const overlay = Object.keys(ok).length ? await writeOverlay(ok) : await readOverlay();
      return res.status(200).json({ overlay, rejected });
    }

    return res.status(405).json({ error: 'GET or PUT' });
  } catch (err) {
    console.error('[overlay]', err);
    return res.status(500).json({ error: 'could not reach the store' });
  }
}
