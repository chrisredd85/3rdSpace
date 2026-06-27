export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  createOrganizerDiscoveryReport,
  DISCOVERY_REPORT_CATEGORIES,
  type DiscoveryReportCategory,
} from '@/lib/discovery/freshness'

type RouteContext = {
  params: Promise<{
    vendorId: string
  }>
}

const reportSchema = z.object({
  category: z.enum(DISCOVERY_REPORT_CATEGORIES),
  details: z.string().trim().min(1).max(2000),
}).strict()

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    if (user.user_metadata?.user_type !== 'community_builder') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const params = await context.params
    const parsed = reportSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const planId = await loadOwnedCandidatePlanId(supabase, user.id, params.vendorId)
    if (!planId) {
      return NextResponse.json({ error: 'Discovery vendor is not attached to one of your plans' }, { status: 403 })
    }

    const admin = createServiceRoleClient()
    const ticket = await createOrganizerDiscoveryReport({
      admin,
      entityType: 'discovery_vendor',
      entityId: params.vendorId,
      planId,
      userId: user.id,
      category: parsed.data.category as DiscoveryReportCategory,
      details: parsed.data.details,
    })

    return NextResponse.json({
      ticket_id: ticket.id,
      message: 'Thanks, our team will review within 24 hours',
    })
  } catch (error) {
    console.error('[planner.discovery-vendors.report] POST failed', error)
    return NextResponse.json({ error: 'Failed to submit report' }, { status: 500 })
  }
}

async function loadOwnedCandidatePlanId(
  db: ReturnType<typeof createClient>,
  userId: string,
  vendorId: string
) {
  const { data, error } = await db
    .from('plan_discovery_vendor_candidates')
    .select('plan_id,plans!inner(id,user_id)')
    .eq('discovery_vendor_id', vendorId)
    .eq('plans.user_id', userId)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[planner.discovery-vendors.report] ownership_check_failed', {
      error: error.message,
      vendor_id: vendorId,
    })
    return null
  }

  const row = data as { plan_id?: unknown } | null
  return typeof row?.plan_id === 'string' ? row.plan_id : null
}
