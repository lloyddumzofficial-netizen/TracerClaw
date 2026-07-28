ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS generated_image_url TEXT;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS ai_prompt TEXT;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS upscaled_image_url TEXT;
NOTIFY pgrst, 'reload schema';
