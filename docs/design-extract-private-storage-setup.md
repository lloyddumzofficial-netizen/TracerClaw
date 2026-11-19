# Private Design Extract storage setup

1. In Cloudflare, open R2 Object Storage in the same account as the current DesaynClaw bucket. Create `desaynclaw-design-extract-private` using the default/automatic location and jurisdiction.
2. Open the new bucket's Settings. Keep Public Development URL (r2.dev) disabled and do not connect a custom domain. The existing public bucket remains unchanged.
3. Under CORS Policy, choose Add CORS policy, open the JSON tab, paste `docs/design-extract-r2-cors.json`, and Save. CORS permits the browser upload; it does not make the bucket public.
4. Under Object Lifecycle Rules, add a deletion rule for prefix `staging/design-extract/` after 1 day, and another for prefix `users/` after 3 days. Application cleanup still enforces project expiry. Configure incomplete multipart uploads to expire after 1 day if supported in the dashboard.
5. In R2 Account Details, use Manage API Tokens. Create an Account API token with Object Read & Write. Scope it to BOTH the existing DesaynClaw bucket (the name in `CLOUDFLARE_BUCKET_NAME`) and the new private bucket. Do not remove access to the existing bucket. Bucket configuration was done through the dashboard so the app key does not need Admin Read & Write.
6. Save the generated Access Key ID and Secret Access Key directly in `.env.local` as `CLOUDFLARE_ACCESS_KEY_ID` and `CLOUDFLARE_SECRET_ACCESS_KEY`. Never paste them in chat or commit them. Keep `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_BUCKET_NAME`, and `CLOUDFLARE_PUBLIC_URL` unchanged.
7. Add `DESIGN_EXTRACT_PRIVATE_BUCKET=desaynclaw-design-extract-private` to `.env.local`. Use `DESIGN_EXTRACT_BILLING_MODE=paid` for the verified charged workflow (2 Claws per extraction). `beta` is an explicit free test override, not the normal release setting. Migrations 039–041 must be installed; see the current predeployment audit. Restart the existing local development server on port 3000.
8. Tell the coding assistant that the private bucket, settings, and local credentials are ready. It will verify object access and the full upload/generation/export flow without publishing signatures or credentials. Do not enable public access to fix an image-loading problem.

This configures future private Design Extract assets. Existing public assets need separate migration/expiry and cache treatment; creating the private bucket does not revoke previously published URLs.

References:
- https://developers.cloudflare.com/r2/buckets/create-buckets/
- https://developers.cloudflare.com/r2/buckets/cors/
- https://developers.cloudflare.com/r2/api/tokens/
