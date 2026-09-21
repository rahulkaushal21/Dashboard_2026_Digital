-- 036 — the fields the revenue sheet needs that the dashboard never asked for.
--
-- The Web, Hub & LP tab has 40 columns. Before this, the dashboard could fill 17 of them,
-- so a deal confirmed here landed in the sheet as a half-row somebody had to finish by
-- hand — which is exactly the second pass the 1 Oct cutover is meant to abolish.
--
-- Seven columns are genuinely typed by a person at confirmation time. They are added
-- here. The rest are either computed (Project Id, Optimization, Week Start, Month-Year)
-- or filled later by delivery and finance, and neither belongs in a confirm dialog.
--
-- WHY THE VOCABULARIES COME OUT OF THE SHEET RATHER THAN OUT OF THE CODE: these columns
-- have been filled by hand for 3,218 rows. The spellings in there ARE the vocabulary —
-- inventing a parallel list in TypeScript would mean the dashboard writes "Dev & Design"
-- where every historical row says "Dev and Design", and the tab stops grouping.

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------

alter table public.opportunities
  -- "Agency" in the sheet is the company; "Client Name" is the person at it. The
  -- dashboard only ever stored the company, so the person had to be retyped.
  add column if not exists client_name     text,
  -- Agency | Direct/End — 2,267 vs 938 across the history.
  add column if not exists client_type     text,
  -- What was sold: Development Only, Dev and Design, Project Management, …
  add column if not exists service_type    text,
  -- How it is scheduled: Effort based, Expedite, Client Specified TAT, Super Expedite.
  add column if not exists delivery_type   text,
  -- The figure QUOTED, before negotiation, in the deal's own currency. Distinct from
  -- local_value, which is what it was actually confirmed at. 85% of sheet rows carry
  -- both and the gap between them is the discount — losing it loses that.
  add column if not exists quote_price     numeric,
  add column if not exists start_date      date,
  add column if not exists delivery_date   date,
  -- DELIVERY state: Under Development -> Delivered, or Cancelled / On Hold.
  -- Deliberately NOT called project_status next to `status`, and not merged into it:
  -- `status` is the SALES state (Open/Won/Lost), it is overwritten by the Quotes sync
  -- every 30 minutes, and oppStatus() treats anything it does not recognise as Open.
  -- Writing "Delivered" into `status` would move won deals back into open pipeline.
  add column if not exists delivery_status text;

comment on column public.opportunities.delivery_status is
  'Delivery state for the revenue sheet''s "Project Status" column. Not the sales status — see `status`.';

-- ---------------------------------------------------------------------------
-- 2. Dropdown vocabularies, read from the sheet itself
-- ---------------------------------------------------------------------------
--
-- A floor of 3 uses. Every one of these columns has a tail of single-row typos — an
-- email address in Client Type, "$600" in Business Type — and a dropdown offering those
-- back would launder the typo into the vocabulary. #REF! is excluded for the same reason.

drop view if exists public.web_sheet_vocab;

-- "Repeat" and "repeat" are one option typed two ways, not two options. Fold on case and
-- keep the majority spelling, or the dropdown offers the same thing twice and the tab
-- carries on grouping it apart.
create view public.web_sheet_vocab
with (security_invoker = true) as
with h as (select headers from public.sheet_raw_header where tab = 'revenue'),
cols as (
  select * from (values
    ('service_type',    'Service Type'),
    ('delivery_type',   'Delivery Type'),
    ('client_type',     'Client Type'),
    ('technology',      'Technology'),
    ('delivery_status', 'Project Status'),
    ('business_type',   'Business Type')
  ) as t(field, header)
),
-- Column positions are read from the header row, never hard-coded: insert a column in
-- the source tab and a fixed index silently reads the one next door.
pos as (
  select c.field, (e.ord - 1)::int as idx
    from cols c
    cross join h
    join lateral jsonb_array_elements_text(h.headers) with ordinality as e(val, ord)
      on lower(btrim(e.val)) = lower(c.header)
),
vals as (
  select p.field, btrim(r.values ->> p.idx) as value
    from pos p join public.sheet_raw r on r.tab = 'revenue'
   where p.idx is not null
),
clean as (
  select field, value from vals
   where coalesce(value, '') <> ''
     and value not like '#%'   -- #REF!, #N/A
     and value !~ '@'          -- an email typed into a category column
),
spellings as (
  select field, lower(value) as k, value, count(*) as n
    from clean group by field, lower(value), value
)
select field,
       (array_agg(value order by n desc))[1] as value,
       sum(n)::bigint as uses
  from spellings
 group by field, k
having sum(n) >= 3;

comment on view public.web_sheet_vocab is
  'Dropdown options for the confirm dialog, taken from what the revenue sheet actually contains. Values used fewer than 3 times are typos, not options; case variants are folded to the majority spelling.';

grant select on public.web_sheet_vocab to authenticated;

-- ---------------------------------------------------------------------------
-- 3. What we already know about this client, from the sheet's own rows
-- ---------------------------------------------------------------------------
--
-- The point of this view is that a PM confirming a repeat client should be CHECKING
-- fields, not typing them. The sheet holds the answers: 99%+ of its 3,218 rows carry
-- Client Name, Client Type, Service Type and Delivery Type, and a client's next project
-- is almost always the same on all four.
--
-- Keyed on Agency, because that is the column the dashboard's company_name corresponds
-- to. Most recent row wins — a client that moved from Direct/End to Agency should
-- prefill as what they are now, not what they were in 2024.

create or replace view public.web_sheet_client_defaults
with (security_invoker = true) as
with h as (select headers from public.sheet_raw_header where tab = 'revenue'),
idx as (
  select lower(btrim(e.val)) as name, (e.ord - 1)::int as i
    from h cross join lateral jsonb_array_elements_text(h.headers) with ordinality as e(val, ord)
),
c as (
  select (select i from idx where name = 'agency')        as agency,
         (select i from idx where name = 'client name')   as client_name,
         (select i from idx where name = 'client email')  as client_email,
         (select i from idx where name = 'client type')   as client_type,
         (select i from idx where name = 'service type')  as service_type,
         (select i from idx where name = 'delivery type') as delivery_type,
         (select i from idx where name = 'technology')    as technology,
         (select i from idx where name = 'geo')           as geo,
         (select i from idx where name = 'currency type') as currency,
         (select i from idx where name = 'service department') as service_dept,
         (select i from idx where name = 'project type')  as project_type,
         (select i from idx where name = 'pc/sme')        as pc_sme,
         (select i from idx where name = 'account/sales person') as sales_person,
         (select i from idx where name = 'confirmation date')    as conf_date
),
rows_ as (
  select lower(btrim(r.values ->> c.agency)) as client_key,
         btrim(r.values ->> c.agency)        as agency,
         nullif(btrim(r.values ->> c.client_name), '')   as client_name,
         nullif(btrim(r.values ->> c.client_email), '')  as client_email,
         nullif(btrim(r.values ->> c.client_type), '')   as client_type,
         nullif(btrim(r.values ->> c.service_type), '')  as service_type,
         nullif(btrim(r.values ->> c.delivery_type), '') as delivery_type,
         nullif(btrim(r.values ->> c.technology), '')    as technology,
         nullif(btrim(r.values ->> c.geo), '')           as geo,
         nullif(btrim(r.values ->> c.currency), '')      as currency,
         nullif(btrim(r.values ->> c.service_dept), '')  as service_dept,
         nullif(btrim(r.values ->> c.project_type), '')  as project_type,
         nullif(btrim(r.values ->> c.pc_sme), '')        as pc_sme,
         nullif(btrim(r.values ->> c.sales_person), '')  as sales_person,
         r.row_index
    from public.sheet_raw r cross join c
   where r.tab = 'revenue'
     and coalesce(btrim(r.values ->> c.agency), '') <> ''
)
-- A client's most recent row supplies the defaults, but a blank cell in it falls through
-- to the last row that HAD a value. Taking the newest row wholesale would hand back an
-- empty Client Name whenever the latest project happened to omit it.
select client_key,
       (array_agg(agency order by row_index desc))[1] as company_name,
       (array_agg(client_name   order by row_index desc) filter (where client_name   is not null))[1] as client_name,
       (array_agg(client_email  order by row_index desc) filter (where client_email  is not null))[1] as client_email,
       (array_agg(client_type   order by row_index desc) filter (where client_type   is not null))[1] as client_type,
       (array_agg(service_type  order by row_index desc) filter (where service_type  is not null))[1] as service_type,
       (array_agg(delivery_type order by row_index desc) filter (where delivery_type is not null))[1] as delivery_type,
       (array_agg(technology    order by row_index desc) filter (where technology    is not null))[1] as technology,
       (array_agg(geo           order by row_index desc) filter (where geo           is not null))[1] as geo,
       (array_agg(currency      order by row_index desc) filter (where currency      is not null))[1] as currency,
       (array_agg(service_dept  order by row_index desc) filter (where service_dept  is not null))[1] as service_dept,
       (array_agg(project_type  order by row_index desc) filter (where project_type  is not null))[1] as project_type,
       (array_agg(pc_sme        order by row_index desc) filter (where pc_sme        is not null))[1] as pc_sme,
       (array_agg(sales_person  order by row_index desc) filter (where sales_person  is not null))[1] as sales_person,
       count(*) as sheet_projects
  from rows_
 group by client_key;

comment on view public.web_sheet_client_defaults is
  'Per-client defaults read from the revenue sheet, so the confirm dialog can be checked rather than filled in.';

grant select on public.web_sheet_client_defaults to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The completeness gate
-- ---------------------------------------------------------------------------
--
-- Everything added here is REQUIRED, with one exception, because after 1 Oct there is no
-- later pass in the sheet to catch a blank. That is only reasonable because the dialog
-- prefills all of it from the client's own history — the ask is to check six fields, not
-- to fill them.
--
-- Delivery date is required EXCEPT on the retainer-shaped project types. A Dedicated
-- engagement has no delivery date; demanding one would make the monthly retainer, the
-- highest-volume confirmation there is, impossible to complete honestly.
--
-- Quote Price stays optional: 15% of historical rows have none, and where a deal was
-- never formally quoted an invented figure is worse than a blank.

create or replace function public.opportunity_missing_fields(p_id bigint)
returns text[]
language sql stable security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(f order by f), '{}'::text[]) from (
    select f from public.opportunities o,
      lateral (values
        ('Client',            nullif(trim(coalesce(o.company_name,'')),'') is null),
        ('Value',             coalesce(o.est_value,0) <= 0),
        ('Currency',          nullif(trim(coalesce(o.currency,'')),'') is null),
        ('Quote date',        o.source_date is null),
        ('Service / dept',    nullif(trim(coalesce(o.service_dept,'')),'') is null),
        ('Project type',      nullif(trim(coalesce(o.project_type,'')),'') is null),
        ('Account manager',   nullif(trim(coalesce(o.sales_person,'')),'') is null),
        ('PM owner',          nullif(trim(coalesce(o.pm_owner,'')),'') is null),
        ('Geography',         nullif(trim(coalesce(o.geo,'')),'') is null),
        ('Client name',       nullif(trim(coalesce(o.client_name,'')),'') is null),
        ('Client type',       nullif(trim(coalesce(o.client_type,'')),'') is null),
        ('Service type',      nullif(trim(coalesce(o.service_type,'')),'') is null),
        ('Delivery type',     nullif(trim(coalesce(o.delivery_type,'')),'') is null),
        ('Technology',        nullif(trim(coalesce(o.technology,'')),'') is null),
        ('Start date',        o.start_date is null),
        ('Delivery date',     o.delivery_date is null
                              and coalesce(o.project_type,'') not in
                                  ('Dedicated','Partial Dedicated','Ballpark'))
      ) as v(f, missing)
     where o.id = p_id and v.missing
  ) z
$function$;

revoke execute on function public.opportunity_missing_fields(bigint) from public, anon;
grant  execute on function public.opportunity_missing_fields(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Confirming, with the new fields
-- ---------------------------------------------------------------------------
--
-- The new parameters are appended and all default NULL, so the existing 12-argument call
-- keeps working while the frontend catches up. NULL means "leave what is there" for
-- every one of them — a form that fails to send a field must never blank it.

-- The old 12-argument version must GO, not merely be superseded. Postgres overloads on
-- argument list, so leaving it in place would make every existing named-parameter call
-- ambiguous — both candidates match, and the error names neither.
drop function if exists public.confirm_opportunity(bigint, numeric, text, date, text, text, text, text, text, date, text, text);

create or replace function public.confirm_opportunity(
  p_id bigint,
  p_est_value numeric default null, p_currency text default null,
  p_quote_date date default null, p_service_dept text default null,
  p_project_type text default null, p_sales_person text default null,
  p_pm_owner text default null, p_geo text default null,
  p_confirmed_on date default null, p_note text default null, p_subject text default null,
  p_client_name text default null, p_client_type text default null,
  p_service_type text default null, p_delivery_type text default null,
  p_technology text default null, p_contact_email text default null,
  p_quote_price numeric default null, p_start_date date default null,
  p_delivery_date date default null, p_delivery_status text default null,
  p_business_type text default null
)
returns bigint
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_actor   text := public.jwt_email();
  v_missing text[];
  v_cur     text;
  v_local   numeric;
begin
  if v_actor is null then
    raise exception 'Sign in to confirm a deal.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.opportunities where id = p_id) then
    raise exception 'No such deal (#%).', p_id using errcode = 'P0002';
  end if;
  if not public.can_confirm_opportunity(p_id) then
    raise exception 'This deal belongs to another PM. Its owner, or an admin, can confirm it.'
      using errcode = '42501';
  end if;

  update public.opportunities set
    currency       = coalesce(nullif(trim(coalesce(p_currency,'')),''),       currency, 'USD'),
    source_subject = coalesce(nullif(trim(coalesce(p_subject,'')),''),        source_subject),
    source_date    = coalesce(p_quote_date::timestamptz, source_date),
    service_dept   = coalesce(nullif(trim(coalesce(p_service_dept,'')),''),   service_dept),
    project_type   = coalesce(nullif(trim(coalesce(p_project_type,'')),''),   project_type),
    sales_person   = coalesce(nullif(trim(coalesce(p_sales_person,'')),''),   sales_person),
    pm_owner       = coalesce(nullif(trim(coalesce(p_pm_owner,'')),''),       pm_owner),
    geo            = coalesce(nullif(trim(coalesce(p_geo,'')),''),            geo),
    client_name    = coalesce(nullif(trim(coalesce(p_client_name,'')),''),    client_name),
    client_type    = coalesce(nullif(trim(coalesce(p_client_type,'')),''),    client_type),
    service_type   = coalesce(nullif(trim(coalesce(p_service_type,'')),''),   service_type),
    delivery_type  = coalesce(nullif(trim(coalesce(p_delivery_type,'')),''),  delivery_type),
    technology     = coalesce(nullif(trim(coalesce(p_technology,'')),''),     technology),
    business_type  = coalesce(nullif(trim(coalesce(p_business_type,'')),''),  business_type),
    contact_email  = coalesce(nullif(trim(coalesce(p_contact_email,'')),''),  contact_email),
    quote_price    = coalesce(p_quote_price,  quote_price),
    start_date     = coalesce(p_start_date,   start_date),
    delivery_date  = coalesce(p_delivery_date, delivery_date),
    -- A deal being confirmed is starting, not finished. 'Delivered' is set later, by
    -- whoever actually delivers it.
    delivery_status = coalesce(nullif(trim(coalesce(p_delivery_status,'')),''),
                               delivery_status, 'Under Development')
  where id = p_id;

  -- The figure typed in is in the deal's OWN currency. est_value is USD throughout the
  -- dashboard - every total, forecast and scorecard adds it up without asking what
  -- currency it was - so the local amount is kept in local_value and est_value holds the
  -- converted figure. Storing a GBP number in est_value would silently overstate the
  -- pipeline by a third.
  select coalesce(p_est_value, local_value, est_value), currency into v_local, v_cur
    from public.opportunities where id = p_id;

  update public.opportunities set
    local_value = v_local,
    est_value   = public.to_usd(v_local, v_cur)
  where id = p_id;

  v_missing := public.opportunity_missing_fields(p_id);
  if array_length(v_missing, 1) > 0 then
    raise exception 'Cannot confirm yet - still missing: %', array_to_string(v_missing, ', ')
      using errcode = '23502';
  end if;

  update public.opportunities set
    won = true, status = 'Won', won_amount = est_value, rfq_status = 'won',
    email_won = true, email_won_by = v_actor,
    email_won_at = coalesce(p_confirmed_on::timestamptz, now()),
    email_won_reason = nullif(trim(coalesce(p_note,'')),''),
    confirmed_by = v_actor, confirmed_at = coalesce(p_confirmed_on::timestamptz, now()),
    unlikely = false, unlikely_reason = null, unlikely_at = null, unlikely_by = null,
    email_lost = false, email_lost_reason = null, email_lost_at = null, email_lost_by = null
  where id = p_id;

  insert into public.opportunity_events (opportunity_id, event, actor, detail)
  values (p_id, 'confirmed', v_actor,
          jsonb_build_object('confirmed_on', coalesce(p_confirmed_on, current_date),
                             'local_value', v_local, 'currency', v_cur, 'note', p_note));

  return p_id;
end $function$;

-- EXECUTE is granted to PUBLIC by default and anon inherits it, so the revoke has to come
-- FIRST. Granting without revoking leaves the function open to every anonymous visitor —
-- which is exactly how to_usd() ended up callable by anon and needed migration 033.
revoke execute on function public.confirm_opportunity(bigint, numeric, text, date, text, text, text, text, text, date, text, text, text, text, text, text, text, text, numeric, date, date, text, text) from public, anon;
grant  execute on function public.confirm_opportunity(bigint, numeric, text, date, text, text, text, text, text, date, text, text, text, text, text, text, text, text, numeric, date, date, text, text) to authenticated;
