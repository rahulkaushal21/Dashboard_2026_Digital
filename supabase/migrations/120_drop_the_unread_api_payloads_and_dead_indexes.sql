-- 120 — drop the unread API payloads and the dead indexes
--
-- The project crossed the free plan's 0.5 GB database cap on 1 Oct 2026 (0.54 GB).
-- Rahul's call: options 1 and 2 of the space review. Option 3 (old email bodies) was
-- done by hand the same evening and took the database from 502 MB to 428 MB.
--
-- OPTION 2. Every quote_api_* row kept a jsonb copy of the raw API record beside the
-- columns parsed from it: 60 MB in all, and nothing reads it. Every field the dashboard
-- uses has its own column, and the 120-day rolling re-pull means the raw record is never
-- further away than the next sync. Dropped on quotes (payload AND quote_payload),
-- invoices and invoice_lines. KEPT on quote_api_opportunities: web_open_opportunity_evidence
-- reads a field out of it, and at 6.5 MB it is not where the space is.
--
-- quote-sync stops writing the four dropped columns in the same commit.
--
-- OPTION 1. Four indexes that have never, or once, been used since the stats began:
--   email_inbox_thread_idx       exact duplicate of idx_email_inbox_thread (191 scans)
--   email_inbox_mailbox_idx      0 scans; mailbox is one value since 4 Aug
--   quote_api_quotes_deal_key    0 scans
--   quote_api_quotes_rfq_no      0 scans
-- Definitions recorded here so any of them can be put back with one statement.
-- idx_email_inbox_hist_queue also shows 0 scans but is 16 kB and part of the processing
-- design (the historical queue), so it stays.
--
-- The email_inbox rewrite that option 1 also called for was done by hand on 1 Oct
-- (VACUUM FULL, with option 3). The three quote_api tables are rewritten after this
-- migration, by hand, because VACUUM cannot run inside a transaction.

alter table public.quote_api_quotes        drop column if exists payload;
alter table public.quote_api_quotes        drop column if exists quote_payload;
alter table public.quote_api_invoices      drop column if exists payload;
alter table public.quote_api_invoice_lines drop column if exists payload;

-- CREATE INDEX email_inbox_thread_idx ON public.email_inbox USING btree (thread_id)
drop index if exists public.email_inbox_thread_idx;
-- CREATE INDEX email_inbox_mailbox_idx ON public.email_inbox USING btree (mailbox)
drop index if exists public.email_inbox_mailbox_idx;
-- CREATE INDEX quote_api_quotes_deal_key ON public.quote_api_quotes USING btree (deal_key)
drop index if exists public.quote_api_quotes_deal_key;
-- CREATE INDEX quote_api_quotes_rfq_no ON public.quote_api_quotes USING btree (rfq_no)
drop index if exists public.quote_api_quotes_rfq_no;
