-- A confirmation outranks the quotes snapshot
-- ===========================================
--
-- Rahul, 14 Oct 2026: two deals he had confirmed were back on the Opportunities board.
-- Switch Digital "SEO Task" (AUD 3,600, confirmed 12 Oct) and Design+Marketing
-- "McGraths Hill Website" (AUD 80, confirmed 1 Oct), both by rahul.j@mavlers.com.
--
-- Both were in a state nothing should be able to produce:
--
--     confirmed_by = 'rahul.j@mavlers.com'   confirmed_at = set
--     won          = false                   status = 'Open'
--     win_probability = 45                   summary = 'Quote Shared · …'
--
-- HALF-CONFIRMED IS THE WORST OF BOTH. web_project_ledger needs `won = true and
-- confirmed_by is not null`, so the revenue silently left the ledger; the Opportunities
-- board shows anything not won, so the deal came back as open pipeline. The same money
-- was missing from one screen and double-counted as forecast on another.
--
--
-- The cause
-- ---------
-- sync_quotes_to_opportunities() upserts on quote_key and, on conflict, wrote
--
--     won=excluded.won, status=excluded.status, won_amount=excluded.won_amount,
--     rfq_status=excluded.rfq_status, est_value=excluded.est_value
--
-- unconditionally, where `excluded.won` is `lower(quotes.status)='confirmed'`. Both
-- deals still read "Quote Shared" in the frozen Quotes snapshot, because that tab is no
-- longer maintained — so every run reset them to Open.
--
-- It never writes confirmed_by or confirmed_at, which is why those survived and made
-- the damage legible after the fact. And because it is an upsert rather than an RPC, it
-- writes no opportunity_event: the audit trail for both rows ends at Rahul's own
-- `confirmed` event, with nothing after it.
--
-- est_value was overwritten too, back to the QUOTED figure:
--     Switch Digital       confirmed AUD 3,600 -> $2,553.19, reset to $2,266
--     Design+Marketing     confirmed AUD    80 ->    $56.74, reset to    $52
-- The November copy of McGraths Hill carries $56.74, because copy_row_to_month computed
-- it fresh with to_usd. The parent was the one that got clobbered.
--
-- The trigger is `sync-all`, which the "Sync now" button on the dashboard home page
-- calls; it runs run_refresh_chain(), whose first step is this function. Anybody
-- pressing that button after a confirmation undid it.
--
-- SCOPE: exactly the two Rahul spotted were damaged. But 128 open sheet-origin deals
-- worth $451,148 still have a quote_key present in the snapshot, and every one of them
-- would have been reverted the same way the moment it was confirmed.
--
--
-- What is applied here
-- --------------------
-- ALL THREE PARTS ARE LIVE as of 14 Oct 2026.
--
-- Part 2 — the fix to sync_quotes_to_opportunities itself — could not be applied from
-- here, because the MCP connection declines any statement containing DELETE and that
-- function carries three janitor deletes. Rahul pasted apply-147-by-hand.sql the same
-- day and it is confirmed live: the on-conflict clause guards on confirmed_by and all
-- three janitors carry `and a.confirmed_by is null`.
--
-- VERIFIED BY RUNNING THE THING THAT BROKE IT. After the paste,
-- sync_quotes_to_opportunities() was called directly — 865 rows upserted — and nothing
-- moved: Switch Digital stayed Won at $2,553.19 and Design+Marketing at $56.74, the
-- half-confirmed count stayed 0, and the totals either side were identical (1,093
-- opportunities, 861 sheet-origin, 83 confirmed, 3,377 ledger rows, October $96,668).
-- The janitors deleted nothing.
--
-- Both layers are kept. Part 1 is not redundant: it catches the NEXT sync that writes
-- won without looking at confirmed_by, not only this one.


-- 1. The net: a confirmed deal cannot silently un-confirm  [APPLIED]
-- ------------------------------------------------------------------
-- Deliberately narrow — it guards one transition, "still confirmed but no longer won",
-- which nothing legitimate produces. confirm_opportunity sets confirmed_by and won in
-- the same statement, and nothing anywhere clears confirmed_by: undoing a booking is
-- done by removing the ledger line, not by un-confirming the deal. The guard stands
-- down when confirmed_by is being cleared, so a real un-confirm would still work if one
-- is ever written.
--
-- It is kept even once Part 2 lands, because it catches the NEXT sync that makes this
-- mistake, not just this one.
create or replace function public.protect_confirmed_deal()
returns trigger
language plpgsql
as $function$
begin
  if old.confirmed_by is not null
     and new.confirmed_by is not null
     and coalesce(old.won, false) = true
     and coalesce(new.won, false) = false
  then
    new.won             := old.won;
    new.status          := old.status;
    new.rfq_status      := old.rfq_status;
    new.won_amount      := old.won_amount;
    new.est_value       := old.est_value;
    new.win_probability := old.win_probability;
    new.summary         := old.summary;
    new.gist            := old.gist;
    new.next_step       := old.next_step;
    new.source_subject  := old.source_subject;
  end if;
  return new;
end $function$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_protect_confirmed_deal'
                   and tgrelid = 'public.opportunities'::regclass) then
    create trigger trg_protect_confirmed_deal
      before update on public.opportunities
      for each row execute function public.protect_confirmed_deal();
  end if;
end $$;


-- 2. The actual fix  [NOT APPLIED — PASTE BY HAND]
-- -------------------------------------------------
-- Identical to the live function except for the on-conflict clause and a
-- `confirmed_by is null` guard on each of the three janitor deletes, so a tidy-up can
-- no longer remove a confirmed deal and its revenue along with it.
--
-- confirmed_by is the signal rather than won, because it is set only by
-- confirm_opportunity: it means a human decided this HERE. A row the sheet itself says
-- is Confirmed carries won = true with confirmed_by null, stays sheet-driven, and is
-- correctly left alone by this guard.
--
-- The whole statement is in apply-147-by-hand.sql next to this file.


-- 3. The repair  [APPLIED]
-- -------------------------
-- Values recomputed with to_usd() from the confirmed local_value rather than restored
-- from any remembered figure — the standing rule after the AUD 0.649 mistake on 9 Oct.
-- Both rows are back in the October ledger: Switch Digital $2,553.19, Design+Marketing
-- $56.74. An 'edited' event was written on each recording what happened, since the
-- thing that broke them left no trail of its own.
--
--   update public.opportunities
--      set won = true, status = 'Won', rfq_status = 'won',
--          est_value  = public.to_usd(local_value, currency),
--          won_amount = public.to_usd(local_value, currency),
--          win_probability = 100
--    where id in (3012655, 2925037);
--
-- The summary, gist and next_step on both rows were rewritten afterwards too. They still
-- read "Quote Shared · Switch Digital · $2266" — the text the bug itself had generated —
-- and since Part 2 now protects those fields on a confirmed row, that wrong label would
-- have been frozen in place permanently rather than corrected on the next sync. They now
-- read "Confirmed · Switch Digital · $2553", with the gist naming who confirmed it and
-- when.
