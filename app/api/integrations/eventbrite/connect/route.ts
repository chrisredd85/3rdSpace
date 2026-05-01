export const dynamic = 'force-dynamic'
import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

interface ConnectRequestBody {
  eventId?: string
  forceOAuth?: boolean
}

type ExistingIntegrationRow = {
  id: string
}

type BuilderTicketingConnectionRow = {
  id: string
  access_token_encrypted: string | null
  refresh_token_encrypted: string | null
  token_expires_at: string | null
  config?: Record<string, unknown> | null
}

/**
 * Ensures the current request has a logged-in builder and returns the current user plus builder profile id.
 */
async function getAuthenticatedBuilderContext() {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { supabase, user: null, builderProfileId: null, error: 'Not logged in' }
  }

  const { builderProfileId, error } = await getBuilderProfileId(supabase, user.id)

  if (error || !builderProfileId) {
    return { supabase, user, builderProfileId: null, error: 'Builder profile not found' }
  }

  return { supabase, user, builderProfileId, error: null }
}

/**
 * Builds the Eventbrite authorization URL for a given state value.
 */
function buildEventbriteAuthUrl(state: string) {
  const clientId = process.env.EVENTBRITE_CLIENT_ID
  const redirectUri = process.env.EVENTBRITE_OAUTH_REDIRECT_URI

  if (!clientId || !redirectUri) {
    throw new Error('Missing Eventbrite OAuth configuration')
  }

  const url = new URL('https://www.eventbrite.com/oauth/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  return url.toString()
}

/**
 * Initiates Eventbrite OAuth flow.
 *
 * @route POST /api/integrations/eventbrite/connect
 * @auth Required - Event creator only
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[eventbrite.connect] Starting OAuth flow')

    const body = (await request.json()) as ConnectRequestBody
    const { supabase, user, builderProfileId, error } = await getAuthenticatedBuilderContext()

    if (!user || error === 'Not logged in') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!builderProfileId) {
      return NextResponse.json({ error: error || 'Builder profile not found' }, { status: 403 })
    }

    if (!body.eventId) {
      const state = randomBytes(32).toString('hex')
      const { error: connectionError } = await supabase
        .from('builder_ticketing_connections')
        .upsert(
          {
            builder_id: builderProfileId,
            platform: 'eventbrite',
            status: 'pending',
            config: {
              oauth_state: state,
              initiated_by: user.id,
              initiated_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: 'builder_id,platform' }
        )

      if (connectionError) {
        console.error('[eventbrite.connect] Failed to create account-level connection', connectionError)
        return NextResponse.json({ error: 'Failed to start Eventbrite connection' }, { status: 500 })
      }

      const authUrl = buildEventbriteAuthUrl(state)
      return NextResponse.json({ authUrl })
    }

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id')
      .eq('id', body.eventId)
      .eq('builder_id', builderProfileId)
      .maybeSingle()

    if (eventError) {
      console.error('[eventbrite.connect] Event lookup failed', eventError)
      return NextResponse.json({ error: 'Failed to verify event ownership' }, { status: 500 })
    }

    if (!event) {
      const { data: eventExists } = await supabase
        .from('events')
        .select('id')
        .eq('id', body.eventId)
        .maybeSingle()

      return NextResponse.json(
        { error: eventExists ? 'You do not have access to this event' : 'Event not found' },
        { status: eventExists ? 403 : 404 }
      )
    }

    if (!body.forceOAuth) {
      const { data: accountConnection, error: accountConnectionError } = await supabase
        .from('builder_ticketing_connections')
        .select('id, access_token_encrypted, refresh_token_encrypted, token_expires_at, config')
        .eq('builder_id', builderProfileId)
        .eq('platform', 'eventbrite')
        .eq('status', 'connected')
        .maybeSingle()

      if (accountConnectionError) {
        console.error('[eventbrite.connect] Account connection lookup failed', accountConnectionError)
        return NextResponse.json({ error: 'Failed to start Eventbrite connection' }, { status: 500 })
      }

      const typedAccountConnection = accountConnection as BuilderTicketingConnectionRow | null
      if (typedAccountConnection?.access_token_encrypted) {
        const { data: connectedIntegration, error: integrationError } = await supabase
          .from('external_event_integrations')
          .upsert(
            {
              event_id: body.eventId,
              platform: 'eventbrite',
              access_token_encrypted: typedAccountConnection.access_token_encrypted,
              refresh_token_encrypted: typedAccountConnection.refresh_token_encrypted,
              token_expires_at: typedAccountConnection.token_expires_at,
              sync_status: 'connected',
              sync_error: null,
              last_sync_status: 'connected',
              last_sync_error: null,
              last_sync_at: new Date().toISOString(),
              is_active: true,
              config: {
                ...((typedAccountConnection.config as Record<string, unknown> | null) ?? {}),
                account_connection_id: typedAccountConnection.id,
                connected_from_account: true,
                connected_at: new Date().toISOString(),
              },
              updated_at: new Date().toISOString(),
            } as never,
            { onConflict: 'event_id,platform' }
          )
          .select('id')
          .single()

        if (integrationError) {
          console.error('[eventbrite.connect] Failed to attach account Eventbrite connection', integrationError)
          return NextResponse.json({ error: 'Failed to attach Eventbrite connection' }, { status: 500 })
        }

        return NextResponse.json({
          connected: true,
          integrationId: (connectedIntegration as { id: string }).id,
        })
      }
    }

    const state = randomBytes(32).toString('hex')

    const { data: existingIntegration, error: existingIntegrationError } = await supabase
      .from('external_event_integrations')
      .select('id')
      .eq('event_id', body.eventId)
      .eq('platform', 'eventbrite')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingIntegrationError) {
      console.error('[eventbrite.connect] Existing integration lookup failed', existingIntegrationError)
      return NextResponse.json({ error: 'Failed to start Eventbrite connection' }, { status: 500 })
    }

    const typedExistingIntegration = existingIntegration as ExistingIntegrationRow | null

    if (typedExistingIntegration?.id) {
      const { error: updateError } = await supabase
        .from('external_event_integrations')
        .update({
          sync_status: 'pending',
          sync_error: null,
          config: {
            oauth_state: state,
            initiated_by: user.id,
            initiated_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', typedExistingIntegration.id)

      if (updateError) {
        console.error('[eventbrite.connect] Failed to update integration state', updateError)
        return NextResponse.json({ error: 'Failed to start Eventbrite connection' }, { status: 500 })
      }
    } else {
      const { error: insertError } = await supabase
        .from('external_event_integrations')
        .insert({
          event_id: body.eventId,
          platform: 'eventbrite',
          sync_status: 'pending',
          config: {
            oauth_state: state,
            initiated_by: user.id,
            initiated_at: new Date().toISOString(),
          },
        } as never)

      if (insertError) {
        console.error('[eventbrite.connect] Failed to create pending integration', insertError)
        return NextResponse.json({ error: 'Failed to start Eventbrite connection' }, { status: 500 })
      }
    }

    const authUrl = buildEventbriteAuthUrl(state)
    return NextResponse.json({ authUrl })
  } catch (error) {
    console.error('[eventbrite.connect] Unexpected error', error)
    return NextResponse.json({ error: 'Connection failed' }, { status: 500 })
  }
}
