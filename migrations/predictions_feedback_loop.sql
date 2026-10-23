-- Signal Feedback Loop — predictions table schema
-- Run this in Supabase SQL editor

CREATE TABLE IF NOT EXISTS predictions (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at         timestamptz DEFAULT now(),
  predicted_date     date,
  sannolikhet_krasch integer     DEFAULT 0,
  varsel_status      text,
  varsel_dag         integer     DEFAULT 0,
  dagar_till_krasch  integer     DEFAULT 3,
  kritisk_atgard     text,
  agent_output       jsonb,
  outcome            text        CHECK (outcome IN ('traffade','avvärjt','missade','oklar')),
  outcome_checked_at timestamptz,
  outcome_energy     numeric,
  outcome_stress     numeric
);

-- If table already existed with no columns, add them:
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS predicted_date     date;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS sannolikhet_krasch integer     DEFAULT 0;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS varsel_status      text;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS varsel_dag         integer     DEFAULT 0;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS dagar_till_krasch  integer     DEFAULT 3;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS kritisk_atgard     text;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS agent_output       jsonb;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS outcome            text;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS outcome_checked_at timestamptz;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS outcome_energy     numeric;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS outcome_stress     numeric;

-- Add CHECK constraint if missing (may error if exists — ignore)
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_outcome_check;
ALTER TABLE predictions ADD CONSTRAINT predictions_outcome_check
  CHECK (outcome IN ('traffade','avvärjt','missade','oklar'));

-- Row-level security
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "predictions_user" ON predictions;
CREATE POLICY "predictions_user" ON predictions
  FOR ALL USING (user_id = auth.uid());
