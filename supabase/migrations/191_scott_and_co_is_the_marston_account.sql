-- Scott & Co is the Marston account
--
-- An escalation sat on the Critical Escalations list under "Scott & Co", a client nobody
-- could find in the customer list, because there is no such account. Scott & Co is a
-- Marston Holdings brand, and in our books the Marston account is Project Centre Ltd.
--
-- Not a guess. Debbie Brodie's own escalation (6 Oct, "Ongoing/ Outstanding matters") is
-- one of several Marston threads; an earlier one on the same list, "Live QR codes", is
-- from the same scottandco.uk.com address and was already filed as Project Centre Ltd,
-- sender "Marston Holdings / Scott & Co". Of the scottandco.uk.com threads in the inbox,
-- most carry a marstonholdings.co.uk address on the same thread. And the money is already
-- there: "Scott and Co 5 content pages" (Aug 2026) and "S&C - Online Enquiry Form (Halo
-- Integration)" (Jul 2026) are both billed on Project Centre Ltd, alongside the Marston
-- maintenance, the Marston Social Value hub and the rest.
--
-- Three changes, because three different things were wrong:
--
-- 1. The escalation itself is re-filed. It was the only row under that name, so the list
--    now shows one Project Centre Ltd row of 8 escalations rather than 7 plus an orphan -
--    which matters, because the escalation count per client is what the Clients board
--    reads risk from. Keyed on client_key so spelling cannot miss it, and safe to re-run.
--
-- 2. scottandco.uk.com joins the account's domains. It was missing, which is why the mail
--    never matched a client in the first place; marstonholdings.co.uk was already there.
--    marstonrecovery.co.uk is left alone deliberately - it appears on one escalation but
--    on no booking, so there is no evidence yet that it is the same buyer rather than
--    another company in the group.
--
-- 3. The name fixes catch it next time. client_canonical_name feeds the revenue and
--    ledger views, so a line that arrives named "Scott & Co" now rolls up to Project
--    Centre Ltd instead of opening a second account for the same client. "Marston
--    Holdings" itself is mapped for the same reason: the group name is not the account
--    name, and a row filed under the parent would split the client in two.

with u as (
  update public.critical_escalations
     set company_name = 'Project Centre Ltd', updated_at = now()
   where client_key(company_name) = client_key('Scott & Co')
  returning thread_id
) select count(*) as escalations_refiled from u;

update public.client_directory
   set domains = (select array_agg(distinct d order by d)
                    from unnest(domains || array['scottandco.uk.com']) d),
       notes = coalesce(nullif(btrim(notes), '') || '; ', '')
               || 'scottandco.uk.com added 23 Nov 2026 — Scott & Co is a Marston Holdings brand; its work is billed on this account',
       updated_at = now()
 where name_key = 'projectcentreltd'
   and not ('scottandco.uk.com' = any (domains));

insert into public.client_name_fixes (from_key, to_name, note, added_by)
values ('scott & co',        'Project Centre Ltd', 'Scott & Co is a Marston Holdings brand; its work is billed on the Project Centre Ltd account (Scott and Co 5 content pages, S&C Online Enquiry Form). Added 23 Nov 2026.', 'rahul.k@mavlers.com'),
       ('scott and co',      'Project Centre Ltd', 'Spelling variant of scott & co.', 'rahul.k@mavlers.com'),
       ('scottandco',        'Project Centre Ltd', 'Spelling variant of scott & co.', 'rahul.k@mavlers.com'),
       ('scottandco.uk.com', 'Project Centre Ltd', 'Domain used as a company name in mail-sourced rows.', 'rahul.k@mavlers.com'),
       ('marston holdings',  'Project Centre Ltd', 'Parent group; the account in the client list is Project Centre Ltd and already carries the Marston lines.', 'rahul.k@mavlers.com')
on conflict (from_key) do nothing;
