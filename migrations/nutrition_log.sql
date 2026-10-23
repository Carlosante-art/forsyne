-- Måltidslogg
CREATE TABLE IF NOT EXISTS nutrition_log (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         date NOT NULL,
  meal_type    text NOT NULL CHECK (meal_type IN ('lunch','middag')),
  food_name    text NOT NULL,
  brand        text,
  barcode      text,
  serving_g    numeric,
  kcal         numeric,
  protein_g    numeric,
  carbs_g      numeric,
  fat_g        numeric,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE nutrition_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nutrition_log_own" ON nutrition_log FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS nutrition_log_user_date ON nutrition_log (user_id, date DESC);
