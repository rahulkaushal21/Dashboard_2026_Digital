-- 101 — the quote id needs the same normalising the project id got
--
-- Measuring how well the team fills in ids, a naive check said 118 of 1,047 rows since
-- April carried a quote id the invoice app has never heard of. Almost none of them were
-- wrong. The breakdown:
--
--   QUT                     23 rows — a placeholder, exactly like the bare 'PRJ'
--   QUT290726132138_1       the team appends an instalment counter; the app's quote
--                           numbers carry no suffix
--   PRJ110926193900          a PROJECT id typed into the quote_id column — 3 rows, and
--                           the only genuine error in the set
--
-- After normalising, quote ids unknown to the app: ZERO. The 118 was entirely formatting,
-- and shipping it as an error count would have sent people chasing 118 non-problems.
--
-- Same rule as ledger_project_key (095): extract the first well-formed id, and never
-- rewrite the sheet.
create or replace function ledger_quote_key(raw text) returns text
language sql immutable set search_path = public as $$
  select (regexp_match(upper(btrim(coalesce(raw,''))), '(QUT[0-9]{12})'))[1];
$$;
