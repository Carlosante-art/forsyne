create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  email text not null,
  name text not null,
  age int,
  wearable text,
  sessions_per_week text,
  main_sport text,
  about text,
  source text,
  ip_address text,
  user_agent text
);

create index if not exists waitlist_email_idx on waitlist(email);
create index if not exists waitlist_created_idx on waitlist(created_at desc);

alter table waitlist enable row level security;
