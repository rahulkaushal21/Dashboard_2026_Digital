-- 111 — retire the hand-entered amendments
--
-- Migration 108 recorded four amendments by hand so September would tie to the invoice
-- app's report to the cent. Rahul, on seeing the derived figure: "180,691.29 this number
-- is also ok, as this is much closer and 1180 diffetnet is just because of change in api"
-- — so the table goes.
--
-- It was always the weakest part of this: a table somebody has to keep honest every month,
-- whose whole purpose was to close a 0.65% gap the API cannot report. 108 said the risk out
-- loud — "a table like this is how a number quietly becomes fiction" — and the way to
-- retire that risk is to retire the table, not to guard it more carefully.
--
-- September goes back to $180,691.29, entirely derived. The ~$1,180 difference from the
-- app's $179,511.13 is four invoices amended after being raised, and the mapping tab's own
-- bridge shows it line by line. The proper fix is the booking-events endpoint, expected in
-- a week.
--
-- The view keeps its third union branch, now reading an empty table. Rebuilding that union
-- when the new endpoint lands is a smaller change than re-deriving it from scratch, and it
-- costs a scan of nothing.
--
-- Apr $186,984.05 · May $198,185.60 · Jun $221,929.79 · Jul $215,941.42 · Aug $208,810.59
-- · Sep $180,691.29 — all derived, no adjustments anywhere.

delete from invoice_booking_adjustments;

comment on table invoice_booking_adjustments is
  'EMPTY AND MEANT TO STAY EMPTY (1 Oct 2026). Held four hand-entered amendments so September tied exactly to the invoice app; retired once the derived figure was accepted. Do not refill it — if invoice amendments need to reach the dashboard, they come from the app''s booking-events endpoint. Kept only so web_invoice_bookings does not need restructuring when that lands.';
