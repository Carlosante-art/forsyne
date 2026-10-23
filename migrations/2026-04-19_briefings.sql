-- Agent 11 — morgonbriefing
-- Lagrar dagens syntetiserade narrativ per användare.

create table if not exists briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  narrative text not null,
  varsel_status text,
  input_used jsonb,
  tokens_input int,
  tokens_output int,
  tokens_cache_read int,
  tokens_cache_write int,
  model text default 'claude-sonnet-4-6',
  created_at timestamptz default now()
);

create index if not exists briefings_user_date_idx
  on briefings(user_id, date desc);

-- RLS: användaren får läsa sina egna briefings. Skrivning sker via service role.
alter table briefings enable row level security;

drop policy if exists briefings_select_own on briefings;
create policy briefings_select_own on briefings
  for select using (auth.uid() = user_id);
