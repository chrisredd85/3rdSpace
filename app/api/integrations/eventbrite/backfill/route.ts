export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  importSelectedEventbriteEvents,
  listEventbriteBackfillEvents,
  loadEventbriteConnection,
  publicEventbriteConnectionState,
} from '@/lib/integrations/eventbrite/sync'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

const importSchema = z.object({
  eventbrite_event_ids: z.array(z.string().trim().min(1)).min(1).max(10),
})

const listSchema = z.object({
  action: z.literal('list_events').optional(),
}).passthrough()

type BuilderAuth =
  | { userId: string; builderProfileId: string }
  | { response: NextResponse<{ error: string }> }

export async function GET() {
  try {
    const auth = await getAuthenticatedBuilder()
    if ('response' in auth) return auth.response

    const admin = createServiceRoleClient()
    const connection = await loadEventbriteConnection(admin, auth.builderProfileId)
    return NextResponse.json({
      connection: publicEventbriteConnectionState(connection),
    })
  } catch (error) {
    console.error('[eventbrite.backfill] Failed to load state', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load Eventbrite connection' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedBuilder()
    if ('response' in auth) return auth.response

    const body = await request.json().catch(() => ({}))
    const admin = createServiceRoleClient()
    const importBody = importSchema.safeParse(body)

    if (importBody.success) {
      const result = await importSelectedEventbriteEvents({
        db: admin,
        builderId: auth.builderProfileId,
        userId: auth.userId,
        eventbriteEventIds: importBody.data.eventbrite_event_ids,
      })
      const connection = await loadEventbriteConnection(admin, auth.builderProfileId)
      return NextResponse.json({
        imported: result.imported,
        results: result.results,
        connection: publicEventbriteConnectionState(connection),
      })
    }

    const listBody = listSchema.safeParse(body)
    if (!listBody.success) {
      return NextResponse.json({ error: 'Invalid Eventbrite backfill request' }, { status: 400 })
    }

    const result = await listEventbriteBackfillEvents(admin, auth.builderProfileId)
    return NextResponse.json(result)
  } catch (error) {
    console.error('[eventbrite.backfill] Request failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Eventbrite backfill failed' },
      { status: 500 }
    )
  }
}

async function getAuthenticatedBuilder(): Promise<BuilderAuth> {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  const { builderProfileId, error: builderError } = await getBuilderProfileId(supabase, user.id)
  if (builderError || !builderProfileId) {
    return { response: NextResponse.json({ error: 'Builder profile not found' }, { status: 404 }) }
  }

  return {
    userId: user.id,
    builderProfileId,
  }
}
