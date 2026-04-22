-- ============================================================
-- SmartAllocation — Consolidated Supabase Database Schema
-- Final Version: Includes Decision Support & Impact Tracking
-- ============================================================

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── 1. Table Definitions ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS profiles (
  id      uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  role    text CHECK (role IN ('NGO', 'Volunteer')),
  email   text,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ngo_details (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL UNIQUE,
  org_name     text NOT NULL,
  contact_name text,
  phone        text,
  org_type     text,
  mission_statement text,
  focus_areas  text[],
  location_name text,
  website      text,
  est_year     int,
  contact_role text,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS volunteer_details (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL UNIQUE,
  full_name    text NOT NULL,
  phone        text,
  skills_summary text,
  location_name text,
  availability jsonb DEFAULT '{"weekdays": false, "weekends": false}',
  skills       text[],
  languages    text[],
  rating       float DEFAULT 5.0,
  reviews_count int DEFAULT 0,
  tasks_completed int DEFAULT 0,
  total_hours  int DEFAULT 0,
  impact_score int DEFAULT 0,
  -- NEW DECISION SUPPORT FIELDS
  volunteer_reliability float DEFAULT 0.8,
  lat                   double precision,
  lng                   double precision,
  skills_embedding      vector(1024),
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ngos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users ON DELETE CASCADE DEFAULT auth.uid(),
  name       text NOT NULL,
  region     text NOT NULL,
  lat        double precision NOT NULL,
  lng        double precision NOT NULL,
  category   text DEFAULT 'General',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE IF EXISTS ngos ADD CONSTRAINT ngos_name_key UNIQUE (name);

CREATE TABLE IF NOT EXISTS surveys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users ON DELETE CASCADE DEFAULT auth.uid(),
  committed_by uuid REFERENCES auth.users ON DELETE SET NULL,
  ngo_name     text NOT NULL,
  region       text NOT NULL,
  needs        text NOT NULL,
  status       text DEFAULT 'open',
  is_available boolean DEFAULT true,
  embedding    vector(1024),
  urgency_level text DEFAULT 'Medium',
  assigned_at      timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz DEFAULT now(),
  -- NEW DECISION SUPPORT & IMPACT FIELDS
  source          text DEFAULT 'manual',
  people_affected  int DEFAULT 1,
  location_name    text,
  category         text,
  priority_score   float DEFAULT 0,
  response_time    interval,
  resolution_time  interval,
  required_resources int DEFAULT 1,
  fulfilled_resources int DEFAULT 0,
  volunteer_rating int CHECK (volunteer_rating >= 1 AND volunteer_rating <= 5),
  ngo_feedback     int CHECK (ngo_feedback >= 1 AND ngo_feedback <= 5)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ngo_name') THEN
    ALTER TABLE surveys ADD CONSTRAINT fk_ngo_name
    FOREIGN KEY (ngo_name) REFERENCES ngos(name) ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS invitations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id         uuid REFERENCES surveys(id) ON DELETE CASCADE,
  ngo_user_id       uuid REFERENCES auth.users ON DELETE CASCADE,
  volunteer_user_id uuid REFERENCES auth.users ON DELETE CASCADE,
  status            text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  message           text,
  created_at        timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ratings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id  uuid REFERENCES surveys(id) ON DELETE CASCADE,
  rated_by   uuid REFERENCES auth.users ON DELETE SET NULL,
  rated_user uuid REFERENCES auth.users ON DELETE CASCADE,
  score      int CHECK (score >= 1 AND score <= 5),
  comment    text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(survey_id, rated_by)
);

CREATE TABLE IF NOT EXISTS messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id  uuid REFERENCES surveys(id) ON DELETE CASCADE,
  sender_id  uuid REFERENCES auth.users ON DELETE SET NULL,
  content    text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ─── 2. Row Level Security ────────────────────────────────────

ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ngos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE surveys           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ngo_details       ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteer_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages          ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "NGOs manage own details" ON ngo_details FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Volunteers manage own details" ON volunteer_details FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "NGOs can read volunteer details" ON volunteer_details FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'NGO'));
CREATE POLICY "Allow public read on ngos" ON ngos FOR SELECT USING (true);
CREATE POLICY "NGOs can insert their own profiles" ON ngos FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'NGO'));
CREATE POLICY "Allow owners to update ngos" ON ngos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Allow public read on surveys" ON surveys FOR SELECT USING (true);
CREATE POLICY "NGOs can insert surveys" ON surveys FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated' AND 
    EXISTS (
      SELECT 1 FROM ngos 
      WHERE ngos.name = surveys.ngo_name 
      AND ngos.user_id = auth.uid()
    )
  );
CREATE POLICY "Owners can manage own surveys" ON surveys FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Volunteers can commit to tasks" ON surveys FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'Volunteer'));
CREATE POLICY "NGOs can view own invitations" ON invitations FOR SELECT USING (auth.uid() = ngo_user_id OR auth.uid() = volunteer_user_id);
CREATE POLICY "Allow analytics read on invitation outcomes" ON invitations FOR SELECT
  USING (status IN ('accepted', 'declined'));
CREATE POLICY "NGOs can send invitations" ON invitations FOR INSERT WITH CHECK (auth.uid() = ngo_user_id);
CREATE POLICY "Volunteers can respond to invitations" ON invitations FOR UPDATE USING (auth.uid() = volunteer_user_id);
CREATE POLICY "Allow ratings select" ON ratings FOR SELECT USING (true);
CREATE POLICY "Allow ratings insert" ON ratings FOR INSERT WITH CHECK (auth.uid() = rated_by);
DROP POLICY IF EXISTS "Task participants can view messages" ON messages;
DROP POLICY IF EXISTS "Task participants can send messages" ON messages;

CREATE POLICY "Task participants can view messages" ON messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM surveys s
    LEFT JOIN ngos n ON LOWER(TRIM(n.name)) = LOWER(TRIM(s.ngo_name))
    WHERE s.id = messages.survey_id
      AND (
        s.user_id = auth.uid()
        OR s.committed_by = auth.uid()
        OR n.user_id = auth.uid()
      )
  )
);

CREATE POLICY "Task participants can send messages" ON messages
FOR INSERT
WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM surveys s
    LEFT JOIN ngos n ON LOWER(TRIM(n.name)) = LOWER(TRIM(s.ngo_name))
    WHERE s.id = messages.survey_id
      AND (
        s.user_id = auth.uid()
        OR s.committed_by = auth.uid()
        OR n.user_id = auth.uid()
      )
  )
);

-- ─── 3. Functions & Triggers ──────────────────────────────────

-- Profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, role, email)
  VALUES (new.id, COALESCE(new.raw_user_meta_data->>'role', 'Volunteer'), new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Survey matching (Vector + Reliability + Distance)
CREATE OR REPLACE FUNCTION match_surveys(
  match_count int,
  match_threshold float,
  query_embedding vector(1024),
  v_reliability float DEFAULT 0.8,
  v_lat double precision DEFAULT NULL,
  v_lng double precision DEFAULT NULL
)
RETURNS TABLE (
  survey_id uuid, ngo_name text, region text, needs text,
  similarity float, lat double precision, lng double precision,
  category text, urgency_level text, age_days float, priority_score float,
  distance_km float
)
LANGUAGE sql AS $$
  SELECT
    s.id as survey_id, s.ngo_name, s.region, s.needs,
    ((1 - (s.embedding <=> query_embedding)) * v_reliability) AS similarity,
    n.lat, n.lng, n.category, s.urgency_level,
    EXTRACT(EPOCH FROM (now() - s.created_at)) / 86400 AS age_days,
    s.priority_score,
    CASE 
      WHEN v_lat IS NOT NULL AND v_lng IS NOT NULL AND n.lat IS NOT NULL 
      THEN (point(n.lng, n.lat) <@> point(v_lng, v_lat)) * 1.60934
      ELSE NULL 
    END as distance_km
  FROM surveys s
  LEFT JOIN ngos n ON LOWER(TRIM(s.ngo_name)) = LOWER(TRIM(n.name))
  WHERE (1 - (s.embedding <=> query_embedding)) > match_threshold
    AND s.is_available = true
  ORDER BY 
    s.priority_score DESC, 
    similarity DESC,
    distance_km ASC NULLS LAST
  LIMIT match_count;
$$;

-- Priority Scoring Formula (Upgrade)
CREATE OR REPLACE FUNCTION calculate_priority_score(
  urgency text, 
  affected int, 
  created_at timestamptz, 
  available boolean,
  req_res int DEFAULT 1,
  ful_res int DEFAULT 0
) 
RETURNS float AS $$
DECLARE
  u_weight float;
  p_norm float;
  t_norm float;
  gap_ratio float;
BEGIN
  -- 1. Urgency Weight (40%)
  u_weight := CASE WHEN urgency = 'High' THEN 1.0 WHEN urgency = 'Medium' THEN 0.6 ELSE 0.3 END;
  
  -- 2. Impact Normalization (30%) - max out at 500 people
  p_norm := LEAST(affected::float / 500, 1.0);
  
  -- 3. Time Normalization (20%) - max out at 30 days
  t_norm := LEAST((EXTRACT(EPOCH FROM (now() - created_at)) / 86400)::float / 30, 1.0);
  
  -- 4. Resource Gap Ratio (10%)
  gap_ratio := CASE WHEN COALESCE(req_res, 0) > 0 THEN (COALESCE(req_res, 0) - COALESCE(ful_res, 0))::float / req_res ELSE 0 END;
  
  RETURN LEAST((u_weight * 0.4) + (p_norm * 0.3) + (t_norm * 0.2) + (gap_ratio * 0.1), 1.0);
END;
$$ LANGUAGE plpgsql;

-- Trigger for Priority Score
CREATE OR REPLACE FUNCTION update_survey_priority()
RETURNS trigger AS $$
BEGIN
  NEW.priority_score := calculate_priority_score(
    NEW.urgency_level, 
    NEW.people_affected, 
    NEW.created_at, 
    NEW.is_available,
    NEW.required_resources,
    NEW.fulfilled_resources
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_priority ON surveys;
CREATE TRIGGER trg_update_priority BEFORE INSERT OR UPDATE ON surveys FOR EACH ROW EXECUTE FUNCTION update_survey_priority();

-- Recalculate volunteer reliability/ratings when a new rating is submitted
CREATE OR REPLACE FUNCTION refresh_volunteer_reliability()
RETURNS trigger AS $$
DECLARE
  avg_rating float;
  total_reviews int;
  normalized_reliability float;
BEGIN
  SELECT
    AVG(score)::float,
    COUNT(*)::int
  INTO avg_rating, total_reviews
  FROM ratings
  WHERE rated_user = NEW.rated_user;

  normalized_reliability := LEAST(GREATEST(COALESCE(avg_rating, 4)::float / 5.0, 0), 1);

  UPDATE volunteer_details
  SET
    rating = ROUND(COALESCE(avg_rating, 0)::numeric, 1),
    reviews_count = COALESCE(total_reviews, 0),
    volunteer_reliability = normalized_reliability
  WHERE user_id = NEW.rated_user;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_refresh_volunteer_reliability ON ratings;
CREATE TRIGGER trg_refresh_volunteer_reliability
AFTER INSERT ON ratings
FOR EACH ROW
EXECUTE FUNCTION refresh_volunteer_reliability();

-- Analytics View (NGO Grouped with Security Invoker)
DROP VIEW IF EXISTS impact_metrics;
CREATE OR REPLACE VIEW impact_metrics 
WITH (security_invoker = true) AS
SELECT 
  ngo_name,
  SUM(people_affected) FILTER (WHERE status = 'resolved') as total_people_helped,
  AVG(assigned_at - created_at) as avg_response_time,
  AVG(completed_at - created_at) as avg_resolution_time,
  COUNT(*) FILTER (WHERE status = 'resolved')::float / NULLIF(COUNT(*), 0) as success_rate
FROM surveys
GROUP BY ngo_name;

-- ─── 4. Seed Data ──────────────────────────────────────────────

INSERT INTO ngos (name, region, lat, lng, category) VALUES
  ('Hope Foundation',       'Maharashtra',     19.0760,  72.8777, 'Healthcare'),
  ('Green Earth NGO',       'Karnataka',       12.9716,  77.5946, 'Environment'),
  ('Rural Aid Trust',       'Rajasthan',       26.9124,  75.7873, 'Education'),
  ('Child First Society',   'Uttar Pradesh',   26.8467,  80.9462, 'Child Welfare'),
  ('Women Empower India',   'Tamil Nadu',      13.0827,  80.2707, 'Women Rights'),
  ('Digital Literacy Hub',  'West Bengal',     22.5726,  88.3639, 'Education'),
  ('Clean Water Mission',   'Bihar',           25.5941,  85.1376, 'Sanitation'),
  ('Food For All',          'Delhi',           28.6139,  77.2090, 'Food Security')
ON CONFLICT (name) DO NOTHING;

-- ─── 5. Realtime Publication ──────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'surveys') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE surveys;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'invitations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE invitations;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'volunteer_details') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE volunteer_details;
  END IF;
END $$;
