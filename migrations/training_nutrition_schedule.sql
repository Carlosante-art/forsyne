-- Training schedule: weekly template (one row per weekday per user)
CREATE TABLE IF NOT EXISTS training_schedule (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dag         text NOT NULL, -- Måndag, Tisdag, Onsdag, Torsdag, Fredag, Lördag, Söndag
  typ         text, -- Tung styrka, Medel styrka, Lätt/Rörlighet, Kondition, Vila, Aktiv vila
  fokus       text, -- Ben, Överkropp, Helkropp, Kondition, Rörlighet
  intensitet  integer CHECK (intensitet BETWEEN 1 AND 10),
  varaktighet integer, -- minutes
  anteckningar text,
  aktiv       boolean DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, dag)
);

-- Nutrition protocol: user's baseline rules
CREATE TABLE IF NOT EXISTS nutrition_protocol (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fastar                boolean DEFAULT false,
  fastfönster           text,           -- '16:8', '18:6', etc.
  kolhydratsstrategi    text,           -- 'normal', 'lågkolhydrat', 'cyklisk', 'keto'
  kolhydrater_gram      integer,        -- daily target
  protein_gram          integer,
  kalorier              integer,
  tillskott             text[],
  anteckningar          text,
  updated_at            timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- RLS
ALTER TABLE training_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "training_schedule_user" ON training_schedule;
CREATE POLICY "training_schedule_user" ON training_schedule FOR ALL USING (user_id = auth.uid());

ALTER TABLE nutrition_protocol ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nutrition_protocol_user" ON nutrition_protocol;
CREATE POLICY "nutrition_protocol_user" ON nutrition_protocol FOR ALL USING (user_id = auth.uid());
