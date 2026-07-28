# Ordered Migrations

Run these files in numeric order for a fresh DesaynClaw database.

The files are copied from the existing production SQL scripts without changing
SQL behavior. This directory is the canonical forward path for future database
changes; the root-level SQL files are historical references.

## Current Order

1. `001_setup_base.sql`
2. `002_setup_auth.sql`
3. `003_setup_payments.sql`
4. `004_setup_dodo_payments.sql`
5. `005_setup_zip_cache.sql`
6. `006_add_reviews.sql`
7. `007_add_billing_columns.sql`
8. `008_add_project_failure_tracking.sql`
9. `009_add_performance_indexes.sql`
10. `010_enable_projects_rls.sql`
11. `011_harden_projects_rls.sql`
12. `012_fix_projects_select_policy.sql`
13. `013_secure_payment_proofs.sql`
14. `014_add_financial_atomic_rpcs.sql`
15. `015_add_scalability_admin_rpcs.sql`
16. `016_add_scalability_public_stats_rpcs.sql`
17. `017_add_palette_studio_gate.sql`

## Historical Root Scripts

The root `database/*.sql` files remain for audit history. Do not mix root-level
scripts with this ordered directory during a fresh setup.

`setup_refunds.sql` and `setup_increment_credits.sql` are intentionally not part
of this ordered migration path because the current atomic RPC migrations replace
that older refund/credit approach.
