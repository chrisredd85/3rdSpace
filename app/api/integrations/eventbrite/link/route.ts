export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  fetchEventbriteEvent,
  getEventbriteAccessToken,
  getEventbriteErrorMessage,
  type EventbriteIntegrationRow,
} from '@/lib/server/eventbrite'

interface LinkRequestBody {
  integrationId?: string
  eventbriteEventId?: string
}

/**
 * Links a 3rdPlace event to a specific Eventbrite event.
 *
 * @route POST /api/integrations/eventbrite/link
 * @auth Required - Event creator only
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as LinkRequestBody
    if (!body.integrationId || !body.eventbriteEventId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: integration, error: integrationError } = await supabase
      .from('external_event_integrations')
      .select('id, event_id, external_event_id, external_event_url, access_token_encrypted, config')
      .eq('id', body.integrationId)
      .eq('platform', 'eventbrite')
      .maybeSingle()

    if (integrationError) {
      console.error('[eventbrite.link] Failed to load integration', integrationError)
      return NextResponse.json({ error: 'Failed to load integration' }, { status: 500 })
    }

    if (!integration) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    }

    const { data: duplicate } = await supabase
      .from('external_event_integrations')
      .select('id')
      .eq('platform', 'eventbrite')
      .eq('external_event_id', body.eventbriteEventId)
      .neq('id', body.integrationId)
      .maybeSingle()

    if (duplicate) {
      return NextResponse.json({ error: 'That Eventbrite event is already linked to another event' }, { status: 409 })
    }

    const accessToken = getEventbriteAccessToken(integration as EventbriteIntegrationRow)
    const eventbriteEvent = await fetchEventbriteEvent(accessToken, body.eventbriteEventId)

    const updatedConfig = {
      ...(((integration as EventbriteIntegrationRow).config as Record<string, any> | null) ?? {}),
      eventbrite_event: {
        id: eventbriteEvent.id,
        name: eventbriteEvent.name?.text ?? 'Untitled Event',
        start: eventbriteEvent.start?.utc ?? eventbriteEvent.start?.local ?? null,
        end: eventbriteEvent.end?.utc ?? eventbriteEvent.end?.local ?? null,
        status: eventbriteEvent.status ?? 'unknown',
        url: eventbriteEvent.url ?? null,
      },
    }

    const { error: updateError } = await supabase
      .from('external_event_integrations')
      .update({
        external_event_id: body.eventbriteEventId,
        external_event_url: eventbriteEvent.url ?? null,
        config: updatedConfig,
        sync_status: 'linked',
        sync_error: null,
        last_sync_status: 'linked',
        last_sync_error: null,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', body.integrationId)

    if (updateError) {
      console.error('[eventbrite.link] Failed to update integration', updateError)
      return NextResponse.json({ error: 'Failed to link Eventbrite event' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      integration: {
        ...(integration as EventbriteIntegrationRow),
        external_event_id: body.eventbriteEventId,
        external_event_url: eventbriteEvent.url ?? null,
        sync_status: 'linked',
        config: updatedConfig,
      },
    })
  } catch (error) {
    console.error('[eventbrite.link] Unexpected error', error)
    const status = typeof error === 'object' && error && 'status' in error ? (error as { status?: number }).status : undefined
    return NextResponse.json({ error: getEventbriteErrorMessage(error) }, { status: status || 500 })
  }
}
