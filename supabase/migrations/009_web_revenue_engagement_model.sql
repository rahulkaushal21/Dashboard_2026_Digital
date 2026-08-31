-- ============================================================================
-- web_revenue: carry the sheet's "Project Type" (engagement model) through.
--
-- Why: the Clients page needs each client's billing split by engagement model
-- (Dedicated / Partial Dedicated / Ad-hoc / New Development / Maintenance...).
-- That value only lived on `bookings`, but every page reads `web_revenue`, and
-- the two disagree because web_revenue excludes not-yet-realised revenue and
-- recovers blank agency/month rows. Charting from one and splitting from the
-- other would put two numbers that don't reconcile on the same panel.
--
-- sync-web-revenue also adds engagement_model to its grouping key. It has to:
-- 14.8% of company|month|service groups mix more than one Project Type, so
-- without it ~1 in 7 rows would be stamped with an arbitrary model. Totals are
-- unaffected — the same money, split across more lines — exactly as when
-- `technology` was added to the key for the same reason.
-- ============================================================================

alter table public.web_revenue add column if not exists engagement_model text;

comment on column public.web_revenue.engagement_model is
  'Sheet column "Project Type": Dedicated | Partial Dedicated | Ad-hoc | New Development | Maintanance | Additional Pages | Change Request. Part of the sync grouping key.';

create index if not exists web_revenue_engagement_model_idx
  on public.web_revenue (company_name, booking_month, engagement_model);
