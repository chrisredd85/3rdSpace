export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { enqueueJob } from '@/lib/server/job-queue'

interface ImportRequestBody {
  integrationId?: string
}

/**
 * Queues an Eventbrite attendee import for a linked event.
 *
 * @route POST /api/integrations/eventbrite/import
 * @auth Required - Event creator only
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ImportRequestBody
    if (!body.integrationId) {
      return NextResponse.json({ error: 'Missing integrationId' }, { status: 400 })
    }

    const supabase = createClient()
    const admin = createServiceRoleClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: integration, error: integrationError } = await supabase
      .from('external_event_integrations')
      .select('id, event_id, external_event_id, sync_status')
      .eq('id', body.integrationId)
      .eq('platform', 'eventbrite')
      .maybeSingle()

    if (integrationError) {
      console.error('[eventbrite.import] Failed to load integration', integrationError)
      return NextResponse.json({ error: 'Failed to load integration' }, { status: 500 })
    }

    if (!integration) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    }

    const typedIntegration = integration as {
      id: string
      external_event_id: string | null
      sync_status: string | null
    }

    if (!typedIntegration.external_event_id) {
      return NextResponse.json({ error: 'Event not linked to Eventbrite event' }, { status: 400 })
    }

    if (typedIntegration.sync_status === 'syncing') {
      return NextResponse.json({ error: 'An Eventbrite import is already running for this event.' }, { status: 409 })
    }

    const job = await enqueueJob(admin, {
      jobType: 'eventbrite.import',
      payload: {
        integrationId: typedIntegration.id,
        requestedBy: user.id,
      },
      uniqueKey: `eventbrite-import:${typedIntegration.id}`,
      maxAttempts: 3,
    })

    await admin
      .from('external_event_integrations')
      .update({
        sync_error: null,
        last_sync_status: 'queued',
        last_sync_error: null,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', typedIntegration.id)

    return NextResponse.json(
      {
        queued: true,
        jobId: job.id,
        message: 'Eventbrite import queued. Attendance data will update in the background.',
      },
      { status: 202 }
    )
  } catch (error) {
    console.error('[eventbrite.import] Failed to queue import', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to queue import' },
      { status: 500 }
    )
  }
}
