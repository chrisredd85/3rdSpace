export const dynamic = 'force-dynamic'

import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'
import { decryptEmailToken } from '@/lib/outreach/crypto'
import { createClient } from '@/lib/supabase/server'

const ACCOUNT_PUBLIC_SELECT = 'id, provider, email_address, token_expires_at, created_at, revoked_at'
const ACCOUNT_REVOKE_SELECT = 'id, oauth_refresh_token'

/**
 * Returns the current creator Gmail connection state.
 */
export async function GET() {
  const auth = await getCreatorAuth()
  if ('response' in auth) return auth.response

  const { data, error } = await auth.db
    .from('creator_email_accounts')
    .select(ACCOUNT_PUBLIC_SELECT)
    .eq('user_id', auth.userId)
    .eq('provider', 'gmail')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[gmail.account] Lookup failed', error)
    return NextResponse.json({ error: 'Failed to load Gmail connection' }, { status: 500 })
  }

  return NextResponse.json({ account: data ?? null })
}

/**
 * Revokes Google OAuth access first, then disconnects Gmail locally.
 * A failed Google revoke is logged but does not block the user's local disconnect.
 */
export async function DELETE() {
  const auth = await getCreatorAuth()
  if ('response' in auth) return auth.response

  const { data: account, error: lookupError } = await auth.db
    .from('creator_email_accounts')
    .select(ACCOUNT_REVOKE_SELECT)
    .eq('user_id', auth.userId)
    .eq('provider', 'gmail')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lookupError) {
    console.error('[gmail.account] Disconnect lookup failed', lookupError)
    return NextResponse.json({ error: 'Failed to load Gmail connection' }, { status: 500 })
  }

  if (!account) {
    return NextResponse.json({ account: null })
  }

  let refreshToken: string
  try {
    refreshToken = decryptEmailToken(account.oauth_refresh_token)
  } catch (error) {
    console.error('[gmail.account] Refresh token decrypt failed', error)
    return NextResponse.json({ error: 'Failed to decrypt Gmail connection' }, { status: 500 })
  }

  await revokeGoogleRefreshToken(refreshToken, auth.userId)

  const { error } = await auth.db
    .from('creator_email_accounts')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', account.id)
    .is('revoked_at', null)

  if (error) {
    console.error('[gmail.account] Disconnect failed', error)
    return NextResponse.json({ error: 'Failed to disconnect Gmail' }, { status: 500 })
  }

  return NextResponse.json({ account: null })
}

async function revokeGoogleRefreshToken(refreshToken: string, userId: string) {
  let response: Response
  try {
    response = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    })
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        user_id: userId,
        action: 'gmail_revoke_failure',
      },
    })
    console.warn('[gmail.account] Google revoke request failed', error)
    return
  }

  if (response.ok) return

  Sentry.captureMessage('gmail_revoke_failure', {
    level: 'warning',
    extra: {
      user_id: userId,
      action: 'gmail_revoke_failure',
      status_code: response.status,
    },
  })

  console.warn('[gmail.account] Google revoke failed', {
    user_id: userId,
    action: 'gmail_revoke_failure',
    status_code: response.status,
  })
}

async function getCreatorAuth() {
  const supabase = createClient()
  const db = supabase as any
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  return { db, userId: user.id }
}
