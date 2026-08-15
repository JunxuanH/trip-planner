/**
 * Push the real, local italy-2026/data/itinerary.json into Redis, where
 * api/itinerary.ts reads it from. This is the one step that gets a data
 * change from your machine to what plan.html actually shows — pushing to git
 * no longer does that, since the file isn't tracked there anymore (see
 * italy-2026/data/itinerary.sample.json and CLAUDE.md).
 *
 *   node --env-file=.env.local scripts/upload-itinerary.mjs
 *
 * (or export KV_REST_API_URL / KV_REST_API_TOKEN yourself first — same pair
 * api/_lib/store.ts reads, already in .env.local from `vercel env pull`).
 *
 * Whole-document overwrite, so it's idempotent — re-running after fixing a
 * typo just replaces the old copy, no partial state possible.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Redis } from '@upstash/redis';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'italy-2026/data/itinerary.json');
const KEY = 'italy2026:itinerary';

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) {
  console.error('no Redis credentials in the environment — see the usage comment at the top of this file');
  process.exit(1);
}

let itinerary;
try {
  itinerary = JSON.parse(await readFile(file, 'utf8'));
} catch (err) {
  console.error(`could not read ${file} — this file is gitignored and local-only; restore it from your own backup`);
  console.error(err.message);
  process.exit(1);
}

const redis = new Redis({ url, token });
await redis.set(KEY, itinerary);

console.log(`✓ uploaded ${file} (${(JSON.stringify(itinerary).length / 1024).toFixed(0)} KB) → ${KEY}`);
console.log('plan.html will pick this up on the next sign-in or reload — nothing to rebuild or redeploy.');
