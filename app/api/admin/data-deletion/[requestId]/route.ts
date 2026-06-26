export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { executeDataDeletion } from '@/lib/privacy/executeDataDeletion'

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('review') }),
  z.object({ action: z.literal('reject'), reason: z.string().min(3).max(2000) }),
  z.object({ action: z.literal('execute') }),
])

type RouteContext = {
  params: Promise<{
    requestId: string
  }>
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { getAdminContext } = await import('@/lib/server/admin-auth')
  const { createServiceRoleClient } = await import('@/lib/supabase/server')
  const adminContext = await getAdminContext()
  if (!adminContext.authorized) {
    return NextResponse.json({ error: adminContext.error }, { status: adminContext.status })
  }

  const parsed = actionSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid data deletion action' }, { status: 400 })
  }

  const admin = createServiceRoleClient() as any
  const { data: row, error: loadError } = await admin
    .from('data_deletion_requests')
    .select('id,user_id,email,status,cooling_off_ends_at')
    .eq('id', (await context.params).requestId)
    .maybeSingle()

  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Deletion request not found' }, { status: 404 })

  if (parsed.data.action === 'review') {
    const { data, error } = await admin
      .from('data_deletion_requests')
      .update({ status: 'in_review' })
      .eq('id', row.id)
      .in('status', ['requested', 'approved'])
      .select('id,status')
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ request: data })
  }

  if (parsed.data.action === 'reject') {
    const { data, error } = await admin
      .from('data_deletion_requests')
      .update({
        status: 'rejected',
        rejected_reason: parsed.data.reason,
      })
      .eq('id', row.id)
      .neq('status', 'executed')
      .select('id,status,rejected_reason')
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ request: data })
  }

  const coolingOffEndsAt = new Date(row.cooling_off_ends_at)
  if (Number.isNaN(coolingOffEndsAt.getTime()) || coolingOffEndsAt > new Date()) {
    return NextResponse.json(
      { error: 'Cooling-off period has not ended yet' },
      { status: 409 }
    )
  }

  if (row.status === 'executed') {
    return NextResponse.json({ error: 'Deletion request already executed' }, { status: 409 })
  }

  await admin
    .from('data_deletion_requests')
    .update({ status: 'approved' })
    .eq('id', row.id)

  const execution = await executeDataDeletion({
    supabase: admin,
    userId: row.user_id,
    adminUserId: adminContext.user.id,
  })

  const finalStatus = execution.failed.length > 0 ? 'in_review' : 'executed'
  const { data, error } = await admin
    .from('data_deletion_requests')
    .update({
      status: finalStatus,
      executed_at: finalStatus === 'executed' ? new Date().toISOString() : null,
      executed_by: adminContext.user.id,
      execution_log: execution,
    })
    .eq('id', row.id)
    .select('id,status,executed_at,execution_log')
    .single()

  if (error) return NextResponse.json({ error: error.message, execution }, { status: 500 })

  return NextResponse.json({ request: data, execution })
}
