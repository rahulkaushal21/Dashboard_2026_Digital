-- 097 — the Web scope is four services, not two
--
-- 093 defined our scope as Development - Web + Development - LP/Hub, inferred from the
-- service names alone. Confirmed by Rahul on 28 Sep 2026: 'AI & Automation - WEB' and
-- 'Design - Digital' are also Web services and are inside the figures the business
-- reports. Adding them moved April from $1,544 below the reported number to $696 above it.
--
-- DELIBERATELY NOT INCLUDED, because adding any of them overshoots every reported month:
--   Design - Web ($39,863 Apr-Aug)   Design - Asset ($16,746)   Design - LP ($3,700)
--   Design - Banner ($1,684)         Design - Email ($119,857)
--   Dot-Net Development ($21,156)    Development - Mobile App ($19,305)
--
-- 'Design - Web' is the one to watch: it sounds in scope, it is the largest of the
-- excluded services, and including it would break the reconciliation. Left out on the
-- evidence, not on confidence — worth confirming with the business either way.
create or replace function quote_api_is_ours(service text) returns boolean
language sql immutable set search_path = public as $$
  select service in (
    'Development - Web',
    'Development - LP/Hub',
    'AI & Automation - WEB',
    'Design - Digital'
  );
$$;
