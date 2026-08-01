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

const PAGES = [
  { out: 'plan.html',         tpl: 'src/plan.template.html',         entry: 'src/js/plan.js', css: ['src/styles/base.css', 'src/styles/plan.css'] },
  { out: 'presentation.html', tpl: 'src/presentation.template.html', entry: 'src/js/deck.js', css: ['src/styles/base.css', 'src/styles/deck.css'] },
];

/* ── typefaces, inlined ───────────────────────────────────────────────────
   The CSS is concatenated as-is rather than run through esbuild, so it can't
   import a .woff2 the way src/js/images.js imports artwork. Instead the faces
   are base64'd here and substituted into base.css's __FONTS__ placeholder.
   A data: URL keeps the self-containment rule below satisfied.

   Archivo carries both a weight and a width axis in one file, which is what
   lets the display role be genuinely Expanded rather than faked with
   letter-spacing. Latin only, upright only — no italic is used anywhere in
   the design, and shipping one would cost more than the mono faces combined.
   All three are SIL OFL 1.1. */
const FONTS = [
  { family: 'Archivo', weight: '100 900', stretch: '62% 125%',
    file: 'node_modules/@fontsource-variable/archivo/files/archivo-latin-standard-normal.woff2' },
  { family: 'Martian Mono', weight: '400', stretch: '100%',
    file: 'node_modules/@fontsource/martian-mono/files/martian-mono-latin-400-normal.woff2' },
  { family: 'Martian Mono', weight: '700', stretch: '100%',
    file: 'node_modules/@fontsource/martian-mono/files/martian-mono-latin-700-normal.woff2' },
];

const fontFaces = FONTS.map(({ family, weight, stretch, file }) => {
  const p = r(file);
  if (!existsSync(p)) throw new Error(`missing typeface ${file} — run npm install`);
  const b64 = readFileSync(p).toString('base64');
  return `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};`
    + `font-stretch:${stretch};font-display:swap;`
    + `src:url(data:font/woff2;charset=utf-8;base64,${b64}) format("woff2");}`;
}).join('\n');

/** A literal `</script` inside bundled JS or CSS would close the host tag early. */
const safe = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1');

const kb = (s) => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(0);

mkdirSync(r('dist'), { recursive: true });

for (const page of PAGES) {
  if (!existsSync(r(page.tpl)) || !existsSync(r(page.entry))) {
    console.log(`  … skipping ${page.out} (sources not present yet)`);
    continue;
  }

  const css = page.css
    .map((f) => readFileSync(r(f), 'utf8'))
    .join('\n')
    .replace('__FONTS__', () => fontFaces);

  if (css.includes('__FONTS__')) throw new Error(`${page.out}: __FONTS__ was not substituted`);

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

/* ── self-check: nothing may reference the network ───────────────────────── */

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

let bad = 0;
for (const page of PAGES) {
  const p = r('dist', page.out);
  if (!existsSync(p)) continue;
  const html = readFileSync(p, 'utf8');
  for (const [re, label] of OFFENDERS) {
    if (re.test(html)) { console.error(`  ✗ ${page.out}: contains ${label}`); bad++; }
  }
  console.log(`  ✓ ${page.out} is self-contained (${(statSync(p).size / 1024).toFixed(0)} KB on disk)`);
}
if (bad) process.exit(1);
