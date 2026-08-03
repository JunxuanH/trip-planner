/**
 * POST { dayN, instruction } → { patch, rejected, summary }
 *
 * Turns "push dinner to 9 and note the ferry was late" into an overlay patch.
 *
 * Two things make this safe to use casually:
 *
 *   1. It PROPOSES. Nothing here writes to the store. The response goes into
 *      the client's draft layer and the traveller applies it — the model has no
 *      privileged path to the live plan that a person typing doesn't have.
 *   2. It is validated. `validatePatch` is the same function /api/overlay uses,
 *      so a model that invents `day.12.items.3.price` gets it dropped and
 *      reported rather than stored.
 *
 * Only one day is sent — about 1-2k tokens rather than the whole 50k itinerary.
 * That keeps it cheap and accurate, and is why whole-trip restructuring stays a
 * conversation rather than a button.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, requireAuth } from './_lib/auth.js';
import { dayContext, validatePatch, ITEM_TEXT_FIELDS } from './_lib/schema.js';

/* Constructed per request, not at module load: `new Anthropic()` throws when
   the key is missing, and at module scope that crashes the whole function on a
   cold start — a 500 with no body instead of a sentence saying what is wrong. */
let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

const SYSTEM = `You edit one day of a travel itinerary.

You are given the day as JSON and an instruction from the traveller. Return a
list of edits, containing ONLY the fields the instruction actually asks to
change. Never restate a field whose value you are not changing.

Each edit is a path and its new value. The paths you may write:
  day.<n>.items.<i>.time     a clock time, exactly like "9:30am" or "12:05pm"
  day.<n>.items.<i>.title    short label for the stop
  day.<n>.items.<i>.detail   the descriptive sentence(s)
  day.<n>.items.<i>.how      how you get there, e.g. "Walk, ~10 min"
  day.<n>.note               the day's note line

<n> is the day number you were given. <i> is the item's "index" field.

Rules:
- Times must stay in order through the day. If moving one stop would put it
  before the one above it, move the others too and say so in your summary.
- Nothing else is editable. Coordinates, dates, hotels and prices are fixed —
  if the instruction asks for one of those, return no edits and explain in the
  summary that it needs a rebuild.
- Keep the existing voice: plain, specific, no exclamation marks, no filler.
- If the instruction is ambiguous, make the smaller change and say what you
  assumed.

Write the summary first, before the edits: say in one or two full sentences what
you are about to change and why, naming the stops you touch. It is what the
traveller reads to decide whether to accept the change, so a placeholder or a
single word is useless to them. Write it to be read, not parsed.`;

/**
 * A list, not a map. Structured outputs want closed schemas with named
 * properties; an object keyed by arbitrary dotted paths is exactly what that
 * subset can't express. The server folds it back into the overlay's map shape.
 */
const SCHEMA = {
  type: 'object',
  properties: {
    // `summary` is generated first because structured outputs emit properties in
    // schema order, and a model asked for it last writes it as an afterthought —
    // one live call came back with a nine-field patch summarised as "x". Stating
    // the intent before making the edits fixes that and reads better besides.
    summary: {
      type: 'string',
      description:
        'One or two full sentences for the traveller: what you are changing and why.',
    },
    edits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'e.g. day.4.items.2.time' },
          value: { type: 'string', description: 'the replacement text' },
        },
        required: ['path', 'value'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'edits'],
  additionalProperties: false,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return;
  const session = requireAuth(req, res);
  if (!session) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { dayN, instruction } = (req.body ?? {}) as { dayN?: number; instruction?: string };
  const day = dayContext(Number(dayN));
  if (!day) return res.status(400).json({ error: 'no such day' });

  const ask = String(instruction ?? '').trim();
  if (!ask) return res.status(400).json({ error: 'say what to change' });
  if (ask.length > 600) return res.status(400).json({ error: 'keep the instruction shorter' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'the Claude endpoint is not configured yet' });
  }

  try {
    const message = await anthropic().messages.create({
      model: 'claude-opus-5',
      max_tokens: 4096,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `Day ${day.n} (${day.date}) — ${day.title}\n\n${JSON.stringify(
            day,
            null,
            1,
          )}\n\nEditable item fields: ${ITEM_TEXT_FIELDS.join(', ')}\n\nInstruction: ${ask}`,
        },
      ],
    });

    // Refusals arrive as a normal 200 with an empty content array — reading
    // content[0] unconditionally would throw here.
    if (message.stop_reason === 'refusal') {
      return res.status(200).json({
        patch: {},
        rejected: [],
        summary: 'Claude declined to make that change.',
      });
    }

    // With thinking on, the JSON is in the last text block, not content[0].
    const block = message.content.filter((b) => b.type === 'text').at(-1);
    let parsed: { edits?: { path?: string; value?: string }[]; summary?: string } = {};
    try {
      parsed = JSON.parse(block && 'text' in block ? block.text : '{}');
    } catch {
      return res.status(502).json({ error: 'could not read the proposed change' });
    }

    const proposed: Record<string, string> = {};
    for (const e of Array.isArray(parsed.edits) ? parsed.edits.slice(0, 60) : []) {
      if (typeof e?.path === 'string') proposed[e.path] = String(e.value ?? '');
    }

    // Untrusted output. Same validator as a hand-made request.
    const { ok, rejected } = validatePatch(proposed, session.by);

    return res.status(200).json({
      patch: ok,
      rejected,
      summary: String(parsed.summary ?? '').slice(0, 800),
      usage: {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
      },
    });
  } catch (err) {
    console.error('[edit]', err);
    const status = err instanceof Anthropic.RateLimitError ? 429 : 502;
    const msg =
      err instanceof Anthropic.RateLimitError
        ? 'rate limited — try again shortly'
        : err instanceof Anthropic.AuthenticationError
          ? 'the server key is not valid'
          : 'could not reach Claude';
    return res.status(status).json({ error: msg });
  }
}
