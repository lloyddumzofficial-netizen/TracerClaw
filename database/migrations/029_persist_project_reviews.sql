-- Project files and rows are intentionally deleted after three days. Reviews
-- must live independently so public trust metrics survive project cleanup.

CREATE TABLE IF NOT EXISTS public.project_reviews (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  project_name text,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  feedback_text text,
  reviewer_name text,
  reviewer_avatar text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.project_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_reviews FROM PUBLIC, authenticated, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.project_reviews TO service_role;

CREATE INDEX IF NOT EXISTS project_reviews_created_idx
  ON public.project_reviews (created_at DESC);
CREATE INDEX IF NOT EXISTS project_reviews_rating_idx
  ON public.project_reviews (rating, created_at DESC);

-- Preserve any reviews whose temporary project rows still exist at migration time.
INSERT INTO public.project_reviews (
  project_id, user_id, project_name, rating, feedback_text,
  reviewer_name, reviewer_avatar, created_at, updated_at
)
SELECT
  id, user_id, name, rating, feedback_text,
  reviewer_name, reviewer_avatar, created_at, timezone('utc'::text, now())
FROM public.projects
WHERE rating IS NOT NULL
ON CONFLICT (project_id) DO UPDATE SET
  project_name = EXCLUDED.project_name,
  rating = EXCLUDED.rating,
  feedback_text = EXCLUDED.feedback_text,
  reviewer_name = EXCLUDED.reviewer_name,
  reviewer_avatar = EXCLUDED.reviewer_avatar,
  updated_at = timezone('utc'::text, now());

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
    -- Eleven verified reviews predate the permanent table and were removed by
    -- the three-day project cleanup. Keep that historical baseline and add all
    -- reviews captured after this migration.
    (11 + (SELECT count(*) FROM public.project_reviews))::bigint,
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
        FROM public.project_reviews
        WHERE reviewer_avatar IS NOT NULL AND rating >= 4
        ORDER BY created_at DESC
        LIMIT 20
      ),
      ARRAY[]::text[]
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.get_public_homepage_stats() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_public_homepage_stats() TO service_role;
NOTIFY pgrst, 'reload schema';
