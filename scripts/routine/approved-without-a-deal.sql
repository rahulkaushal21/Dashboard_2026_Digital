-- Step 3b of the refresh: client approved a quote, and no opportunity carries that thread.
--
-- Why this exists. On 26 Oct 2026 two approved quotes were found to have no row:
--   Agero "Font Color Issue Appearing Across HubSpot Landing Pages"   USD 410, approved 23 Oct
--   ZULU 8 "C21 stores"                                              AUD 10,445, approved 26 Oct
-- Both threads kept a support-looking subject, so the snippet triage skipped them, and the
-- `web_unlogged_deal_signals` detector called Agero "answered" because the client already had
-- a USD 399 deal within 15% of the quote. Matching on the THREAD removes that blind spot.
--
-- Read-only. Run it every refresh. Every row is a thread to read, not a row to create:
-- check the object of the approval sentence before writing anything.
--
-- Widen the window with the two interval literals if a run was skipped for several days.

with ext as (
  select thread_id,
         max(inserted_at) last_ext,
         max(left(regexp_replace(email_new_text(body), '\s+', ' ', 'g'), 160))
           filter (where email_new_text(body) ~* '(approved|go ahead|go-ahead|please proceed|proceed with|happy to proceed|move forward|please start|looks good to go|confirmed to proceed|green light)') ev
  from email_inbox
  where inserted_at > now() - interval '14 days' and not archived
    and from_addr !~* '(mavlers\.com|uplers)'
    and from_addr !~* '(noreply|no-reply|notifications|donotreply)'
    and email_new_text(body) ~* '(approved|go ahead|go-ahead|please proceed|proceed with|happy to proceed|move forward|please start|looks good to go|confirmed to proceed|green light)'
  group by thread_id
),
ours as (
  -- Our side named a price or an effort. Without this, every "thanks, go ahead and book the call"
  -- would be a hit.
  select thread_id
  from email_inbox
  where inserted_at > now() - interval '16 days'
    and from_addr ~* '(mavlers\.com|uplers)'
    and email_new_text(body) ~* '(\$ ?[0-9]{2,}|usd ?[0-9]|aud ?[0-9]|gbp ?[0-9]|cad ?[0-9]|nzd ?[0-9]|[0-9]+ hours?|estimate|quote|cost)'
  group by thread_id
)
select e.thread_id,
       to_char(e.last_ext, 'MM-DD') as approved_on,
       (select subject from email_inbox s where s.thread_id = e.thread_id order by inserted_at limit 1) as subject,
       e.ev as client_words
from ext e
join ours o using (thread_id)
where not exists (select 1 from opportunities p
                  where p.thread_id = e.thread_id or p.thread_id like e.thread_id || ':%')
  and not exists (select 1 from deal_signal_dismissals d where d.thread_id = e.thread_id)
order by e.last_ext desc
limit 40;
