-- Insights — lägger till mönster_referens och psi_förklaring
-- Kör i Supabase SQL editor

ALTER TABLE insights ADD COLUMN IF NOT EXISTS mönster_referens text;
ALTER TABLE insights ADD COLUMN IF NOT EXISTS psi_förklaring   text;
