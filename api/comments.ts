/**
 * GET   → every thread
 * POST  { anchor, text }        → append one comment
 * PATCH { anchor, id, resolved } → resolve / reopen
 *
 * Comments post immediately. They are conversation about the plan, not changes
 * to it — holding one behind an Apply button would be the wrong shape, and a
 * comment cannot corrupt the itinerary.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, requireAuth, newId } from './_lib/auth.js';
import { isValidAnchor, MAX_COMMENT } from './_lib/schema.js';
import { readComments, appendComment, appendComments, setResolved } from './_lib/store.js';
import type { Comment } from './_lib/schema.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const session = requireAuth(req, res);
  if (!session) return;

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ comments: await readComments() });
    }

    if (req.method === 'POST') {
      const body = (req.body ?? {}) as { anchor?: string; text?: string; queued?: Comment[] };

      // A client that was offline flushes its queue in one request. Ids were
      // minted client-side, so a double-flush is idempotent under union-by-id.
      if (Array.isArray(body.queued) && body.queued.length) {
        const doc: Record<string, Comment[]> = {};
        for (const c of body.queued.slice(0, 100)) {
          if (!isValidAnchor(c.anchor)) continue;
          const text = String(c.text ?? '').trim().slice(0, MAX_COMMENT);
          if (!text) continue;
          (doc[c.anchor] ??= []).push({
            id: c.id || newId(),
            anchor: c.anchor,
            by: session.by,
            at: Number(c.at) || Date.now(),
            text,
          });
        }
        return res.status(200).json({ comments: await appendComments(doc) });
      }

      const anchor = String(body.anchor ?? '');
      const text = String(body.text ?? '').trim();
      if (!isValidAnchor(anchor)) {
        return res.status(400).json({ error: 'that is not a part of the plan' });
      }
      if (!text) return res.status(400).json({ error: 'say something' });

      const comment: Comment = {
        id: newId(),
        anchor,
        by: session.by,
        at: Date.now(),
        text: text.slice(0, MAX_COMMENT),
      };
      return res.status(200).json({ comments: await appendComment(comment), comment });
    }

    if (req.method === 'PATCH') {
      const { anchor, id, resolved } = (req.body ?? {}) as {
        anchor?: string;
        id?: string;
        resolved?: boolean;
      };
      if (!anchor || !id) return res.status(400).json({ error: 'anchor and id required' });
      return res
        .status(200)
        .json({ comments: await setResolved(anchor, id, Boolean(resolved)) });
    }

    return res.status(405).json({ error: 'GET, POST or PATCH' });
  } catch (err) {
    console.error('[comments]', err);
    return res.status(500).json({ error: 'could not reach the store' });
  }
}
