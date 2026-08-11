/* ── the view gate: everyone needs the passphrase, not just editors ───────
 *
 * plan.html is a public, static file on GitHub Pages — there is no server in
 * front of it to check a login before handing over bytes. So this is NOT
 * real access control: the itinerary is still sitting in this page's own JS
 * (TRIP, bundled at build time) for anyone who opens dev tools or just
 * fetches the URL directly, gate or no gate. What it *can* do is stop a
 * casual visitor, a shared link, or a search engine from seeing content at a
 * glance, which is what this is for while real server-side gating — serving
 * the page itself from behind the Vercel API instead of Pages — waits on
 * deploy access nobody has yet. See CLAUDE.md.
 *
 * Deliberately its own module, not folded into edit-ui.js: it has to decide
 * whether to show anything at all before login/tickets exist as a concept
 * for this visitor, and unlike everything edit-ui.js gates, it has to keep
 * working with no network once passed — the same "still works on a plane"
 * promise the rest of this page already makes. That is why it is backed by
 * a plain persistent flag rather than the short-lived edit token: the token
 * is re-checked server-side on every call and expires in 12 hours by design,
 * which is exactly wrong for a screen whose only job is "has this device
 * ever typed the passphrase correctly, once."
 */
import { h, $ } from './dom.js';
import { state, signIn } from './overlay.js';

const LS_UNLOCKED = 'italy26-unlocked';

/**
 * True once this device has ever supplied the right passphrase. `state.by`
 * and `state.token` are the grandfather clause: anyone who signed in before
 * this gate existed, or who still has a live edit session from earlier
 * today, already proved they know the passphrase, and re-walling them would
 * just be annoying, not safer — all three live in the same untrusted client
 * storage either way.
 */
const isUnlocked = () =>
  localStorage.getItem(LS_UNLOCKED) === '1' || Boolean(state.by) || Boolean(state.token);

function reveal() {
  localStorage.setItem(LS_UNLOCKED, '1');
  document.body.classList.remove('gated');
  $('#gate')?.remove();
}

export function mountGate() {
  if (isUnlocked()) return; // the common case: nothing to build, nothing to show

  document.body.classList.add('gated');

  const who = h('input', { type: 'text', placeholder: 'Initials', maxlength: '2', autocomplete: 'off' });
  const pass = h('input', { type: 'password', placeholder: 'Passphrase', autocomplete: 'current-password' });
  const err = h('div', { class: 'dlg-err' });
  const btn = h('button', { type: 'submit', class: 'mini-btn solid' }, 'View the plan');

  async function submit(e) {
    e.preventDefault();
    if (!pass.value.trim()) return;
    err.textContent = '';
    btn.disabled = true;
    const r = await signIn(pass.value, who.value);
    btn.disabled = false;
    if (!r.ok) {
      err.textContent = r.status === 0
        ? 'No connection — this needs the network the first time, on each new device.'
        : (r.data?.error || 'Wrong passphrase.');
      pass.value = '';
      pass.focus();
      return;
    }
    reveal();
  }

  const card = h('form', { class: 'dlg gate-card', onSubmit: submit },
    h('h1', {}, 'Italy 2026'),
    h('p', {}, 'This trip plan is private. Enter the passphrase to view it.'),
    who, pass, err, btn,
  );

  document.body.append(h('div', { id: 'gate' }, card));
  requestAnimationFrame(() => pass.focus());
}
