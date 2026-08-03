/* The same `h()` plan.js and deck.js each carry. The editing modules share one
   copy rather than adding a third — the pages keep theirs because they are
   independent entry points; these are not. */

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
  m = /^day\.(\d+)\.items\.(\d+)\.([a-z]+)$/.exec(path);
  if (m) return `Day ${m[1]} · stop ${+m[2] + 1} · ${m[3]}`;
  return path;
}
