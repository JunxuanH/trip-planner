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

  const initial = (by ?? '?').trim().slice(0, 2).toUpperCase() || '?';
  return res.status(200).json({ token: issueToken(initial), by: initial });
}
