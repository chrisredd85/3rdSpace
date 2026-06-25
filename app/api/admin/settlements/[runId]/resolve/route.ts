import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { resolveDisputedSettlement } from '@/lib/finance/settlement-checkout'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  reason: z.string().trim().min(1, 'Resolution reason is required').max(2000),
})

type RouteContext = {
  params: {
    runId: string
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const adminContext = await getAdminContext()
  if (!adminContext.authorized) {
    return NextResponse.json({ error: adminContext.error }, { status: adminContext.status })
  }

  try {
    const body = BodySchema.parse(await request.json().catch(() => ({})))
    const admin = createServiceRoleClient()
    const result = await resolveDisputedSettlement(admin, context.params.runId, {
      actor: { id: adminContext.user.id, type: 'admin' },
      reason: body.reason,
    })
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid resolution payload', details: error.flatten() }, { status: 422 })
    }
    console.error('[admin.settlements.resolve] Failed to resolve settlement dispute', error)
    return NextResponse.json(
      { error: 'Unable to resolve settlement dispute', code: 'resolve_failed' },
      { status: 500 },
    )
  }
}
