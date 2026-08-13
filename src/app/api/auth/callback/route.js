import { NextResponse } from 'next/server'
// The client you created from the Server-Side Auth instructions
import { createClient } from '@/utils/supabase/server'
import { sendEmail } from '@/lib/email'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
const NEW_USER_WELCOME_WINDOW_MS = 5 * 60 * 1000

function resolveSafeRedirect(next, origin) {
  try {
    const redirectUrl = new URL(next || '/', origin)
    if (redirectUrl.origin !== origin) return new URL('/', origin)
    return redirectUrl
  } catch {
    return new URL('/', origin)
  }
}

function redirectWithAuthError(origin, reason, description) {
  const redirectUrl = new URL('/', origin)
  redirectUrl.searchParams.set('error', 'auth-failed')
  if (reason) redirectUrl.searchParams.set('auth_error', reason)
  if (description) redirectUrl.searchParams.set('auth_error_description', description)
  return NextResponse.redirect(redirectUrl)
}

function getUserDisplayName(user) {
  return (
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split('@')[0] ||
    'there'
  )
}

function isRecentlyCreatedUser(user) {
  const createdAt = user?.created_at ? new Date(user.created_at).getTime() : 0
  return createdAt > 0 && Date.now() - createdAt <= NEW_USER_WELCOME_WINDOW_MS
}

async function sendWelcomeEmailForNewUser(user) {
  if (!user?.email || !isRecentlyCreatedUser(user)) return

  const result = await sendEmail({
    to: user.email,
    subject: 'Welcome to DesaynClaw',
    template: 'welcome',
    data: {
      name: getUserDisplayName(user),
    },
  })

  if ('error' in result) {
    logger.warn('[auth callback] Welcome email was not sent', {
      userId: user.id,
      error: result.error,
    })
  }
}

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const providerError = searchParams.get('error') || searchParams.get('error_code')
  const providerErrorDescription = searchParams.get('error_description')
  // if "next" is in param, use it as the redirect URL
  let next = searchParams.get('next') ?? '/'

  if (providerError) {
    console.error('[auth callback] Provider returned an auth error', {
      error: providerError,
      description: providerErrorDescription,
    })
    return redirectWithAuthError(origin, providerError, providerErrorDescription)
  }

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      try {
        await sendWelcomeEmailForNewUser(data?.session?.user)
      } catch (welcomeError) {
        logger.warn('[auth callback] Welcome email failed after sign in', { error: welcomeError })
      }

      return NextResponse.redirect(resolveSafeRedirect(next, origin))
    }

    console.error('[auth callback] Failed to exchange auth code for session', {
      name: error.name,
      code: error.code,
      status: error.status,
      message: error.message,
    })
    return redirectWithAuthError(origin, error.code || error.name, error.message)
  }

  console.error('[auth callback] Missing auth code and provider error params')
  return redirectWithAuthError(origin, 'missing_code', 'The sign-in link did not include an auth code.')
}
