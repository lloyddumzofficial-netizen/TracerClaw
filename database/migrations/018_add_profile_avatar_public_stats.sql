-- Store basic OAuth profile display data for homepage public avatar stats.
-- Run once in Supabase SQL editor before or alongside the matching deploy.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name text NULL,
  ADD COLUMN IF NOT EXISTS avatar_url text NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, credits, is_admin, full_name, avatar_url)
  VALUES (
    new.id,
    new.email,
    0,
    FALSE,
    NULLIF(new.raw_user_meta_data->>'full_name', ''),
    NULLIF(new.raw_user_meta_data->>'avatar_url', '')
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_public_homepage_stats()
RETURNS TABLE(
  total_users bigint,
  completed_extractions bigint,
  review_count bigint,
  avatars text[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.profiles)::bigint,
    (SELECT count(*) FROM public.projects WHERE svg_url IS NOT NULL)::bigint,
    (SELECT count(*) FROM public.projects WHERE rating IS NOT NULL)::bigint,
    COALESCE(
      NULLIF(
        ARRAY(
          SELECT avatar_url
          FROM public.profiles
          WHERE avatar_url IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 20
        ),
        ARRAY[]::text[]
      ),
      ARRAY(
        SELECT reviewer_avatar
        FROM public.projects
        WHERE reviewer_avatar IS NOT NULL
          AND rating >= 4
        ORDER BY created_at DESC
        LIMIT 20
      ),
      ARRAY[]::text[]
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.get_public_homepage_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_public_homepage_stats() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_public_homepage_stats() FROM anon;

NOTIFY pgrst, 'reload schema';
