-- Malay is one person
-- ===================
--
-- The PM filter listed "Malay Shrivastava" and "Malay Srivastava" as two people. They
-- are one; the surname was being typed two ways. Rahul picked SRIVASTAVA on 13 Oct 2026.
--
-- The directory already knew: pm_directory held a single row, malay@mavlers.com, with
-- both spellings in its aliases. The duplicate came from the values stored on the rows
-- themselves, which is what every PM filter is built from:
--
--   opportunities.pm_owner          87 Shrivastava    2 Srivastava
--   sheet_raw via web_sheet_rows    159 Shrivastava   0
--   bookings.sme                    149 Shrivastava   0
--   web_revenue.sme                 129 Shrivastava   0
--   clients.pc_sme                   17 Shrivastava   0
--   client_owner_overrides.person     3 Shrivastava   0
--
-- Note the minority spelling won. Srivastava is how he spells it, which is the only
-- thing that decides a person's name; 246 rows of the other one is just how often it
-- was mistyped.
--
-- THE FROZEN SHEET IS NOT REWRITTEN. 159 of these sit in sheet_raw, which is the old
-- spreadsheet's own record and locked by 126 — only sheet-writer runs now, outbound.
-- Rather than edit a locked source, web_sheet_rows folds the name on the way out, the
-- same way it already folded sales_person. That also means the merge cannot be undone
-- by anything arriving later with the old spelling.
--
-- The alias array keeps BOTH spellings. directory_owner_match gates who may edit a row,
-- so dropping the old alias would have locked Malay out of his own historical rows.

-- 1. One canonical spelling, folded wherever a name is read
-- ---------------------------------------------------------
-- Same shape as the Vikram Shahi/Sahi entry that was already here for exactly this.
create or replace function public.canonical_person(p text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case lower(btrim(coalesce(p, '')))
    when 'kalgi'              then 'Kalgi Shah'
    when 'kalgi shah'         then 'Kalgi Shah'
    when 'flintoff'           then 'Flintoff Mehta'
    when 'nevilson'           then 'Nevilson Christian'
    when 'vikram shahi'       then 'Vikram Sahi'
    when 'malay shrivastava'  then 'Malay Srivastava'
    when 'malay'              then 'Malay Srivastava'
    else nullif(btrim(coalesce(p, '')), '')
  end;
$function$;


-- 2. The sheet's PC/SME is folded on the way out
-- ----------------------------------------------
-- One expression changed from s.pc_sme to canonical_person(s.pc_sme). web_project_ledger
-- reads this as pm_owner, so the 159 locked rows now report the canonical name without a
-- single byte of sheet_raw being touched.
create or replace view public.web_sheet_rows as
 SELECT s.id,
    s.row_index,
    COALESCE(o.project_id, s.project_id) AS project_id,
    COALESCE(o.quote_id, s.quote_id) AS quote_id,
    COALESCE(o.service_dept, s.service_dept) AS service_dept,
    COALESCE(o.project_name, s.project_name) AS project_name,
    COALESCE(o.project_type, s.project_type) AS project_type,
    COALESCE(o.technology, s.technology) AS technology,
    s.confirmation_date,
    COALESCE(o.start_date, s.start_date) AS start_date,
    COALESCE(o.delivery_date, s.delivery_date) AS delivery_date,
    COALESCE(o.internal_delivery, s.internal_delivery) AS internal_delivery,
    COALESCE(o.internal_hrs, s.internal_hrs) AS internal_hrs,
    COALESCE(o.actual_hrs, s.actual_hrs) AS actual_hrs,
    COALESCE(o.project_status, s.project_status) AS project_status,
    COALESCE(o.service_type, s.service_type) AS service_type,
    COALESCE(o.delivery_type, s.delivery_type) AS delivery_type,
    canonical_person(s.pc_sme) AS pc_sme,
    COALESCE(o.expert, s.expert) AS expert,
    COALESCE(o.integration, s.integration) AS integration,
    client_canonical_name(s.agency) AS agency,
    s.client_name,
    s.client_email,
    COALESCE(o.client_type, s.client_type) AS client_type,
    COALESCE(o.geo, s.geo) AS geo,
    s.currency,
    s.quote_price,
    s.confirmed_price,
    s.usd_value,
    COALESCE(o.business_type, s.business_type) AS business_type,
    canonical_person(s.sales_person) AS sales_person,
    COALESCE(o.outsource_price, s.outsource_price) AS outsource_price,
    COALESCE(o.invoice_no, s.invoice_no) AS invoice_no,
    COALESCE(o.invoice_currency, s.invoice_currency) AS invoice_currency,
    COALESCE(o.invoice_amount, s.invoice_amount) AS invoice_amount,
    s.booking_month,
    o.contractor_name,
    o.outsource_currency,
    o.row_index IS NOT NULL AS has_override,
    o.updated_by AS override_by,
    o.updated_at AS override_at
   FROM web_sheet_rows_src s
     LEFT JOIN sheet_row_overrides o ON o.row_index = s.row_index AND o.fingerprint = ((((lower(COALESCE(s.agency, ''::text)) || '|'::text) || lower(COALESCE(s.project_name, ''::text))) || '|'::text) || COALESCE(s.booking_month::text, ''::text));


-- 3. The stored values the dashboard owns
-- ---------------------------------------
-- Written at source rather than folded, because web_project_ledger reads
-- opportunities.pm_owner directly and clients is rebuilt from bookings/web_revenue.
-- All 87 opportunities rows already carried a business_type of Repeat, New or null, so
-- the normalising trigger on that table is a no-op here and nothing else moves.
update public.opportunities        set pm_owner = 'Malay Srivastava' where pm_owner = 'Malay Shrivastava';
update public.client_owner_overrides set person = 'Malay Srivastava' where person   = 'Malay Shrivastava';
update public.bookings             set sme      = 'Malay Srivastava' where sme      = 'Malay Shrivastava';
update public.web_revenue          set sme      = 'Malay Srivastava' where sme      = 'Malay Shrivastava';

-- The directory row itself. Both spellings stay in aliases so he can still edit the
-- rows that were raised under the old one.
update public.pm_directory
   set name    = 'Malay Srivastava',
       aliases = array['malay srivastava','malay shrivastava','malay']
 where email = 'malay@mavlers.com';

-- clients.pc_sme is derived, so it is refreshed rather than updated.
select public.rebuild_clients();
