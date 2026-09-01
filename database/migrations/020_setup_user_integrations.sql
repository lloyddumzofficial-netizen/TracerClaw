-- Optional user integrations for DesaynClaw.
-- Tokens/secrets are encrypted by the app before storage. RLS is enabled and
-- no direct client policies are granted; users manage integrations only through
-- authenticated API routes so encrypted provider credentials are never exposed.

CREATE TABLE IF NOT EXISTS public.user_integrations (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  google_drive_refresh_token_enc text,
  google_drive_email text,
  google_drive_folder_id text,
  google_drive_connected_at timestamp with time zone,
  webhook_url text,
  webhook_secret_enc text,
  webhook_enabled boolean NOT NULL DEFAULT false,
  webhook_last_status text,
  webhook_last_delivered_at timestamp with time zone,
  webhook_last_error text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS user_integrations_webhook_enabled_idx
ON public.user_integrations (webhook_enabled)
WHERE webhook_enabled = true;

CREATE OR REPLACE FUNCTION public.set_user_integrations_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_user_integrations_updated_at ON public.user_integrations;
CREATE TRIGGER set_user_integrations_updated_at
BEFORE UPDATE ON public.user_integrations
FOR EACH ROW
EXECUTE FUNCTION public.set_user_integrations_updated_at();

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS google_drive_folder_id text,
ADD COLUMN IF NOT EXISTS google_drive_folder_url text,
ADD COLUMN IF NOT EXISTS google_drive_exported_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS google_drive_export_signature text;

NOTIFY pgrst, 'reload schema';
