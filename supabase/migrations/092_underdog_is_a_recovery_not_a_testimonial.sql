-- Underdog Digital onto the Delights board — but as a RECOVERY, which is what the
-- mailbox actually supports.
--
-- Searched their whole correspondence, both underdogdigital.co and their end client
-- peaceathomeparenting.com. The warmest words on record are modest:
--   14 May  John Carlos  — "it looks good!... it is working well. Great job!"
--   24 Aug  Brooke       — "Thank you so much!"
--   12 Sep  Kathleen     — "excellent" (about handouts appearing, inside a QA list)
--   16 Sep  Brooke       — "Thank you all so much for all of your help!"
--
-- And against that, the same account escalated TWICE over the summer:
--   29 Jun  Matt Vaadi escalated on the PAH redevelopment — repeated weekly calls, a
--           perceived lack of leadership, rising cost.
--   9 Jul   "costing us tons of time every week… listen to the client the first time…
--           tighten up the communication, produce better designs."
--
-- So "amazing happy" is not what the email says, and writing a glowing testimonial from
-- this correspondence would be inventing one. What the email DOES say is better than a
-- compliment: after Malay's team absorbed ~10 unbilled hours stabilising the migration,
-- Matt approved a $250 goodwill invoice for that effort, paid to Malay. A client
-- choosing to pay more at the end of a difficult project is the strongest satisfaction
-- signal there is, because it costs them something.
--
-- Recorded with both halves in the summary. A delight on an account that escalated nine
-- weeks earlier has to carry that, or the board becomes a place where the bad half of a
-- story quietly disappears — and the QBR that reads it would walk in blind.
--
-- Kept honest by verified_by: praise_quality("Thank you all so much for all of your
-- help!") is 2 against a bar of 4, and it should be. It is on the board because a person
-- vouched for the account being in a good place, not because the sentence scored.
--
-- NOT IN THE MAILBOX: on 15 Sep Malay asked Matt for written feedback through a Google
-- Form. Form responses land in a spreadsheet, not in email, so if Matt filled it in, the
-- real testimonial exists and this system cannot see it. That sheet is worth wiring in.

insert into public.email_signals
  (company_name, client_email, signal_type, sentiment, summary, client_quote,
   source_subject, source_sender, source_date, thread_id, verified_by)
values
 ('Underdog Digital','brooke@underdogdigital.co','praise — recovered account','Positive',
  $q$Peace at Home closed well after a hard middle. Malay's team absorbed ~10 extra hours reconciling the migration and stabilising the site during the go-live wobble; Matt Vaadi then approved a $250 goodwill invoice for that effort, paid straight to Malay — a client choosing to pay more after a difficult project, which is a stronger signal than a compliment. Brooke Burris closed the wrap-up thread with thanks to the whole team. Worth reading against the record rather than instead of it: this same account escalated twice in the summer (29 Jun, and 9 Jul — "costing us tons of time every week… listen to the client the first time… tighten up the communication, produce better designs"). Both are true, and the order they happened in is the point.$q$,
  $q$Thank you all so much for all of your help!$q$,
  'Re: Peace at Home – Wrapping Things Up','Brooke Burris <brooke@underdogdigital.co>','2026-09-16','1a0a709385c0b539',
  'web@uplers.com')
on conflict (thread_id) do nothing;
