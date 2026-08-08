/* ── Italy 2026 · what to buy ───────────────────────────────────────────────
 *
 * Its own page rather than a section of the plan, for one reason: the district
 * view needs three.js, and plan.html has no other use for it. Bundling it there
 * put half a megabyte on a document whose whole premise is that it opens from
 * file:// and survives being emailed. Here the cost falls only on whoever opens
 * the shopping page.
 *
 * Nothing is fetched at runtime — no tiles, no API. This page is offline in the
 * same way the deck is.
 */

import TRIP from '../../data/itinerary.json';
import STREETS from '../geo/streets.json';
import { createShopMap } from './shopmap.js';

/* Local helpers, deliberately not shared with plan.js or deck.js — see
   CLAUDE.md: each entry carries its own copy rather than importing one. */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
};

const CATS = [
  ['apparel', 'Apparel'],
  ['jewelry', 'Jewellery'],
  ['other', 'Everything else'],
];

const S = TRIP.shopping;

$('#shop-note').textContent = S.note;
$('#shop-count').textContent = `${S.places.length} stops · Rome`;

$('#shop-legend').append(...CATS.map(([key, label]) =>
  h('span', { class: `shop-key k-${key}` }, label)));

const card = $('#shop-card');
let view = null;

function showCard(p) {
  card.textContent = '';
  // Node.append() turns null into a literal "null" text node, so the optional
  // rows are filtered rather than passed through.
  card.append(...[
    h('div', { class: `shop-card-top k-${p.category}` },
      h('h3', {}, p.name),
      h('span', { class: 'shop-street' }, p.street)),
    p.cheaper ? h('span', { class: 'shop-flag' }, 'Cheaper here than at home') : null,
    h('dl', { class: 'shop-facts' },
      h('dt', {}, 'Sells'), h('dd', {}, p.sells),
      h('dt', {}, 'Price'), h('dd', {}, p.price)),
    h('p', { class: 'shop-why' }, p.why),
    // A street gets a pin on the road, not at a door. Say so rather than
    // implying a precision the coordinate does not have.
    p.precise ? null : h('p', { class: 'shop-approx' }, 'Marked on the street, not at a doorway'),
  ].filter(Boolean));

  view?.select(p.name);
  $$('.shop-row').forEach((r) => r.classList.toggle('is-on', r.dataset.shop === p.name));
}

const list = $('#shop-list');
for (const [key, label] of CATS) {
  const inCat = S.places.filter((p) => p.category === key);
  if (!inCat.length) continue;
  list.append(h('h4', { class: `shop-cat k-${key}` }, label));
  list.append(...inCat.map((p) => h('button', {
    class: 'shop-row', type: 'button', 'data-shop': p.name,
    onClick: () => showCard(p),
  }, h('b', {}, p.name), h('span', {}, p.street))));
}

$('#shop-vat').append(h('h4', {}, S.vat.headline), h('p', {}, S.vat.detail));

$('#shop-else').append(
  h('h4', {}, 'Elsewhere on the trip'),
  ...S.elsewhere.map((e) => h('p', {}, h('b', {}, e.name), ' — ', e.detail)));

showCard(S.places[0]);

/* The scene is built when the stage first comes into view. On this page it is
   above the fold, so that is almost immediately — but it keeps the WebGL
   context out of the critical path on a phone. */
const stage = $('.shop-stage');
const io = new IntersectionObserver((entries, obs) => {
  if (!entries.some((e) => e.isIntersecting)) return;
  obs.disconnect();
  view = createShopMap($('#shop-canvas'), STREETS, S.places, showCard);
  if (view) {
    view.select(S.places[0].name);
  } else {
    // No WebGL. The list and the cards are the substance; drop the picture and
    // say so rather than leaving a dead grey rectangle.
    stage.classList.add('no-gl');
    $('#shop-hint').textContent = 'This browser cannot draw the 3D view — the list below is unaffected.';
  }
}, { rootMargin: '200px' });
io.observe(stage);
