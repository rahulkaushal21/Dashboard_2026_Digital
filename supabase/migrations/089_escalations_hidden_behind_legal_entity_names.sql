-- 14 escalations that Client 360 could never see, and one that was never logged.
--
-- Client 360 matches an escalation to a client with keyMatch(): two names match if any
-- key is equal, or if one is a PREFIX of the other at >= 4 characters. That handles
-- "Enphase (Solargraf)" and "The View From Here" fine. It cannot handle a client filed
-- under its legal entity, because "mettomhrmbv" and "mettompayrolling" share a stem and
-- neither is a prefix of the other.
--
-- Sweeping every escalation name that fails keyMatch against all clients but shares a
-- 6-character stem with one found nine such names, on fourteen escalation rows. Each was
-- confirmed against a registered domain or the client's own wording, NOT against the
-- name looking similar:
--
--   Mettom HRM B.V.          -> Mettom Payrolling      mettom.nl; same PMs on the thread
--   THE RANKING COMPANY INC. -> Ranking Carolina       their own footer says "DBA RANKING CAROLINA"
--   Appeal Marketing Ltd     -> Appeal Digital         appeal.marketing + appealmarketing.com are theirs
--   Amadeus / Amadeus Group  -> Amadeus IT Group SA    amadeus.com; escalations from eric.oppegaard@amadeus.com
--   Birchman Group / ...Ltd  -> Birchmangroup          birchmangroup.com
--   Cheryl Obal              -> Cheryl Lynn Obal       cherylobal.com
--   David Hicks Limited      -> davidhicksdesign.co.uk booked under the domain
--   Messina Agency           -> messinadesign.biz      booked under the domain
--   Will Woolley             -> WillWooley             willwoolley.co.uk
--
-- WillWooley is deliberately the canonical even though it is the misspelling: it is the
-- name the revenue sheet books under, and renaming the ledger to tidy a spelling is a
-- separate decision from making an escalation visible.
--
-- client_aliases with kind='merge' is the existing mechanism; canonicalise_client_names()
-- applies it and already runs at :03 and :33, just after each sheet sync, so a sheet push
-- that restores the old spelling is corrected within minutes.

insert into public.client_aliases (kind, pattern, canonical, note) values
 ('merge','mettom hrm b.v.','Mettom Payrolling','legal entity; mettom.nl, same PMs (Nitin Mishra, Harshvardhan Sharma), only Mettom Payrolling is booked'),
 ('merge','the ranking company inc.','Ranking Carolina','their own footer: "THE RANKING COMPANY INC. DBA RANKING CAROLINA"'),
 ('merge','appeal marketing ltd','Appeal Digital','appeal.marketing / appeal.marketing.co.uk / appealmarketing.com are all registered domains of Appeal Digital'),
 ('merge','amadeus','Amadeus IT Group SA','amadeus.com; escalations raised from eric.oppegaard@amadeus.com'),
 ('merge','amadeus group','Amadeus IT Group SA','amadeus.com'),
 ('merge','birchman group','Birchmangroup','birchmangroup.com'),
 ('merge','birchman solutions ltd','Birchmangroup','birchmangroup.com'),
 ('merge','cheryl obal','Cheryl Lynn Obal','cherylobal.com / cherylobal.co'),
 ('merge','david hicks limited','davidhicksdesign.co.uk','booked under the domain'),
 ('merge','messina agency','messinadesign.biz','booked under the domain'),
 ('merge','will woolley','WillWooley','willwoolley.co.uk; the BOOKED name is the misspelling, kept as canonical so the ledger is not rewritten')
on conflict (kind, pattern) do nothing;

select * from public.canonicalise_client_names();

-- The September escalation itself, which nobody had logged.
--
-- src_row_hash is NULL on purpose: sheet-ingest clears escalations with
-- `delete().not("src_row_hash","is",null)` before reinserting the tab, so a null hash is
-- how a dashboard-raised escalation survives the sync. 39 rows already live this way.
insert into public.escalations
  (raised_by, tracking_date, month, week, service_type, company_name, deal_type,
   email_subject, project_name, situation_type, source, escalation_type, business_impact,
   source_sender, source_date, thread_id, evidence, src_row_hash)
values
 ('web@uplers.com','2026-09-16','September','Sep W3','Managed','Mettom Payrolling',
  'Existing Business - Managed','Re: Delivery - Act 3 theme updates','Act 3 theme migration',
  'Technical','email','Major','Medium',
  'Nick Hunting <n.hunting@mettom.nl>','2026-09-16','1a0391c51deff189',
  $q$Client found our defects repeatedly across September on the Act 3 HubSpot theme migration. 2 Sep: re-update checklist ownership unclear, mobile header button missing, wiki pages and later changes not converted. 10 Sep: their SEO specialist reports "a lot of 404 notifications" from changed buttons; wiki breadcrumb and side-menu structure wrong. 16 Sep: USP blocks migrated with duplicated text, and the wrong form on the e-book download page, fixed by the client himself — "this is careless work if it means we have to triple-check everything... We paid serious money to get this migration done, and we keep running into errors."$q$,
  null)
on conflict do nothing;

select public.rebuild_clients();
select public.compute_client_sentiment();
