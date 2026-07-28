# Database SQL

The canonical database change path now lives in `database/migrations/`.

Root-level `.sql` files are historical source scripts from earlier production
hardening work. Keep them for audit context, but do not run them directly unless
you are intentionally investigating past behavior. In particular, older setup
scripts can overlap with newer hardening migrations.

For new database changes:

1. Add a new file under `database/migrations/` with the next numeric prefix.
2. Keep migrations idempotent when possible.
3. Document any required ordering or deployment coupling in the migration file.
4. Do not edit already-applied migrations except to add comments.

Historical scripts intentionally left at the root:

- `setup_increment_credits.sql`
- `setup_refunds.sql`

Those are superseded by the atomic billing/refund RPC migrations in
`database/migrations/`.
