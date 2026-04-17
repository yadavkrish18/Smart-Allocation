-- ============================================================
-- SmartAllocation — Supabase Database Schema
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ─── NGOs Table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ngos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  region     text NOT NULL,
  lat        double precision NOT NULL,
  lng        double precision NOT NULL,
  category   text DEFAULT 'General',
  created_at timestamptz DEFAULT now()
);

-- ─── Surveys Table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS surveys (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ngo_name   text NOT NULL,
  region     text NOT NULL,
  needs      text NOT NULL,
  status     text DEFAULT 'pending',  -- pending | reviewed | resolved
  created_at timestamptz DEFAULT now()
);

-- ─── Enable Row Level Security ─────────────────────────────────
ALTER TABLE ngos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;

-- ─── RLS Policies (allow public read/insert for anon key) ──────
-- NGOs: anyone can read and register
CREATE POLICY "Allow public read on ngos"
  ON ngos FOR SELECT USING (true);

CREATE POLICY "Allow public insert on ngos"
  ON ngos FOR INSERT WITH CHECK (true);

-- Surveys: anyone can insert and read
CREATE POLICY "Allow public insert on surveys"
  ON surveys FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read on surveys"
  ON surveys FOR SELECT USING (true);

CREATE POLICY "Allow public update on surveys"
  ON surveys FOR UPDATE USING (true);

-- ─── Seed Sample NGO Data ──────────────────────────────────────
INSERT INTO ngos (name, region, lat, lng, category) VALUES
  ('Hope Foundation',       'Maharashtra',     19.0760,  72.8777, 'Healthcare'),
  ('Green Earth NGO',       'Karnataka',       12.9716,  77.5946, 'Environment'),
  ('Rural Aid Trust',       'Rajasthan',       26.9124,  75.7873, 'Education'),
  ('Child First Society',   'Uttar Pradesh',   26.8467,  80.9462, 'Child Welfare'),
  ('Women Empower India',   'Tamil Nadu',      13.0827,  80.2707, 'Women Rights'),
  ('Digital Literacy Hub',  'West Bengal',     22.5726,  88.3639, 'Education'),
  ('Clean Water Mission',   'Bihar',           25.5941,  85.1376, 'Sanitation'),
  ('Food For All',          'Delhi',           28.6139,  77.2090, 'Food Security');

-- ============================================================
-- Smart Search Update (Run these separately if ngos/surveys already exist)
-- ============================================================

-- ─── 0. Reset Old Schema (If you previously used OpenAI's 1536 dims) 
DROP FUNCTION IF EXISTS match_surveys;
ALTER TABLE surveys DROP COLUMN IF EXISTS embedding;

-- ─── 1. Enable pgvector Extension ──────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── 2. Add Embeddings & State to Surveys ──────────────────────
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS embedding vector(1024);
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS is_available boolean DEFAULT true;

-- ─── 3. Match Surveys RPC Function ─────────────────────────────
-- This function takes user input (converted to an embedding vector),
-- finds the most semantically similar 'needs' in the surveys table,
-- and JOINS with the 'ngos' table to get the map coordinates (lat/lng).
CREATE OR REPLACE FUNCTION match_surveys(
  query_embedding vector(1024),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  survey_id uuid,
  ngo_name text,
  region text,
  needs text,
  similarity float,
  lat double precision,
  lng double precision,
  category text,
  age_days float
)
LANGUAGE sql
AS $$
  SELECT
    s.id as survey_id,
    s.ngo_name,
    s.region,
    s.needs,
    -- Base similarity from vector comparison
    -- PLUS a small boost for older surveys (up to 0.1 boost for 30+ days)
    (1 - (s.embedding <=> query_embedding)) + 
    LEAST(0.1, (EXTRACT(EPOCH FROM (now() - s.created_at)) / 2592000) * 0.1) AS similarity,
    n.lat,
    n.lng,
    n.category,
    EXTRACT(EPOCH FROM (now() - s.created_at)) / 86400 AS age_days
  FROM surveys s
  LEFT JOIN ngos n ON LOWER(TRIM(s.ngo_name)) = LOWER(TRIM(n.name))
  WHERE (1 - (s.embedding <=> query_embedding)) > match_threshold
    AND s.is_available = true
  ORDER BY similarity DESC
  LIMIT match_count;
$$;

-- ─── 4. Data Integrity & Relational Joins ──────────────────────
-- These constraints are required for the "Active Survey" map filter
ALTER TABLE IF EXISTS ngos ADD CONSTRAINT ngos_name_key UNIQUE (name);

-- Establish the link between surveys and ngos
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ngo_name') THEN
    ALTER TABLE surveys ADD CONSTRAINT fk_ngo_name 
    FOREIGN KEY (ngo_name) REFERENCES ngos(name) ON UPDATE CASCADE;
  END IF;
END $$;

