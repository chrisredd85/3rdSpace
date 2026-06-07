export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import {
  exchangeGmailCode,
  encryptGmailTokenSet,
  loadGmailProfile,
  parseGmailOAuthState,
} from '@/lib/outreach/gmail'
import { createClient } from '@/lib/supabase/server'

/**
 * Completes creator Gmail OAuth and stores encrypted tokens.
 */
export async function GET(request: NextRequest) {
  const appUrl = new URL('/planner/settings/integrations', request.url)

  try {
    const code = request.nextUrl.searchParams.get('code')
    const stateValue = request.nextUrl.searchParams.get('state')
    const oauthError = request.nextUrl.searchParams.get('error')

    if (oauthError) throw new Error(oauthError)
    if (!code || !stateValue) throw new Error('Missing Google OAuth callback parameters')

    const state = parseGmailOAuthState(stateValue)
    const supabase = createClient()
    const db = supabase as any
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) throw new Error('Sign in again before connecting Gmail')
    if (user.id !== state.userId) throw new Error('Gmail OAuth state does not match the signed-in creator')
    if (user.user_metadata?.user_type !== 'community_builder') throw new Error('Only creators can connect Gmail')

    const tokenSet = await exchangeGmailCode(code)
    const profile = await loadGmailProfile(tokenSet.access_token!)
    const encrypted = encryptGmailTokenSet({
      accessToken: tokenSet.access_token!,
      refreshToken: tokenSet.refresh_token!,
      expiresInSeconds: tokenSet.expires_in,
    })

    await db
      .from('creator_email_accounts')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('provider', 'gmail')
      .is('revoked_at', null)

    const { error: insertError } = await db.from('creator_email_accounts').insert({
      user_id: user.id,
      provider: 'gmail',
      email_address: profile.emailAddress,
      oauth_access_token: encrypted.oauth_access_token,
      oauth_refresh_token: encrypted.oauth_refresh_token,
      token_expires_at: encrypted.token_expires_at,
      history_id: profile.historyId,
      label_id: null,
    })

    if (insertError) throw new Error(insertError.message)

    const redirectUrl = new URL(safeReturnTo(state.returnTo), request.url)
    redirectUrl.searchParams.set('gmail', 'connected')
    return NextResponse.redirect(redirectUrl)
  } catch (error) {
    appUrl.searchParams.set('gmail_error', error instanceof Error ? error.message : 'Gmail connection failed')
    return NextResponse.redirect(appUrl)
  }
}

function safeReturnTo(value: string) {
  return value.startsWith('/') ? value : '/planner/settings/integrations'
}
