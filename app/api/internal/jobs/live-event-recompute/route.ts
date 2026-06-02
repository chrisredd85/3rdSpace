export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runLiveEventRecompute } from '@/lib/finance/liveRecommendations'
import { getWorkerOrAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

const recomputeSchema = z.object({
  eventId: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  const context = await getWorkerOrAdminContext(request)
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const parsed = recomputeSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Missing eventId' }, { status: 400 })
  }

  try {
    const admin = createServiceRoleClient()
    const result = await runLiveEventRecompute(admin, parsed.data.eventId)
    return NextResponse.json(result)
  } catch (error) {
    console.error('[live-event-recompute] Failed to recompute live event', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to recompute live event' },
      { status: 500 }
    )
  }
}
