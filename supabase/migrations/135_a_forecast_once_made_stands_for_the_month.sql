-- 135 — a forecast, once made, stands for the month
--
-- Rahul, 6 Oct 2026: "you keep on changing monthly forecast everytime, last month I saw
-- forecast somewhere around 174, but now I can see you predicted $204,859 … Once you
-- forecasted you shouldnt change it for the entire month."
--
-- The forecast was computed on every page load from whatever the revenue lines held at
-- that moment, and the header of lib/forecast.ts argued that this was a virtue. It is
-- not, for the person reading it: a number that moves every day cannot be held to, and
-- cannot be judged afterwards either. So each unit's forecast is written down once per
-- calendar month — the first time the page computes it in that month — and that is the
-- forecast for the month. The page still shows what the model would say today, labelled
-- as such, beside the one that stands.
--
-- One row per (unit, month the forecast was made in). The payload is the model's own
-- output — every month's value and band, the model used, its backtest error — so the
-- page can render the frozen forecast exactly as it rendered the live one, and so a
-- later reader can see what was known. First writer wins: the RPC inserts only when
-- nothing is there yet and returns whatever is there afterwards.

create table if not exists public.forecast_snapshots (
  id         bigserial primary key,
  unit       text not null check (unit in ('all', 'lp-hub', 'web')),
  as_of      date not null,                       -- first of the month the forecast was made in
  made_at    timestamptz not null default now(),
  made_by    text,
  payload    jsonb not null,
  unique (unit, as_of)
);

alter table public.forecast_snapshots enable row level security;
create policy forecast_snapshots_read on public.forecast_snapshots
  for select to anon, authenticated using (true);
grant select on public.forecast_snapshots to anon, authenticated;

create or replace function public.save_forecast_snapshot(p_unit text, p_as_of date, p_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_actor text := public.jwt_email(); v_out jsonb;
begin
  if v_actor is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  insert into public.forecast_snapshots (unit, as_of, made_by, payload)
  values (p_unit, date_trunc('month', p_as_of)::date, v_actor, p_payload)
  on conflict (unit, as_of) do nothing;
  select jsonb_build_object('made_at', made_at, 'made_by', made_by, 'payload', payload) into v_out
  from public.forecast_snapshots where unit = p_unit and as_of = date_trunc('month', p_as_of)::date;
  return v_out;
end $function$;

revoke execute on function public.save_forecast_snapshot(text, date, jsonb) from public, anon;
grant execute on function public.save_forecast_snapshot(text, date, jsonb) to authenticated;
