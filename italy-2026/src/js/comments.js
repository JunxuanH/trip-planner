/* ── comments ─────────────────────────────────────────────────────────────
 *
 * A comment is not an edit. "Should we push this later?" is a question about
 * the plan, not a change to it, so it posts immediately — there is no review
 * tray here, and there shouldn't be: holding a message behind an Apply button
 * would be the wrong shape, and a comment cannot corrupt the itinerary.
 *
 * Threads are anchored to paths the overlay already understands, widened past
 * the editable fields: a timeline stop, a whole day, a hotel card, a booking
 * row. Anything with a stable identity can carry a conversation, including the
 * places "did we actually pay this?" belongs.
 *
 * Threads open in a side panel rather than expanding inline. The day view is
 * dense already, and a thread that pushes the timeline around while you read it
 * makes the plan harder to use, not easier.
 */

import { h, $, $$ } from './dom.js';
import {
  state, threadFor, unreadCount, markSeen, postComment, resolveComment, onChange,
} from './overlay.js';

let panel, panelBody, panelTitle, openAnchor = null;

const when = (ts) => new Date(ts).toLocaleString('en-GB', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

/* ── the panel ───────────────────────────────────────────────────────────── */

function buildPanel() {
  panelTitle = h('b', {});
  panelBody = h('div', { class: 'cm-body' });

  const input = h('textarea', { class: 'cm-input', rows: '2', placeholder: 'Add a comment…' });
  const send = h('button', { type: 'button', class: 'mini-btn solid' }, 'Post');

  const post = async () => {
    const text = input.value.trim();
    if (!text || !openAnchor) return;
    input.value = '';
    await postComment(openAnchor, text);
    panelBody.scrollTop = panelBody.scrollHeight;
  };
  send.addEventListener('click', post);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post();
    e.stopPropagation();
  });

  panel = h('aside', { class: 'cm-panel', id: 'cm-panel', 'aria-label': 'Comments' },
    h('div', { class: 'cm-head' },
      panelTitle,
      h('button', { type: 'button', class: 'cm-close', 'aria-label': 'Close', onClick: closePanel }, '×')),
    panelBody,
    h('div', { class: 'cm-compose' }, input, send),
  );
  document.body.append(panel);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && openAnchor) closePanel(); });
}

function renderThread() {
  if (!openAnchor) return;
  const thread = threadFor(openAnchor);
  panelBody.textContent = '';

  if (!thread.length) {
    panelBody.append(h('p', { class: 'cm-empty' }, 'No comments yet.'));
    return;
  }

  panelBody.append(...thread.map((c) => h('div', {
    class: 'cm' + (c.resolved ? ' is-resolved' : '') + (c.pending ? ' is-pending' : ''),
  },
    h('div', { class: 'cm-meta' },
      h('span', { class: 'cm-by' }, c.by),
      h('span', { class: 'cm-at' }, c.pending ? 'unsent' : when(c.at)),
      // Resolving rather than deleting keeps the reasoning: six weeks later
      // "why isn't Pompeii in here" has an answer sitting next to the day.
      c.pending ? null : h('button', {
        type: 'button', class: 'cm-resolve',
        onClick: () => resolveComment(openAnchor, c.id, !c.resolved),
      }, c.resolved ? 'Reopen' : 'Resolve')),
    h('div', { class: 'cm-text' }, c.text),
  )));
  panelBody.scrollTop = panelBody.scrollHeight;
}

function openPanel(anchor, label) {
  openAnchor = anchor;
  panelTitle.textContent = label;
  panel.classList.add('is-on');
  document.body.classList.add('cm-open');
  markSeen(anchor);
  renderThread();
  panel.querySelector('.cm-input')?.focus();
}

function closePanel() {
  openAnchor = null;
  panel.classList.remove('is-on');
  document.body.classList.remove('cm-open');
  paintBadges();
}

/* ── the affordance on each anchorable row ───────────────────────────────── */

function paintBadges() {
  $$('[data-anchor]').forEach((el) => {
    const anchor = el.dataset.anchor;
    const btn = el.querySelector(':scope > .cm-mark');
    if (!btn) return;
    const n = threadFor(anchor).length;
    const unread = unreadCount(anchor);
    btn.textContent = n ? String(n) : '';
    btn.classList.toggle('has-thread', n > 0);
    btn.classList.toggle('has-unread', unread > 0);
    btn.setAttribute('aria-label', n ? `${n} comments` : 'Add a comment');
    el.classList.toggle('is-open-thread', anchor === openAnchor);
  });
}

/** Attach a comment button to an already-rendered element. */
export function anchorTo(el, anchor, label) {
  el.dataset.anchor = anchor;
  el.classList.add('has-cm');
  el.append(h('button', {
    class: 'cm-mark', type: 'button', title: 'Comments',
    onClick: (e) => { e.stopPropagation(); openPanel(anchor, label); },
  }));
}

export function mountComments() {
  buildPanel();
  onChange((what) => {
    if (what === 'comments' || what === 'all') { renderThread(); paintBadges(); }
  });
  paintBadges();
}
