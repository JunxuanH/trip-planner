/**
 * GET            → { tickets: [{ id, label, day, filename, size }] }
 * GET ?id=<id>   → the PDF bytes
 *
 * Both need the 'tickets' scope, which means the passphrase *and* a Google
 * account on the allowlist. An 'edit' token gets a 403 here, not a 401 — the
 * caller is signed in, they just have not cleared the second factor.
 *
 * The bytes are proxied rather than redirected. A 302 to the blob host would
 * make plan.html fetch a third origin, and its build gate asserts — positively,
 * in both directions — that the page talks to exactly two. Streaming through
 * here keeps that assertion true and keeps the blob URLs private as a bonus.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, requireAuth } from './_lib/auth.js';
import { listTickets, findTicket } from './_lib/tickets.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = requireAuth(req, res, 'tickets');
  if (!session) return;

  const id = typeof req.query.id === 'string' ? req.query.id : undefined;

  try {
    if (!id) {
      // The listing deliberately omits `url` — the browser never sees it.
      const tickets = (await listTickets()).map(({ url, ...rest }) => rest);
      return res.status(200).json({ tickets });
    }

    const ticket = await findTicket(id);
    if (!ticket) return res.status(404).json({ error: 'no such ticket' });

    const upstream = await fetch(ticket.url);
    if (!upstream.ok) {
      console.error('[tickets] blob fetch failed', ticket.id, upstream.status);
      return res.status(502).json({ error: 'could not read that ticket' });
    }

    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(bytes.length));
    // inline, so a phone opens it in the viewer rather than dumping it in Files.
    res.setHeader('Content-Disposition', `inline; filename="${ticket.filename}"`);
    // Private: this is a per-person document behind auth, and a shared cache
    // holding it would undo the point of the scope check above.
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(bytes);
  } catch (err) {
    console.error('[tickets]', err);
    return res.status(500).json({ error: 'could not reach the ticket store' });
  }
}
