-- migrations/checkin_cognitive_predictions.sql
-- Kognitiv belastning + aktiv återhämtning i check-ins
-- Konkreta if-then prediktioner

-- 1. Ny data på checkins
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS kognitiv_belastning int;   -- 2–10 (skalat från 1–5)
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS aktiv_aterhamtning  bool;  -- ja/nej

-- 2. Tabell för konkreta if-then prediktioner
CREATE TABLE IF NOT EXISTS concrete_predictions (
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            uuid REFERENCES auth.users NOT NULL,
  created_at         timestamptz DEFAULT now(),
  expires_at         date,
  trigger_field      text,        -- "sleep"
  trigger_operator   text,        -- "under"
  trigger_value      numeric,     -- 6.5
  predicted_field    text,        -- "energy"
  predicted_operator text,        -- "under"
  predicted_value    numeric,     -- 5
  confidence         int,         -- 0–100
  display_text       text,        -- "Om du sover under 6.5h förutspår systemet energi under 5 nästa dag."
  verified           bool DEFAULT false,
  actual_value       numeric,
  correct            bool
);

ALTER TABLE concrete_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "concrete_predictions_own" ON concrete_predictions
  FOR ALL USING (auth.uid() = user_id);
