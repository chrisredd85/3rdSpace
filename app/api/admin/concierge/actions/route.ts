export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdminContext } from '@/lib/server/admin-auth'
import { logConciergeAction } from '@/lib/server/admin-concierge'
import { createServiceRoleClient } from '@/lib/supabase/server'

const actionSchema = z.object({
  inviteId: z.string().uuid(),
  actionType: z.enum(['outreach_attempt', 'response_logged', 'status_override', 'reassigned']),
  notes: z.string().trim().max(4000).nullable().optional(),
  outcomePayload: z.record(z.unknown()).optional(),
})

/**
 * Logs an admin/concierge action against a venue opportunity invite.
 */
export async function POST(request: NextRequest) {
  const context = await getAdminContext()
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const parsed = actionSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const action = await logConciergeAction(createServiceRoleClient() as any, {
      inviteId: parsed.data.inviteId,
      adminUserId: context.user.id,
      actionType: parsed.data.actionType,
      notes: parsed.data.notes ?? null,
      outcomePayload: parsed.data.outcomePayload,
    })

    return NextResponse.json({ action })
  } catch (error) {
    console.error('[admin.concierge.actions] Failed to log action', error)
    return NextResponse.json({ error: 'Failed to log concierge action' }, { status: 500 })
  }
}
