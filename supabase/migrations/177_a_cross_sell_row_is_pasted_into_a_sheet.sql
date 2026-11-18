-- A cross-sell row has to paste into the sheet
-- ===========================================
--
-- "Need Date, email subject line, email id and client name in the same format so i can
-- easily copy paste and also can also export it to excel" — Rahul, 18 Nov 2026, with a
-- picture of the tracker's header row.
--
-- The tracker's ten columns are, in order:
--   Month (DD-MM-YYYY) · Company Name · Client Name · Client Email ID · Agency / Direct ·
--   PC/SME Name · BU Name · Cross Sell Service Name · Email Subject line ·
--   Invoice Billable (USD) - RFQ
--
-- 175 held seven of them. The three missing ones — the contact's name, their address and
-- whether they are an agency or the end client — are on the booked line in
-- web_project_ledger, so they could have been joined at read time. They are copied onto
-- the row instead, on purpose: a cross-sell is a record of who was mailed, and the ledger
-- line's contact is the account's CURRENT contact. When a client changes hands the join
-- would quietly rewrite who we sold to last October. The row keeps what was true when the
-- mail went.
--
-- AGENCY / DIRECT IS NORMALISED HERE, not in the page. The ledger says 'Direct/End'; the
-- tracker's column says 'Direct'. The value stored is the one that gets pasted, so the
-- page prints the column and does not translate it — a page that rewrites a value on its
-- way to the clipboard is a page you cannot check against its own database.

alter table public.cross_sells add column if not exists client_name  text;
alter table public.cross_sells add column if not exists client_email text;
alter table public.cross_sells add column if not exists client_type  text;

comment on column public.cross_sells.client_name is
  'The person mailed, as the tracker''s "Client Name" column wants it. Copied from the booked line at the time, not joined — see migration 177.';
comment on column public.cross_sells.client_email is
  'Their address, the tracker''s "Client Email ID".';
comment on column public.cross_sells.client_type is
  'Agency or Direct, spelled as the tracker spells it.';

-- Filled from the booked line each row already reconciles against, taking the contact on
-- the most recently confirmed line for that client in the window.
with contact as (
  select lower(btrim(l.company_name)) k,
         (array_agg(l.client_name   order by l.confirmed_at desc nulls last) filter (where l.client_name is not null))[1]   nm,
         (array_agg(l.contact_email order by l.confirmed_at desc nulls last) filter (where l.contact_email is not null))[1] em,
         (array_agg(l.client_type   order by l.confirmed_at desc nulls last) filter (where l.client_type is not null))[1]   ty
  from public.web_project_ledger l
  where l.booking_month between date '2026-10-01' and date '2026-11-01'
  group by k
)
update public.cross_sells c
   set client_name  = coalesce(c.client_name, contact.nm),
       client_email = coalesce(c.client_email, contact.em),
       client_type  = coalesce(c.client_type,
                        case when contact.ty ilike 'agency%' then 'Agency'
                             when contact.ty is not null     then 'Direct'
                             else null end)
  from contact
 where contact.k = lower(btrim(c.client));

-- andrew@frogonline.net.a is a truncated address — the sheet lost the 'u' on three
-- Frogonline rows and the ledger carries the typo. Fixed on the way in rather than pasted
-- into the tracker, where it would bounce.
update public.cross_sells
   set client_email = 'andrew@frogonline.net.au'
 where client_email = 'andrew@frogonline.net.a';
