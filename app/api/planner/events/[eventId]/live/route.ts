export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { computeEventPnL } from '@/lib/finance/eventActuals'
import {
  buildRevenueTermBasisFromActuals,
  listRevenueTerms,
  summarizeRevenueTermImpacts,
} from '@/lib/finance/revenueTerms'
import { enqueueJob } from '@/lib/server/job-queue'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

const paramsSchema = z.object({
  eventId: z.string().uuid(),
})

const recommendationStateSchema = z.enum(['open', 'acknowledged', 'dismissed', 'acted_on'])

const patchSchema = z.object({
  recommendation_id: z.string().uuid().optional(),
  id: z.string().uuid().optional(),
  state: recommendationStateSchema,
}).refine((body) => body.recommendation_id || body.id, {
  message: 'Recommendation id is required',
})

type PlannerDb = { from: (table: string) => any }

type EventAccess =
  | {
      db: PlannerDb
      admin: PlannerDb
      builderProfileId: string
      event: EventRow
    }
  | { response: NextResponse<{ error: string }> }

type EventRow = {
  id: string
  builder_id: string
  event_name: string | null
  event_type: string | null
  event_date: string | null
  expected_attendance: number | string | null
  expected_attendance_min?: number | string | null
  expected_attendance_max: number | string | null
  status: string | null
}

type SalesVelocityRow = {
  gross_cents?: number | string | null
  total_amount_cents?: number | string | null
  total_amount?: number | string | null
  is_refund?: boolean | null
  purchase_timestamp?: string | null
  received_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

const HOUR_MS = 60 * 60 * 1000
const VELOCITY_BUCKETS = 24 * 7

export async function GET(
  _request: NextRequest,
  context: { params: { eventId: string } }
) {
  try {
    const access = await resolveEventAccess(context.params)
    if ('response' in access) return access.response

    const [pnl, recommendations, velocity_points, connectionSummary, terms] = await Promise.all([
      computeEventPnL(access.admin, access.event.id),
      loadRecommendations(access.admin, access.event.id),
      loadVelocityPoints(access.admin, access.event.id),
      loadTicketingConnectionSummary(access.admin, access.builderProfileId),
      listRevenueTerms(access.admin, access.event.id),
    ])
    const termBasis = buildRevenueTermBasisFromActuals(pnl.revenue)
    const termSummary = summarizeRevenueTermImpacts(terms, termBasis)
    const activeTickets = Math.max(pnl.revenue.tickets_sold - pnl.revenue.tickets_refunded, 0)
    const capacity =
      readInteger(access.event.expected_attendance) ??
      readInteger(access.event.expected_attendance_max) ??
      readInteger(access.event.expected_attendance_min)
    const breakevenPct = pnl.breakeven.tickets_needed > 0
      ? clampPercent(activeTickets / pnl.breakeven.tickets_needed)
      : pnl.breakeven.crossed_at
        ? 1
        : 0
    const hasRecentCsv = pnl.revenue.data_sources.includes('csv_import') &&
      isRecent(pnl.revenue.last_event_at, 30)

    return NextResponse.json({
      snapshot: {
        event: {
          id: access.event.id,
          name: access.event.event_name ?? 'Untitled event',
          status: access.event.status,
          event_date: access.event.event_date,
          capacity,
        },
        pnl,
        kpis: {
          active_tickets: activeTickets,
          capacity,
          net_revenue_cents: pnl.revenue.net_revenue_cents,
          breakeven_progress_pct: breakevenPct,
        },
        velocity_points,
        costs: {
          ...pnl.costs,
          total_expected_cents: pnl.costs.paid_cents + pnl.costs.committed_cents + pnl.costs.estimated_cents,
        },
        revenue_terms: {
          terms,
          impacts: termSummary.impacts,
          summary: termSummary,
        },
        recommendations,
        freshness: {
          data_sources: pnl.revenue.data_sources,
          last_event_at: pnl.revenue.last_event_at,
          has_connected_source: connectionSummary.has_connected_source,
          connected_platforms: connectionSummary.connected_platforms,
          has_recent_csv: hasRecentCsv,
        },
        empty_state: {
          show: !connectionSummary.has_connected_source && !hasRecentCsv && pnl.revenue.tickets_sold === 0,
          reason: 'No live ticketing source or recent import is attached to this event yet.',
        },
      },
    })
  } catch (error) {
    console.error('[planner.event.live] Failed to load live snapshot', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load live event snapshot' },
      { status: 500 }
    )
  }
}

export async function POST(
  _request: NextRequest,
  context: { params: { eventId: string } }
) {
  try {
    const access = await resolveEventAccess(context.params)
    if ('response' in access) return access.response

    const job = await enqueueJob(access.admin, {
      jobType: 'live_event.recompute',
      payload: { eventId: access.event.id },
      uniqueKey: `live-event-recompute:${access.event.id}`,
      scheduledAt: new Date(Date.now() + 5_000).toISOString(),
      maxAttempts: 3,
    })

    return NextResponse.json({
      enqueued: true,
      job: {
        id: job.id,
        status: job.status,
        unique_key: job.unique_key,
      },
    })
  } catch (error) {
    console.error('[planner.event.live] Failed to enqueue live recompute', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to enqueue live recompute' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: { eventId: string } }
) {
  try {
    const access = await resolveEventAccess(context.params)
    if ('response' in access) return access.response

    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid recommendation update' }, { status: 400 })
    }

    const recommendationId = parsed.data.recommendation_id ?? parsed.data.id
    const { data, error } = await access.admin
      .from('live_recommendations')
      .update({ state: parsed.data.state })
      .eq('id', recommendationId)
      .eq('event_id', access.event.id)
      .eq('org_id', access.builderProfileId)
      .select('*')
      .maybeSingle()

    if (error) throw new Error(error.message ?? 'Failed to update live recommendation')
    if (!data) {
      return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 })
    }

    return NextResponse.json({ recommendation: data })
  } catch (error) {
    console.error('[planner.event.live] Failed to update live recommendation', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update live recommendation' },
      { status: 500 }
    )
  }
}

async function resolveEventAccess(params: { eventId: string }): Promise<EventAccess> {
  const parsedParams = paramsSchema.safeParse(params)
  if (!parsedParams.success) {
    return { response: NextResponse.json({ error: 'Invalid event id' }, { status: 400 }) }
  }

  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  const { builderProfileId, error: builderError } = await getBuilderProfileId(supabase, user.id)
  if (builderError || !builderProfileId) {
    return { response: NextResponse.json({ error: 'Builder profile not found' }, { status: 404 }) }
  }

  const db = supabase as unknown as PlannerDb
  const { data: event, error: eventError } = await db
    .from('events')
    .select([
      'id',
      'builder_id',
      'event_name',
      'event_type',
      'event_date',
      'expected_attendance',
      'expected_attendance_min',
      'expected_attendance_max',
      'status',
    ].join(', '))
    .eq('id', parsedParams.data.eventId)
    .eq('builder_id', builderProfileId)
    .maybeSingle()

  if (eventError) throw new Error(eventError.message ?? 'Failed to verify event access')
  if (!event) {
    return { response: NextResponse.json({ error: 'Event not found' }, { status: 404 }) }
  }

  return {
    db,
    admin: createServiceRoleClient() as unknown as PlannerDb,
    builderProfileId,
    event: event as EventRow,
  }
}

async function loadRecommendations(admin: PlannerDb, eventId: string) {
  const { data, error } = await admin
    .from('live_recommendations')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message ?? 'Failed to load live recommendations')
  return data ?? []
}

async function loadVelocityPoints(admin: PlannerDb, eventId: string) {
  const end = new Date()
  end.setMinutes(0, 0, 0)
  const start = new Date(end.getTime() - (VELOCITY_BUCKETS - 1) * HOUR_MS)
  const buckets = Array.from({ length: VELOCITY_BUCKETS }, (_, index) => ({
    bucket_start: new Date(start.getTime() + index * HOUR_MS).toISOString(),
    gross_cents: 0,
    orders: 0,
  }))

  const { data, error } = await admin
    .from('event_sales_data')
    .select([
      'gross_cents',
      'total_amount_cents',
      'total_amount',
      'is_refund',
      'purchase_timestamp',
      'received_at',
      'created_at',
      'updated_at',
    ].join(', '))
    .eq('event_id', eventId)
    .limit(5000)

  if (error) throw new Error(error.message ?? 'Failed to load live velocity rows')

  for (const row of ((data ?? []) as SalesVelocityRow[])) {
    const at = firstIsoDate([
      row.purchase_timestamp,
      row.received_at,
      row.updated_at,
      row.created_at,
    ])
    if (!at) continue
    const bucketTime = new Date(at)
    bucketTime.setMinutes(0, 0, 0)
    const index = Math.floor((bucketTime.getTime() - start.getTime()) / HOUR_MS)
    if (index < 0 || index >= buckets.length) continue

    const cents = readSalesCents(row)
    buckets[index]!.gross_cents += row.is_refund ? -Math.abs(cents) : Math.max(cents, 0)
    buckets[index]!.orders += 1
  }

  return buckets
}

async function loadTicketingConnectionSummary(admin: PlannerDb, builderProfileId: string) {
  const { data, error } = await admin
    .from('builder_ticketing_connections')
    .select('platform, status')
    .eq('builder_id', builderProfileId)
    .in('status', ['pending', 'connected'])

  if (error) throw new Error(error.message ?? 'Failed to load ticketing connections')
  const rows = (data ?? []) as Array<{ platform: string; status: string }>
  return {
    has_connected_source: rows.some((row) => row.status === 'connected' || row.status === 'pending'),
    connected_platforms: rows.map((row) => row.platform),
  }
}

function readSalesCents(row: SalesVelocityRow) {
  return readInteger(row.gross_cents) ??
    readInteger(row.total_amount_cents) ??
    moneyToCents(row.total_amount) ??
    0
}

function readInteger(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function moneyToCents(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100)
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[$,\s]/g, ''))
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : null
  }
  return null
}

function firstIsoDate(values: Array<string | null | undefined>) {
  for (const value of values) {
    if (!value) continue
    const parsed = new Date(value)
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString()
  }
  return null
}

function isRecent(value: string | null, days: number) {
  if (!value) return false
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return false
  return Date.now() - parsed.getTime() <= days * 24 * HOUR_MS
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(value, 1))
}
