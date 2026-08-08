/** POST { passphrase, by } → { token }. The only unauthenticated endpoint. */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, issueToken, rateLimited } from './_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (rateLimited(req)) {
    return res.status(429).json({ error: 'too many attempts — wait a minute' });
  }

  const { passphrase, by } = (req.body ?? {}) as { passphrase?: string; by?: string };
  if (!passphrase || passphrase !== process.env.EDIT_PASSPHRASE) {
    // Deliberately vague, and identical timing-wise to a missing passphrase.
    return res.status(401).json({ error: 'that passphrase is not right' });
  }

  // The passphrase alone buys 'edit'. Tickets need a Google account on the
  // allowlist as well — see api/auth/google.ts.
  //
  // The Google client id rides along here rather than from its own public
  // endpoint. It is not a secret — it ends up in a URL the browser visits — but
  // handing it out only after the passphrase keeps the unauthenticated surface
  // of this API at exactly one route.
  const initial = (by ?? '?').trim().slice(0, 2).toUpperCase() || '?';
  return res.status(200).json({
    token: issueToken(initial, ['edit']),
    by: initial,
    scopes: ['edit'],
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? null,
  });
}
