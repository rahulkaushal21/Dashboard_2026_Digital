-- andrew@frogonline.net.a is not an address
--
-- The sheet lost the 'u' off .au and the typo spread. It is provably a typo rather than a
-- real address: the same account carries webit@frogonline.net.au and
-- janine@frogonline.net.au spelled correctly.
--
-- Mail to it bounces, and every domain match against captured mail misses Andrew — the
-- same class of silent miss as matching a domain without a wildcard on both sides.
--
-- Only three base tables are written. web_client_defaults, web_revenue_lines and
-- web_project_ledger are all VIEWS over these, so they correct themselves — and
-- web_client_defaults is the one that mattered most, since it seeds the contact on a new
-- deal and would otherwise have kept minting fresh rows with the typo.
--
-- WHAT THIS CANNOT REACH. Eight older ledger lines (Sep 2025 – Sep 2026) are sheet rows,
-- and their email comes through web_sheet_rows_mv from sheet_raw, which is a mirror of
-- the Google Sheet resynced from it. Writing the fix here would be undone by the next
-- sync, and sheet_row_overrides has no contact column to hold it. Those eight are a
-- one-cell fix in the spreadsheet; nothing in the database can do it for them.

with u as (
  update public.opportunities set contact_email = 'andrew@frogonline.net.au'
   where contact_email = 'andrew@frogonline.net.a' returning 1)
select count(*) as opportunities_fixed from u;

with u as (
  update public.bookings set contact_email = 'andrew@frogonline.net.au'
   where contact_email = 'andrew@frogonline.net.a' returning 1)
select count(*) as bookings_fixed from u;

with u as (
  update public.web_revenue set contact_email = 'andrew@frogonline.net.au'
   where contact_email = 'andrew@frogonline.net.a' returning 1)
select count(*) as web_revenue_fixed from u;
