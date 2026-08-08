/**
 * The ticket drawer: the booking PDFs, once you have cleared both factors.
 *
 * Everything else in this document is inlined and works from `file://`. These
 * cannot be — the built page is public — so they are fetched. That makes them
 * the one part of the plan that can fail when the network does, and the network
 * is worst exactly where the tickets matter: at Porta della Mandorla, or outside
 * Passageway 2 on foreign data.
 *
 * So every PDF is cached in IndexedDB the first time it is opened, and served
 * from there afterwards. Open each ticket once on hotel wifi and the drawer
 * keeps working with no signal at all. IndexedDB rather than localStorage
 * because the four documents are 2.6 MB and localStorage is a ~5 MB string
 * store you share with everything else on the origin.
 */
import { API, state, can, onChange } from './overlay.js';

const DB = 'italy26-tickets';
const STORE = 'pdf';

/* ── the cache ───────────────────────────────────────────────────────────── */

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cached(id) {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    // Private browsing and locked-down Safari both refuse IndexedDB. Losing the
    // cache is survivable; losing the drawer is not.
    return null;
  }
}

async function cache(id, blob) {
  try {
    const db = await open();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, id);
  } catch {}
}

/* ── fetching ────────────────────────────────────────────────────────────── */

/** Metadata only. The blob URLs never leave the server. */
async function listTickets() {
  const res = await fetch(`${API}/api/tickets`, {
    headers: { authorization: `Bearer ${state.token}` },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'could not list tickets');
  return (await res.json()).tickets ?? [];
}

/**
 * A ticket as a Blob — from IndexedDB if we have it, otherwise over the wire.
 * A cache hit means this resolves offline, which is the entire point.
 */
async function ticketBlob(id) {
  const hit = await cached(id);
  if (hit) return hit;

  const res = await fetch(`${API}/api/tickets?id=${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${state.token}` },
  });
  if (!res.ok) throw new Error('could not fetch that ticket');
  const blob = await res.blob();
  cache(id, blob);
  return blob;
}

/**
 * Open a PDF. `window.open` on an object URL rather than an <iframe> — the
 * build gate rejects iframes outright, and a new tab is what a phone wants for
 * a PDF anyway.
 */
async function show(id, label) {
  const blob = await ticketBlob(id);
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) {
    // Popup blocked — fall back to a download so the tap is not swallowed.
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label}.pdf`.replace(/[/\\?%*:|"<>]/g, '-');
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ── the drawer ──────────────────────────────────────────────────────────── */

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((k) => k != null));
  return el;
};

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

async function openDrawer() {
  const body = h('div', { class: 'tk-body' }, h('p', { class: 'tk-note' }, 'Loading…'));
  const dlg = h('dialog', { class: 'dlg tk-dlg' },
    h('h4', {}, 'Tickets'),
    h('p', {}, 'Opened once on wifi, each one stays available offline.'),
    body,
    h('div', { class: 'dlg-acts' },
      h('button', { type: 'button', class: 'mini-btn ghost', onClick: () => dlg.close() }, 'Close')),
  );
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();

  try {
    const tickets = await listTickets();
    body.textContent = '';
    if (!tickets.length) {
      body.append(h('p', { class: 'tk-note' }, 'No tickets uploaded yet.'));
      return;
    }
    for (const t of tickets) {
      const status = h('span', { class: 'tk-size' }, kb(t.size));
      body.append(h('button', {
        type: 'button', class: 'tk-row',
        onClick: async () => {
          status.textContent = 'opening…';
          try { await show(t.id, t.label); status.textContent = kb(t.size); }
          catch (e) { status.textContent = navigator.onLine ? 'failed' : 'offline, not cached'; }
        },
      }, h('span', { class: 'tk-label' }, t.label), status));
    }
  } catch (e) {
    body.textContent = '';
    body.append(h('p', { class: 'tk-note' }, e.message));
  }
}

/** The button, shown only once the Google step has granted the tickets scope. */
export function mountTickets() {
  const btn = h('button', {
    class: 'theme-btn', id: 'tickets-btn', type: 'button',
    'aria-label': 'Tickets', title: 'Tickets', hidden: 'hidden',
    onClick: openDrawer,
  }, '🎟');
  document.querySelector('#theme').before(btn);

  const refresh = () => { btn.hidden = !can('tickets'); };
  onChange((what) => { if (what === 'auth' || what === 'all') refresh(); });
  refresh();
}
