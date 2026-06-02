export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import {
  exchangeEventbriteCode,
  requiredEventbriteEnv,
  tokenExpiresAt,
} from '@/lib/integrations/eventbrite/client'
import { seedPlatformServiceFeeTermsForOrg } from '@/lib/finance/revenueTerms'
import {
  buildEventbriteWebhookUrl,
  EVENTBRITE_PLATFORM,
  generateEventbriteWebhookSecret,
} from '@/lib/integrations/eventbrite/sync'
import { tryUpsertProviderConnection } from '@/lib/server/provider-connections'
import { encryptSecret } from '@/lib/server/token-crypto'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

type ConnectionRow = {
  id: string
  config: Record<string, unknown> | null
  webhook_secret_encrypted: string | null
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const state = requestUrl.searchParams.get('state')
  const oauthError = requestUrl.searchParams.get('error')

  if (!state) {
    return NextResponse.redirect(buildRedirect(request, 'error', 'Security validation failed'))
  }

  const supabase = createClient()

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.redirect(buildRedirect(request, 'error', 'Sign in before connecting Eventbrite'))
    }

    const { builderProfileId, error: builderError } = await getBuilderProfileId(supabase, user.id)
    if (builderError || !builderProfileId) {
      return NextResponse.redirect(buildRedirect(request, 'error', 'Builder profile not found'))
    }

    const { data: connection, error: connectionError } = await supabase
      .from('builder_ticketing_connections')
      .select('id, config, webhook_secret_encrypted')
      .eq('builder_id', builderProfileId)
      .eq('platform', EVENTBRITE_PLATFORM)
      .eq('config->>oauth_state', state)
      .maybeSingle()

    if (connectionError) {
      console.error('[eventbrite.callback] State lookup failed', connectionError)
      return NextResponse.redirect(buildRedirect(request, 'error', 'Security validation failed'))
    }

    if (!connection) {
      return NextResponse.redirect(buildRedirect(request, 'error', 'Security validation failed'))
    }

    if (oauthError) {
      await markConnectionFailed(supabase, (connection as ConnectionRow).id, 'Eventbrite authorization was not completed')
      return NextResponse.redirect(buildRedirect(request, 'error', 'Eventbrite authorization was not completed'))
    }

    if (!code) {
      await markConnectionFailed(supabase, (connection as ConnectionRow).id, 'Missing authorization code')
      return NextResponse.redirect(buildRedirect(request, 'error', 'Missing authorization code'))
    }

    const redirectUri = readString((connection as ConnectionRow).config?.oauth_redirect_uri) ?? getEventbriteRedirectUri(request)
    const tokenData = await exchangeEventbriteCode({
      code,
      clientId: requiredEventbriteEnv('EVENTBRITE_CLIENT_ID'),
      clientSecret: requiredEventbriteEnv('EVENTBRITE_CLIENT_SECRET'),
      redirectUri,
    })
    const encryptedAccessToken = encryptSecret(tokenData.access_token)
    const encryptedRefreshToken = tokenData.refresh_token ? encryptSecret(tokenData.refresh_token) : null
    const expiresAt = tokenExpiresAt(tokenData)
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin
    const webhookUrl = buildEventbriteWebhookUrl(origin, (connection as ConnectionRow).id)
    const webhookSecretEncrypted =
      (connection as ConnectionRow).webhook_secret_encrypted ??
      encryptSecret(process.env.EVENTBRITE_WEBHOOK_SECRET ?? generateEventbriteWebhookSecret())
    const now = new Date().toISOString()

    const { error: updateError } = await supabase
      .from('builder_ticketing_connections')
      .update({
        access_token_encrypted: encryptedAccessToken,
        refresh_token_encrypted: encryptedRefreshToken,
        token_expires_at: expiresAt,
        webhook_url: webhookUrl,
        webhook_secret_encrypted: webhookSecretEncrypted,
        status: 'connected',
        last_connected_at: now,
        last_error: null,
        config: {
          ...(((connection as ConnectionRow).config as Record<string, unknown> | null) ?? {}),
          oauth_state: null,
          oauth_redirect_uri: redirectUri,
          connected_at: now,
          token_type: tokenData.token_type ?? 'Bearer',
          scope: tokenData.scope ?? null,
          webhook_actions: ['order.placed', 'order.updated', 'order.refunded', 'attendee.checked_in'],
        },
        updated_at: now,
      } as never)
      .eq('id', (connection as ConnectionRow).id)

    if (updateError) {
      console.error('[eventbrite.callback] Token save failed', updateError)
      return NextResponse.redirect(
        buildRedirect(request, 'error', 'We connected to Eventbrite but could not save the integration')
      )
    }

    await tryUpsertProviderConnection(supabase, {
      userId: user.id,
      builderId: builderProfileId,
      provider: EVENTBRITE_PLATFORM,
      status: 'connected',
      encryptedCredentials: {
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        token_expires_at: expiresAt,
      },
      webhookUrl,
      config: {
        account_connection_id: (connection as ConnectionRow).id,
        token_type: tokenData.token_type ?? 'Bearer',
        scope: tokenData.scope ?? null,
      },
      lastConnectedAt: now,
    })

    await seedPlatformServiceFeeTermsForOrg({
      supabase: supabase as never,
      orgId: builderProfileId,
      platform: EVENTBRITE_PLATFORM,
    })

    return NextResponse.redirect(buildRedirect(request, 'success'))
  } catch (error) {
    console.error('[eventbrite.callback] Callback failed', error)
    return NextResponse.redirect(
      buildRedirect(request, 'error', error instanceof Error ? error.message : 'Eventbrite connection failed')
    )
  }
}

async function markConnectionFailed(db: { from: (table: string) => any }, connectionId: string, message: string) {
  await db
    .from('builder_ticketing_connections')
    .update({
      status: 'failed',
      last_error: message,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', connectionId)
}

function buildRedirect(request: NextRequest, status: 'success' | 'error', message?: string) {
  const url = new URL('/planner/integrations/eventbrite', request.nextUrl.origin)
  url.searchParams.set(status === 'success' ? 'connected' : 'error', status === 'success' ? '1' : message ?? 'Eventbrite connection failed')
  return url
}

function getEventbriteRedirectUri(request: NextRequest) {
  return (
    process.env.EVENTBRITE_OAUTH_REDIRECT_URI ??
    new URL('/api/integrations/eventbrite/callback', request.nextUrl.origin).toString()
  )
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
