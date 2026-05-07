export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdminContext } from '@/lib/server/admin-auth'
import { overrideConciergeInvite } from '@/lib/server/admin-concierge'
import { createServiceRoleClient } from '@/lib/supabase/server'

const overrideSchema = z.object({
  status: z.enum(['queued', 'sent', 'viewed', 'accepted', 'declined', 'countered', 'expired', 'concierge_followup', 'cancelled']),
  notes: z.string().trim().max(4000).nullable().optional(),
  outcomePayload: z.record(z.unknown()).optional(),
  reassignedVenueId: z.string().uuid().nullable().optional(),
})

interface RouteContext {
  params: {
    id: string
  }
}

/**
 * Overrides or reassigns a concierge invite and records the admin audit trail.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const adminContext = await getAdminContext()
  if (!adminContext.authorized) {
    return NextResponse.json({ error: adminContext.error }, { status: adminContext.status })
  }

  const parsed = overrideSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = await overrideConciergeInvite(createServiceRoleClient() as any, {
      inviteId: context.params.id,
      adminUserId: adminContext.user.id,
      status: parsed.data.status,
      notes: parsed.data.notes ?? null,
      outcomePayload: parsed.data.outcomePayload,
      reassignedVenueId: parsed.data.reassignedVenueId ?? null,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[admin.concierge.override] Failed to override invite', error)
    return NextResponse.json({ error: 'Failed to override invite' }, { status: 500 })
  }
}
