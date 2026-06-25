export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdminContext } from '@/lib/server/admin-auth'
import { SUPPORT_STATUSES } from '@/lib/support/tickets'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const updateSupportTicketSchema = z.object({
  status: z.enum(SUPPORT_STATUSES),
  resolution_notes: z.string().trim().max(4000).optional(),
})

export async function PATCH(
  request: NextRequest,
  context: { params: { ticketId: string } }
) {
  const adminContext = await getAdminContext()
  if (!adminContext.authorized) {
    return NextResponse.json({ error: adminContext.error }, { status: adminContext.status })
  }

  const parsed = updateSupportTicketSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid support ticket update', details: parsed.error.flatten() }, { status: 400 })
  }

  const now = new Date().toISOString()
  const isResolved = parsed.data.status === 'resolved' || parsed.data.status === 'closed'
  const update = {
    status: parsed.data.status,
    resolution_notes: parsed.data.resolution_notes ?? null,
    resolved_at: isResolved ? now : null,
    resolved_by: isResolved ? adminContext.user.id : null,
  }

  const admin = createServiceRoleClient()
  const { data, error } = await (admin as any)
    .from('support_tickets')
    .update(update)
    .eq('ticket_id', context.params.ticketId)
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('[admin.support] Failed to update support ticket', error)
    return NextResponse.json({ error: 'Failed to update support ticket' }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'Support ticket not found' }, { status: 404 })
  }

  return NextResponse.json({ ticket: data })
}
