-- 109 — the mapping tab was timing out
--
-- "canceling statement due to statement timeout", and the page rendered $0 across the
-- board. invoice_mapping('2026-09-01') took 7,083 ms against PostgREST's 8-second limit,
-- so it failed intermittently — the worst kind, because the page looked merely empty.
--
-- I caused it. Migration 105 added route 4 (client + invoice LINE value) and joined every
-- sheet row to every line in the ±18-month window, with an OR of prefix tests in the join
-- condition that no index can serve. Migration 102 had already learned this exact lesson —
-- "comparing every sheet row with every invoice and normalising both sides inside the
-- comparison ran 11s" — and route 4 walked straight back into it.
--
-- 7,083 ms → 700 ms, same 199 rows, same states (145 Invoiced, 26 Not in sheet, 5 Part
-- invoiced, 12 To raise, 11 Value differs), April/June/August unchanged too.
--
-- THREE CHANGES, all of them narrowing a join before making it rather than filtering
-- after:
--
-- 1. I31 — routes 3 and 4 both require the invoice to sit within a month of the target
--    month, but both joined against all 2,131 invoices in the wide window and applied the
--    date test in the WHERE. Materialising the ±31-day subset first turns 173 x 2,131
--    comparisons into 173 x ~170.
--
-- 2. IL — the line set is only ever used by route 4, so it is built over the same ±31 days
--    instead of the full window.
--
-- 3. LU — route 4 only concerns sheet rows nothing else matched, which is a handful, not
--    173. The `not exists` tests move out of the WHERE into a materialised subset that is
--    built before the join.
--
-- And an index. client_match_stem() is STABLE and reads client_aliases, so it runs per row
-- — 2,131 calls, each a sequential scan of 167 alias rows calling client_stem() on every
-- one. An expression index on client_stem(pattern) turns that into an index lookup, and
-- it is allowed precisely because client_stem() is IMMUTABLE. That one index is worth
-- 750 ms of the 6.4 seconds.
--
-- THE RULE, now on its third outing: if a join in this function compares normalised text
-- with an OR, narrow both sides to the month FIRST. The date test in the WHERE does not
-- save you — the planner has already built the cross product by then.

create index if not exists client_aliases_merge_stem
  on client_aliases (client_stem(pattern)) where kind = 'merge';

do $do$
declare d text; o text;
begin
  select pg_get_functiondef(oid) into d from pg_proc where proname = 'invoice_mapping';

  -- 1 + 2: the ±31-day invoice subset, defined before anything joins to it.
  o := 'LK as (select L.row_key, k from L, unnest(L.inv_keys) k),';
  if position(o in d) = 0 then raise exception 'LK anchor'; end if;
  d := replace(d, o, 'I31 as materialized (
  select I.* from I, p where abs(I.im - p.m) <= 31
),
LK as (select L.row_key, k from L, unnest(L.inv_keys) k),');

  o := '  from quote_api_invoice_lines li
  join I on I.invoice_no = li.invoice_no
  where quote_api_is_ours(li.service) and li.amount_usd is not null
),';
  if position(o in d) = 0 then raise exception 'IL anchor'; end if;
  d := replace(d, o, '  from quote_api_invoice_lines li
  join I on I.invoice_no = li.invoice_no, p
  where quote_api_is_ours(li.service) and li.amount_usd is not null
    and abs(I.im - p.m) <= 31
),');

  -- Route 3 against the narrowed set.
  o := '  select L.row_key, I.invoice_no, 3, I.im, I.usd
  from L join I on left(I.cstem, 4) = left(L.cstem, 4)
                or (length(I.cstem) between 2 and 3 and L.cstem like I.cstem || ''%'')
  where length(L.cstem) >= 4
    and (I.cstem like left(L.cstem, 5) || ''%'' or L.cstem like left(I.cstem, 5) || ''%'')
    and abs(I.usd - L.sheet_usd) <= greatest(5, 0.02 * L.sheet_usd)
    and abs(I.im - (select m from p)) <= 31';
  if position(o in d) = 0 then raise exception 'route3 anchor'; end if;
  d := replace(d, o, '  select L.row_key, I31.invoice_no, 3, I31.im, I31.usd
  from L join I31 on left(I31.cstem, 4) = left(L.cstem, 4)
                  or (length(I31.cstem) between 2 and 3 and L.cstem like I31.cstem || ''%'')
  where length(L.cstem) >= 4
    and (I31.cstem like left(L.cstem, 5) || ''%'' or L.cstem like left(I31.cstem, 5) || ''%'')
    and abs(I31.usd - L.sheet_usd) <= greatest(5, 0.02 * L.sheet_usd)');

  -- 3: route 4 against the unmatched rows only.
  o := 'C4 as (
  select L.row_key, IL.invoice_no, IL.line_key,
         abs(IL.im - (select m from p)) as mdist,
         abs(IL.amt - L.sheet_usd) as vdist
  from L join IL on left(IL.cstem, 4) = left(L.cstem, 4)
                 or (length(IL.cstem) between 2 and 3 and L.cstem like IL.cstem || ''%'')
  where length(L.cstem) >= 4
    and (IL.cstem like left(L.cstem, 5) || ''%'' or L.cstem like left(IL.cstem, 5) || ''%'')
    and abs(IL.amt - L.sheet_usd) <= greatest(5, 0.02 * L.sheet_usd)
    and abs(IL.im - (select m from p)) <= 31
    and not exists (select 1 from B12 where B12.row_key = L.row_key)
    and not exists (select 1 from A3  where A3.row_key  = L.row_key)
),';
  if position(o in d) = 0 then raise exception 'C4 anchor'; end if;
  d := replace(d, o, 'LU as materialized (
  select L.row_key, L.cstem, L.sheet_usd
  from L
  where length(L.cstem) >= 4
    and not exists (select 1 from B12 where B12.row_key = L.row_key)
    and not exists (select 1 from A3  where A3.row_key  = L.row_key)
),
C4 as (
  select LU.row_key, IL.invoice_no, IL.line_key,
         abs(IL.im - (select m from p)) as mdist,
         abs(IL.amt - LU.sheet_usd) as vdist
  from LU join IL on left(IL.cstem, 4) = left(LU.cstem, 4)
                  or (length(IL.cstem) between 2 and 3 and LU.cstem like IL.cstem || ''%'')
  where (IL.cstem like left(LU.cstem, 5) || ''%'' or LU.cstem like left(IL.cstem, 5) || ''%'')
    and abs(IL.amt - LU.sheet_usd) <= greatest(5, 0.02 * LU.sheet_usd)
),');

  execute d;
end $do$;
