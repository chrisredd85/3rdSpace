export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import {
  buildSelectedVendorLine,
  enrichPlanSelectedVendors,
  estimateCommittedPriceCents,
  getPlanSourceEventId,
  mergeSelectedVendorIntoMetadata,
  type PlannerVendorSelectionDb,
} from '@/lib/planner/planVendorSelections'
import { createClient } from '@/lib/supabase/server'
import type { Json, Plan } from '@/lib/types'
import {
  commitVendorRateAgreement,
  getVendorRatePrefill,
} from '@/lib/vendors/rateAgreements'

interface RouteContext {
  params: Promise<{
    planId: string
    vendorId: string
  }>
}

const commitRateSchema = z.object({
  amount: z.coerce.number().positive(),
  rate_type: z.enum(['flat', 'per_person', 'hourly']),
  commit_agreement: z.boolean().optional().default(true),
})

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, (await context.params).planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const vendor = await loadVendor(auth.db, (await context.params).vendorId)
    if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

    const prefill = await getVendorRatePrefill(auth.db, auth.userId, (await context.params).vendorId, {
      expectedAttendance: plan.guest_count,
    })

    return NextResponse.json({
      vendor,
      prefill,
      source_event_id: getPlanSourceEventId(plan),
    })
  } catch (error) {
    console.error('[planner.vendor-rate] GET error', error)
    return NextResponse.json({ error: 'Could not load vendor rate.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const parsed = commitRateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid vendor rate', details: parsed.error.flatten() }, { status: 400 })
    }

    const plan = await loadOwnedPlan(auth.db, (await context.params).planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const vendor = await loadVendor(auth.db, (await context.params).vendorId)
    if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

    const sourceEventId = getPlanSourceEventId(plan)
    const rateAmount = roundMoney(parsed.data.amount)
    const rateType = parsed.data.rate_type
    const priceCents = estimateCommittedPriceCents(rateAmount, rateType, plan.guest_count)
    const commitPlan = parsed.data.commit_agreement
      ? await commitVendorRateAgreement(auth.db, {
          organizerUserId: auth.userId,
          vendorId: (await context.params).vendorId,
          sourceEventId,
          amount: rateAmount,
          rateType,
        })
      : null

    const vendorLine = buildSelectedVendorLine({
      vendor,
      rateAmount,
      rateType,
      priceCents,
      sourceEventId,
      provenanceLabel: null,
    })
    const nextMetadata = mergeSelectedVendorIntoMetadata(plan.metadata, vendorLine)

    const { data, error } = await auth.db
      .from('plans')
      .update({ metadata: nextMetadata as Json })
      .eq('id', plan.id)
      .eq('user_id', auth.userId)
      .select(PLAN_SELECT_COLUMNS)
      .single()

    if (error || !data) {
      console.error('[planner.vendor-rate] Plan metadata update error', error)
      return NextResponse.json({ error: 'Could not attach vendor to plan.' }, { status: 500 })
    }

    const enrichedPlan = await enrichPlanSelectedVendors(auth.db, data as Plan, auth.userId)
    return NextResponse.json({
      plan: enrichedPlan,
      selected_vendor: vendorLine,
      rate_commit: commitPlan,
    })
  } catch (error) {
    console.error('[planner.vendor-rate] POST error', error)
    return NextResponse.json({ error: 'Could not save vendor rate.' }, { status: 500 })
  }
}

async function getPlannerAuth(): Promise<
  | { db: PlannerVendorSelectionDb; userId: string }
  | { response: NextResponse<{ error: string }> }
> {
  const supabase = createClient()
  const db = supabase as unknown as PlannerVendorSelectionDb
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  return { db, userId: user.id }
}

async function loadOwnedPlan(db: PlannerVendorSelectionDb, planId: string, userId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[planner.vendor-rate] Plan lookup error', error)
    return null
  }

  return (data as Plan | null) ?? null
}

async function loadVendor(db: PlannerVendorSelectionDb, vendorId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await db
    .from('vendor_profiles')
    .select('id, name, service_type, base_rate, per_person_rate, pricing_model, claim_status, is_claimed')
    .eq('id', vendorId)
    .maybeSingle()

  if (error) {
    console.error('[planner.vendor-rate] Vendor lookup error', error)
    return null
  }

  return data as Record<string, unknown> | null
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}
