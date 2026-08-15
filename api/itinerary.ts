/**
 * GET → { itinerary }.
 *
 * Needs the 'edit' scope — the same passphrase gate that already unlocks
 * comments and editing, not a new tier. This is what the whole document is
 * behind now, not just those features: plan.js fetches this on load instead
 * of having the itinerary bundled in, and renders nothing until it succeeds.
 *
 * Deliberately does not import italy-2026/data/itinerary.json. This
 * deployment builds from the same repo `dist/plan.html` does, so anything
 * importable here would be committed and public — which defeats the point.
 * The real data lives in Redis instead (readItinerary(), api/_lib/store.ts),
 * seeded by the local-only scripts/upload-itinerary.mjs. Nothing here writes
 * it back; that only ever happens from your machine.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, requireAuth } from './_lib/auth.js';
import { readItinerary } from './_lib/store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = requireAuth(req, res, 'edit');
  if (!session) return;

  try {
    const itinerary = await readItinerary();
    if (!itinerary) {
      // Not yet uploaded — a real state right after this feature ships on a
      // fresh Redis, not an error in the request itself.
      return res.status(503).json({ error: 'the plan has not been uploaded yet' });
    }
    // Private: this is the whole trip, not something to sit in a shared cache.
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ itinerary });
  } catch (err) {
    console.error('[itinerary]', err);
    return res.status(500).json({ error: 'could not reach the store' });
  }
}
