-- Business type is two values: Repeat or New.
--
-- Four spellings were in play. The revenue sheet has been hand-filled with Repeat, New
-- and New Repeat; the dashboard's own Quotes sync writes a fourth, "Existing". Three of
-- those mean the same thing — a client who has bought before — and the split was never a
-- distinction anybody used, it was two people typing into different tabs. Left alone it
-- would have gone into the new spreadsheet from October as four categories that nobody
-- can total.
--
-- Folded at the DATABASE, not in the form, because the form is not the only writer: the
-- Quotes sync runs every 30 minutes and would put "Existing" straight back. A trigger
-- catches every path in — the confirm dialog, the sync, the recurring duplicator, a hand
-- edit — which is the only version of this that stays true next month.
--
-- Historical rows in `sheet_raw` are NOT touched. That tab belongs to the team who fills
-- it, and rewriting 3,218 of their rows to tidy a word is not a change this dashboard
-- should make on its own.

create or replace function public.norm_business_type(v text)
returns text language sql immutable as $$
  select case
    when coalesce(btrim(v), '') = '' then null
    -- Repeat is tested FIRST: "New Repeat" starts with "new" and is still a repeat client.
    -- Repeat, New Repeat, Existing — all of them are "they have bought before".
    when lower(btrim(v)) ~ 'repeat|existing' then 'Repeat'
    when lower(btrim(v)) ~ '^new\M' then 'New'
    else btrim(v)
  end
$$;

create or replace function public.opportunities_norm_business_type()
returns trigger language plpgsql as $$
begin
  new.business_type := public.norm_business_type(new.business_type);
  return new;
end $$;

drop trigger if exists opportunities_business_type_norm on public.opportunities;
create trigger opportunities_business_type_norm
  before insert or update of business_type on public.opportunities
  for each row execute function public.opportunities_norm_business_type();

-- The rows already stored under the old spellings.
update public.opportunities
   set business_type = public.norm_business_type(business_type)
 where business_type is not null
   and business_type is distinct from public.norm_business_type(business_type);
