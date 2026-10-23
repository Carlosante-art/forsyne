-- ═══════════════════════════════════════════════════════════════
--  FORSYNE — Full Schema Migration
--  Run in Supabase SQL Editor (Settings → SQL Editor → New query)
-- ═══════════════════════════════════════════════════════════════

-- ── PROFILES ──
CREATE TABLE IF NOT EXISTS profiles (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data        jsonb DEFAULT '{}',
  analysis    text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- ── CHECKINS ──
CREATE TABLE IF NOT EXISTS checkins (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date            date NOT NULL,
  energy          numeric(4,1),
  focus           numeric(4,1),
  stress          numeric(4,1),
  sleep           numeric(4,1),
  motivation      numeric(4,1),
  mood            numeric(4,1),
  moods           jsonb DEFAULT '[]',
  reflection      text,
  personal_answer text,
  analysis        text,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

-- ── DAILY_DATA — cached analysis output per day ──
CREATE TABLE IF NOT EXISTS daily_data (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date        date NOT NULL,
  psi         numeric(6,1),
  normalize   jsonb DEFAULT '{}',
  prediction  jsonb DEFAULT '{}',
  insight     jsonb DEFAULT '{}',
  balance     jsonb,
  updated_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

-- ── INSIGHTS — standalone saved insights ──
CREATE TABLE IF NOT EXISTS insights (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date       date DEFAULT CURRENT_DATE,
  data       jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- ── PREDICTIONS ──
CREATE TABLE IF NOT EXISTS predictions (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date       date DEFAULT CURRENT_DATE,
  data       jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- ── PATTERNS ──
CREATE TABLE IF NOT EXISTS patterns (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data       jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- ── JOURNAL_CONTEXT ──
CREATE TABLE IF NOT EXISTS journal_context (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  context    text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- ── INTEGRATIONS ──
CREATE TABLE IF NOT EXISTS integrations (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  access_token  text,
  refresh_token text,
  token_expires timestamptz,
  data          jsonb DEFAULT '{}',
  last_synced   timestamptz,
  UNIQUE(user_id, provider)
);

-- ── CONVERSATIONS ──
CREATE TABLE IF NOT EXISTS conversations (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id   text NOT NULL,
  messages   jsonb DEFAULT '[]',
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, agent_id)
);

-- ── VISION_EVENTS — one row per image sent through /api/vision/analyze ──
CREATE TABLE IF NOT EXISTS vision_events (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date        date NOT NULL,
  type        text NOT NULL,
  extracted   jsonb DEFAULT '{}',
  summary_sv  text,
  confidence  numeric(3,2),
  flags       jsonb DEFAULT '[]',
  created_at  timestamptz DEFAULT now()
);

-- ── WAITLIST ──
CREATE TABLE IF NOT EXISTS waitlist (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
--  INDEXES — for common query patterns
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS checkins_user_date         ON checkins(user_id, date DESC);
CREATE INDEX IF NOT EXISTS daily_data_user_date       ON daily_data(user_id, date DESC);
CREATE INDEX IF NOT EXISTS insights_user_id           ON insights(user_id);
CREATE INDEX IF NOT EXISTS predictions_user_id        ON predictions(user_id);
CREATE INDEX IF NOT EXISTS integrations_token         ON integrations(access_token);
CREATE INDEX IF NOT EXISTS vision_events_user_date    ON vision_events(user_id, date DESC);
CREATE INDEX IF NOT EXISTS vision_events_user_type    ON vision_events(user_id, type, date DESC);

-- ═══════════════════════════════════════════════════════════════
--  RLS — Row Level Security (same as supabase_rls.sql, combined)
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins        ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_data      ENABLE ROW LEVEL SECURITY;
ALTER TABLE insights        ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE patterns        ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE vision_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist        ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first (idempotent)
DO $$ DECLARE t text;
BEGIN FOR t IN SELECT unnest(ARRAY['profiles','checkins','daily_data','insights','predictions','patterns','journal_context','integrations','conversations','vision_events']) LOOP
  EXECUTE format('DROP POLICY IF EXISTS "Users can only access own data" ON %I', t);
  EXECUTE format('CREATE POLICY "Users can only access own data" ON %I FOR ALL USING (auth.uid() = user_id)', t);
END LOOP; END $$;

DROP POLICY IF EXISTS "Public insert only" ON waitlist;
CREATE POLICY "Public insert only" ON waitlist FOR INSERT WITH CHECK (true);
