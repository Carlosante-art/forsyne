-- ═══════════════════════════════════════════════════════════════
--  FORSYNE — Coach B2B Migration
--  Kör i Supabase SQL Editor (Settings → SQL Editor → New query)
--  Kör en sektion i taget.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. COACHES ──
-- En coach är en Supabase-användare med coach-roll.
-- name, organization: testlabb-namn, bio etc.
CREATE TABLE IF NOT EXISTS coaches (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  organization  text,
  created_at    timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- ── 2. COACH_CLIENTS ──
-- Kopplar en coach till en klient (en Forsyne-användare).
-- invite_token: UUID som skickas i inbjudningslänken.
-- status: pending → active → revoked
CREATE TABLE IF NOT EXISTS coach_clients (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  coach_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invite_token  uuid DEFAULT gen_random_uuid() NOT NULL,
  invite_email  text,
  status        text NOT NULL DEFAULT 'pending',  -- pending | active | revoked
  client_name   text,
  created_at    timestamptz DEFAULT now(),
  accepted_at   timestamptz,
  UNIQUE(coach_id, client_id),
  UNIQUE(invite_token)
);

-- ── 3. LAB_TESTS ──
-- Vetenskapliga testresultat kopplade till en klient.
-- Inmatade av coach/testlabb.
-- test_type: 'vo2max' | 'lactate' | 'hormone' | 'biochemistry' | 'body_comp' | 'strength' | 'other'
CREATE TABLE IF NOT EXISTS lab_tests (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coach_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  test_date     date NOT NULL,
  test_type     text NOT NULL,
  label         text NOT NULL,       -- t.ex. "VO2 max", "Testosteron total", "Laktattröskel"
  value         numeric(10,3),
  unit          text,                -- ml/kg/min, nmol/L, mmol/L, etc.
  reference_low numeric(10,3),       -- referensintervall nedre
  reference_high numeric(10,3),      -- referensintervall övre
  notes         text,
  context_analysis text,             -- AI-genererad kontextualisering mot daglig data
  context_generated_at timestamptz,
  created_at    timestamptz DEFAULT now()
);

-- ── 4. INDEXES ──
CREATE INDEX IF NOT EXISTS coach_clients_coach_id  ON coach_clients(coach_id);
CREATE INDEX IF NOT EXISTS coach_clients_client_id ON coach_clients(client_id);
CREATE INDEX IF NOT EXISTS coach_clients_token     ON coach_clients(invite_token);
CREATE INDEX IF NOT EXISTS lab_tests_client_id     ON lab_tests(client_id, test_date DESC);
CREATE INDEX IF NOT EXISTS lab_tests_coach_id      ON lab_tests(coach_id);

-- ── 5. RLS ──
ALTER TABLE coaches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_tests     ENABLE ROW LEVEL SECURITY;

-- coaches: bara egna rader
DROP POLICY IF EXISTS "Coach own row" ON coaches;
CREATE POLICY "Coach own row" ON coaches FOR ALL USING (auth.uid() = user_id);

-- coach_clients: coach ser sina klienter, klient ser sin egen rad
DROP POLICY IF EXISTS "Coach sees own clients" ON coach_clients;
CREATE POLICY "Coach sees own clients" ON coach_clients
  FOR ALL USING (auth.uid() = coach_id OR auth.uid() = client_id);

-- lab_tests: coach som skapade, eller klienten det gäller
DROP POLICY IF EXISTS "Lab tests access" ON lab_tests;
CREATE POLICY "Lab tests access" ON lab_tests
  FOR ALL USING (auth.uid() = coach_id OR auth.uid() = client_id);

-- ── KLAR ──
-- Nästa: kör coach API-routes i server.js
