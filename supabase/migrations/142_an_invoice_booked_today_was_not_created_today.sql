-- An invoice booked today was not created today
-- =============================================
--
-- Our invoice mirror was calling real, raised invoices "Draft". On 9 Oct 2026, of the 47
-- invoices with an October booking date, 7 read Draft — and all 7 were stale, last synced
-- 28 September or earlier. Not one fresh invoice read Draft. Forcing a wide re-pull
-- showed what they actually were:
--
--   Klick               INV111225193615_10   Draft -> Sent
--   Tanium              INV110526162138_6    Draft -> Sent
--   KAR Global          INV230526024511_5    Draft -> Paid
--   Searchmarketingpros INV060626001413_5    Draft -> Paid
--   Pure Flix           INV010526200015_6    Draft -> Overdue
--   MannKind            INV060326193127_8    Draft -> Overdue
--
-- CAUSE. quote-sync pulls a rolling WINDOW_DAYS=120 window, and the quote API's
-- FROMDATE/TODATE filter on the invoice's CREATION date — it has no "modified since".
-- Those six were created between Dec 2025 and Jun 2026, raised and booked in October.
-- Being created outside the window, they were never re-fetched, so each stayed frozen at
-- the status it carried on the day it was created, which for a scheduled invoice is
-- Draft. The longer a retainer runs, the more certain it is to be wrong — so the error
-- fell hardest on exactly the recurring invoices that matter most to a booking figure.
--
-- Rahul caught it: "not even a single invoice which I pasted above is draft... invoice
-- number is only available if invoice is sent, there is no draft now check it once your
-- logic is not correct."
--
-- FIX. Keep the 15-minute 120-day sync for responsiveness, and add a nightly 400-day
-- pull so anything created within about thirteen months is refreshed whatever its age.
-- The wide pull moves ~36,800 rows and takes about two minutes, which is far too heavy
-- for every quarter hour but nothing at 02:40. A full 18-month range was tried and the
-- API returned HTTP 524, so 400 days is also near the practical ceiling.
--
-- Applied directly as well, so the schedule exists in the database already.
select cron.schedule('quote-api-sync-wide', '40 2 * * *', $$
  select net.http_get(
      url := 'https://hsmuxmvhgteexanssigc.supabase.co/functions/v1/quote-sync?token=ingestQuoteApi_5d1b83&days=400',
      timeout_milliseconds := 240000
  );
$$);

-- What this corrected, once the stale rows were refreshed: October bookings on the
-- existing web_invoice_bookings view went from $48,559 to $73,947 gross, $69,237 net of
-- the five invoices voided during October. Against Rahul's export of $69,879.39 that
-- leaves $642.26, all of it structural and none of it status:
--   +$660.42  Vericast, a recurring invoice the export splits across months while the
--             API books the whole $8,568 in March
--   +$233.34  Layer 8 Training, the same pattern against an August invoice
--   -$79.73   Searchmarketingpros, where the two systems hold different amounts
--   -$171.77  a Brandtech credit note the export books in October and our mirror still
--             carries as Overdue against September
