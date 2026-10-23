-- Labbtester — generisk tabell för VO2 max, laktattrösklar, kroppssammansättning
-- Leverantör är fritext så användaren kan ladda in från vilket labb som helst.
-- Server skriver via service role; användaren läser eget via RLS.

create table if not exists lab_tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  provider text,

  -- Kardiorespiratorisk kapacitet
  vo2max numeric,

  -- Laktattrösklar — atleten fyller bara i det hen har
  lt1_watts numeric,
  lt1_bpm   int,
  lt1_pace  text,
  lt2_watts numeric,
  lt2_bpm   int,
  lt2_pace  text,

  -- Kroppssammansättning
  body_fat_pct         numeric,
  muscle_mass_kg       numeric,
  bone_density_t_score numeric,

  -- Grundvärden
  weight_kg numeric,
  height_cm numeric,

  -- Fritext
  notes text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists lab_tests_user_date_idx
  on lab_tests(user_id, date desc);

alter table lab_tests enable row level security;

drop policy if exists lab_tests_select_own on lab_tests;
create policy lab_tests_select_own on lab_tests
  for select using (auth.uid() = user_id);
