-- A won deal is a hundred percent
-- ===============================
--
-- Spotted while sweeping for more of the 147 damage: two "view from here" lines were
-- won, booked into October and written to the project sheet, and still showed
-- win_probability = 45 on the Opportunities board.
--
-- Nothing was overwriting it. confirm_opportunity simply never touched the field, so a
-- deal kept whatever percentage it had when it was open — and 45 is what the quotes
-- mapping assigns to "Quote Shared". Confirm a deal out of that status and it sat there
-- won and 45% likely at the same time.
--
-- 19 won deals carried a partial percentage: 90 (x6), 75 (x5), 95 (x3), 45 (x2), 80, 60
-- and 99, together $12,415. 62 more were blank, and 545 already read 100.
--
-- HARMLESS BUT WRONG, and worth being clear which. It never reached the project sheet —
-- win_probability is not one of its 35 columns and sheet-writer does not send it — and
-- every consumer filters won deals out already (getBigOpenDeals is .eq('won', false),
-- the stale-pipeline insight averages over open deals only). So no total was ever wrong.
-- It was a misleading label on a correct number.
--
-- THE RULE IT NOW FOLLOWS is the one the quotes sync has always used: a confirmed quote
-- maps to 100. This applies it to every path a deal can be won by rather than only to
-- confirm_opportunity, because roll_up_opportunities and any future route set won too.
--
-- Blank is left blank where there is no value, per winpct-requires-value: a percentage
-- only exists where a real quoted figure does. Two won deals have no figure and keep
-- their blank, because blank means unknown and is not a wrong number — 45 on a won deal
-- is. That is the whole distinction being fixed.

-- 1. The rule, as a second invariant on the guard added in 147
-- ------------------------------------------------------------
-- It lives here rather than in confirm_opportunity for two reasons: it then covers every
-- path that sets won, not just the one; and the MCP connection declines a rewrite of
-- confirm_opportunity, so that function cannot be replaced from a migration here anyway.
create or replace function public.protect_confirmed_deal()
returns trigger
language plpgsql
as $function$
begin
  -- INVARIANT 1 (147): a confirmed deal cannot silently stop being won.
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

  -- INVARIANT 2 (148): a won deal is not 45% likely.
  if coalesce(new.won, false) = true
     and coalesce(old.won, false) = false
     and coalesce(new.est_value, 0) > 0
  then
    new.win_probability := 100;
  end if;

  return new;
end $function$;

-- The trigger itself was attached by 147 and is unchanged.


-- 2. The backfill  [APPLIED]
-- ---------------------------
--   update public.opportunities set win_probability = 100
--    where won = true and rolled_into is null
--      and coalesce(est_value,0) > 0 and coalesce(win_probability, -1) <> 100;
--
-- 81 rows moved to 100 (19 partial, 62 blank). Afterwards: 626 won deals all reading
-- 100%, 2 with no value correctly still blank, 0 partial.


-- Verified by running it, not by reading it
-- -----------------------------------------
-- Row 499 (Response MS, On Hold, $34, 25%, never confirmed) was flipped to won and
-- win_probability moved 25 -> 100 on its own, then the row was restored exactly to On
-- Hold / won false / 25. That row was chosen because it has no confirmed_by, so it can
-- never enter web_project_ledger whatever won says, which made the test incapable of
-- moving any revenue. The ledger was 3,377 rows and October $96,668 either side.
