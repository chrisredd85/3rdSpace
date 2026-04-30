import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchOwnedEventbriteEvents, getEventbriteAccessToken, getEventbriteErrorMessage, type EventbriteIntegrationRow } from '@/lib/server/eventbrite'

/**
 * Fetches list of events from the user's Eventbrite account.
 *
 * @route GET /api/integrations/eventbrite/events
 * @auth Required
 */
export async function GET(request: NextRequest) {
  try {
    const integrationId = request.nextUrl.searchParams.get('integrationId')
    if (!integrationId) {
      return NextResponse.json({ error: 'Missing integrationId' }, { status: 400 })
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
      .select('id, event_id, access_token_encrypted, token_expires_at')
      .eq('id', integrationId)
      .eq('platform', 'eventbrite')
      .maybeSingle()

    if (integrationError) {
      console.error('[eventbrite.events] Failed to load integration', integrationError)
      return NextResponse.json({ error: 'Failed to load Eventbrite integration' }, { status: 500 })
    }

    if (!integration) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    }

    let accessToken: string
    try {
      accessToken = getEventbriteAccessToken(integration as EventbriteIntegrationRow)
    } catch (error) {
      console.error('[eventbrite.events] Failed to decrypt access token', error)
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to read Eventbrite credentials' }, { status: 500 })
    }

    const data = await fetchOwnedEventbriteEvents(accessToken)
    const events = (data.events ?? []).map((event) => ({
      id: event.id,
      name: event.name?.text ?? 'Untitled Event',
      start: event.start?.utc ?? null,
      end: event.end?.utc ?? null,
      status: event.status ?? 'unknown',
    }))

    return NextResponse.json({ events })
  } catch (error) {
    console.error('[eventbrite.events] Unexpected error', error)

    const status = error instanceof Error ? (error as Error & { status?: number }).status : undefined

    if (status === 401) {
      return NextResponse.json({ error: 'Invalid or expired Eventbrite token' }, { status: 401 })
    }

    if (status === 429) {
      return NextResponse.json({ error: 'Too many requests, try again later' }, { status: 429 })
    }

    return NextResponse.json({ error: getEventbriteErrorMessage(error) }, { status: status || 500 })
  }
}
