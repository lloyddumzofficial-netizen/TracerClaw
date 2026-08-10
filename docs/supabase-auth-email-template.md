# Supabase Auth Email Template

The plain "Your sign-in link" email comes from Supabase Auth, not the app's Resend email renderer.
For hosted Supabase projects, update it in the Supabase Dashboard.

## Magic Link

Dashboard path:

1. Open Supabase Dashboard.
2. Go to Authentication > Emails.
3. Open the Magic Link template.
4. Set the subject to:

```text
Sign in to DesaynClaw
```

5. Paste the HTML from:

```text
supabase/email-templates/magic-link.html
```

This template uses Supabase's supported variables:

```text
{{ .Email }}
{{ .ConfirmationURL }}
```

The branded header image is loaded from:

```text
https://desaynclaw.com/DESAYNCLAW_EMAIL-HEADER.jpg
```
