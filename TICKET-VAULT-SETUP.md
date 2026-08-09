# Ticket vault — setup runbook

Handoff for an agent with Vercel and Google Cloud access. The code is written,
typechecked and merged; **none of it does anything until the four steps below are
done.** Until then the tickets button stays hidden, the Google step says it is
not configured, and editing works exactly as it did.

Nothing here needs a code change. If you find yourself editing `api/` or
`italy-2026/src/`, stop — something has gone wrong with the assumptions.

## Status update (2026-08-09)

Two more tickets landed — the Galleria dell'Accademia entries for Aug 27,
2:30pm (Junxuan and Hanji) — and `api/_lib/tickets.ts` / `scripts/
upload-tickets.mjs` now know their ids (`accademia-junxuan`,
`accademia-hanji`; see the table below). The split, correctly-named PDFs are
staged in a local `tickets-in/` (gitignored, this machine only). **Uploading
them still needs `BLOB_READ_WRITE_TOKEN`, which this session does not have**
— run the Step 4 command below with it, from a machine or session that does.
The `api/` code change also needs the same manual `vercel deploy --prod` any
`api/` change has needed since auto-deploy turned out not to be wired up (see
the entry below) — the label won't show in the drawer until that redeploy
happens, even once the blob itself is uploaded.

## Status (2026-08-08)

Steps 1–3 are **done and verified live**. Only Step 4 — uploading the actual PDFs
— is outstanding, because they aren't obtainable by an agent: they're email
attachments a human has to pull down.

- ✅ **Step 1 — Google OAuth.** Consent screen created (External, Testing),
  `junxuanhe@gmail.com` and `nicholezhou1214@gmail.com` added as test users. Web
  application OAuth client created with the redirect URI below. Client secret was
  shown once at creation and is not recorded here — see Vercel.
- ✅ **Step 2 — Vercel env vars.** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `ALLOWED_EMAILS` (`junxuanhe@gmail.com,nicholezhou1214@gmail.com`) all set on
  `trip-planner-api` production via `vercel env add`.
- ✅ **Step 3 — Vercel Blob.** Store `trip-planner-tickets` (public access, region
  `iad1`) created via `vercel blob create-store` and connected to the project;
  `BLOB_READ_WRITE_TOKEN` is injected automatically.
- Along the way: the API project turned out to have **no GitHub → Vercel
  auto-deploy** — every prior deployment was a manual `vercel deploy` from a
  previous agent session, and production was still serving code from Aug 3 (before
  even the "Log in" button). Re-deployed from a clean `main` checkout twice — once
  to ship the current code, once after the env vars landed — and confirmed via
  `POST /api/session` that `googleClientId` now comes back populated instead of
  `null`. If auto-deploy still isn't wired up, future `api/` changes need an
  explicit `vercel deploy --prod` after merge, same as this one did.
- ⬜ **Step 4 — upload the PDFs.** Still needs a human/agent with the actual four
  files (from Junxuan's email) staged in a local `tickets-in/`, then
  `BLOB_READ_WRITE_TOKEN=… node scripts/upload-tickets.mjs ./tickets-in`. Whoever
  does this should also run through *Verification* below afterward.
- **Known effect already in force:** this redeploy signed everyone out — tokens
  from before today no longer verify (the payload gained a scope field). Tell
  Hanji/Nicole to expect a fresh "Log in," not a bug.

## What was built

A **Log in** button on `plan.html` replacing the old pencil. Two factors:

| Factor | Grants | Endpoint |
|---|---|---|
| Shared passphrase | `edit` — comments, inline edits | `POST /api/session` |
| Passphrase **+** allowlisted Google account | `edit tickets` — the booking PDFs | `POST /api/auth/google` |

`GET /api/tickets` requires the `tickets` scope and answers an edit-only token
with **403** (not 401 — the caller is authenticated, they just have not cleared
the second factor).

Six PDFs go in the vault: the Vatican Gardens & Museums voucher, the
GetYourGuide Borghese reservation, the two Brunelleschi Passes, and the two
Galleria dell'Accademia tickets.

## Step 1 — Google OAuth client (console only)

**There is no CLI for this.** `gcloud alpha iap oauth-brands` / `oauth-clients`
is Identity-Aware Proxy specific, and brand creation via API is limited to
Workspace-internal apps. Both travellers use personal Gmail, so the consent
screen must be **External**, which Google exposes only in the console. Do not
burn time installing gcloud for this.

1. Google Cloud Console → **APIs & Services → OAuth consent screen**
   - User type: **External**
   - Add both as **Test users**: `junxuanhe@gmail.com`, `nicholezhou1214@gmail.com`
   - Leaving it in *Testing* is deliberate — publishing would trigger Google's
     verification review, which a two-person trip planner does not need. Test
     mode allows up to 100 users and the only cost is a refresh token that
     expires every 7 days, which does not matter here because the app's own
     token lasts 12 hours and re-auth is one tap.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorised redirect URI, character for character:
     ```
     https://junxuanh.github.io/trip-planner/plan.html
     ```
   - No trailing slash. A mismatch fails with Google's own `redirect_uri_mismatch`
     page, not anything this app can catch or explain.
3. Keep the **client ID** and **client secret**.

## Step 2 — Vercel environment variables

Dashboard → project → Settings → Environment Variables, or via CLI:

```bash
vercel link                       # once, in the repo root
vercel env add GOOGLE_CLIENT_ID production
vercel env add GOOGLE_CLIENT_SECRET production
vercel env add ALLOWED_EMAILS production   # junxuanhe@gmail.com,nicholezhou1214@gmail.com
```

`vercel env add` reads the value from stdin. `ALLOWED_EMAILS` is comma
separated, compared lowercased and trimmed, and checked against the Google
`email` claim **only when `email_verified` is true**.

Secrets stay in Vercel. This repo is public and GitHub auto-revokes keys pushed
to public repos.

## Step 3 — Vercel Blob

Dashboard → Storage → **Create Blob store** → connect it to this project. That
injects `BLOB_READ_WRITE_TOKEN`.

Redeploy after steps 2 and 3 — Vercel only picks up new env vars on a new
deployment.

## Step 4 — Upload the PDFs

**The PDFs are not in this repo and never will be.** `.gitignore` blocks
`tickets-in/` and `*.pdf`. Get them from Junxuan's email; they are the
confirmation attachments from Musei Vaticani, GetYourGuide, Opera di Santa
Maria del Fiore and the Galleria dell'Accademia (ticketDirect/GAMB).

Put all six in a local `tickets-in/`, then:

```bash
npm install                                    # repo root, for @vercel/blob
BLOB_READ_WRITE_TOKEN=… node scripts/upload-tickets.mjs ./tickets-in
```

The script maps filenames to ids, so the providers' own download names work
unrenamed — and so does a file already named after its id:

| Ticket | Matches a filename containing | id |
|---|---|---|
| Vatican voucher | `voucher` | `vatican-voucher` |
| Borghese reservation | `booking_is_reserved` | `borghese-reservation` |
| Brunelleschi Pass — Junxuan | `59465436` | `duomo-pass-junxuan` |
| Brunelleschi Pass — Hanji | `59465437` | `duomo-pass-hanji` |
| Accademia — Junxuan | *(named by id — see below)* | `accademia-junxuan` |
| Accademia — Hanji | *(named by id — see below)* | `accademia-hanji` |

The two Duomo receipts differ **only in that trailing digit**. Getting them the
wrong way round puts the wrong name on each pass; Opera staff check names
against ID at the dome, so it matters.

**The Accademia order arrives as one two-page PDF, order-numbered, with no
per-traveller filename to match on** — GAMB emails a single confirmation
covering everyone on the order, page 1 for whoever the order was booked under
and one further page per named ticket-holder after that. There is no filename
fragment this table could match, so that PDF has to be split into one
single-page file per person and each one named after its id
(`accademia-junxuan.pdf`, `accademia-hanji.pdf`) before it goes in
`tickets-in/` — confirm which page is which by extracting each page's text
(the passenger name line, not the `Cod.Cliente` account holder) rather than
assuming page order, the same care the Duomo passes need.

Re-running replaces by id rather than adding duplicates. Labels live in
`api/_lib/tickets.ts` (`LABELS`) and can be reworded without re-uploading.

## Verification

```bash
API=https://trip-planner-api-mu.vercel.app

# 1. passphrase alone → edit scope only
curl -s -X POST $API/api/session -H 'content-type: application/json' \
  -d '{"passphrase":"<passphrase>","by":"C"}'
# expect: {"token":"…","by":"C","scopes":["edit"],"googleClientId":"…apps.googleusercontent.com"}
# googleClientId must NOT be null — if it is, step 2 did not take effect.

# 2. edit token must NOT reach the tickets
curl -s -o /dev/null -w '%{http_code}\n' $API/api/tickets \
  -H "authorization: Bearer <edit token>"
# expect: 403
```

Then in a browser at <https://junxuanh.github.io/trip-planner/plan.html>:

- **Log in** → passphrase → "See the tickets too?" offers **Continue with Google**.
  If it says Google sign-in is not configured, `GOOGLE_CLIENT_ID` is missing.
- Sign in with an allowlisted account → "Tickets unlocked", 🎟 appears.
- **Sign in with a third Google account → must be refused**, and the 🎟 button
  must stay hidden. This is the check that actually matters; do not skip it.
- Open each of the four tickets once, then go offline and reopen one — it must
  still render, from the IndexedDB cache.
- Reload the page immediately after the Google redirect: the URL must already be
  clean and no error should appear (the code is single-use and is scrubbed with
  `history.replaceState`).

## Known effects

- **Everyone is signed out once.** The token payload gained a scope field, so
  tokens issued before this deploy no longer verify. Expected; sign in again.
- **Tickets are the only online-dependent part of the plan.** Everything else
  works from `file://`. The IndexedDB cache is what stops that being a
  regression — hence the "open each once on wifi" instruction, which is worth
  passing on to the travellers rather than leaving in a runbook.
- **The passphrase is still `hanji123`** and still a real factor. Google narrows
  access to two accounts, which is the substantive gain, but setting a strong
  `TOKEN_SECRET` in Vercel is worth doing while you are in there. It is optional
  and falls back to the passphrase; setting it separately also means changing
  the passphrase later will not invalidate every live token.

## If it needs backing out

Delete `GOOGLE_CLIENT_ID` from Vercel and redeploy. The Google step then reports
itself unconfigured, the tickets button stays hidden, and the passphrase flow
carries on unchanged. No code revert needed, and no data is lost — the blobs
simply go unread.
