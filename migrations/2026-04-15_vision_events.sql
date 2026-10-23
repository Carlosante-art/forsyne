-- ═══════════════════════════════════════════════════════════════
-- VISION EVENTS — one row per image sent through /api/vision/analyze
-- Used by the Historik screen in the PWA (app/index.html)
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

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

CREATE INDEX IF NOT EXISTS vision_events_user_date
  ON vision_events(user_id, date DESC);

CREATE INDEX IF NOT EXISTS vision_events_user_type_date
  ON vision_events(user_id, type, date DESC);

ALTER TABLE vision_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access own data" ON vision_events;
CREATE POLICY "Users can only access own data" ON vision_events
  FOR ALL USING (auth.uid() = user_id);
