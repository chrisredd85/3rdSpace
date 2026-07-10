export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { resolveCanonicalEventTaxonomy } from '@/lib/planner/eventIdentity'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { mapDbEventToApp } from '@/lib/supabase/server-helpers'
import type { Plan } from '@/lib/types'

const DEFAULT_EVENT_TIME_ZONE = 'America/Los_Angeles'
const planIdSchema = z.string().uuid()
const eventDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate, 'Invalid calendar date')
const startTimeSchema = z.string().regex(/^\d{2}:\d{2}$/).refine(isClockTime, 'Invalid start time')
const timeZoneSchema = z.string().trim().min(1).max(100).refine(isIanaTimeZone, 'Invalid IANA timezone')

const materializePlanSchema = z.object({
  eventDate: eventDateSchema,
  startTime: startTimeSchema,
  durationMinutes: z.number().int().min(1).max(24 * 60),
  timeZone: timeZoneSchema.default(DEFAULT_EVENT_TIME_ZONE),
}).strict()

type PlannerDb = {
  from: (table: string) => any
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown
    error: { code?: string; message?: string; details?: string; hint?: string } | null
  }>
}

interface RouteContext {
  params: Promise<{ planId: string }>
}

type MaterializationRow = {
  event_id?: string
  existing?: boolean
  event_record?: Record<string, unknown>
  plan_status?: string
}

/**
 * Explicitly turns a planner plan into its one canonical events row.
 * Ownership is proved with the session client before the service-only RPC is
 * reachable; the RPC owns the cross-table transaction and idempotency.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await getCreatorAuth()
    if ('response' in auth) return auth.response

    const planIdResult = planIdSchema.safeParse((await context.params).planId)
    if (!planIdResult.success) {
      return NextResponse.json({ error: 'Invalid plan id' }, { status: 400 })
    }

    const body = materializePlanSchema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json(
        { error: 'Invalid materialization schedule', details: body.error.flatten() },
        { status: 400 }
      )
    }

    const plan = await loadOwnedPlan(auth.db, planIdResult.data, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const taxonomy = resolveCanonicalEventTaxonomy(plan.event_type)
    if (!taxonomy) {
      return NextResponse.json(
        { error: 'Plan event type is not a supported planner archetype', code: 'plan_archetype_unresolved' },
        { status: 422 }
      )
    }

    if (!isDateInsidePlanWindow(body.data.eventDate, plan)) {
      return NextResponse.json(
        { error: 'Event date must be inside the plan date window', code: 'plan_event_date_outside_window' },
        { status: 409 }
      )
    }

    const writeDb = createServiceRoleClient() as unknown as PlannerDb
    if (!writeDb.rpc) {
      return NextResponse.json({ error: 'Event materialization is unavailable' }, { status: 500 })
    }

    // This transition establishes lineage only. It does not create or
    // authorize a booking, payment, transaction, or outbound message.
    const { data, error } = await writeDb.rpc('materialize_plan_event', {
      p_plan_id: plan.id,
      p_actor_id: auth.userId,
      p_archetype_key: taxonomy.archetypeKey,
      p_event_date: body.data.eventDate,
      p_start_time: body.data.startTime,
      p_duration_minutes: body.data.durationMinutes,
      p_time_zone: body.data.timeZone,
    })

    if (error) return mapMaterializationError(error)

    const materialized = readMaterializationRow(data)
    if (!materialized?.event_id || !materialized.event_record) {
      return NextResponse.json({ error: 'Event materialization returned no event' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      plan_id: plan.id,
      event_id: materialized.event_id,
      event: mapDbEventToApp(materialized.event_record),
      plan_status: materialized.plan_status ?? null,
      existing: Boolean(materialized.existing),
    })
  } catch (error) {
    console.error('[planner.materialize] Unexpected materialization error', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
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

async function loadOwnedPlan(db: PlannerDb, planId: string, userId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Plan lookup failed')
  return data as Plan | null
}

function mapMaterializationError(error: { code?: string; message?: string; details?: string; hint?: string }) {
  const text = [error.message, error.details, error.hint].filter(Boolean).join(' ')
  if (/plan_materialization_(?:status_)?ineligible|plan_status_transition_invalid/i.test(text)) {
    return NextResponse.json(
      { error: 'Plan is not eligible for event materialization', code: 'plan_materialization_ineligible' },
      { status: 409 }
    )
  }
  if (/plan_event_date_outside_window/i.test(text)) {
    return NextResponse.json(
      { error: 'Event date must be inside the plan date window', code: 'plan_event_date_outside_window' },
      { status: 409 }
    )
  }
  if (error.code === '23505' || /plan_event_identity_conflict|already_materialized/i.test(text)) {
    return NextResponse.json(
      { error: 'Plan already has a different canonical event', code: 'plan_event_identity_conflict' },
      { status: 409 }
    )
  }
  if (error.code === 'P0002' || /plan_materialization_plan_not_found/i.test(text)) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }
  if (/plan_materialization_(?:archetype|schedule)_invalid/i.test(text)) {
    return NextResponse.json({ error: 'Plan event taxonomy or schedule is invalid' }, { status: 422 })
  }

  console.error('[planner.materialize] RPC failed', error)
  return NextResponse.json({ error: 'Failed to materialize event' }, { status: 500 })
}

function readMaterializationRow(data: unknown): MaterializationRow | null {
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  return row as MaterializationRow
}

function isDateInsidePlanWindow(eventDate: string, plan: Plan) {
  if (plan.date_window_start && eventDate < plan.date_window_start) return false
  if (plan.date_window_end && eventDate > plan.date_window_end) return false
  return true
}

function isCalendarDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isClockTime(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return Number.isInteger(hours) && Number.isInteger(minutes) && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
}

function isIanaTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}
