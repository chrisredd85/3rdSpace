export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdminContext } from '@/lib/server/admin-auth'
import { AdminTaskServiceError, mutateAdminTask } from '@/lib/server/admin-tasks'
import { createServiceRoleClient } from '@/lib/supabase/server'

const taskActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('assign'),
    assignedTo: z.string().uuid().nullable(),
  }),
  z.object({
    action: z.literal('start'),
  }),
  z.object({
    action: z.literal('complete'),
    note: z.string().trim().max(4000).nullable().optional(),
  }),
  z.object({
    action: z.literal('cancel'),
    note: z.string().trim().max(4000).nullable().optional(),
  }),
  z.object({
    action: z.literal('append_note'),
    note: z.string().trim().min(1).max(4000),
  }),
])

interface RouteContext {
  params: {
    id: string
  }
}

/**
 * Mutates one admin task and records the internal audit trail.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const adminContext = await getAdminContext()
  if (!adminContext.authorized) {
    return NextResponse.json({ error: adminContext.error }, { status: adminContext.status })
  }

  const taskId = z.string().uuid().safeParse(context.params.id)
  if (!taskId.success) {
    return NextResponse.json({ error: 'Invalid admin task id' }, { status: 400 })
  }

  const parsed = taskActionSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid admin task action', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const task = await mutateAdminTask(createServiceRoleClient(), {
      taskId: taskId.data,
      adminUserId: adminContext.user.id,
      adminUserEmail: adminContext.user.email,
      ...parsed.data,
    })

    return NextResponse.json({ task })
  } catch (error) {
    if (error instanceof AdminTaskServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    console.error('[admin.tasks] Failed to mutate admin task', error)
    return NextResponse.json({ error: 'Failed to update admin task' }, { status: 500 })
  }
}
