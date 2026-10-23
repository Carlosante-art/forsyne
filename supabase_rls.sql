-- ═══════════════════════════════════════════════════════════════
--  FORSYNE — Row Level Security (RLS) Migration
--  Run this in Supabase SQL Editor (Settings → SQL Editor)
-- ═══════════════════════════════════════════════════════════════

-- ── PROFILES ──
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access own data" ON profiles;
CREATE POLICY "Users can only access own data"
  ON profiles FOR ALL
  USING (auth.uid() = user_id);

-- ── CHECKINS ──
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access own data" ON checkins;
CREATE POLICY "Users can only access own data"
  ON checkins FOR ALL
  USING (auth.uid() = user_id);

-- ── DAILY_DATA ──
ALTER TABLE daily_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access own data" ON daily_data;
CREATE POLICY "Users can only access own data"
  ON daily_data FOR ALL
  USING (auth.uid() = user_id);

-- ── INSIGHTS ──
ALTER TABLE insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access own data" ON insights;
CREATE POLICY "Users can only access own data"
  ON insights FOR ALL
  USING (auth.uid() = user_id);

-- ── PREDICTIONS ──
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access own data" ON predictions;
CREATE POLICY "Users can only access own data"
  ON predictions FOR ALL
  USING (auth.uid() = user_id);

-- ── PATTERNS ──
ALTER TABLE patterns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access own data" ON patterns;
CREATE POLICY "Users can only access own data"
  ON patterns FOR ALL
  USING (auth.uid() = user_id);

-- ── JOURNAL_CONTEXT ──
ALTER TABLE journal_context ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access own data" ON journal_context;
CREATE POLICY "Users can only access own data"
  ON journal_context FOR ALL
  USING (auth.uid() = user_id);

-- ── INTEGRATIONS ──
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access own data" ON integrations;
CREATE POLICY "Users can only access own data"
  ON integrations FOR ALL
  USING (auth.uid() = user_id);

-- ── CONVERSATIONS ──
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access own data" ON conversations;
CREATE POLICY "Users can only access own data"
  ON conversations FOR ALL
  USING (auth.uid() = user_id);

-- ── WAITLIST — public insert, no read without auth ──
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public insert only" ON waitlist;
CREATE POLICY "Public insert only"
  ON waitlist FOR INSERT
  WITH CHECK (true);

-- ── VERIFY — test that anon cannot read profiles ──
-- Run this with an anon key to confirm RLS works:
-- SELECT * FROM profiles LIMIT 1;
-- Expected result: 0 rows (not an error, just empty — RLS silently filters)

-- ── SERVICE ROLE bypasses RLS (server-side Supabase client) ──
-- This is expected and correct: our server uses SUPABASE_SERVICE_KEY
-- which bypasses RLS. All user_id filtering is done server-side in code.
-- The user_id = req.user.id check in every endpoint IS the access control.
