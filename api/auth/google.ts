/**
 * POST { code, redirectUri } → { token, email, scopes }
 *
 * The second factor. The passphrase is shared between two people and is eight
 * lowercase characters; on its own it should not stand between a stranger and
 * booking references that can cancel the trip. This narrows access to two named
 * Google accounts.
 *
 * It deliberately requires an existing 'edit' token, so this is an *upgrade*
 * rather than a second door: passing Google without knowing the passphrase gets
 * you nothing. Both factors, or neither.
 *
 * No Google SDK is involved anywhere. The browser navigates to Google's consent
 * page and comes back with a code; the exchange happens here, server-side. That
 * is not squeamishness — plan.html is checked at build time for external
 * <script src>, and loading Google's client library would fail the build.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, requireAuth, issueToken, rateLimited } from '../_lib/auth.js';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Who is allowed through, by verified Google email. */
function allowlist(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The email claim out of an id_token.
 *
 * The token arrives over TLS directly from Google's token endpoint in exchange
 * for a code and our client secret, so the signature adds nothing here — it is
 * already an authenticated channel. Reading the payload is enough, and it keeps
 * a JWT verification dependency out of a project that has two.
 */
function claims(idToken: string): { email?: string; email_verified?: boolean } {
  const part = idToken.split('.')[1];
  if (!part) return {};
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Must already hold the passphrase token — this upgrades it, never replaces it.
  const session = requireAuth(req, res, 'edit');
  if (!session) return;

  if (rateLimited(req)) {
    return res.status(429).json({ error: 'too many attempts — wait a minute' });
  }

  const { code, redirectUri } = (req.body ?? {}) as { code?: string; redirectUri?: string };
  if (!code || !redirectUri) return res.status(400).json({ error: 'code and redirectUri required' });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('[auth/google] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set');
    return res.status(500).json({ error: 'Google sign-in is not configured' });
  }

  try {
    const r = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!r.ok) {
      // A spent or mismatched code lands here. Say so plainly rather than
      // leaking Google's error body to the browser.
      console.error('[auth/google] token exchange failed', r.status, await r.text());
      return res.status(401).json({ error: 'Google sign-in failed — try again' });
    }

    const { id_token: idToken } = (await r.json()) as { id_token?: string };
    if (!idToken) return res.status(401).json({ error: 'Google returned no identity' });

    const { email, email_verified: verified } = claims(idToken);
    const who = email?.toLowerCase();

    // An unverified address is not an identity: Google lets an account carry one
    // it has never proved, and the allowlist is only worth as much as the proof.
    if (!who || !verified) return res.status(403).json({ error: 'that Google account has no verified email' });

    if (!allowlist().includes(who)) {
      return res.status(403).json({ error: `${who} is not on the list for this trip` });
    }

    // Keep the initials the traveller chose at the passphrase step — authorship
    // in the UI stays theirs, and the email is not shown next to their comments.
    return res
      .status(200)
      .json({ token: issueToken(session.by, ['edit', 'tickets']), email: who, scopes: ['edit', 'tickets'] });
  } catch (err) {
    console.error('[auth/google]', err);
    return res.status(500).json({ error: 'could not reach Google' });
  }
}
