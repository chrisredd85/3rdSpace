export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

type SalesRow = {
  ticket_quantity: number | null
  total_amount_cents: number | null
  total_amount: number | string | null
  ticket_price_cents: number | null
  ticket_tier_name?: string | null
  ticket_type?: string | null
  is_refund: boolean | null
  purchase_timestamp: string | null
}

type AttendeeRow = {
  checked_in: boolean | null
  check_in_time: string | null
}

/**
 * Returns deterministic post-event attendance and sales rollups.
 *
 * AI should not process raw attendance rows. This route computes actual
 * RSVP/check-in/sales metrics from imported_attendees and event_sales_data, then
 * the UI can ask a lightweight agent to explain setup gaps if needed.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    if (user.user_metadata?.user_type !== 'community_builder') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { builderProfileId, error: builderError } = await getBuilderProfileId(supabase, user.id)
    if (builderError || !builderProfileId) {
      return NextResponse.json({ error: 'Builder profile not found' }, { status: 403 })
    }

    const requestedEventId = request.nextUrl.searchParams.get('eventId')
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, event_name, event_date')
      .eq('builder_id', builderProfileId)
      .order('event_date', { ascending: false })
      .limit(50)

    if (eventsError) {
      console.error('[planner.post-event.report] Failed to load events', eventsError)
      return NextResponse.json({ error: 'Failed to load events' }, { status: 500 })
    }

    const ownedEvents = ((events ?? []) as Array<{ id: string; event_name?: string | null; event_date?: string | null }>).filter(Boolean)
    const ownedEventIds = new Set(ownedEvents.map((event) => event.id))
    const eventIds = requestedEventId ? [requestedEventId].filter((id) => ownedEventIds.has(id)) : [...ownedEventIds]

    if (requestedEventId && eventIds.length === 0) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    if (eventIds.length === 0) {
      return NextResponse.json(buildEmptyReport([]))
    }

    const [attendeesResult, salesResult] = await Promise.all([
      supabase
        .from('imported_attendees')
        .select('checked_in, check_in_time')
        .in('event_id', eventIds)
        .limit(10000),
      supabase
        .from('event_sales_data')
        .select('ticket_quantity, total_amount_cents, total_amount, ticket_price_cents, ticket_tier_name, ticket_type, is_refund, purchase_timestamp')
        .in('event_id', eventIds)
        .order('purchase_timestamp', { ascending: true })
        .limit(10000),
    ])

    if (attendeesResult.error) {
      console.error('[planner.post-event.report] Failed to load attendees', attendeesResult.error)
      return NextResponse.json({ error: 'Failed to load attendee check-ins' }, { status: 500 })
    }

    if (salesResult.error) {
      console.error('[planner.post-event.report] Failed to load sales rows', salesResult.error)
      return NextResponse.json({ error: 'Failed to load ticket sales' }, { status: 500 })
    }

    const attendees = (attendeesResult.data ?? []) as AttendeeRow[]
    const salesRows = (salesResult.data ?? []) as SalesRow[]
    return NextResponse.json(buildReport({
      events: ownedEvents.filter((event) => eventIds.includes(event.id)),
      attendees,
      salesRows,
    }))
  } catch (error) {
    console.error('[planner.post-event.report] Unexpected error', error)
    return NextResponse.json({ error: 'Unable to load post-event report' }, { status: 500 })
  }
}

function buildEmptyReport(events: Array<{ id: string; event_name?: string | null; event_date?: string | null }>) {
  return {
    summary: {
      events_count: events.length,
      rsvps_or_imported_attendees: 0,
      checked_in: 0,
      no_show_rate: null,
      tickets_sold: 0,
      tickets_refunded: 0,
      gross_revenue_cents: 0,
      refund_amount_cents: 0,
      net_revenue_cents: 0,
      average_ticket_price_cents: 0,
      peak_arrival_hour: null,
      venue_foot_traffic_proxy: 0,
      source_confidence: 'no_data',
    },
    arrival_buckets: [],
    tier_velocity: [],
    events: events.slice(0, 5),
    post_event_questions: defaultPostEventQuestions(),
  }
}

function buildReport(input: {
  events: Array<{ id: string; event_name?: string | null; event_date?: string | null }>
  attendees: AttendeeRow[]
  salesRows: SalesRow[]
}) {
  const checkedIn = input.attendees.filter((attendee) => attendee.checked_in === true).length
  const attendeeCount = input.attendees.length
  const salesSummary = input.salesRows.reduce(
    (summary, row) => {
      const rawQuantity = row.ticket_quantity ?? 0
      const quantity = Math.abs(rawQuantity) || (row.is_refund ? 1 : 0)
      const amount = row.total_amount_cents ?? toCents(row.total_amount)
      if (row.is_refund) {
        return {
          ...summary,
          tickets_refunded: summary.tickets_refunded + Math.abs(quantity),
          refund_amount_cents: summary.refund_amount_cents + Math.abs(amount),
        }
      }

      return {
        tickets_sold: summary.tickets_sold + quantity,
        tickets_refunded: summary.tickets_refunded,
        gross_revenue_cents: summary.gross_revenue_cents + Math.max(0, amount),
        refund_amount_cents: summary.refund_amount_cents,
      }
    },
    { tickets_sold: 0, tickets_refunded: 0, gross_revenue_cents: 0, refund_amount_cents: 0 }
  )
  const arrivalBuckets = buildArrivalBuckets(input.attendees)
  const tierVelocity = buildTierVelocity(input.salesRows)
  const peakBucket = arrivalBuckets.reduce<typeof arrivalBuckets[number] | null>(
    (current, bucket) => (!current || bucket.count > current.count ? bucket : current),
    null
  )
  const denominator = Math.max(attendeeCount, salesSummary.tickets_sold)
  const hasAttendance = attendeeCount > 0 || salesSummary.tickets_sold > 0
  const netRevenueCents = salesSummary.gross_revenue_cents - salesSummary.refund_amount_cents
  // Proxy is intentionally conservative: prefer real check-ins, then imported attendee rows, then net sold tickets.
  const venueFootTrafficProxy = checkedIn || attendeeCount || Math.max(0, salesSummary.tickets_sold - salesSummary.tickets_refunded)

  return {
    summary: {
      events_count: input.events.length,
      rsvps_or_imported_attendees: attendeeCount,
      checked_in: checkedIn,
      no_show_rate: attendeeCount > 0 ? Number(((attendeeCount - checkedIn) / attendeeCount).toFixed(3)) : null,
      tickets_sold: salesSummary.tickets_sold,
      tickets_refunded: salesSummary.tickets_refunded,
      gross_revenue_cents: salesSummary.gross_revenue_cents,
      refund_amount_cents: salesSummary.refund_amount_cents,
      net_revenue_cents: netRevenueCents,
      average_ticket_price_cents:
        salesSummary.tickets_sold > 0
          ? Math.round(salesSummary.gross_revenue_cents / salesSummary.tickets_sold)
          : 0,
      peak_arrival_hour: peakBucket?.label ?? null,
      venue_foot_traffic_proxy: venueFootTrafficProxy,
      source_confidence:
        checkedIn > 0 && salesSummary.tickets_sold > 0
          ? 'imported_checkins_and_sales'
          : hasAttendance
            ? 'partial'
            : 'no_data',
      attendance_coverage:
        denominator > 0 ? Number((checkedIn / denominator).toFixed(3)) : null,
    },
    arrival_buckets: arrivalBuckets,
    tier_velocity: tierVelocity,
    events: input.events.slice(0, 5),
    post_event_questions: defaultPostEventQuestions(),
  }
}

function buildArrivalBuckets(attendees: AttendeeRow[]) {
  const counts = new Map<string, number>()
  attendees.forEach((attendee) => {
    if (!attendee.checked_in || !attendee.check_in_time) return
    const date = new Date(attendee.check_in_time)
    if (Number.isNaN(date.getTime())) return
    const hour = date.getHours()
    const label = `${String(hour).padStart(2, '0')}:00`
    counts.set(label, (counts.get(label) ?? 0) + 1)
  })

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((first, second) => first.label.localeCompare(second.label))
}

function buildTierVelocity(rows: SalesRow[]) {
  const grouped = new Map<string, {
    tier_name: string
    ticket_price_cents: number | null
    tickets_sold: number
    tickets_refunded: number
    gross_revenue_cents: number
    first_purchase_at: string | null
    last_purchase_at: string | null
  }>()

  rows.forEach((row) => {
    const tierName = row.ticket_tier_name ?? row.ticket_type ?? 'Unknown'
    const price = row.ticket_price_cents ?? null
    const key = `${tierName}:${price ?? 'unknown'}`
    const current = grouped.get(key) ?? {
      tier_name: tierName,
      ticket_price_cents: price,
      tickets_sold: 0,
      tickets_refunded: 0,
      gross_revenue_cents: 0,
      first_purchase_at: null,
      last_purchase_at: null,
    }
    const quantity = Math.abs(row.ticket_quantity ?? 0) || (row.is_refund ? 1 : 0)
    const amount = row.total_amount_cents ?? toCents(row.total_amount)

    if (row.is_refund) {
      current.tickets_refunded += quantity
    } else {
      current.tickets_sold += quantity
      current.gross_revenue_cents += Math.max(0, amount)
    }

    if (row.purchase_timestamp) {
      current.first_purchase_at =
        !current.first_purchase_at || row.purchase_timestamp < current.first_purchase_at
          ? row.purchase_timestamp
          : current.first_purchase_at
      current.last_purchase_at =
        !current.last_purchase_at || row.purchase_timestamp > current.last_purchase_at
          ? row.purchase_timestamp
          : current.last_purchase_at
    }

    grouped.set(key, current)
  })

  return [...grouped.values()].sort((first, second) => {
    const firstPrice = first.ticket_price_cents ?? Number.MAX_SAFE_INTEGER
    const secondPrice = second.ticket_price_cents ?? Number.MAX_SAFE_INTEGER
    return firstPrice - secondPrice || first.tier_name.localeCompare(second.tier_name)
  })
}

function defaultPostEventQuestions() {
  return [
    'How many walk-ins did the venue or door team observe?',
    'What was the peak room count and approximate peak time?',
    'What were bar, cafe, or food sales during the event window?',
    'Did the room feel empty, right-sized, or overcrowded?',
    'Were there weather, transit, line, or check-in issues that changed turnout?',
  ]
}

function toCents(value: number | string | null) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100)
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Math.round(Number(value) * 100)
  return 0
}
