-- Two follow-ups from 089.
--
-- 1. WILL WOOLLEY, SPELT RIGHT.
-- 089 kept "WillWooley" as canonical because it was the name the revenue sheet books
-- under, and said renaming the ledger was a separate decision. It is made here: their
-- own domain is willwoolley.co.uk, so the booked name has simply dropped an l.
--
-- Same shape as the Geraint fix (084): client_name_fixes maps it in the VIEWS, the
-- sheet itself is never rewritten, and deleting one row undoes it. The merge alias added
-- in 089 pointed the other way, so it is reversed rather than dropped — anything still
-- filed under the misspelling is now corrected TO the right spelling, instead of correct
-- records being renamed back to the typo.
--
-- Verified: all-time total unchanged at $3,817,869; 0 lines left under the misspelling,
-- 1 under "Will Woolley", and its Feb 2026 Major escalation now attaches.

insert into public.client_name_fixes (from_key, to_name, note) values
 ('willwooley','Will Woolley',
  'Booked name dropped an l. Their own domain is willwoolley.co.uk. Confirmed by Rahul on 25 Sep 2026. Applied in the views only; the sheet is never rewritten.')
on conflict (from_key) do nothing;

delete from public.client_aliases where kind='merge' and pattern='will woolley';
insert into public.client_aliases (kind, pattern, canonical, note) values
 ('merge','willwooley','Will Woolley','booked name dropped an l; their domain is willwoolley.co.uk')
on conflict (kind, pattern) do update set canonical = excluded.canonical, note = excluded.note;

-- 2. RANKING CAROLINA, WHICH IS THE ONE THAT MATTERS.
--
-- Surfaced by 089's merge: seven Major escalations, Apr 2025 through 21 May 2026, all of
-- them previously filed under "THE RANKING COMPANY INC." and invisible on Client 360.
-- $27,600 booked lifetime and nothing new since July 2026.
--
-- The May handover thread is the one that nearly went in as a DELIGHT. It matches every
-- praise regex there is — "one of the most rewarding partnerships", "incredibly
-- professional", "I would absolutely love to catch up" — because Jebin's own farewell
-- note praising the CLIENT is quoted beneath their reply. What the client actually wrote
-- is a warning about owner churn and quality. Recorded as At Risk, with their words kept
-- verbatim so nobody has to re-read the thread to see which way it points.

insert into public.email_signals
  (company_name, client_email, signal_type, sentiment, summary, client_quote,
   source_subject, source_sender, source_date, thread_id, verified_by)
values
 ('Ranking Carolina','jonea@rankingcarolina.com','Relationship continuity + quality warning','At Risk',
  $q$On Jebin Joy's handover email (11 May 2026), Jonea Sugishita — VP/CMO — replied naming the churn of account owners they have absorbed and setting an explicit expectation on quality. Read carelessly this thread scans as praise, because Jebin's own farewell note praising THEM is quoted beneath it; the client's own words are a warning. Context that makes it serious: seven Major escalations on record (Apr 2025 through 21 May 2026), $27,600 booked lifetime, and no new booking since July 2026.$q$,
  $q$We are super bummed that Jebin is no longer going to be working with us. … As Jebin and Tanuj know, we are not super fans of phone calls. We would rather send work along as we have it and see how it goes. From Ankit and Rahul to Nitin and now Jebin, there are some shoes to fill, and we hope that moving forward, the work quality only gets better.$q$,
  'FW: Re: Sayonara for Now & A Heartfelt Thank You - Ranking Carolina',
  'Jonea Gene Sugishita <jonea@rankingcarolina.com>','2026-05-12','19e189accb0a749b',
  'web@uplers.com')
on conflict (thread_id) do nothing;

select * from public.canonicalise_client_names();
select public.rebuild_clients();
select public.compute_client_sentiment();

-- Mettom's business impact is left at Medium. The relationship damage is real but the
-- contract is $5,461, and inflating the rating to match the tone would make the field
-- mean nothing. Change it deliberately if that is the wrong call.
