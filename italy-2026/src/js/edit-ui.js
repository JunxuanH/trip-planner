/* ── edit mode ────────────────────────────────────────────────────────────
 *
 * Two ways to change the plan, one tray to review them in.
 *
 * Direct manipulation is the primary path: turn on edit mode and the times,
 * titles, details and notes become editable in place. Asking Claude is for the
 * awkward cases — "shift everything after lunch back an hour" — where typing a
 * sentence beats editing six fields.
 *
 * Both land in `draft`. Nothing is shared, persisted to the server, or visible
 * to the other traveller until Apply. Until then a changed field renders as
 * pending, in place, so you see the day as it would be rather than reading a
 * diff and imagining it.
 */

import { h, $, $$, pathLabel } from './dom.js';
import {
  state, effective, baseValue, setDraft, setDrafts, discardDraft, draftPaths,
  applyDraft, revertApplied, signIn, onChange, proposeEdit, sync,
} from './overlay.js';

let editing = false;

/* ── painting values back into the page ──────────────────────────────────── */

/**
 * The page is rendered once, imperatively, by plan.js. Rather than rebuild it
 * on every overlay change — which would tear down fourteen lazily-built maps —
 * we repaint the handful of nodes carrying a `data-path`.
 */
export function repaint() {
  $$('[data-path]').forEach((el) => {
    const path = el.dataset.path;
    const { value, source, by } = effective(path);
    // Don't fight the caret: skip the field being typed in right now.
    if (document.activeElement !== el) el.textContent = value ?? '';
    el.classList.toggle('is-draft', source === 'draft');
    el.classList.toggle('is-theirs', source === 'applied' && by && by !== state.by);
    el.classList.toggle('is-mine', source === 'applied' && by === state.by);
    el.title = source === 'applied' && by !== state.by ? `changed by ${by}` : '';
  });
}

/* ── inline editing ──────────────────────────────────────────────────────── */

function bindField(el) {
  el.addEventListener('focus', () => { el.dataset.wasBefore = el.textContent; });
  el.addEventListener('blur', () => {
    const next = el.textContent.replace(/\s+/g, ' ').trim();
    if (next !== el.dataset.wasBefore) setDraft(el.dataset.path, next);
    else repaint();
  });
  // Enter commits rather than inserting a line break — these are one-liners,
  // except the detail, where a paragraph is reasonable.
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { el.textContent = el.dataset.wasBefore; el.blur(); }
    e.stopPropagation();
  });
  // A field inside a timeline row: typing shouldn't fly the map to the stop.
  el.addEventListener('click', (e) => { if (editing) e.stopPropagation(); });
}

function setEditing(on) {
  editing = on;
  document.body.classList.toggle('editing', on);
  $$('[data-path]').forEach((el) => {
    el.contentEditable = on ? 'plaintext-only' : 'false';
    if (on && !el.dataset.bound) { el.dataset.bound = '1'; bindField(el); }
  });
  $('#edit-toggle')?.setAttribute('aria-pressed', String(on));
  repaint();
}

/* ── the review tray ─────────────────────────────────────────────────────── */

function renderTray() {
  const tray = $('#tray');
  const paths = draftPaths();
  tray.classList.toggle('is-on', paths.length > 0);
  tray.textContent = '';
  if (!paths.length) return;

  const rows = h('div', { class: 'tray-rows' }, ...paths.map((path) => {
    const from = state.applied[path] ? state.applied[path].value : baseValue(path);
    const to = state.draft[path].value;
    const reason = state.draft[path].reason;
    return h('div', { class: 'tray-row' + (reason ? ' is-rejected' : '') },
      h('div', { class: 'tray-where' }, pathLabel(path)),
      h('div', { class: 'tray-diff' },
        h('del', {}, String(from) || '(empty)'),
        h('ins', {}, String(to) || '(cleared)')),
      reason ? h('div', { class: 'tray-reason' }, 'Rejected: ', reason) : null,
      h('div', { class: 'tray-row-acts' },
        h('button', { type: 'button', class: 'mini-btn', onClick: () => applyDraft([path]) }, 'Apply'),
        h('button', { type: 'button', class: 'mini-btn ghost', onClick: () => discardDraft([path]) }, 'Discard')),
    );
  }));

  tray.append(
    h('div', { class: 'tray-head' },
      h('b', {}, paths.length, paths.length === 1 ? ' unapplied change' : ' unapplied changes'),
      h('div', { class: 'tray-acts' },
        h('button', { type: 'button', class: 'mini-btn ghost', onClick: () => discardDraft() }, 'Discard all'),
        h('button', { type: 'button', class: 'mini-btn solid', onClick: () => applyDraft() }, 'Apply all')),
    ),
    rows,
  );
}

/* ── asking Claude ───────────────────────────────────────────────────────── */

function askBox(dayN) {
  const input = h('input', {
    type: 'text', class: 'ask-input', maxlength: '600',
    placeholder: 'Shift everything after lunch back an hour…',
  });
  const out = h('div', { class: 'ask-out' });
  const btn = h('button', { type: 'button', class: 'mini-btn solid' }, 'Ask');

  async function run() {
    const instruction = input.value.trim();
    if (!instruction) return;
    btn.disabled = true;
    out.textContent = 'Thinking…';
    out.className = 'ask-out is-busy';

    const r = await proposeEdit(dayN, instruction);
    btn.disabled = false;

    if (!r.ok) {
      out.className = 'ask-out is-err';
      out.textContent = r.status === 0
        ? 'No connection — this one needs the network.'
        : r.data.error || 'That did not work.';
      return;
    }

    const n = Object.keys(r.data.patch || {}).length;
    setDrafts(r.data.patch || {});
    out.className = 'ask-out';
    out.textContent = '';
    out.append(
      h('p', { class: 'ask-summary' }, r.data.summary || ''),
      h('p', { class: 'ask-count' }, n
        ? `${n} change${n === 1 ? '' : 's'} proposed below — review before applying.`
        : 'Nothing changed.'),
      ...(r.data.rejected?.length
        ? [h('p', { class: 'ask-rejected' },
            'Not allowed here: ',
            r.data.rejected.map((x) => pathLabel(x.path)).join(', '),
            '. Those need a rebuild.')]
        : []),
    );
    if (n) input.value = '';
  }

  btn.addEventListener('click', run);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });

  return h('div', { class: 'ask' },
    h('div', { class: 'ask-row' }, input, btn),
    h('div', { class: 'ask-hint' },
      'Times and wording for this day only. Hotels, dates, prices and the route need a rebuild.'),
    out,
  );
}

/* ── sign-in ─────────────────────────────────────────────────────────────── */

function signInDialog() {
  const pass = h('input', { type: 'password', placeholder: 'Passphrase', autocomplete: 'current-password' });
  const who = h('input', { type: 'text', placeholder: 'Initials', maxlength: '2', value: state.by || '' });
  const err = h('div', { class: 'dlg-err' });
  const dlg = h('dialog', { class: 'dlg' },
    h('form', {
      method: 'dialog',
      onSubmit: async (e) => {
        e.preventDefault();
        const r = await signIn(pass.value, who.value);
        if (r.ok) { dlg.close(); setEditing(true); }
        else err.textContent = r.data.error || 'Could not sign in.';
      },
    },
      h('h4', {}, 'Edit this plan'),
      h('p', {}, 'Changes are shared between the two of you. Nothing applies until you review it.'),
      who, pass, err,
      h('div', { class: 'dlg-acts' },
        h('button', { type: 'button', class: 'mini-btn ghost', onClick: () => dlg.close() }, 'Cancel'),
        h('button', { type: 'submit', class: 'mini-btn solid' }, 'Start editing')),
    ),
  );
  document.body.append(dlg);
  dlg.showModal();
}

/* ── mount ───────────────────────────────────────────────────────────────── */

export function mountEditing() {
  // The toggle lives beside the theme button, in the rail that is already
  // sticky on every screen size.
  const toggle = h('button', {
    class: 'theme-btn', id: 'edit-toggle', type: 'button',
    'aria-pressed': 'false', 'aria-label': 'Edit the plan', title: 'Edit the plan',
    onClick: () => {
      if (!state.token) return signInDialog();
      setEditing(!editing);
    },
  }, '✎');
  $('#theme').before(toggle);

  const link = h('div', { class: 'link-state', id: 'link-state' });
  document.body.append(h('div', { class: 'tray', id: 'tray' }), link);

  // Ask-Claude sits under each day's timeline, visible only in edit mode —
  // it is scoped to one day, and putting it anywhere else would imply it isn't.
  $$('.day').forEach((sec) => {
    const n = Number(sec.id.split('-')[1]);
    sec.querySelector('.timeline')?.after(askBox(n));
  });

  onChange((what) => {
    if (what === 'link') {
      link.textContent = state.link === 'down' ? 'Offline — edits are saved on this device' : '';
      link.classList.toggle('is-on', state.link === 'down');
      return;
    }
    if (what === 'draft' || what === 'applied' || what === 'all') { repaint(); renderTray(); }
  });

  repaint();
  renderTray();
  if (state.token) sync();
}

export { revertApplied };
