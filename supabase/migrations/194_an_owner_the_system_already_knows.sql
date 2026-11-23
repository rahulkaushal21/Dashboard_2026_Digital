-- An owner the system already knows
--
-- EXPERT (R), 135 blanks. The user set the rule after seeing what the column actually
-- contains: WEB-UK -> Rahul Kumar, WEB-US -> Harshal Mehuriya, LP/HUB -> Pratik Bhatt,
-- WEB-AU -> KS. Only the AU one matches the historical majority (66% since July 2026);
-- UK is Rahul Kumar at 52%, US is Gagandeep Singh at 43% with Harshal at 10%, and LP/HUB
-- are Harshvardhan Sharma at ~89%. That was put to the user and the rule above is the
-- answer: these are who is ACCOUNTABLE for the department now, which no amount of history
-- can tell you. Recorded here so nobody re-derives the majority and "corrects" it back.
--
-- 112 sheet rows and 18 dashboard rows filled. The five tagged "WEB-US (KS)" take Harshal
-- Mehuriya, where rule and evidence agree: every filled row in that department already
-- says Harshal Mehuriya.
--
-- NOT filled: the four AI & Automation lines (all Telfer Digital). The rule covers four
-- departments and that is a fifth; its own rows say Deepak and Gaurav Pardeshi, which is
-- not enough to pick one.
--
-- ACCOUNT/SALES PERSON (AD), the 32 left after 193. They are not 32 clients - 26 of them
-- are ONE client, Inbox Army, which has no owner on any line anywhere, which is why the
-- modal fill in 193 could not touch them. The real list is seven accounts, and five are
-- answered by evidence we already hold:
--
--   G Squared -> Baspin Thomas          | client_directory, groupgpartners.com
--   3P Creative -> Sourya Ghosh         | client_directory, jeffreywaldman.com
--   Alpha Alpaka -> Divya S             | client_directory, alpha-alpaka.de
--   IPPA -> Hammad Riyaz Bhaldar        | client_directory, dci-kansascity.com
--   Beghou -> Dhruti Dave               | the mail: 45 messages since August, running the
--                                         HubSpot calls, and in am_directory
--
-- Still open, and for a human: Inbox Army (26 lines) and the Mavlers website line. Inbox
-- Army is intra-group - its "client" contacts are @uplers.in staff - so the mail names
-- Madhav Maheshwari and Pratik Bhatt rather than an account manager, and neither is in
-- am_directory. Guessing an owner for 26 lines of a sister brand is how a column stops
-- meaning anything.

update public.sheet_raw s
   set values = jsonb_set(s.values, '{17}', to_jsonb(
         case when btrim(s.values->>2) like 'WEB-US%'     then 'Harshal Mehuriya'
              when btrim(s.values->>2) = 'WEB-UK'         then 'Rahul Kumar'
              when btrim(s.values->>2) in ('LP','HUB')    then 'Pratik Bhatt'
              when btrim(s.values->>2) = 'WEB-AU'         then 'KS' end))
 where s.tab = 'revenue' and jsonb_array_length(s.values) = 40
   and btrim(coalesce(s.values->>17,'')) = ''
   and btrim(s.values->>2) in ('WEB-US','WEB-US (KS)','WEB-UK','LP','HUB','WEB-AU');

update public.opportunities o
   set expert = case when o.service_dept like 'WEB-US%'      then 'Harshal Mehuriya'
                     when o.service_dept = 'WEB-UK'          then 'Rahul Kumar'
                     when o.service_dept in ('LP','HUB')     then 'Pratik Bhatt'
                     when o.service_dept = 'WEB-AU'          then 'KS' end
 where o.won = true and o.confirmed_by is not null and o.rolled_into is null
   and coalesce(btrim(o.expert),'') = ''
   and o.service_dept in ('WEB-US','WEB-US (KS)','WEB-UK','LP','HUB','WEB-AU')
   and set_config('app.manual_edit','1',true) = '1';

update public.sheet_raw s
   set values = jsonb_set(s.values, '{29}', to_jsonb(f.who))
  from (values (20774,'Baspin Thomas'), (20712,'Sourya Ghosh'), (21663,'Divya S'),
               (21966,'Hammad Riyaz Bhaldar'), (23261,'Dhruti Dave')) as f(ri, who)
 where s.tab = 'revenue' and s.row_index = f.ri and btrim(coalesce(s.values->>29,'')) = '';
