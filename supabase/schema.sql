-- =============================================================
-- RecruiterRadar — Supabase Database Schema
-- Run this in your Supabase SQL editor (Project → SQL Editor)
-- =============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================
-- TABLES
-- =============================================================

-- ─── profiles ────────────────────────────────────────────────
-- Mirrors auth.users with additional profile fields.
-- Auto-created via trigger on new user sign-up.

CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email       TEXT,
  full_name   TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE public.profiles IS 'User profile data mirroring auth.users';

-- ─── jobs ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.jobs (
  id                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id             UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  company_name        TEXT NOT NULL,
  job_title           TEXT NOT NULL,
  job_url             TEXT NOT NULL,
  location            TEXT NOT NULL,
  status              TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')) NOT NULL,
  ai_provider         TEXT DEFAULT 'xai' NOT NULL,
  email_pattern       TEXT,
  hiring_team_notes   TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE public.jobs IS 'Job postings submitted by users for recruiter discovery';
CREATE INDEX IF NOT EXISTS jobs_user_id_idx ON public.jobs(user_id);
CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON public.jobs(created_at DESC);

-- ─── recruiter_leads ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.recruiter_leads (
  id                UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  job_id            UUID REFERENCES public.jobs(id) ON DELETE CASCADE NOT NULL,
  user_id           UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  full_name         TEXT NOT NULL,
  recruiter_title   TEXT NOT NULL,
  linkedin_url      TEXT,
  email             TEXT,
  email_type        TEXT DEFAULT 'unknown' CHECK (email_type IN ('verified', 'estimated', 'unknown')) NOT NULL,
  confidence_level  TEXT DEFAULT 'Medium' CHECK (confidence_level IN ('High', 'Medium', 'Low')) NOT NULL,
  source            TEXT NOT NULL DEFAULT '',
  outreach_message  TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE public.recruiter_leads IS 'Individual recruiter/hiring manager leads found by AI';
CREATE INDEX IF NOT EXISTS recruiter_leads_job_id_idx ON public.recruiter_leads(job_id);
CREATE INDEX IF NOT EXISTS recruiter_leads_user_id_idx ON public.recruiter_leads(user_id);
CREATE INDEX IF NOT EXISTS recruiter_leads_confidence_idx ON public.recruiter_leads(confidence_level);

-- ─── generation_runs ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.generation_runs (
  id                    UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id               UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  job_id                UUID REFERENCES public.jobs(id) ON DELETE CASCADE NOT NULL,
  ai_provider           TEXT NOT NULL,
  model_name            TEXT NOT NULL,
  search_provider       TEXT DEFAULT 'mock',
  search_queries_used   JSONB,   -- array of query strings executed
  prompt_text           TEXT,
  raw_response          TEXT,
  status                TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')) NOT NULL,
  error_message         TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Migration: if you already ran the schema, add the new columns:
-- ALTER TABLE public.generation_runs ADD COLUMN IF NOT EXISTS search_provider TEXT DEFAULT 'mock';
-- ALTER TABLE public.generation_runs ADD COLUMN IF NOT EXISTS search_queries_used JSONB;

COMMENT ON TABLE public.generation_runs IS 'Audit log of each AI generation request and its outcome';
CREATE INDEX IF NOT EXISTS generation_runs_job_id_idx ON public.generation_runs(job_id);
CREATE INDEX IF NOT EXISTS generation_runs_user_id_idx ON public.generation_runs(user_id);

-- =============================================================
-- ROW LEVEL SECURITY
-- =============================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruiter_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_runs ENABLE ROW LEVEL SECURITY;

-- ─── profiles policies ────────────────────────────────────────

CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ─── jobs policies ────────────────────────────────────────────

CREATE POLICY "Users can view their own jobs"
  ON public.jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own jobs"
  ON public.jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own jobs"
  ON public.jobs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own jobs"
  ON public.jobs FOR DELETE
  USING (auth.uid() = user_id);

-- ─── recruiter_leads policies ─────────────────────────────────

CREATE POLICY "Users can view their own leads"
  ON public.recruiter_leads FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own leads"
  ON public.recruiter_leads FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own leads"
  ON public.recruiter_leads FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own leads"
  ON public.recruiter_leads FOR DELETE
  USING (auth.uid() = user_id);

-- ─── generation_runs policies ─────────────────────────────────

CREATE POLICY "Users can view their own generation runs"
  ON public.generation_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own generation runs"
  ON public.generation_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Service role can do everything (used by backend API)
-- This is handled automatically by Supabase service role key bypass

-- =============================================================
-- FUNCTIONS & TRIGGERS
-- =============================================================

-- Auto-create profile on new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

-- Trigger: fire after auth.users insert
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

CREATE TRIGGER set_jobs_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

CREATE TRIGGER set_recruiter_leads_updated_at
  BEFORE UPDATE ON public.recruiter_leads
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- =============================================================
-- STORAGE (optional — for avatars)
-- =============================================================

-- Run this in the Supabase dashboard → Storage if you want avatar uploads:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true);

-- CREATE POLICY "Avatar images are publicly accessible"
--   ON storage.objects FOR SELECT
--   USING (bucket_id = 'avatars');

-- CREATE POLICY "Users can upload their own avatar"
--   ON storage.objects FOR INSERT
--   WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- =============================================================
-- SAMPLE / DEMO DATA (optional — remove for production)
-- =============================================================
-- DO NOT run this in production. Only for local testing.
-- The app creates real data through the UI.
