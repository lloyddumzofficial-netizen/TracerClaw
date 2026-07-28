-- Scalability helper for the unauthenticated homepage stats endpoint.
-- Run once in the Supabase SQL editor before or alongside the matching deploy.

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
