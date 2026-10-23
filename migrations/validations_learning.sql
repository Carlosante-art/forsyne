-- Valideringsslingan — lärdomar sparas tillbaka i databasen
-- Kör i Supabase SQL Editor

ALTER TABLE validations ADD COLUMN IF NOT EXISTS stammer        bool;
ALTER TABLE validations ADD COLUMN IF NOT EXISTS larda_notering text;
ALTER TABLE validations ADD COLUMN IF NOT EXISTS vad_missades   text;
