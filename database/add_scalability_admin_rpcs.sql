-- Scalability helpers for the admin dashboard.
-- Run once in the Supabase SQL editor before or alongside the matching deploy.

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_metrics()
RETURNS TABLE(
  total_projects bigint,
  active_credits_total bigint,
  approved_gcash_revenue integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.projects)::bigint,
    COALESCE((SELECT sum(credits)::bigint FROM public.profiles WHERE credits > 0), 0),
    COALESCE(
      (
        SELECT sum(
          CASE lower(plan)
            WHEN 'tingi' THEN 60
            WHEN 'basic' THEN 140
            WHEN 'starter' THEN 260
            WHEN 'pro' THEN 840
            ELSE 0
          END
        )::integer
        FROM public.payment_requests
        WHERE status = 'approved'
      ),
      0
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_metrics() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_metrics() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_metrics() FROM anon;

NOTIFY pgrst, 'reload schema';
