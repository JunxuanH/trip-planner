/**
 * Bundles each page into ONE self-contained .html file.
 *
 * Both deliverables have to survive being emailed, opened from a USB stick, or
 * viewed on a plane — so every byte (CSS, JS, itinerary data, map geometry and
 * three.js) is inlined and nothing is fetched at runtime.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => join(root, ...p);

/* plan.html carries Leaflet's stylesheet ahead of its own so the map chrome can
   be restyled by plan.css. Leaflet's JS is bundled by esbuild like any import;
   only its CSS has to be spliced in here, the same way the page's own is. */
const PAGES = [
  { out: 'plan.html',         tpl: 'src/plan.template.html',         entry: 'src/js/plan.js',
    css: ['node_modules/leaflet/dist/leaflet.css', 'src/styles/base.css', 'src/styles/plan.css', 'src/styles/edit.css'] },
  { out: 'presentation.html', tpl: 'src/presentation.template.html', entry: 'src/js/deck.js',
    css: ['src/styles/base.css', 'src/styles/deck.css'] },
];

/** A literal `</script` inside bundled JS or CSS would close the host tag early. */
const safe = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1');

const kb = (s) => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(0);

mkdirSync(r('dist'), { recursive: true });

for (const page of PAGES) {
  if (!existsSync(r(page.tpl)) || !existsSync(r(page.entry))) {
    console.log(`  … skipping ${page.out} (sources not present yet)`);
    continue;
  }

  const css = page.css.map((f) => readFileSync(r(f), 'utf8')).join('\n');

  const result = await esbuild.build({
    entryPoints: [r(page.entry)],
    bundle: true,
    format: 'esm',
    target: ['es2022'],
    minify: true,
    write: false,
    loader: { '.json': 'json', '.webp': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl' },
    legalComments: 'none',
  });
  const js = result.outputFiles[0].text;

  const html = readFileSync(r(page.tpl), 'utf8')
    .replace('__CSS__', () => safe(css))
    .replace('__JS__', () => safe(js));

  // A stray placeholder means the template and this script disagree.
  for (const token of ['__CSS__', '__JS__']) {
    if (html.includes(token)) throw new Error(`${page.out}: ${token} was not substituted`);
  }

  writeFileSync(r('dist', page.out), html);
  console.log(`  ✓ dist/${page.out}  ${kb(html)} KB  (css ${kb(css)} KB · js ${kb(js)} KB)`);
}

/* ── self-check: what may reach the network ───────────────────────────────
   Both pages are still ONE file — no external script, stylesheet or iframe,
   nothing loaded at parse time. plan.html additionally makes two kinds of
   runtime request, each a deliberate, reviewed exception:

     basemaps.cartocdn.com     map tiles. Buys a real basemap; tilemap.js falls
                               back to the bundled SVG engine when they can't
                               be reached.
     trip-planner-api.vercel.app  the editing endpoints. Every edit is kept in
                               localStorage first, so the document still opens,
                               renders and accepts changes with no network.

   Both are allowlisted by host so the exceptions stay exactly that wide, and
   both are asserted positively — a page that stops requesting them fails too,
   which is how a silently-broken tile layer or a moved API host gets noticed.
   Anything else remote — a font, an analytics beacon, a second provider —
   fails the build the way it always did.

   presentation.html imports neither module and stays fully offline. */
const TILE_HOST = 'basemaps.cartocdn.com';
const API_HOST = 'trip-planner-api.vercel.app';

/** Hosts each page is allowed — and required — to talk to at runtime. */
const PAGE_HOSTS = {
  'plan.html': [TILE_HOST, API_HOST],
  'presentation.html': [],
};

/* Structural checks — these catch anything the browser would load while
   parsing the file, which is what "one file" means. An https:// inside an
   href the reader clicks, or inside a comment in a bundled library, is not a
   load and is not this list's business. */
const OFFENDERS = [
  [/<script[^>]+\bsrc\s*=/i,              'external <script src>'],
  [/<link[^>]+rel=["']?stylesheet/i,      'external stylesheet <link>'],
  [/@import\s+(url\()?["']?https?:/i,     'CSS @import over http'],
  [/url\(\s*["']?https?:\/\//i,           'CSS url() over http'],
  [/<img[^>]+\bsrc\s*=\s*["']https?:/i,   'remote <img>'],
  [/new\s+WebSocket\s*\(/i,               'WebSocket'],
  [/<iframe/i,                            '<iframe>'],
];

/* A literal URL passed to fetch() — the one runtime-request shape that gets
   past the structural checks above, since nothing about it is visible to the
   parser. Caught here and matched against the page's allowlist. */
const FETCH_LITERAL = /\bfetch\s*\(\s*["']https?:\/\/([^/"'`\s]+)/gi;

let bad = 0;
for (const page of PAGES) {
  const p = r('dist', page.out);
  if (!existsSync(p)) continue;
  const html = readFileSync(p, 'utf8');
  const allowed = PAGE_HOSTS[page.out] ?? [];

  for (const [re, label] of OFFENDERS) {
    if (re.test(html)) { console.error(`  ✗ ${page.out}: contains ${label}`); bad++; }
  }

  for (const m of html.matchAll(FETCH_LITERAL)) {
    if (allowed.includes(m[1])) continue;
    console.error(`  ✗ ${page.out}: runtime fetch() to ${m[1]}, which is not allowlisted`);
    bad++;
  }

  // Every allowed host must actually appear, and no page may reference a host
  // allowed only for the other one.
  for (const host of allowed) {
    if (!html.includes(host)) {
      console.error(`  ✗ ${page.out}: expected to reference ${host}, found none`);
      bad++;
    }
  }
  for (const host of [TILE_HOST, API_HOST]) {
    if (!allowed.includes(host) && html.includes(host)) {
      console.error(`  ✗ ${page.out}: must stay fully offline, but references ${host}`);
      bad++;
    }
  }

  const note = allowed.length
    ? `one file; reaches ${allowed.join(' and ')}, and works without either`
    : 'self-contained';
  console.log(`  ✓ ${page.out} is ${note} (${(statSync(p).size / 1024).toFixed(0)} KB on disk)`);
}
if (bad) process.exit(1);
