-- Marston Recovery is a different company
--
-- 191 folded Scott & Co into Project Centre Ltd and left marstonrecovery.co.uk out, on
-- the grounds that it appeared on one escalation and no booking. The user confirmed it on
-- 23 Nov 2026: it is a different company in the Marston group, not this account.
--
-- So it stays out of the domain list, and this is the note that stops it being folded in
-- the next time somebody notices the two names look alike. There is nothing else to
-- remove: no client row, no directory entry and no revenue line anywhere mentions it.
--
-- The one escalation from that domain STAYS on Project Centre Ltd, which is not a
-- contradiction. "URGENT Help needed" (13 Jul, still open) is Mark Eddowes reporting that
-- the Marston site broke after a Friday change — the site we maintain and bill on this
-- account. The sender's employer and the account the work belongs to are two different
-- questions, and in a group of companies sharing one website they routinely give
-- different answers. File by the site the work is on, not by the domain in the From line.

update public.client_directory
   set notes = notes || '; marstonrecovery.co.uk is NOT a domain of this account — confirmed a different company in the group, 23 Nov 2026. Mail from it may still concern the Marston site we maintain here (e.g. the 13 Jul "URGENT Help needed"), so judge those by the site the work is on, not the sender domain.',
       updated_at = now()
 where name_key = 'projectcentreltd'
   and notes not like '%marstonrecovery.co.uk is NOT%';
