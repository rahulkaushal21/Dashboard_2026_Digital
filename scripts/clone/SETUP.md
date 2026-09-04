# Cloning the dashboard — Dashboard, Opportunities, Clients

A complete setup guide for standing up a **second, independent** copy of the
dashboard on its own Supabase project, its own Vercel project, and its own mail
capture from **`digitalbu@mavlers.com`**.

Nothing in this guide touches the live system. Follow it top to bottom.

**Scope for now:** three pages — **Dashboard**, **Opportunities**, **Clients**.
The rest (Business Trend, Forecast, Escalations, Delights, SQL/Leads, Operations,
Last Year) come later.

---

## Before you start

You need five things. Get all five first — three of the phases stall without them.

| # | What | Who gives it to you |
|---|---|---|
| 1 | Sign-in for **`digitalbu@mavlers.com`** | Workspace admin |
| 2 | **Read access to the existing Supabase project** (`hsmuxmvhgteexanssigc`) | Rahul |
| 3 | Permission to create a **new Supabase project** | Rahul |
| 4 | Permission to create a **new Vercel project** | Rahul |
| 5 | Edit access to the **Quotes spreadsheet's Apps Script** | Rahul |

You also need `git`, Node 20+, and the Supabase CLI (`npm i -g supabase`).

### The one thing to understand before you build

The three pages are fed by **two completely different pipelines**:

- **Opportunities** comes largely from **email** — captured from `digitalbu@`.
- **Dashboard** and **Clients** are driven by **Google Sheets** — revenue, bookings
  and quotes. None of that comes from email.

So a "clean start" only empties the **email** side (signals, escalations,
email-origin opportunities). Point the new project's sheet syncs at the *same*
spreadsheets and **all revenue and quote history appears immediately**. There is
no import script and nothing is lost.

---

## Phase 1 — Confirm the mailbox

**Before writing any code**, verify three things about `digitalbu@mavlers.com`:

1. **It is a real Workspace user, not a Google Group.**
   This matters more than it sounds. Apps Script's `GmailApp` reads the inbox of
   the account the script runs under. A Google Group has no inbox it can open, so
   a group address produces a script that silently reads nothing.
2. **You can sign in to it.** The script must be created *while signed in as that
   account*.
3. **Mail is already arriving**, and roughly how much per day. Open the inbox and
   look. That number decides whether Phase 4 is safe.

> **Check with Rahul:** the live system captures `reviewweb@**uplers**.com`. If
> the address forwarding into `digitalbu@` is `reviewweb@**mavlers**.com`, those
> are two different mailboxes on two different domains. Confirm which one actually
> feeds it, so you know what the stream contains.

**Quota note (good news):** the two systems run under *different Google accounts*,
so their Gmail API quotas are separate. Nothing you do here can exhaust the quota
the live dashboard depends on.

---

## Phase 2 — Create the Supabase project

### 2a. Create it

Create a new project. From **Settings → API**, note three values:

- **Project URL** — `https://<new-ref>.supabase.co`
- **anon key** — safe in the browser
- **service-role key** — **never** in the browser (see Phase 6)

### 2b. Run the repo migrations, in order

In the new project's **SQL Editor**, run these files from `supabase/migrations/`
one at a time, in this exact order:

```
001_schema.sql
002_align_to_business_sheet.sql
003_app_settings.sql
004_security_rls.sql
005_dashboard_auth_gating.sql
006_fix_auth_write_select_leak.sql
007_email_only_login.sql
008_email_inbox_cross_mailbox_dedup.sql
009_web_revenue_engagement_model.sql
```

Do **not** run `010`, `011` or `012` — those are for the Revenue History page,
which is out of scope.

`008` is not optional. It is what makes cross-mailbox dedup work; see Trap 2.

### 2c. Copy the functions and views that are NOT in the repo

**This is the step most likely to be skipped, and it breaks everything quietly.**

Four functions the dashboard depends on were applied straight to the live database
and never landed in `supabase/migrations`. Two views the Clients page reads are
also missing from the repo.

In the **existing** project's SQL editor (`hsmuxmvhgteexanssigc`), run each of
these and copy the single text cell it returns:

```
scripts/clone/01-extract-from-live.sql   →  9 function definitions
scripts/clone/02-views.sql               →  web_clients, web_client_directory
```

Paste each result into the **new** project's SQL editor and run it.
**Order matters: tables first (2b), then these** — the functions reference tables.

The nine functions you should end up with:

| Function | What it does |
|---|---|
| `sync_quotes_to_opportunities()` | Quotes tab → opportunities, plus the janitors |
| `reconcile_opportunities()` | Cross-source value backfill; merges email twins |
| `reconcile_sheet_drift()` | Clears orphaned rows and spent manual flags |
| `canonicalise_client_names()` | Applies `client_aliases` merges everywhere |
| `rebuild_clients()` | Rebuilds the `clients` table |
| `compute_client_sentiment()` | Sets sentiment — **must follow `rebuild_clients()`** |
| `set_opportunity_lost()` | Human "Lost" decision, survives the sync |
| `set_opportunity_confirmed()` | Human "Confirmed" decision |
| `set_opportunity_unlikely()` | Human "might not come" flag |

### 2d. Lock down the inbox

`email_inbox` holds confidential client mail. It must be reachable **only** by the
service-role key — never the anon key, never the browser.

```sql
alter table email_inbox enable row level security;
-- deliberately NO policies: service-role only
```

Verify it: with the anon key, `select * from email_inbox` must return nothing.

---

## Phase 3 — Deploy the edge functions

Four functions, not one. Opportunities needs the mail ingest; Dashboard and
Clients need the sheet side too.

| Function | Job |
|---|---|
| `gmail-ingest` | Receives mail pushed by Apps Script |
| `sheet-sync` | Pulls bookings / web-revenue from the sheet |
| `sync-web-revenue` | The revenue full-replace |
| `sheet-ingest` | **Receives the pushed Quotes tab** |

### Generate fresh tokens

Each function authenticates on a shared secret in the query string. **Generate new
ones — do not reuse the live system's tokens.** Two systems sharing a secret means
rotating it breaks both, and a leak from either compromises both.

```bash
openssl rand -hex 12    # run once per function, keep them somewhere safe
```

Set each as a secret on the new project, matching the variable name each function
already expects (read the top of each `index.ts`).

### Deploy

```bash
supabase link --project-ref <new-ref>

supabase functions deploy gmail-ingest     --no-verify-jwt
supabase functions deploy sheet-sync       --no-verify-jwt
supabase functions deploy sync-web-revenue --no-verify-jwt
supabase functions deploy sheet-ingest     --no-verify-jwt
```

`--no-verify-jwt` is required on all four: they authenticate on their token, not
on a Supabase JWT. Without it every call returns 401.

---

## Phase 4 — Install the mail puller

### 4a. The Gmail → Supabase script

1. Go to <https://script.google.com> **signed in as `digitalbu@mavlers.com`**.
   Not your own account — the script reads whichever inbox owns it.
2. **New project**, name it `Gmail → Supabase inbox (digitalbu)`.
3. Paste in the whole of `scripts/routine/pull-gmail-to-supabase.gs`.
   Use the current version from this repo — it already contains the `sliceSafe`
   fix (Trap 4).
4. Change exactly three lines at the top:

```js
var EXPECTED_MAILBOX = 'digitalbu@mavlers.com';
var SUPABASE_FN      = 'https://<new-ref>.supabase.co/functions/v1/gmail-ingest';
var INGEST_TOKEN     = '<the gmail-ingest token from Phase 3>';
```

5. Save, then run these functions **in this order** from the editor dropdown:

| Run | Expect |
|---|---|
| `whoAmI()` | Logs `digitalbu@mavlers.com`. If it logs anything else, **stop** — you are in the wrong account. |
| `checkHeaderSupport()` | "✓ SAFE" — every sampled message readable. If not, stop and report it. |
| `pullGmailToSupabase()` | Logs `pushed N` with **no** `ingest error` |
| `installGmailPullTrigger()` | Creates the 30-minute trigger |

`status()` prints the cursor and trigger state any time you want to check.

> **Do not skip `checkHeaderSupport()`.** It confirms the account can read the RFC
> Message-ID header, which is what stops the same email being stored once per
> person on a thread. See Trap 2.

### 4b. Retarget the Quotes pusher

**The Quotes tab cannot be pulled — it is push-only.** An Apps Script attached to
the Quotes spreadsheet posts it on the hour at `:49`. No SQL will fetch it.

Copy that script into a second Apps Script project and point it at the new
project's `sheet-ingest` URL with its new token.

Miss this and Opportunities has no sheet data at all — and from the database side
it looks exactly like "the sheet is empty", with nothing in any log.

---

## Phase 5 — Build the app

New repo. Copy this one, then delete what is out of scope.

### Delete

```
app/business-trend/   app/forecast/    app/last-year/    app/operations/
app/escalations/      app/critical-escalations/          app/delights/
app/sql-leads/        app/admin/
lib/forecast.ts       lib/mockData.ts
components/BarCard.tsx  components/ComingSoon.tsx
.github/workflows/deploy.yml          # Vercel builds on push; this is for GitHub Pages
```

### Keep

```
app/page.tsx  app/opportunities/  app/clients/
app/layout.tsx  app/globals.css
components/  Sidebar  Header  KPICard  RevenueChart  AuthProvider
lib/  supabase  insights  metrics  nbd  automation-plays  access  config
next.config.js  package.json  tsconfig.json  tailwind.config  postcss.config
```

### Two edits, not deletions

- **`components/Sidebar.tsx`** — trim the `nav` array to the three routes.
  *Comment the others out rather than deleting them* — they are coming back later.
- **`lib/access.ts`** — trim `PAGES` to match, or the gating references routes that
  no longer exist.

### Nothing to change for Vercel

`next.config.js` already branches on `DEPLOY_TARGET`. Leave that variable unset and
the GitHub Pages `basePath`, `assetPrefix` and static `output: 'export'` all drop
away automatically.

### Before pushing

```bash
npm install
npx tsc --noEmit     # the build does NOT typecheck; do it yourself
npm run build
```

`eslint.ignoreDuringBuilds` and `typescript.ignoreBuildErrors` are both `true` in
`next.config.js`, which means `npm run build` will happily build broken TypeScript.
On a fresh repo you may prefer to set both to `false` and let Vercel catch it.

---

## Phase 6 — Deploy to Vercel

1. Push the repo to GitHub.
2. Vercel → **Add New… → Project** → import it. The Next.js preset is detected;
   no build settings to change.
3. Add two environment variables, ticked for **all three** environments
   (Production, Preview, Development):

```
NEXT_PUBLIC_SUPABASE_URL       = https://<new-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY  = <anon key>
```

> **Never** put the service-role key in a `NEXT_PUBLIC_*` variable. Anything with
> that prefix is compiled into the JavaScript the browser downloads — it would be
> public. The service-role key belongs only in edge functions.

Deploys run on push to the default branch. Preview URLs let you check a branch
before it reaches production.

---

## Phase 7 — Schedule the syncs

Mail capture runs itself from the Apps Script trigger. The sheet side needs
`pg_cron` in Supabase. **The order matters** — each step consumes what the one
before it produced.

| Minute | Job | Why there |
|---|---|---|
| `:00` / `:30` | `sheet-sync` | Bookings and revenue land first |
| `:05` / `:35` | `sync_quotes_to_opportunities()` | After the sheet has arrived |
| `:07` / `:37` | `reconcile_opportunities()` | Needs the upsert finished |
| `:09` / `:39` | `reconcile_sheet_drift()` | Clears orphans the sync exposed |
| `:17` | `sync-web-revenue` | Revenue full-replace |
| `:20`, `:03`/`:33` | `canonicalise_client_names()` | Right after each data landing |
| `:49` | Quotes push *(Apps Script)* | Not schedulable from SQL |

Add a client rebuild on whatever cadence suits — but **always as a pair**:

```sql
select rebuild_clients();
select compute_client_sentiment();   -- never omit this; see Trap 6
```

---

## Phase 8 — Verify

Work through all of these before telling anyone it is ready.

**Mail capture**
- [ ] `whoAmI()` prints `digitalbu@mavlers.com`
- [ ] `checkHeaderSupport()` reports every sampled message readable
- [ ] A manual pull logs `pushed N` with no `ingest error`
- [ ] `select count(*) from email_inbox` is non-zero and growing
- [ ] Two people on the same thread produce **one** row, not two

**Sheet side**
- [ ] `select count(*) from web_revenue` returns thousands, not zero
- [ ] `select count(*) from quotes` is non-zero after the first `:49` push
- [ ] `select count(*) from opportunities` is non-zero after the quotes sync

**Schema completeness**
- [ ] `select * from web_clients limit 1` returns a row *(the view exists)*
- [ ] `select * from web_client_directory limit 1` returns a row
- [ ] This returns **9**:

```sql
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'rebuild_clients','compute_client_sentiment','sync_quotes_to_opportunities',
  'canonicalise_client_names','reconcile_opportunities','reconcile_sheet_drift',
  'set_opportunity_lost','set_opportunity_confirmed','set_opportunity_unlikely');
```

**The app**
- [ ] Dashboard shows KPIs and a revenue chart, not empty cards
- [ ] Clients lists real clients with sentiment values
- [ ] Opportunities lists deals, and the value-band filter changes the count
- [ ] The anon key **cannot** read `email_inbox`

**Health**
- [ ] `sync_runs` has rows from each sync
- [ ] Gmail API usage after a full day sits well under the ceiling

---

## Traps

Every one of these is a real incident from the live system. They are ordered by
how likely they are to bite you.

### 1. Functions that exist only in production

Four of the nine functions were applied straight to the live database and never
reached `supabase/migrations`. A project built from the repo alone comes up
missing them, and **fails silently** — the quotes sync never runs, Opportunities
stays empty, and nothing appears in any log.

**This is the most likely reason your first build looks broken.** Run
`scripts/clone/01-extract-from-live.sql` (Phase 2c).

### 2. Whole-group capture multiplies duplicates

Gmail's message id is **per-mailbox**. When several people on one thread all feed
the same capture mailbox, the same email arrives multiple times with different
Gmail ids.

The RFC 5322 Message-ID header is stamped once by the sender and is identical in
every copy — that is the real identity. Migration `008` plus a passing
`checkHeaderSupport()` are what make dedup work. Get it wrong and you get
duplicate opportunities that take days to unpick by hand.

### 3. The Quotes tab cannot be pulled

Push-only, from an Apps Script at `:49`. Forget to retarget it (Phase 4b) and
Opportunities has no sheet data — indistinguishable, from the database side, from
an empty sheet.

### 4. Cutting an emoji in half kills capture permanently

An emoji is two UTF-16 code units. A plain `slice()` landing between them leaves a
lone surrogate, which Postgres rejects as `invalid input syntax for type json`.

Because a failed push **holds the cursor**, the same poisoned message is re-sent
every 30 minutes forever. This took the live system's capture down for six hours
on 2 September 2026. The current script has `sliceSafe()` — use it, and do not
"simplify" it away.

### 5. A failed push must never advance the cursor

`postBatch()` returns `-1` on any non-200, and the caller advances the high-water
mark **only when every batch succeeded**. That property is why the six-hour outage
lost no mail at all: the cursor stayed put and the next good run re-pulled the
whole window.

Preserve it. Any change that advances a cursor on partial success turns a
recoverable delay into permanent data loss.

### 6. `rebuild_clients()` wipes sentiment

It **deletes and reinserts** the `clients` table and does not set sentiment. On its
own, every At-Risk flag silently becomes zero. Always follow it immediately with
`compute_client_sentiment()`, in the same job.

On a Clients-facing build this is the difference between a health view that works
and one that quietly lies.

### 7. Quota is shared per account

Roughly 5–6k messages a day across every script on an account. A backfill once
drained it and killed live capture for 21 hours.

The two systems use different Google accounts, so their quotas are independent —
but `digitalbu@` carries more mail than the current capture mailbox. **Measure a
full day of usage before trusting the trigger.** If it runs hot, throttle at the
source (what forwards in, or `SEARCH_QUERY`) — filtering inside the script is too
late, because the quota was already spent on the read.

### 8. A quote with no number has no percentage

A win probability only exists where a real value was quoted to the client. No
figure means **both** `est_value` and `win_probability` stay null — never seed a
default. Carry this in from day one; retrofitting it means auditing every row.

---

## If something is wrong

- **Opportunities empty** → Trap 1 (missing functions) or Trap 3 (Quotes pusher).
- **Clients empty, no error** → the two views are missing (Phase 2c).
- **Dashboard empty** → `sheet-sync` / `sync-web-revenue` have not run, or their
  tokens do not match what the functions expect.
- **Capture stopped and will not restart** → check `sync_runs` for
  `source = 'gmail-ingest'`. Repeated identical errors mean a poisoned message
  (Trap 4), not a transient fault.
- **Everything 401** → a function was deployed without `--no-verify-jwt`.

Freshness is always the first thing to check:

```sql
select source, max(ran_at), max(ran_at) - now() as age
from sync_runs group by source order by 2 desc;
```

---

## Handover

When Phase 8 passes, send back:

- the new Supabase project ref
- the Vercel production URL
- confirmation that all four tokens are stored somewhere safe
- the first full day's Gmail API usage figure

Do **not** send any token or key over chat or email.
