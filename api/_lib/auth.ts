/**
 * A shared passphrase, exchanged for a short-lived signed token.
 *
 * Right-sized for two people and a public URL: it stops a stranger who finds
 * the link from editing the plan. It is not an identity system — `by` is a
 * self-chosen initial for attribution in the UI, not an authenticated claim.
 */
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // a travelling day
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 8;

/**
 * The signing key. Falls back to the passphrase so the thing works with one
 * env var set, but prefer a separate TOKEN_SECRET: changing the passphrase then
 * doesn't silently invalidate every live token, and the value you type into a
 * phone on a train is not also the key.
 */
function secret(): string {
  const s = process.env.TOKEN_SECRET || process.env.EDIT_PASSPHRASE;
  if (!s) throw new Error('neither TOKEN_SECRET nor EDIT_PASSPHRASE is set');
  return s;
}

const sign = (payload: string) =>
  createHmac('sha256', secret()).update(payload).digest('base64url');

/** Constant-time compare that can't leak length through an early return. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function issueToken(by: string): string {
  const payload = `${by}.${Date.now() + TOKEN_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined): { by: string } | null {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i);
  if (!safeEqual(token.slice(i + 1), sign(payload))) return null;
  const [by, expiry] = payload.split('.');
  if (!by || !expiry || Number(expiry) < Date.now()) return null;
  return { by };
}

/* In-memory rate limit. Serverless instances are ephemeral and not shared, so
   this is a speed bump rather than a guarantee — enough to make guessing a
   passphrase impractical, and it costs no round trip to the store. */
const attempts = new Map<string, { n: number; until: number }>();

export function rateLimited(req: VercelRequest): boolean {
  const ip = String(req.headers['x-forwarded-for'] ?? 'unknown').split(',')[0].trim();
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.until < now) {
    attempts.set(ip, { n: 1, until: now + WINDOW_MS });
    return false;
  }
  rec.n += 1;
  return rec.n > MAX_ATTEMPTS;
}

/** The plan is served from Pages; the API lives on Vercel. One known origin. */
export function cors(req: VercelRequest, res: VercelResponse): boolean {
  const allowed = process.env.ALLOWED_ORIGIN ?? 'https://junxuanh.github.io';
  const origin = req.headers.origin;
  if (origin === allowed) res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function bearer(req: VercelRequest): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

/** Guard for every endpoint that touches trip data. */
export function requireAuth(req: VercelRequest, res: VercelResponse): { by: string } | null {
  const session = verifyToken(bearer(req));
  if (!session) {
    res.status(401).json({ error: 'sign in to edit' });
    return null;
  }
  return session;
}

export const newId = () => `c_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
