export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { recomputePlanDerivedState } from '@/lib/planner/recomputeDerivedState'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { Json, Plan } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }

interface RouteContext {
  params: Promise<{
    planId: string
  }>
}

const commitVendorSchema = z.object({
  discovery_vendor_id: z.string().uuid(),
  service_type: z.string().trim().min(1),
  quoted_hourly_cents: z.number().int().nonnegative().nullable().optional(),
  quoted_package_cents: z.number().int().nonnegative().nullable().optional(),
  quoted_minimum_cents: z.number().int().nonnegative().nullable().optional(),
  quoted_deposit_pct: z.number().min(0).max(1).nullable().optional(),
  quoted_terms: z.record(z.unknown()).default({}),
})

const cancelVendorSchema = z.object({
  discovery_vendor_id: z.string().uuid(),
  service_type: z.string().trim().min(1),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await getCreatorAuth()
  if ('response' in auth) return auth.response

  const body = await request.json().catch(() => null)
  const parsed = commitVendorSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid vendor commitment payload', issues: parsed.error.flatten() }, { status: 400 })
  }

  const plan = await loadOwnedPlan(auth.db, (await context.params).planId, auth.userId)
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  const reapprovalResponse = requireMutableQuotePlan(plan)
  if (reapprovalResponse) return reapprovalResponse
  const baselineDb = createServiceRoleClient() as unknown as PlannerDb

  const committedAt = new Date().toISOString()
  // Canonical event identity is lineage, not proof that these quote terms or
  // any booking/payment were approved. Execution must validate its approval.
  const canonicalEventId = plan.materialized_event_id ?? null
  const current = readCommittedVendors((plan as unknown as Record<string, unknown>).committed_vendors)
  const committedVendor = {
    vendor_id: parsed.data.discovery_vendor_id,
    discovery_vendor_id: parsed.data.discovery_vendor_id,
    service_type: parsed.data.service_type,
    quoted_hourly_cents: parsed.data.quoted_hourly_cents ?? null,
    quoted_package_cents: parsed.data.quoted_package_cents ?? null,
    quoted_minimum_cents: parsed.data.quoted_minimum_cents ?? null,
    quoted_deposit_pct: parsed.data.quoted_deposit_pct ?? null,
    quoted_terms: parsed.data.quoted_terms,
    committed_at: committedAt,
    ...(canonicalEventId ? { canonical_event_id: canonicalEventId } : {}),
  }
  const nextCommitted = [
    committedVendor,
    ...current.filter((vendor) => !sameCommittedVendor(vendor, committedVendor)),
  ]

  const metadata = readRecord(plan.metadata) ?? {}
  const acceptedQuoteState = readRecord(metadata.accepted_quote_state) ?? {}
  const nextMetadata = {
    ...metadata,
    committed_vendors: nextCommitted,
    accepted_quote_state: {
      ...acceptedQuoteState,
      vendors: nextCommitted,
      updated_at: committedAt,
    },
  }

  const { data, error } = await auth.db
    .from('plans')
    .update({
      committed_vendors: nextCommitted as unknown as Json,
      metadata: nextMetadata as Json,
    })
    .eq('id', (await context.params).planId)
    .eq('user_id', auth.userId)
    .select(PLAN_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to commit vendor quote' }, { status: 500 })
  }

  await auth.db
    .from('plan_discovery_vendor_candidates')
    .update({ status: 'superseded' })
    .eq('plan_id', (await context.params).planId)
    .eq('service_type', parsed.data.service_type)
    .neq('discovery_vendor_id', parsed.data.discovery_vendor_id)
    .in('status', ['candidate', 'approval_created'])

  const planId = (await context.params).planId
  await insertStatusMessage(
    baselineDb,
    planId,
    `Committed ${parsed.data.service_type.replace(/_/g, ' ')} vendor quote for planning.`,
    canonicalEventId
  )
  await recomputePlanDerivedState({
    supabase: auth.db,
    writeSupabase: baselineDb,
    baselineSupabase: baselineDb,
    planId,
    trigger: 'commit_changed',
  })
  const refreshedPlan = await loadOwnedPlan(auth.db, planId, auth.userId)
  return NextResponse.json({ plan: refreshedPlan ?? data, canonical_event_id: canonicalEventId })
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await getCreatorAuth()
  if ('response' in auth) return auth.response

  const body = await request.json().catch(() => null)
  const parsed = cancelVendorSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid vendor cancellation payload', issues: parsed.error.flatten() }, { status: 400 })
  }

  const plan = await loadOwnedPlan(auth.db, (await context.params).planId, auth.userId)
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  const reapprovalResponse = requireMutableQuotePlan(plan)
  if (reapprovalResponse) return reapprovalResponse
  const baselineDb = createServiceRoleClient() as unknown as PlannerDb
  const canonicalEventId = plan.materialized_event_id ?? null

  const nextCommitted = readCommittedVendors((plan as unknown as Record<string, unknown>).committed_vendors)
    .filter((vendor) => !sameCommittedVendor(vendor, {
      discovery_vendor_id: parsed.data.discovery_vendor_id,
      service_type: parsed.data.service_type,
    }))
  const metadata = readRecord(plan.metadata) ?? {}
  const acceptedQuoteState = readRecord(metadata.accepted_quote_state) ?? {}
  const nextMetadata = {
    ...metadata,
    committed_vendors: nextCommitted,
    accepted_quote_state: {
      ...acceptedQuoteState,
      vendors: nextCommitted,
      updated_at: new Date().toISOString(),
    },
  }

  const { data, error } = await auth.db
    .from('plans')
    .update({
      committed_vendors: nextCommitted as unknown as Json,
      metadata: nextMetadata as Json,
    })
    .eq('id', (await context.params).planId)
    .eq('user_id', auth.userId)
    .select(PLAN_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to cancel vendor commitment' }, { status: 500 })
  }

  const planId = (await context.params).planId
  await insertStatusMessage(
    baselineDb,
    planId,
    `Cancelled accepted ${parsed.data.service_type.replace(/_/g, ' ')} vendor quote.`,
    canonicalEventId
  )
  await recomputePlanDerivedState({
    supabase: auth.db,
    writeSupabase: baselineDb,
    baselineSupabase: baselineDb,
    planId,
    trigger: 'cancel_commit',
  })
  const refreshedPlan = await loadOwnedPlan(auth.db, planId, auth.userId)
  return NextResponse.json({ plan: refreshedPlan ?? data, canonical_event_id: canonicalEventId })
}

async function getCreatorAuth(): Promise<
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<{ error: string }> }
> {
  const supabase = createClient()
  const db = supabase as unknown as PlannerDb
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }
  return { db, userId: user.id }
}

async function loadOwnedPlan(db: PlannerDb, planId: string, userId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as Plan | null
}

async function insertStatusMessage(
  db: PlannerDb,
  planId: string,
  content: string,
  canonicalEventId: string | null
) {
  await db.from('plan_messages').insert({
    plan_id: planId,
    role: 'system',
    content,
    message_type: 'status_update',
    metadata: {
      kind: 'accepted_quote_state',
      ...(canonicalEventId ? { canonical_event_id: canonicalEventId } : {}),
    } as Json,
  })
}

function readCommittedVendors(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = readRecord(item)
        return record ? [record] : []
      })
    : []
}

function sameCommittedVendor(first: Record<string, unknown>, second: Record<string, unknown>) {
  return readString(first.discovery_vendor_id ?? first.vendor_id) === readString(second.discovery_vendor_id ?? second.vendor_id) &&
    readString(first.service_type) === readString(second.service_type)
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function requireMutableQuotePlan(plan: Plan) {
  if (!plan.materialized_event_id && (plan.status === 'drafting' || plan.status === 'ready')) {
    return null
  }

  return NextResponse.json(
    {
      error: 'Quote commitments are frozen after approval or event materialization. Revise the plan and complete re-approval before changing venue, vendor, price, or terms.',
      code: 'PLAN_REAPPROVAL_REQUIRED',
      plan_id: plan.id,
      plan_status: plan.status,
      materialized_event_id: plan.materialized_event_id ?? null,
    },
    { status: 409 }
  )
}
