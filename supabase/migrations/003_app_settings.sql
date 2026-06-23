-- Runtime config the admin edits in the Settings panel; the routine reads it.
create table if not exists app_settings (
  id int primary key default 1,
  business_sheet_url text,     -- the Business Sheet (link or ID) the routine reads
  scan_gmail_address text,     -- inbox/address the email scan targets (test vs live)
  updated_at timestamptz default now(),
  constraint single_row check (id = 1)
);
insert into app_settings (id, business_sheet_url, scan_gmail_address)
values (1,
  'https://docs.google.com/spreadsheets/d/1KbQsWVj0oNDlC4IRPPFfiYPqIW5u6fOeeOn7I3X5lUY',
  'web@uplers.com')
on conflict (id) do nothing;
alter table app_settings enable row level security;
create policy "public read" on app_settings for select using (true);
create policy "auth write"  on app_settings for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
