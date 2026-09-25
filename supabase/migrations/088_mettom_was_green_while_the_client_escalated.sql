-- Mettom Payrolling showed GREEN on Client 360 through the whole of September, while
-- the client spent two weeks finding our defects for us.
--
-- The thread ("Delivery - Act 3 theme updates", Act 3 HubSpot theme migration) was
-- captured live, not backfilled, and still produced NO signal of any kind. Third time
-- this exact class of miss has surfaced — Sticker Ninja and BOLT Marketing were the
-- other two. Step 4 of the scan is a person reading the mail, and it is the step that
-- fails silently.
--
-- WHAT THE CLIENT ACTUALLY SAID, in order:
--   2 Sep  — ownership of the re-update checklist unclear ("do you want us to go through
--            this whole checklist ourselves, or is this for you to check whether you've
--            migrated everything?"); mobile header button missing; pages listed in
--            earlier emails still not converted, including the full wiki set.
--   10 Sep — their SEO specialist reports "a lot of 404 notifications" from changed
--            buttons; breadcrumb and side-menu structure wrong on the wiki pages.
--   16 Sep — USP blocks migrated with duplicated text; the wrong form on the e-book
--            download page, which Nick fixed himself: "this is careless work if it means
--            we have to triple-check everything... We paid serious money to get this
--            migration done, and we keep running into errors."
--
-- Recorded as EVIDENCE rather than as a colour. riskOf() in app/clients/page.tsx reads a
-- negative email signal and returns 'Watch', so the rule sets the zone; hand-setting the
-- badge would have left the next reviewer with a colour and no reason for it.

insert into public.email_signals
  (company_name, client_email, signal_type, sentiment, summary, client_quote,
   source_subject, source_sender, source_date, thread_id, verified_by)
values
 ('Mettom Payrolling','n.hunting@mettom.nl','Delivery quality — repeat defects','At Risk',
  $q$Act 3 theme migration: the CLIENT is finding the defects, repeatedly, across the whole of September. 2 Sep — ownership of the re-update checklist unclear ("do you want us to go through this whole checklist ourselves, or is this for you to check whether you've migrated everything?"), mobile header button missing, and pages listed in earlier emails still not converted including the full wiki set. 10 Sep — their SEO specialist reports "a lot of 404 notifications" from changed buttons, plus wrong breadcrumb and side-menu structure on the wiki pages. 16 Sep — USP blocks migrated with duplicated text, and the wrong form on the e-book download page, which Nick fixed himself. Tone hardened from patient to pointed over two weeks; the client is now asking for a full re-check and has invoked what they paid.$q$,
  $q$We've spotted another sloppy mistake. The wrong form was placed on the wrong page. I've just fixed it myself, but this is careless work if it means we have to triple-check everything because of it. … Could you please double-check everything again? We paid serious money to get this migration done, and we keep running into errors.$q$,
  'Re: Delivery - Act 3 theme updates','Nick Hunting <n.hunting@mettom.nl>','2026-09-16','1a0391c51deff189',
  'web@uplers.com')
on conflict (thread_id) do nothing;

-- NOT DONE HERE, because a client merge is the user's call per pair:
-- the one escalation already on record for this client is filed under "Mettom HRM B.V."
-- (Feb 2026, Technical, MAJOR, raised by Rachana Pandya). Client 360 matches names with
-- keyMatch(), which needs one key to be a prefix of the other at >= 4 chars — and
-- "mettomhrmbv" against "mettompayrolling" shares only "mettom", so it has never
-- attached. Evidence they are one client: mettom.nl resolves to Mettom Payrolling, only
-- Mettom Payrolling is booked ($5,461 over 6 lines, Aug 2025 - Sep 2026), and its SMEs
-- are Nitin Mishra and Harshvardhan Sharma — the same two people on this email thread.
-- One row in client_name_fixes attaches it, and would move this client from Watch to
-- At risk on the existing rule (a major escalation plus live frustration).
