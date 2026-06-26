export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { declineVenueOpportunity } from '@/lib/venues/venueOpportunityRecovery'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    token: string
  }>
}

const declineSchema = z.object({
  reason: z.string().trim().max(1000).optional().nullable(),
})

/**
 * Token-gated venue opportunity decline confirmation.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const parsed = declineSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Decline reason is too long.' }, { status: 400 })
  }

  const admin = createServiceRoleClient()
  const result = await declineVenueOpportunity(admin, {
    token: (await context.params).token,
    reason: parsed.data.reason ?? null,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
