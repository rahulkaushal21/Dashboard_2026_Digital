-- The app reports its own deletions
-- =================================
--
-- The invoice app added IsDeleted / DeletedDate / DeletedBy, and a GetBookings endpoint.
-- Rahul confirmed the date filters are NEW parameters alongside the old behaviour, not a
-- change to the existing ones, so nothing about the current pull inverts.
--
-- WHAT DELETION USED TO BE. An inference. mark_deleted_invoices() pulled the last 120
-- days and treated anything that did not come back as deleted. It could only judge
-- invoices CREATED inside that window — 2,691 of 14,509 — so 81% of the history was
-- simply unknowable, and absence cannot tell a deletion from a failed sync, hence the
-- 2%-or-25 safety cap that refuses to act on anything bigger.
--
-- WHAT IT SCORED, now that the app can be asked directly. Of 2,740 invoices in the
-- window:
--
--   app says deleted                     301
--   we had inferred                       17   (6%)
--   we MISSED                            284
--   we wrongly marked a live invoice       0
--
-- Zero false positives in 2,740. The inference was never wrong, it was nearly blind —
-- which is exactly what you would want of the two failure modes, and exactly why it was
-- built that way.
--
-- THE MONEY. web_invoice_net_lines filtered on deleted_at, the INFERRED column, so the
-- 284 missed deletions were still being counted: 34 of our invoices, $106,418 this FY.
-- Most of that sits in months already closed and served from the frozen snapshot, which
-- the app's own export had already corrected. The live overcount was OCTOBER:
--
--   before   64 rows   $125,089
--   after    59 rows   $ 96,739     — five deleted invoices, $28,350
--
-- BOTH TESTS ARE KEPT. is_deleted is authoritative and backfilled, but it comes back
-- NULL for invoices the pull did not return at all, and COALESCE(...,false) is what
-- makes that NULL read as "no answer" rather than "not deleted". The inferred deleted_at
-- still covers those, so mark_deleted_invoices() stays for now. It retires when the pull
-- window is widened enough that every invoice carries a reported answer.
--
-- DeletedBy arrives on 4 of 301. Documented behaviour — it is populated only after
-- go-live and is blank where the system auto-deleted the invoice — so nothing may
-- require it.
--
-- GetBookings: DISCOVERED, NOT GUESSED. The documentation describes the endpoint by
-- behaviour and never names it or its fields, so quote-sync gained ?probe=1: a read-only
-- path that returns FIELD NAMES ONLY, never values, and writes nothing. Same rule the
-- token follows — report the shape, never the content. GetBooking, GetBookingAPI and
-- GetBookingData are 404; the endpoint is GetBookings, and it returns
--
--   BookingId, BookingDate, BookingMonth, BookingAmount, Service, CompanyName,
--   ContactEmail, ProjectId, OrderNumber, OrderDate, InvoiceNumber, InvoiceDate,
--   InvoiceCreatedDate, InvoiceSentDate, Status, BUType, GEO, GEOHead, PC, SME,
--   SalesPersonName, EngagementModel, Comments, IsDeleted, DeletedDate, DeletedBy
--
-- 577 rows in a 20-day window. That is everything needed to retire
-- invoice_booking_snapshots — 3,528 rows captured ONCE on 9 Oct, stopping at September
-- — and the hand-typed invoice_booking_adjustments, which holds exactly one row. Note
-- there is no BookingAmountInUSD and no Currency: the amount's unit has to be confirmed
-- against September's known $188,882 before anything reads it.

alter table public.quote_api_invoices
  add column if not exists is_deleted   boolean,
  add column if not exists deleted_date date,
  add column if not exists deleted_by   text;

comment on column public.quote_api_invoices.deleted_at is
  'INFERRED from absence by mark_deleted_invoices(). Still needed for invoices older than the pull window, where is_deleted comes back NULL.';
comment on column public.quote_api_invoices.is_deleted is
  'REPORTED by GetInvoices (IsDeleted). Backfilled by the app, so unlike deleted_at it is not limited to the pull window.';
comment on column public.quote_api_invoices.deleted_by is
  'REPORTED by GetInvoices. Blank where the system auto-deleted the invoice, so never require it.';

-- web_invoice_net_lines gains `AND COALESCE(i.is_deleted, false) = false`; applied live,
-- see the repository for its text.
