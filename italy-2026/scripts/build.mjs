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
    css: ['node_modules/leaflet/dist/leaflet.css', 'src/styles/base.css', 'src/styles/plan.css'] },
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
   nothing loaded at parse time. plan.html additionally asks for map tiles at
   runtime, which is a deliberate, reviewed exception: it buys a real basemap,
   and tilemap.js falls back to the bundled SVG engine when the tiles cannot be
   reached, so the document still opens and works from a USB stick on a plane.

   The exception is allowlisted by host so it stays exactly that wide. Anything
   else remote — a font, an analytics beacon, a second tile provider — fails the
   build the way it always did. */
const TILE_HOST = 'basemaps.cartocdn.com';

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
  [/\bfetch\s*\(\s*["']https?:/i,         'runtime fetch()'],
  [/new\s+WebSocket\s*\(/i,               'WebSocket'],
  [/<iframe/i,                            '<iframe>'],
];

/* The one relaxation, asserted rather than assumed: plan.html must request
   tiles from exactly this host, and presentation.html must not request any. */
const TILE_RULES = {
  'plan.html': true,
  'presentation.html': false,
};

let bad = 0;
for (const page of PAGES) {
  const p = r('dist', page.out);
  if (!existsSync(p)) continue;
  const html = readFileSync(p, 'utf8');

  for (const [re, label] of OFFENDERS) {
    if (re.test(html)) { console.error(`  ✗ ${page.out}: contains ${label}`); bad++; }
  }

  const wantsTiles = TILE_RULES[page.out];
  const hasTiles = html.includes(TILE_HOST);
  if (wantsTiles && !hasTiles) {
    console.error(`  ✗ ${page.out}: expected the ${TILE_HOST} tile layer, found none`);
    bad++;
  }
  if (wantsTiles === false && hasTiles) {
    console.error(`  ✗ ${page.out}: must stay fully offline, but references ${TILE_HOST}`);
    bad++;
  }

  const note = wantsTiles
    ? `one file; tiles from ${TILE_HOST}, SVG engine when offline`
    : 'self-contained';
  console.log(`  ✓ ${page.out} is ${note} (${(statSync(p).size / 1024).toFixed(0)} KB on disk)`);
}
if (bad) process.exit(1);
