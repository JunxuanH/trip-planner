/* ── the overlay: what the plan says on top of what it was built with ─────
 *
 * Three layers, rendered as base ⊕ applied ⊕ draft:
 *
 *   base      itinerary.json, bundled into this file, never mutated
 *   applied   the shared document — synced through /api/overlay, live for both
 *   draft     your uncommitted edits — local only, never sent until you Apply
 *
 * Draft is the whole point. Both edit paths, typing in a field and asking
 * Claude, land in draft; nothing reaches the other person's browser until it
 * is reviewed. That is also what makes the Claude path safe to use casually —
 * the model writes into exactly the same tray a person does.
 *
 * Everything here works offline. `applied` and `draft` are both mirrored to
 * localStorage, so a reload on a ferry with no signal loses nothing, and the
 * sync loop reconciles when the network comes back.
 */

import TRIP from '../../data/itinerary.json';

/* The Vercel deployment holding the endpoints. GitHub Pages serves this
   document; it cannot run server code, so sync and Claude live elsewhere.
   Changing the Vercel project name means changing this line. */
export const API = 'https://trip-planner-api-mu.vercel.app';

const LS = {
  applied: 'italy26-applied',
  draft: 'italy26-draft',
  comments: 'italy26-comments',
  queue: 'italy26-comment-queue',
  token: 'italy26-token',
  by: 'italy26-by',
  seen: 'italy26-seen',
  scopes: 'italy26-scopes',
  oauth: 'italy26-oauth-state',
  clientId: 'italy26-google-client',
};

/* Google sign-in, without Google's JavaScript.
   The browser is *navigated* to the consent page and comes back with a code,
   which /api/auth/google exchanges server-side. Loading Google's SDK would be
   an external <script src>, and build.mjs fails the build on those — so the
   redirect dance is not a preference, it is the only shape that fits. */
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

const read = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
};
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const state = {
  applied: read(LS.applied, {}),
  draft: read(LS.draft, {}),
  comments: read(LS.comments, {}),
  queue: read(LS.queue, []),          // comments posted while offline
  token: sessionStorage.getItem(LS.token) || null,
  by: localStorage.getItem(LS.by) || null,
  /** What the current token is good for: ['edit'] or ['edit','tickets']. */
  scopes: read(LS.scopes, []),
  /** null until the first request settles — 'up' | 'down' | null */
  link: null,
};

/* ── listeners ───────────────────────────────────────────────────────────── */

const subs = new Set();
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export function emit(what = 'all') { subs.forEach((fn) => fn(what)); }

/* ── reading a value ─────────────────────────────────────────────────────── */

/** The value itinerary.json was built with. */
export function baseValue(path) {
  let m = /^day\.(\d+)\.note$/.exec(path);
  if (m) return TRIP.days[+m[1] - 1]?.note ?? '';
  m = /^day\.(\d+)\.items\.(\d+)\.subitems\.([a-z0-9_]+)\.([a-z]+)$/.exec(path);
  if (m) {
    const it = TRIP.days[+m[1] - 1]?.items[+m[2]];
    // A hand-folded-back entry without its own id is still addressable, keyed
    // by array position — matches subitemIdsFor()'s fallback server-side.
    const s = it?.subitems?.find((x, i) => (x.id ?? `b_${i}`) === m[3]);
    if (!s) return m[4] === 'deleted' ? false : '';
    return s[m[4]] ?? (m[4] === 'deleted' ? false : '');
  }
  m = /^day\.(\d+)\.items\.(\d+)\.([a-z]+)$/.exec(path);
  if (!m) return '';
  const it = TRIP.days[+m[1] - 1]?.items[+m[2]];
  if (!it) return '';
  return it[m[3]] ?? (m[3] === 'done' ? false : '');
}

/**
 * What the page should show, and where it came from. `source` is what the UI
 * marks up: a draft renders as pending, an applied edit by the other person
 * renders as theirs for a while.
 */
export function effective(path) {
  const d = state.draft[path];
  if (d) return { value: d.value, source: 'draft', by: state.by };
  const a = state.applied[path];
  if (a) return { value: a.value, source: 'applied', by: a.by, at: a.at };
  return { value: baseValue(path), source: 'base' };
}

export const isEdited = (path) => path in state.draft || path in state.applied;

/* ── writing a draft ─────────────────────────────────────────────────────── */

/** Setting a field back to what the base says is a discard, not an edit. */
export function setDraft(path, value) {
  const applied = state.applied[path];
  const current = applied ? applied.value : baseValue(path);
  if (value === current) delete state.draft[path];
  else state.draft[path] = { value, at: Date.now() };
  write(LS.draft, state.draft);
  emit('draft');
}

export function setDrafts(patch) {
  for (const [path, entry] of Object.entries(patch)) {
    const value = entry && typeof entry === 'object' ? entry.value : entry;
    const applied = state.applied[path];
    const current = applied ? applied.value : baseValue(path);
    if (value === current) delete state.draft[path];
    else state.draft[path] = { value, at: Date.now() };
  }
  write(LS.draft, state.draft);
  emit('draft');
}

export function discardDraft(paths = Object.keys(state.draft)) {
  paths.forEach((p) => delete state.draft[p]);
  write(LS.draft, state.draft);
  emit('draft');
}

export const draftPaths = () => Object.keys(state.draft).sort(pathOrder);

/** Day, then item, then field — so the review list reads in trip order. */
export function pathOrder(a, b) {
  const key = (p) => {
    const m = /^day\.(\d+)(?:\.items\.(\d+))?/.exec(p);
    return [m ? +m[1] : 0, m && m[2] != null ? +m[2] : -1];
  };
  const [ad, ai] = key(a);
  const [bd, bi] = key(b);
  return ad - bd || ai - bi || a.localeCompare(b);
}

/**
 * Commit drafts to the shared document.
 *
 * Applied optimistically: the value moves into `applied` before the server
 * confirms, so Apply feels instant and still works with no signal. A path the
 * server rejects is rolled back into draft with its reason, which is how a
 * partly-wrong Claude patch degrades to its good half.
 */
export async function applyDraft(paths = draftPaths()) {
  const patch = {};
  const now = Date.now();
  for (const p of paths) {
    if (!state.draft[p]) continue;
    patch[p] = state.draft[p].value;
    state.applied[p] = { value: state.draft[p].value, at: now, by: state.by || '?' };
    delete state.draft[p];
  }
  if (!Object.keys(patch).length) return { rejected: [] };

  write(LS.draft, state.draft);
  write(LS.applied, state.applied);
  emit('applied');

  const r = await api('/api/overlay', { method: 'PUT', body: { patch } });
  if (!r.ok) return { rejected: [], offline: true };

  // The server's copy is authoritative for merge order — someone else may have
  // written the same path while this request was in flight.
  state.applied = r.data.overlay;
  write(LS.applied, state.applied);

  for (const rj of r.data.rejected ?? []) {
    delete state.applied[rj.path];
    if (patch[rj.path] !== undefined) {
      state.draft[rj.path] = { value: patch[rj.path], at: now, reason: rj.reason };
    }
  }
  if (r.data.rejected?.length) { write(LS.draft, state.draft); write(LS.applied, state.applied); }
  emit('applied');
  return { rejected: r.data.rejected ?? [] };
}

/** Revert an applied field back to what itinerary.json says, for both of you. */
export async function revertApplied(paths) {
  paths.forEach((p) => delete state.applied[p]);
  write(LS.applied, state.applied);
  emit('applied');
  const r = await api('/api/overlay', { method: 'PUT', body: { clear: paths } });
  if (r.ok) { state.applied = r.data.overlay; write(LS.applied, state.applied); emit('applied'); }
}

/* ── subitems ────────────────────────────────────────────────────────────
 * A lightweight, timestamped aside nested under a stop — no coord/kind, it
 * shares its parent's pin and never gets its own. Created live via a
 * client-minted id, addressed the same open-path way as everything else in
 * this overlay (day.N.items.I.subitems.<id>.field); the id has no fixed
 * array slot to live in, so it's discovered by scanning path keys rather
 * than an index bound. */

const minutesOf = (t) => {
  const m = /^(\d{1,2}):(\d{2})(am|pm)$/.exec(String(t ?? '').trim());
  if (!m) return Infinity; // unset/unparseable sorts last, not first
  return ((+m[1] % 12) + (m[3] === 'pm' ? 12 : 0)) * 60 + +m[2];
};

/** Which subitems exist under one item — base (folded into itinerary.json)
 * union overlay-only (born live, not yet folded back). Excludes anything
 * tombstoned `deleted`. Sorted by time, id as the tiebreak so a never-timed
 * new row is stable rather than jumping around as fields land. */
export function subitemsFor(dayN, itemIdx) {
  const base = TRIP.days[dayN - 1]?.items[itemIdx]?.subitems ?? [];
  const ids = new Set(base.map((s, i) => s.id ?? `b_${i}`));
  const prefix = `day.${dayN}.items.${itemIdx}.subitems.`;
  for (const src of [state.applied, state.draft]) {
    for (const path of Object.keys(src)) {
      if (path.startsWith(prefix)) ids.add(path.slice(prefix.length).split('.')[0]);
    }
  }
  return [...ids]
    .map((id) => ({
      id,
      time: effective(`${prefix}${id}.time`).value ?? '',
      title: effective(`${prefix}${id}.title`).value ?? '',
      detail: effective(`${prefix}${id}.detail`).value ?? '',
      deleted: Boolean(effective(`${prefix}${id}.deleted`).value),
    }))
    .filter((s) => !s.deleted)
    .sort((a, b) => minutesOf(a.time) - minutesOf(b.time) || a.id.localeCompare(b.id));
}

/**
 * Mint a new subitem id, client-side — same "no round trip needed to name
 * it" shape as postComment()'s local id, below. Writes directly into
 * state.draft rather than through setDraft(): setDraft elides a write that
 * equals the base value, and base for a brand-new id is '' — going through
 * it would silently create nothing for subitemsFor() to ever discover.
 */
export function createSubitem(dayN, itemIdx) {
  const id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const path = `day.${dayN}.items.${itemIdx}.subitems.${id}.title`;
  state.draft[path] = { value: '', at: Date.now() };
  write(LS.draft, state.draft);
  emit('draft');
  return id;
}

/** Remove one. A subitem that was never applied has nothing to tombstone —
 * discard its draft fields outright. One that's real (in state.applied or
 * baked into itinerary.json) is marked deleted, same mechanism as
 * ITEM_FLAG_FIELDS' done/skipped. */
export function deleteSubitem(dayN, itemIdx, id) {
  const prefix = `day.${dayN}.items.${itemIdx}.subitems.${id}.`;
  const everApplied =
    Object.keys(state.applied).some((p) => p.startsWith(prefix)) ||
    (TRIP.days[dayN - 1]?.items[itemIdx]?.subitems ?? []).some((s, i) => (s.id ?? `b_${i}`) === id);
  if (everApplied) setDraft(`${prefix}deleted`, true);
  else discardDraft(Object.keys(state.draft).filter((p) => p.startsWith(prefix)));
}

/* ── comments ────────────────────────────────────────────────────────────── */

export const threadFor = (anchor) => [
  ...(state.comments[anchor] ?? []),
  ...state.queue.filter((c) => c.anchor === anchor),
];

export function unreadCount(anchor) {
  const seen = read(LS.seen, {})[anchor] ?? 0;
  return (state.comments[anchor] ?? []).filter((c) => c.at > seen && c.by !== state.by).length;
}

export function markSeen(anchor) {
  const seen = read(LS.seen, {});
  seen[anchor] = Date.now();
  write(LS.seen, seen);
  emit('comments');
}

/**
 * Post a comment. Unlike an edit this is not held for review — a comment is
 * conversation about the plan, not a change to it, and it cannot corrupt
 * anything. Offline it queues and renders as unsent rather than looking posted.
 */
export async function postComment(anchor, text) {
  const local = {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    anchor, text, by: state.by || '?', at: Date.now(), pending: true,
  };
  state.queue.push(local);
  write(LS.queue, state.queue);
  emit('comments');

  const r = await api('/api/comments', { method: 'POST', body: { anchor, text } });
  if (!r.ok) return false;
  state.queue = state.queue.filter((c) => c.id !== local.id);
  state.comments = r.data.comments;
  write(LS.queue, state.queue);
  write(LS.comments, state.comments);
  emit('comments');
  return true;
}

export async function resolveComment(anchor, id, resolved) {
  const c = (state.comments[anchor] ?? []).find((x) => x.id === id);
  if (c) { c.resolved = resolved; write(LS.comments, state.comments); emit('comments'); }
  const r = await api('/api/comments', { method: 'PATCH', body: { anchor, id, resolved } });
  if (r.ok) { state.comments = r.data.comments; write(LS.comments, state.comments); emit('comments'); }
}

/* ── auth ────────────────────────────────────────────────────────────────── */

export async function signIn(passphrase, by) {
  const r = await api('/api/session', { method: 'POST', body: { passphrase, by }, auth: false });
  if (!r.ok) return r;
  keep(r.data.token, r.data.by, r.data.scopes ?? ['edit']);
  if (r.data.googleClientId) sessionStorage.setItem(LS.clientId, r.data.googleClientId);
  sync();
  return r;
}

/** The Google client id, handed over by /api/session after the passphrase. */
export const googleClientId = () => sessionStorage.getItem(LS.clientId);

function keep(token, by, scopes) {
  state.token = token;
  state.scopes = scopes;
  sessionStorage.setItem(LS.token, token);
  write(LS.scopes, scopes);
  if (by) { state.by = by; localStorage.setItem(LS.by, by); }
  emit('auth');
}

export const can = (scope) => state.scopes.includes(scope);

export function signOut() {
  state.token = null;
  state.scopes = [];
  sessionStorage.removeItem(LS.token);
  write(LS.scopes, []);
  emit('auth');
}

/* ── the second factor ───────────────────────────────────────────────────── */

/** Where Google sends the browser back to — this page, minus any query. */
const redirectUri = () => location.origin + location.pathname;

/**
 * Hand the browser to Google. Returns nothing useful: the page is leaving.
 *
 * `state` is a nonce parked in sessionStorage and checked on the way back, so a
 * code pasted in from elsewhere cannot complete someone else's sign-in.
 */
export function startGoogle(clientId) {
  const nonce = crypto.randomUUID();
  sessionStorage.setItem(LS.oauth, nonce);
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email',
    state: nonce,
    prompt: 'select_account',
    include_granted_scopes: 'true',
  });
  location.assign(`${GOOGLE_AUTH}?${q}`);
}

/**
 * Called on load. If Google has just sent us back, finish the exchange.
 *
 * The query string is scrubbed with replaceState either way — an authorization
 * code is single-use, and leaving it in the URL means a refresh fails loudly
 * for no reason and the code sits in history.
 */
export async function completeGoogle() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code');
  const returned = q.get('state');
  if (!code && !q.get('error')) return null;

  const expected = sessionStorage.getItem(LS.oauth);
  sessionStorage.removeItem(LS.oauth);
  history.replaceState(null, '', redirectUri());

  if (q.get('error')) return { ok: false, data: { error: 'Google sign-in was cancelled' } };
  if (!expected || returned !== expected) return { ok: false, data: { error: 'sign-in state did not match — try again' } };

  const r = await api('/api/auth/google', { method: 'POST', body: { code, redirectUri: redirectUri() } });
  if (r.ok) keep(r.data.token, null, r.data.scopes ?? ['edit', 'tickets']);
  return r;
}

/* ── the wire ────────────────────────────────────────────────────────────── */

/**
 * One request. Never throws — offline is a normal state on this trip, not an
 * error, so every caller gets {ok:false} and carries on with local data.
 *
 * The literal URL below is why build.mjs has to allowlist this host: the
 * self-containment check bans runtime requests, and this is the one exception
 * the plan deliberately makes. `presentation.html` does not import this module
 * and stays fully offline.
 */
async function api(path, { method = 'GET', body, auth = true } = {}) {
  if (auth && !state.token) return { ok: false, status: 401, data: { error: 'not signed in' } };
  try {
    const res = await fetch(API + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(auth ? { authorization: `Bearer ${state.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    setLink(res.status >= 500 ? 'down' : 'up');
    if (res.status === 401 && auth) signOut();
    return { ok: res.ok, status: res.status, data };
  } catch {
    setLink('down');
    return { ok: false, status: 0, data: { error: 'offline' } };
  }
}

export { api };

function setLink(v) {
  if (state.link === v) return;
  state.link = v;
  emit('link');
}

/** Ask Claude for a patch. Returns a proposal — it applies nothing. */
export async function proposeEdit(dayN, instruction) {
  return api('/api/edit', { method: 'POST', body: { dayN, instruction } });
}

/* ── sync ────────────────────────────────────────────────────────────────── */

let syncing = false;

export async function sync() {
  if (syncing || !state.token) return;
  syncing = true;
  try {
    if (state.queue.length) {
      const r = await api('/api/comments', { method: 'POST', body: { queued: state.queue } });
      if (r.ok) {
        state.comments = r.data.comments;
        state.queue = [];
        write(LS.queue, state.queue);
        write(LS.comments, state.comments);
        emit('comments');
      }
    }
    const [ov, cm] = await Promise.all([api('/api/overlay'), api('/api/comments')]);
    if (ov.ok) { state.applied = ov.data.overlay; write(LS.applied, state.applied); emit('applied'); }
    if (cm.ok) { state.comments = cm.data.comments; write(LS.comments, state.comments); emit('comments'); }
  } finally {
    syncing = false;
  }
}

export function startSync() {
  sync();
  setInterval(sync, 45_000);
  addEventListener('online', sync);
  addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
}
