-- A quote that never became a deal
-- ================================
--
-- Two deals were missed in the same week and the reason was the same both times. The
-- scan triages ~290 threads a day on SENDER AND SUBJECT and deep-reads about thirty.
-- That is the right trade for cold mail and the wrong one for an existing account,
-- because an account's thread keeps its original subject for ever:
--
--   "Tabasco Social Media Forms - Routine site health check"   USD 300, 14 Oct
--   "Re: check-In"                                             USD 150, 29 Sep
--
-- Both subjects describe routine work. Both bodies carry a quote. Capture was never the
-- problem — every message was in email_inbox, processed — the triage was.
--
-- So this reads the BODY, and now the ATTACHMENT NAMES, and hands anything with no
-- matching opportunity to the PM who owns that client.
--
-- A PRICE IS NOT REQUIRED. Rahul, 15 Oct 2026: "if no price thats ok, but an
-- opportunity should be there". A file called Proposal_v2.pdf, a scope of work, a
-- written go-ahead — each is a deal before anybody names a figure, and 17 of the
-- 70 current rows carry no value at all.
--
--
-- ATTACHMENTS WERE NEVER CAPTURED
-- -------------------------------
-- pull-gmail-to-supabase.gs read getPlainBody() and nothing else; not even filenames
-- were stored. Now `attachments text[]` holds the NAMES ONLY, never the bytes:
-- getName() reads a part header without downloading anything, which matters because
-- the Gmail quota is already the binding constraint — the backfill drained it once and
-- killed live capture for 21 hours. Inline images are excluded or every signature logo
-- would be an "attachment".
--
-- The names start arriving from the next capture run. Nothing is backfilled, so the
-- "proposal attached" signal reads zero until then and grows from there.
--
--
-- WHY IT IS MATERIALISED
-- ----------------------
-- 40,230 messages fall in the 90-day window. The first cut was a plain view that split
-- every one of those bodies on newlines and then compared every hit against every known
-- domain with position() — a cross join. It timed out, twice. Now:
--   * a cheap regex prefilter runs BEFORE any splitting;
--   * domains are extracted and hash-joined instead of cross-joined;
--   * the result is a matview rebuilt hourly at :56 (20 seconds), read instantly.
--
--
-- TWO MATCH RULES, BECAUSE THE EVIDENCE DIFFERS
-- ---------------------------------------------
--   PRICED    answered by a deal for this client at roughly ANY figure the mail names,
--             15% either way. Both halves were learned from real misses:
--               * ANY figure, because a quote is regularly a range — Raare's was
--                 "$3,150 - $3,850" and "$8,400 - $9,450", and the deal IS on the board
--                 at 3,150, so matching only the largest figure called it a miss;
--               * 15%, because a quote gets negotiated — By the Scruff is on the board
--                 at $4,500 and the mail settles at $4,150.
--   UNPRICED  answered by ANY deal for this client around that date. Stricter in
--             effect, deliberately: without it an attachment signal would fire on every
--             active account every week.
--
-- A deal with NO DATE still answers its mail. Five open deals carry neither first_date
-- nor source_date and the date window was silently discarding every one of them, which
-- is why By the Scruff appeared although its deal was right there.
--
-- FIGURES THAT ARE NOT PRICES are excluded by the words around them. Every one of these
-- was a real false positive in the 60-day sample: ZULU 8's $5,327.50 was a Shopify order
-- value in a report, Fortra's $4,421 a remaining wallet balance, GoTransverse's $7,750
-- an invoice for work already running.
--
-- VALIDATED ON THE TWO KNOWN MISSES. With the rows added on 15 Oct excluded, the
-- detector surfaces Hunter Public Relations at $300 and Vici Trading at $150 — the right
-- clients at the right figures. With them included, both correctly disappear.
--
-- VOLUME: 70 threads across 50 clients in 90 days, every one with a named owner. Under
-- one a day, split across eleven PMs.
--
--
-- THE DISMISS MATTERS MORE THAN THE DETECTION
-- -------------------------------------------
-- An age-based "Review" flag used to live on the Opportunities page and fired on 169 of
-- 203 open deals — 83% — so it was read once and ignored for ever, burying the handful
-- of real mismatches it existed to surface. A list of seventy becomes that list within a
-- fortnight unless "not a quote" sticks. deal_signal_dismissals is keyed on the thread.
--
-- EACH PM SEES THEIR OWN, by the client's owner (override first, then biggest revenue
-- share, so a leaver's name never lands on somebody's list). Admins see all.
--
-- ORPHAN TO CLEAN UP: web_deal_signals_raw, the first matview, superseded by
-- web_deal_signals_src which carries every figure rather than only the largest. The
-- migration tool declines DROP, so:
--   drop materialized view public.web_deal_signals_raw cascade;
--   -- and then re-point: create or replace view public.web_deal_signals as
--   --   select ... from public.web_deal_signals_src;

alter table public.email_inbox add column if not exists attachments text[];

-- The key the rest of the dashboard uses: lowercase, letters and digits only. It exists
-- because web_client_domains spells a key "2x marketing" while web_client_owners spells
-- the same client "2xmarketing", and a join between them silently returns nothing.
create or replace function public.client_key_of(p text)
returns text language sql immutable set search_path to 'public'
as $$ select nullif(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]', '', 'g'), '') $$;

create table if not exists public.deal_signal_dismissals (
  thread_id    text primary key,
  reason       text,
  dismissed_by text,
  dismissed_at timestamptz not null default now()
);
alter table public.deal_signal_dismissals enable row level security;
revoke all on public.deal_signal_dismissals from public, anon;
grant select, insert, update, delete on public.deal_signal_dismissals to authenticated;

-- web_deal_signals_src (materialised), web_deal_signals, web_unlogged_deal_signals and
-- refresh_deal_signals() are applied live; see the repository for their text.
-- Scheduled: cron job 'refresh-deal-signals', '56 * * * *'.
