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

import { h, $, $$, pathLabel, richNodes, renderSubRow } from './dom.js';
import {
  state, effective, baseValue, setDraft, setDrafts, discardDraft, draftPaths,
  applyDraft, revertApplied, signIn, onChange, proposeEdit, sync,
  can, startGoogle, completeGoogle, googleClientId, signOut, subitemsFor,
} from './overlay.js';
import { anchorTo } from './comments.js';

let editing = false;

/* ── painting values back into the page ──────────────────────────────────── */

/** `detail` and the day `note` may hold a bullet list; everything else — time,
 * title, how — stays the one-liner it always was. */
const isMultiline = (path) => /\.(detail|note)$/.test(path);

/**
 * The page is rendered once, imperatively, by plan.js. Rather than rebuild it
 * on every overlay change — which would tear down fourteen lazily-built maps —
 * we repaint the handful of nodes carrying a `data-path`.
 */
export function repaint() {
  $$('[data-path]').forEach((el) => {
    const path = el.dataset.path;
    const { value, source, by } = effective(path);
    // Don't fight the caret: skip the field being typed in right now — this
    // includes not swapping a multiline field's raw text back to a rendered
    // <ul> out from under someone mid-sentence.
    if (document.activeElement !== el) {
      if (isMultiline(path)) el.replaceChildren(...richNodes(value ?? ''));
      else el.textContent = value ?? '';
    }
    el.classList.toggle('is-draft', source === 'draft');
    el.classList.toggle('is-theirs', source === 'applied' && by && by !== state.by);
    el.classList.toggle('is-mine', source === 'applied' && by === state.by);
    el.title = source === 'applied' && by !== state.by ? `changed by ${by}` : '';
  });
}

/**
 * Overlay-only subitems (born live, no entry in itinerary.json) have no
 * initial DOM — plan.js only ever paints the base/folded-back set. This
 * reconciles each item's `.tl-subs` list against subitemsFor()'s merged view:
 * a new id gets a row, a gone one (deleted, or a discarded draft-only
 * creation) gets removed, survivors get reordered if their time changed.
 * Structural, so it must run before repaint()/renderTray() — a
 * freshly-inserted row's [data-path] fields need to exist for repaint()'s
 * sweep to paint them.
 */
function syncSubitems() {
  $$('.tl-subs').forEach((ol) => {
    const m = /^day\.(\d+)\.items\.(\d+)$/.exec(ol.dataset.subs);
    if (!m) return;
    const [dayN, itemIdx] = [+m[1], +m[2]];
    const wanted = subitemsFor(dayN, itemIdx);
    const have = new Map($$('.tl-sub', ol).map((li) => [li.dataset.subId, li]));

    wanted.forEach((s, pos) => {
      let li = have.get(s.id);
      if (!li) {
        li = renderSubRow(dayN, itemIdx, s);
        anchorTo(li, `day.${dayN}.items.${itemIdx}.subitems.${s.id}`, `Day ${dayN} · ${s.title || 'subitem'}`);
      }
      have.delete(s.id);
      const atPos = ol.children[pos];
      if (atPos !== li) ol.insertBefore(li, atPos ?? null);
    });
    have.forEach((li) => li.remove());
  });
  // Newly inserted rows carry [data-path] but no bound listeners yet if we're
  // already in edit mode — bindField() is only ever attached by setEditing()'s
  // own sweep, so run the same sweep here for anything still unbound.
  if (editing) {
    $$('.tl-sub [data-path]:not([data-bound])').forEach((el) => {
      el.contentEditable = 'plaintext-only';
      el.dataset.bound = '1';
      bindField(el);
    });
  }
}

/* ── inline editing ──────────────────────────────────────────────────────── */

/**
 * Tidy a field's raw text before it is saved.
 *
 * One-liners keep the original behaviour verbatim: every run of whitespace,
 * including a line break, collapses to one space. A multiline field must
 * NOT do that — a newline is exactly the thing this feature exists to keep —
 * so it only tidies each line on its own: interior runs of spaces/tabs
 * collapse and trailing space is trimmed, but *leading* whitespace survives
 * untouched, because that indentation is what tells a sub-bullet from a
 * top-level one. Blank-line runs of three or more collapse to one blank line.
 */
function normalize(text, multiline) {
  if (!multiline) return text.replace(/\s+/g, ' ').trim();
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const m = /^(\s*)(.*)$/.exec(line);
      return m[1].replace(/\t/g, '  ') + m[2].replace(/[ \t]+/g, ' ').trimEnd();
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * `el.textContent` is layout-blind: it concatenates every descendant text
 * node with nothing between them, so wherever a contentEditable Enter press
 * split the field into sibling blocks, textContent glues the two lines
 * together with no separator at all. `el.innerText` is the layout-aware
 * counterpart made for exactly this — it renders block boundaries as `\n` the
 * same way copying the visible text would. Tried controlling Enter by hand
 * first (inserting a literal "\n" via Range surgery, then via
 * execCommand('insertText') as a fallback) and measured both: the Range
 * version left the caret one character early so the next keystroke landed
 * before the newline, and execCommand returned false in this build and
 * inserted nothing at all. Reading innerText sidesteps the question by not
 * caring what shape Enter's default behaviour left behind.
 */
function readMultiline(el) {
  return el.innerText;
}

function bindField(el) {
  const multiline = isMultiline(el.dataset.path);

  el.addEventListener('focus', () => {
    // A multiline field displays as rendered bullets; editing happens on the
    // markdown-lite source underneath, not the <ul> itself, so swap to it now.
    const raw = multiline ? String(effective(el.dataset.path).value ?? '') : el.textContent;
    if (multiline) el.textContent = raw;
    el.dataset.wasBefore = raw;
  });
  el.addEventListener('blur', () => {
    const next = normalize(multiline ? readMultiline(el) : el.textContent, multiline);
    if (next !== el.dataset.wasBefore) setDraft(el.dataset.path, next);
    else repaint();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && multiline && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
      // The one thing Enter itself does NOT do in a multiline field: commit.
      // Left uncaught, plain Enter falls through to the browser's own
      // default line-break behaviour, whatever shape that takes — innerText
      // above is what makes not caring about that shape safe.
      e.preventDefault(); el.blur();
    } else if (e.key === 'Enter' && !multiline && !e.shiftKey) {
      e.preventDefault(); el.blur();
    }
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

/**
 * Step one of two: the shared passphrase.
 *
 * This alone unlocks the plan — comments and editing. The tickets need step
 * two, because the passphrase is shared and short and those documents can
 * cancel the trip.
 */
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
        if (!r.ok) { err.textContent = r.data.error || 'Could not sign in.'; return; }
        dlg.close();
        googleStep();
      },
    },
      h('h4', {}, 'Log in'),
      h('p', {}, 'Unlocks comments and editing. Tickets need a Google check as well.'),
      who, pass, err,
      h('div', { class: 'dlg-acts' },
        h('button', { type: 'button', class: 'mini-btn ghost', onClick: () => dlg.close() }, 'Cancel'),
        h('button', { type: 'submit', class: 'mini-btn solid' }, 'Continue')),
    ),
  );
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

/**
 * Step two: Google, restricted to the two accounts on the trip.
 *
 * Optional by design — skipping it leaves you able to edit but not to see the
 * tickets, which is the right trade for someone who just wants to fix a time.
 * Choosing it navigates away, so nothing after this line runs.
 */
function googleStep() {
  const clientId = googleClientId();
  const dlg = h('dialog', { class: 'dlg' },
    h('h4', {}, 'See the tickets too?'),
    h('p', {}, clientId
      ? 'The booking PDFs are behind a Google check, so a stray passphrase cannot reach them. Only the two accounts on this trip are accepted.'
      : 'Google sign-in is not configured on the server yet, so tickets are unavailable. Editing works.'),
    h('div', { class: 'dlg-acts' },
      h('button', { type: 'button', class: 'mini-btn ghost', onClick: () => { dlg.close(); setEditing(true); } },
        clientId ? 'Not now' : 'OK'),
      clientId
        ? h('button', { type: 'button', class: 'mini-btn solid', onClick: () => startGoogle(clientId) }, 'Continue with Google')
        : null),
  );
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

/** Told the outcome after Google has bounced the browser back to us. */
function reportGoogle(r) {
  const dlg = h('dialog', { class: 'dlg' },
    h('h4', {}, r.ok ? 'Tickets unlocked' : 'Not unlocked'),
    h('p', {}, r.ok
      ? 'Your booking PDFs are in the ticket drawer. Open each one once while you have wifi and it stays available offline.'
      : (r.data?.error || 'Google sign-in failed.')),
    h('div', { class: 'dlg-acts' },
      h('button', { type: 'button', class: 'mini-btn solid', onClick: () => dlg.close() }, 'OK')),
  );
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

/* ── mount ───────────────────────────────────────────────────────────────── */

export function mountEditing() {
  // The toggle lives beside the theme button, in the rail that is already
  // sticky on every screen size.
  // Two controls, not one. The old pencil did double duty as a sign-in, which
  // hid the fact that reading comments needs a token at all — a signed-out
  // reader saw "No comments yet" on threads that were merely unfetched.
  const login = h('button', {
    class: 'theme-btn', id: 'login-btn', type: 'button',
    'aria-label': 'Log in', title: 'Log in',
    onClick: () => (state.token ? signOut() : signInDialog()),
  }, '⇥');
  const toggle = h('button', {
    class: 'theme-btn', id: 'edit-toggle', type: 'button',
    'aria-pressed': 'false', 'aria-label': 'Edit the plan', title: 'Edit the plan', hidden: 'hidden',
    onClick: () => setEditing(!editing),
  }, '✎');
  $('#theme').before(login);
  $('#theme').before(toggle);

  const reflect = () => {
    const on = Boolean(state.token);
    toggle.hidden = !on;
    login.textContent = on ? '⇤' : '⇥';
    login.title = login.ariaLabel = on ? (can('tickets') ? 'Signed in — log out' : 'Signed in (no tickets) — log out') : 'Log in';
    if (!on && editing) setEditing(false);
  };
  onChange((what) => { if (what === 'auth' || what === 'all') reflect(); });
  reflect();

  // If Google has just bounced us back, finish the exchange before anything
  // else touches the URL.
  completeGoogle().then((r) => { if (r) { reflect(); reportGoogle(r); if (r.ok) sync(); } });

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
    if (what === 'draft' || what === 'applied' || what === 'all') { syncSubitems(); repaint(); renderTray(); }
  });

  syncSubitems();
  repaint();
  renderTray();
  if (state.token) sync();
}

export { revertApplied };
