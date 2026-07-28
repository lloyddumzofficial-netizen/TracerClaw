-- Cached project ZIP downloads.
-- Run this once in Supabase SQL Editor.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS zip_url TEXT;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS zip_signature TEXT;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS zip_generated_at TIMESTAMPTZ;
