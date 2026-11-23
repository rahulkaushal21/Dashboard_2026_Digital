-- A column with a rule should not have holes
--
-- Business Type and Account/Sales Person are not optional and not judgement calls in the
-- way Month-Year is: whether a client has bought before is a fact in our own ledger, and
-- who owns the account is a fact in our own mail. So they are derived, not left blank.
--
-- BUSINESS TYPE (AC). The rule tested before it was used: of the 2,854 lines that are NOT
-- a client's first in this data, 96.1% say Repeat. The reverse does NOT hold - of 433
-- first lines, 325 say Repeat, because most clients predate the sheet and their first row
-- here is not their first deal. So "has earlier lines -> Repeat" is sound and "no earlier
-- lines -> New" is only sound for a RECENT row, where the absence means something.
--
--   - 11 dashboard rows blank, every one of them a client with prior bookings (2 to 160
--     earlier lines: Telfer Digital, C7EVEN, Precision Creative...). All Repeat.
--   - 11 sheet rows reading lowercase "repeat" and one reading "$600" (Positive Brand,
--     11 earlier lines). Normalised; the $600 was a price typed into the wrong column.
--   - 2 sheet blanks on clients with 16 and 32 earlier lines -> Repeat. One sheet blank,
--     3P Creative Group, is that client's only line in two years -> New.
--   - 4 dashboard rows carrying "Direct" or "Agency" - the CLIENT TYPE vocabulary leaking
--     one column over. Client Type was already correct on all four, so nothing was lost:
--     three are long-standing clients (Repeat) and Spacetalk, whose first line this is and
--     recent enough for that to mean something, is New.
--
-- ACCOUNT/SALES PERSON (AD). 68 sheet rows blank. 36 of them belong to a client whose
-- other lines name an owner, so they take that owner - the modal one, not the latest,
-- because an account changing hands once should not rewrite its history. The remaining 32
-- are clients with no other line at all; there is nothing in the sheet to derive from and
-- they are left for a human or for the mail.
--
-- EXPERT (R) is NOT filled by rule here, deliberately - see 194's note in the writer. The
-- user's convention (AU under KS, UK under KS, LP/HUB under Pratik, US under Hiren) holds
-- for ONE of the four against the data: since July 2026, WEB-AU is 66% KS. WEB-UK is
-- Rahul Kumar (52%) with a third Contractor, LP and HUB are Harshvardhan Sharma (~89%),
-- WEB-US is Gagandeep Singh (43%), and neither Pratik nor Hiren appears in that column at
-- all. Only the two WEB-AU blanks were filled.

-- Business Type, sheet rows: normalise the case, fix the price in the wrong column, and
-- fill the three blanks that the client's own history decides.
update public.sheet_raw s
   set values = jsonb_set(s.values, '{28}',
                  to_jsonb(case when s.row_index = 20712 then 'New' else 'Repeat' end))
 where s.tab = 'revenue' and jsonb_array_length(s.values) = 40
   and ( btrim(coalesce(s.values->>28,'')) = 'repeat'
      or s.row_index in (22723, 22362, 22701, 20712) );

-- Account/Sales Person: the owner this client's other lines already name.
with r as (
  select id, client_key(btrim(values->>19)) ck, btrim(coalesce(values->>29,'')) am
    from public.sheet_raw where tab = 'revenue' and jsonb_array_length(values) = 40
), modal as (
  select ck, am, row_number() over (partition by ck order by count(*) desc, am) rn
    from r where am <> '' and ck <> '' group by ck, am
)
update public.sheet_raw s
   set values = jsonb_set(s.values, '{29}', to_jsonb(m.am))
  from r, modal m
 where s.id = r.id and m.ck = r.ck and m.rn = 1 and r.am = '' and r.ck <> '';
