/* The same `h()` plan.js and deck.js each carry. The editing modules share one
   copy rather than adding a third — the pages keep theirs because they are
   independent entry points; these are not. */

// A deliberate, narrow exception to this file having no dependents that
// import back into it (overlay.js, edit-ui.js and comments.js all import
// *from* here, never the reverse — that must stay true, since comments.js
// owns anchorTo() and already imports this module). renderSubRow() below
// needs exactly one write action — deleting a subitem — not overlay.js's
// whole read/paint surface. Safe: overlay.js's only import is itinerary.json,
// so this direction alone doesn't create a cycle.
import { deleteSubitem } from './overlay.js';

export const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) n.style.setProperty(sk, sv); else n.style[sk] = sv;
      }
    } else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** "day.4.items.2.time" → "Day 4 · stop 3 · time", for the review list. */
export function pathLabel(path) {
  let m = /^day\.(\d+)\.note$/.exec(path);
  if (m) return `Day ${m[1]} · note`;
  m = /^day\.(\d+)\.items\.(\d+)\.subitems\.([a-z0-9_]+)\.([a-z]+)$/.exec(path);
  if (m) return `Day ${m[1]} · stop ${+m[2] + 1} · subitem · ${m[4]}`;
  m = /^day\.(\d+)\.items\.(\d+)\.skipped$/.exec(path);
  if (m) return `Day ${m[1]} · stop ${+m[2] + 1} · removed`;
  m = /^day\.(\d+)\.items\.(\d+)\.([a-z]+)$/.exec(path);
  if (m) return `Day ${m[1]} · stop ${+m[2] + 1} · ${m[3]}`;
  return path;
}

/* ── multiline text: a plain sentence, or a short bullet list ─────────────
 *
 * The grammar is one rule: a line starting with "- ", "* " or "• " is a
 * bullet. Any lines before the first bullet are an intro; a string with no
 * bullet line at all is just a sentence, unchanged from before this existed.
 * A bullet indented further than the one above it nests under it — depth
 * comes from comparing indentation, not a fixed tab width, so two spaces,
 * four, or a stray extra space from a fat thumb all parse the same way.
 *
 * Returns real nodes built with textContent, never innerHTML — a bullet list
 * carries no more injection risk than the plain string it replaces. */
const BULLET = /^(\s*)[-*•]\s+(.*)$/;

function parseBullets(lines) {
  const root = h('ul', { class: 'bullets' });
  // Each frame is the <ul> currently being appended to, the indent its items
  // sit at, and the last <li> given to it — the anchor a deeper line nests
  // under. The sentinel starts at indent -1 so the first bullet, whatever its
  // indent, becomes a top-level item in `root` rather than one level deeper
  // than necessary.
  const stack = [{ indent: -1, ul: root, lastLi: null }];

  for (const raw of lines) {
    const m = BULLET.exec(raw);
    if (!m) continue;
    const indent = m[1].replace(/\t/g, '  ').length;
    const content = m[2].trim();
    if (!content) continue;

    while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
    let frame = stack[stack.length - 1];

    if (indent > frame.indent) {
      if (frame.lastLi) {
        // Genuinely deeper than the item above: a new list nested inside it.
        const ul = h('ul', { class: 'bullets' });
        frame.lastLi.append(ul);
        frame = { indent, ul, lastLi: null };
        stack.push(frame);
      } else {
        // The very first bullet, or a level whose parent never got a line —
        // adopt this indent as the frame's own rather than nesting one deep
        // for no reason.
        frame.indent = indent;
      }
    }

    const li = h('li', {}, content);
    frame.ul.append(li);
    frame.lastLi = li;
  }
  return root;
}

export function richNodes(text) {
  const raw = String(text ?? '');
  if (!raw) return [];

  const lines = raw.split('\n');
  const first = lines.findIndex((l) => BULLET.test(l));
  if (first === -1) return [document.createTextNode(raw)];

  const nodes = [];
  const intro = lines.slice(0, first).join('\n').trim();
  if (intro) nodes.push(document.createTextNode(intro + '\n'));
  nodes.push(parseBullets(lines.slice(first)));
  return nodes;
}

/* ── subitems: a lightweight, timestamped aside nested under a stop ───────
 *
 * Shared between plan.js (paints the base/folded-back set at first load) and
 * edit-ui.js (reconciles in whatever's overlay-only, born live). One factory
 * so the two never drift into slightly different row shapes.
 *
 * Deliberately doesn't wire the comment anchor itself — anchorTo() lives in
 * comments.js, which imports this module, so this file cannot import it back
 * without cycling. Each caller wires it on the row this returns, exactly like
 * plan.js already does for `.tl` rows, hotel cards and booking rows. */

/** One `.tl-sub` row. `s` is `{id, time, title, detail}`. */
export function renderSubRow(dayN, itemIdx, s) {
  const p = `day.${dayN}.items.${itemIdx}.subitems.${s.id}`;
  return h('li', { class: 'tl-sub', 'data-sub-id': s.id },
    h('button', {
      type: 'button', class: 'tl-sub-toggle', 'aria-expanded': 'true', 'aria-label': 'Collapse',
      onClick: (e) => {
        e.stopPropagation();
        const li = e.currentTarget.closest('.tl-sub');
        const collapsed = li.classList.toggle('is-collapsed');
        e.currentTarget.setAttribute('aria-expanded', String(!collapsed));
      },
    }),
    h('div', { class: 'tl-sub-time tnum', 'data-path': `${p}.time` }, s.time || ''),
    h('div', { class: 'tl-sub-main' },
      h('span', { class: 'tl-sub-title', 'data-path': `${p}.title` }, s.title || ''),
      h('div', { class: 'tl-sub-detail', 'data-path': `${p}.detail` }, ...richNodes(s.detail || ''))),
    h('button', {
      type: 'button', class: 'tl-sub-del', title: 'Remove', 'aria-label': 'Remove subitem',
      onClick: (e) => { e.stopPropagation(); deleteSubitem(dayN, itemIdx, s.id); },
    }, '×'),
  );
}
