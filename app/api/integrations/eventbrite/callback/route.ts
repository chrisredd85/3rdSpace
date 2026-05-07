export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'
import { encryptSecret } from '@/lib/server/token-crypto'
import { getEventbriteErrorMessage } from '@/lib/server/eventbrite'
import { tryUpsertProviderConnection } from '@/lib/server/provider-connections'

type IntegrationRow = {
  id: string
  event_id: string
  config?: { oauth_state?: string } | null
}

type BuilderTicketingConnectionRow = {
  id: string
  config?: { oauth_state?: string } | null
}

/**
 * Builds the redirect URL back into the planner event flow with status context.
 */
function buildEventRedirect(request: NextRequest, eventId: string, status: 'success' | 'error', message?: string) {
  const url = new URL('/planner/experiences', request.url)
  url.searchParams.set('event', eventId)
  url.searchParams.set('integration', 'eventbrite')
  url.searchParams.set('status', status)
  if (message) {
    url.searchParams.set('message', message)
  }
  return url
}

function buildAccountRedirect(request: NextRequest, status: 'success' | 'error', message?: string) {
  const url = new URL('/planner', request.url)
  url.searchParams.set('integration', 'eventbrite')
  url.searchParams.set('status', status)
  if (message) {
    url.searchParams.set('message', message)
  }
  return url
}

/**
 * Exchanges an Eventbrite OAuth authorization code for tokens.
 */
async function exchangeCodeForTokens(code: string) {
  const clientId = process.env.EVENTBRITE_CLIENT_ID
  const clientSecret = process.env.EVENTBRITE_CLIENT_SECRET
  const redirectUri = process.env.EVENTBRITE_OAUTH_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing Eventbrite OAuth configuration')
  }

  console.log('[eventbrite.callback] Exchanging authorization code for tokens')

  const response = await fetch('https://www.eventbrite.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_secret: clientSecret,
      client_id: clientId,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }).toString(),
    cache: 'no-store',
  })

  const data = await response.json().catch(() => null)
  console.log('[eventbrite.callback] Token exchange response status', response.status)

  if (!response.ok) {
    const message = data?.error_description || data?.error || 'Token exchange failed'
    const error = new Error(message)
    ;(error as Error & { status?: number }).status = response.status
    throw error
  }

  return data as {
    access_token: string
    refresh_token?: string
    token_type?: string
  }
}

/**
 * Handles Eventbrite OAuth callback after user authorizes.
 *
 * @route GET /api/integrations/eventbrite/callback
 * @auth Required
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const state = requestUrl.searchParams.get('state')
  const oauthError = requestUrl.searchParams.get('error')

  if (!state) {
    return NextResponse.json({ error: 'Security validation failed' }, { status: 400 })
  }

  const supabase = createClient()

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { builderProfileId } = await getBuilderProfileId(supabase, user.id)
    if (!builderProfileId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: accountConnection, error: accountConnectionError } = await supabase
      .from('builder_ticketing_connections')
      .select('id, config')
      .eq('builder_id', builderProfileId)
      .eq('platform', 'eventbrite')
      .eq('config->>oauth_state', state)
      .maybeSingle()

    if (accountConnectionError) {
      console.error('[eventbrite.callback] Failed to load account connection for state validation', accountConnectionError)
      return NextResponse.json({ error: 'Security validation failed' }, { status: 400 })
    }

    if (accountConnection) {
      if (oauthError) {
        console.error('[eventbrite.callback] OAuth authorization error', oauthError)
        return NextResponse.redirect(
          buildAccountRedirect(request, 'error', 'Eventbrite authorization was not completed')
        )
      }

      if (!code) {
        return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 })
      }

      const tokenData = await exchangeCodeForTokens(code)
      const typedConnection = accountConnection as BuilderTicketingConnectionRow
      const encryptedAccessToken = encryptSecret(tokenData.access_token)
      const encryptedRefreshToken = tokenData.refresh_token ? encryptSecret(tokenData.refresh_token) : null
      const tokenExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()

      const { error: updateConnectionError } = await supabase
        .from('builder_ticketing_connections')
        .update({
          access_token_encrypted: encryptedAccessToken,
          refresh_token_encrypted: encryptedRefreshToken,
          token_expires_at: tokenExpiresAt,
          status: 'connected',
          last_connected_at: new Date().toISOString(),
          last_error: null,
          config: {
            ...((typedConnection.config as Record<string, unknown> | null) ?? {}),
            oauth_state: null,
            connected_at: new Date().toISOString(),
            token_type: tokenData.token_type ?? 'Bearer',
          },
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', typedConnection.id)

      if (updateConnectionError) {
        console.error('[eventbrite.callback] Failed to store account OAuth tokens', updateConnectionError)
        return NextResponse.redirect(
          buildAccountRedirect(request, 'error', 'We connected to Eventbrite but could not save the integration')
        )
      }

      await tryUpsertProviderConnection(supabase, {
        userId: user.id,
        builderId: builderProfileId,
        provider: 'eventbrite',
        status: 'connected',
        encryptedCredentials: {
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken,
          token_expires_at: tokenExpiresAt,
        },
        config: {
          account_connection_id: typedConnection.id,
          token_type: tokenData.token_type ?? 'Bearer',
        },
        lastConnectedAt: new Date().toISOString(),
      })

      return NextResponse.redirect(buildAccountRedirect(request, 'success'))
    }

    const { data: integration, error: integrationError } = await supabase
      .from('external_event_integrations')
      .select('id, event_id, config')
      .eq('platform', 'eventbrite')
      .eq('config->>oauth_state', state)
      .maybeSingle()

    if (integrationError) {
      console.error('[eventbrite.callback] Failed to load integration for state validation', integrationError)
      return NextResponse.json({ error: 'Security validation failed' }, { status: 400 })
    }

    if (!integration) {
      return NextResponse.json({ error: 'Security validation failed' }, { status: 400 })
    }

    const typedIntegration = integration as IntegrationRow
    const { data: event } = await supabase
      .from('events')
      .select('id')
      .eq('id', typedIntegration.event_id)
      .eq('builder_id', builderProfileId)
      .maybeSingle()

    if (!event) {
      return NextResponse.json({ error: 'Security validation failed' }, { status: 400 })
    }

    if (oauthError) {
      console.error('[eventbrite.callback] OAuth authorization error', oauthError)
      return NextResponse.redirect(
        buildEventRedirect(request, typedIntegration.event_id, 'error', 'Eventbrite authorization was not completed')
      )
    }

    if (!code) {
      return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 })
    }

    const tokenData = await exchangeCodeForTokens(code)
    const encryptedAccessToken = encryptSecret(tokenData.access_token)
    const encryptedRefreshToken = tokenData.refresh_token ? encryptSecret(tokenData.refresh_token) : null
    const tokenExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()

    const { error: updateError } = await supabase
      .from('external_event_integrations')
      .update({
        access_token_encrypted: encryptedAccessToken,
        refresh_token_encrypted: encryptedRefreshToken,
        token_expires_at: tokenExpiresAt,
        sync_status: 'connected',
        sync_error: null,
        last_sync_status: 'connected',
        last_sync_error: null,
        last_sync_at: new Date().toISOString(),
        is_active: true,
        config: {
          oauth_state: null,
          connected_at: new Date().toISOString(),
          token_type: tokenData.token_type ?? 'Bearer',
        },
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', typedIntegration.id)

    if (updateError) {
      console.error('[eventbrite.callback] Failed to store OAuth tokens', updateError)
      return NextResponse.redirect(
        buildEventRedirect(request, typedIntegration.event_id, 'error', 'We connected to Eventbrite but could not save the integration')
      )
    }

    await tryUpsertProviderConnection(supabase, {
      userId: user.id,
      builderId: builderProfileId,
      provider: 'eventbrite',
      status: 'connected',
      encryptedCredentials: {
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        token_expires_at: tokenExpiresAt,
      },
      config: {
        event_id: typedIntegration.event_id,
        integration_id: typedIntegration.id,
        token_type: tokenData.token_type ?? 'Bearer',
      },
      lastConnectedAt: new Date().toISOString(),
    })

    return NextResponse.redirect(buildEventRedirect(request, typedIntegration.event_id, 'success'))
  } catch (error) {
    console.error('[eventbrite.callback] Unexpected callback error', error)

    const message =
      error instanceof Error && (error as Error & { status?: number }).status
        ? getEventbriteErrorMessage(error)
        : 'Connection failed'

    const { data: integrations } = await supabase
      .from('external_event_integrations')
      .select('event_id, config')
      .eq('platform', 'eventbrite')
      .eq('config->>oauth_state', state)

    const integration = ((integrations as IntegrationRow[] | null) ?? []).find(
      (row) => row.config?.oauth_state === state
    )

    if (integration?.event_id) {
      return NextResponse.redirect(buildEventRedirect(request, integration.event_id, 'error', message))
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
