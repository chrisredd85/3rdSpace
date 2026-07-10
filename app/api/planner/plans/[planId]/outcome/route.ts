export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/types'

const planIdSchema = z.string().uuid()
const outcomeSchema = z.object({
  actualAttendance: z.number().int().nonnegative().refine(Number.isSafeInteger).optional(),
  grossRevenueCents: z.number().int().nonnegative().refine(Number.isSafeInteger).optional(),
  totalCostCents: z.number().int().nonnegative().refine(Number.isSafeInteger).optional(),
  notes: z.string().trim().min(1).max(4_000).optional(),
}).strict().refine(
  (value) => Object.values(value).some((item) => item !== undefined),
  'Record attendance, revenue, cost, or substantive notes'
)

type PlannerDb = {
  from: (table: string) => any
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown
    error: { code?: string; message?: string; details?: string; hint?: string } | null
  }>
}

type CanonicalOutcomePlan = {
  id: string
  user_id: string
  status: string
  materialized_event_id: string | null
}

type CanonicalOutcomeEvent = {
  id: string
  plan_id: string | null
  status: string | null
  event_name: string
  event_date: string
  ends_at: string | null
  time_zone: string | null
  outcome_recorded_at: string | null
  outcome_summary: Json | null
}

interface RouteContext {
  params: Promise<{ planId: string }>
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const auth = await getCreatorAuth()
    if ('response' in auth) return auth.response

    const planId = planIdSchema.safeParse((await context.params).planId)
    if (!planId.success) return NextResponse.json({ error: 'Invalid plan id' }, { status: 400 })

    const plan = await loadOwnedPlan(auth.db, planId.data, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (!plan.materialized_event_id) {
      return NextResponse.json({
        plan,
        event: null,
        canRecord: false,
        reason: 'canonical_event_required',
        templateEligible: false,
      })
    }

    const event = await loadCanonicalEvent(auth.db, plan)
    if (!event) {
      return NextResponse.json(
        { error: 'Canonical event identity is inconsistent', code: 'canonical_event_identity_mismatch' },
        { status: 409 }
      )
    }

    const hasEnded = Boolean(event.ends_at && Date.parse(event.ends_at) <= Date.now())
    const isRecorded = Boolean(event.outcome_recorded_at && event.outcome_summary)
    return NextResponse.json({
      plan,
      event,
      canRecord: plan.status === 'booked' && hasEnded && !isRecorded,
      reason: isRecorded
        ? 'outcome_recorded'
        : plan.status !== 'booked'
          ? 'plan_not_booked'
          : !hasEnded
            ? 'event_not_ended'
            : null,
      templateEligible: plan.status === 'completed' && isRecorded,
    })
  } catch (error) {
    console.error('[planner.outcome] GET failed', error)
    return NextResponse.json({ error: 'Unable to load event outcome state' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await getCreatorAuth()
    if ('response' in auth) return auth.response

    const planId = planIdSchema.safeParse((await context.params).planId)
    if (!planId.success) return NextResponse.json({ error: 'Invalid plan id' }, { status: 400 })

    const parsed = outcomeSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid outcome evidence', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const plan = await loadOwnedPlan(auth.db, planId.data, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (!plan.materialized_event_id) {
      return NextResponse.json(
        { error: 'This plan has no canonical event', code: 'canonical_event_required' },
        { status: 409 }
      )
    }

    const event = await loadCanonicalEvent(auth.db, plan)
    if (!event) {
      return NextResponse.json(
        { error: 'Canonical event identity is inconsistent', code: 'canonical_event_identity_mismatch' },
        { status: 409 }
      )
    }

    const outcomeSummary = {
      ...(parsed.data.actualAttendance !== undefined
        ? { actual_attendance: parsed.data.actualAttendance }
        : {}),
      ...(parsed.data.grossRevenueCents !== undefined
        ? { gross_revenue_cents: parsed.data.grossRevenueCents }
        : {}),
      ...(parsed.data.totalCostCents !== undefined
        ? { total_cost_cents: parsed.data.totalCostCents }
        : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
    }

    const writeDb = createServiceRoleClient() as unknown as PlannerDb
    if (!writeDb.rpc) {
      return NextResponse.json({ error: 'Event outcome recording is unavailable' }, { status: 500 })
    }

    const { data, error } = await writeDb.rpc('record_plan_event_outcome_command', {
      p_event_id: event.id,
      p_actor_id: auth.userId,
      p_outcome_summary: outcomeSummary,
    })
    if (error) return mapOutcomeError(error)

    return NextResponse.json({ success: true, ...(readRecord(data) ?? {}) })
  } catch (error) {
    console.error('[planner.outcome] POST failed', error)
    return NextResponse.json({ error: 'Unable to record event outcome' }, { status: 500 })
  }
}

async function getCreatorAuth(): Promise<
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<{ error: string }> }
> {
  const supabase = createClient()
  const db = supabase as unknown as PlannerDb
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }
  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  return { db, userId: user.id }
}

async function loadOwnedPlan(db: PlannerDb, planId: string, userId: string): Promise<CanonicalOutcomePlan | null> {
  const { data, error } = await db
    .from('plans')
    .select('id,user_id,status,materialized_event_id')
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Plan lookup failed')
  return data as CanonicalOutcomePlan | null
}

async function loadCanonicalEvent(
  db: PlannerDb,
  plan: CanonicalOutcomePlan
): Promise<CanonicalOutcomeEvent | null> {
  const { data, error } = await db
    .from('events')
    .select('id,plan_id,status,event_name,event_date,ends_at,time_zone,outcome_recorded_at,outcome_summary')
    .eq('id', plan.materialized_event_id)
    .eq('plan_id', plan.id)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Canonical event lookup failed')
  return data as CanonicalOutcomeEvent | null
}

function mapOutcomeError(error: { code?: string; message?: string; details?: string; hint?: string }) {
  const text = [error.message, error.details, error.hint].filter(Boolean).join(' ')
  if (/actor_mismatch|unauthorized/i.test(text) || error.code === '42501') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  if (/canonical_event_not_found/i.test(text) || error.code === 'P0002') {
    return NextResponse.json({ error: 'Canonical event not found' }, { status: 404 })
  }
  if (/event_has_not_ended/i.test(text)) {
    return NextResponse.json(
      { error: 'Record the outcome after the event ends', code: 'event_not_ended' },
      { status: 409 }
    )
  }
  if (/plan_must_be_booked/i.test(text)) {
    return NextResponse.json(
      { error: 'The canonical event must have a confirmed booking before completion', code: 'plan_not_booked' },
      { status: 409 }
    )
  }
  if (/cancelled_event_cannot_complete/i.test(text)) {
    return NextResponse.json(
      { error: 'A cancelled event cannot be completed', code: 'event_cancelled' },
      { status: 409 }
    )
  }
  if (/idempotency_conflict/i.test(text) || error.code === '40001') {
    return NextResponse.json(
      { error: 'An outcome is already recorded with different evidence', code: 'outcome_conflict' },
      { status: 409 }
    )
  }
  if (/requires_|must_be_nonnegative_integer|must_be_string/i.test(text) || error.code === '22023') {
    return NextResponse.json({ error: 'Outcome evidence is invalid' }, { status: 400 })
  }

  console.error('[planner.outcome] RPC failed', error)
  return NextResponse.json({ error: 'Failed to record event outcome' }, { status: 500 })
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
