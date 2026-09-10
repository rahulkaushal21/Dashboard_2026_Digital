-- Tell the "fix the sheet" flags WHERE to go, not just what is wrong.
--
-- quotes.src_row_hash already ends in an index, but that index is assigned AFTER
-- the ingest's KEEP filter drops blank rows, so it is not the spreadsheet row and
-- would skew the moment a blank row appeared mid-sheet. It also cannot be
-- repurposed: quote_key derives 'r:N' from that hash, so changing its meaning
-- would re-key and orphan every quote that has no Quote ID.
--
-- So sheet_row is additive. sheet-ingest (v5) fills it from the position captured
-- BEFORE filtering; until a push lands, the view falls back to index + 2 (one for
-- the header, one because spreadsheets are 1-based). Measured at the time of
-- writing: 815 rows, indices 0-814 contiguous, so the fallback is exact today.
alter table quotes add column if not exists sheet_row int;

comment on column quotes.sheet_row is
  'True 1-based row in the Quotes tab, captured before the ingest KEEP filter. Never derive quote_key from this.';

create or replace view web_quote_sheet_row as
with qk as (
  select
    coalesce(
      nullif(quote_id, ''),
      case when src_row_hash ~ '^Q:[^:]*:[0-9]+$'
           then 'r:' || split_part(src_row_hash, ':', 3)
           else nullif(src_row_hash, '') end,
      md5(coalesce(agency,'') || coalesce(subject_project,'') || coalesce(added_date::text,'') || id::text)
    ) as qkey,
    coalesce(
      sheet_row,
      case when src_row_hash ~ '^Q:[^:]*:[0-9]+$'
           then split_part(src_row_hash, ':', 3)::int + 2 end
    ) as sheet_row
  from quotes
)
select o.id, k.sheet_row
from opportunities o
join qk k on k.qkey = o.quote_key
where o.origin = 'sheet' and k.sheet_row is not null;

-- Row numbers are not confidential, but keep the grant explicit and narrow.
revoke all on web_quote_sheet_row from anon, authenticated;
grant select on web_quote_sheet_row to anon, authenticated;
