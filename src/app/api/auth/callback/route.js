import { NextResponse } from 'next/server'
// The client you created from the Server-Side Auth instructions
import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

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
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
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
