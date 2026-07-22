-- Legacy compatibility flag. Palette Studio access is now based on owned projects with svg_url.
ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS palette_studio_unlocked boolean NOT NULL DEFAULT false;
