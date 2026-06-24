export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import {
  buildTicketTierRollups,
  classifyTicketTier,
  type NormalizedTicketSaleRow,
  type TicketTierCategory,
} from '@/lib/server/ticket-normalization'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

type TicketSalesRow = {
  platform: string | null
  ticket_tier_category: string | null
  ticket_tier_name: string | null
  ticket_type: string | null
  ticket_quantity: number | null
  total_amount: number | string | null
  total_amount_cents: number | null
  fees: number | string | null
  fees_cents: number | null
  currency: string | null
  is_refund: boolean | null
}

/**
 * Returns provider-normalized ticket sales analytics for the authenticated builder.
 *
 * The endpoint intentionally returns tier/category rollups rather than raw buyer
 * rows so planner UI can show Early Bird vs GA vs VIP performance without
 * exposing attendee PII in this surface.
 */
export async function GET(request: NextRequest) {
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
    .select('id, event_name')
    .eq('builder_id', builderProfileId)
    .order('event_date', { ascending: false })
    .limit(100)

  if (eventsError) {
    console.error('[planner.ticketing.analytics] Failed to load events', eventsError)
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 })
  }

  const ownedEvents = ((events ?? []) as Array<{ id: string; event_name?: string | null }>).filter(Boolean)
  const ownedEventIds = new Set(ownedEvents.map((event) => event.id))
  const eventIds = requestedEventId ? [requestedEventId].filter((id) => ownedEventIds.has(id)) : [...ownedEventIds]

  if (requestedEventId && eventIds.length === 0) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  }

  if (eventIds.length === 0) {
    return NextResponse.json({
      summary: emptySummary(),
      rollups: [],
      events: [],
    })
  }

  const { data: salesRows, error: salesError } = await supabase
    .from('event_sales_data')
    .select(
      [
        'platform',
        'ticket_tier_category',
        'ticket_tier_name',
        'ticket_type',
        'ticket_quantity',
        'total_amount',
        'total_amount_cents',
        'fees',
        'fees_cents',
        'currency',
        'is_refund',
      ].join(', ')
    )
    .in('event_id', eventIds)
    .order('purchase_timestamp', { ascending: true })

  if (salesError) {
    console.error('[planner.ticketing.analytics] Failed to load sales rows', salesError)
    return NextResponse.json({ error: 'Failed to load ticketing analytics' }, { status: 500 })
  }

  const normalizedRows = ((salesRows ?? []) as TicketSalesRow[]).map(normalizeSalesRow)
  const rollups = buildTicketTierRollups(normalizedRows)
  const summary = summarizeRollups(rollups)

  return NextResponse.json({
    summary,
    rollups,
    events: ownedEvents.filter((event) => eventIds.includes(event.id)),
  })
}

function normalizeSalesRow(row: TicketSalesRow): NormalizedTicketSaleRow {
  const tierName = row.ticket_tier_name ?? row.ticket_type ?? 'Unknown'
  const totalAmountCents = row.total_amount_cents ?? toCents(row.total_amount)
  const feesCents = row.fees_cents ?? toCents(row.fees)

  return {
    platform: row.platform ?? 'unknown',
    ticket_tier_category: normalizeTierCategory(row.ticket_tier_category) ?? classifyTicketTier(tierName),
    ticket_tier_name: tierName,
    ticket_quantity: row.ticket_quantity ?? 0,
    total_amount_cents: totalAmountCents,
    fees_cents: feesCents,
    currency: row.currency ?? 'usd',
    is_refund: row.is_refund,
  }
}

function normalizeTierCategory(value: string | null): TicketTierCategory | null {
  if (value === 'general_admission') return 'ga'
  if (value === 'waitlist') return 'promo'
  if (value === 'other' || value === 'unknown') return 'ga'

  if (
    value === 'early_bird' ||
    value === 'ga' ||
    value === 'vip' ||
    value === 'comp' ||
    value === 'promo' ||
    value === 'donation' ||
    value === 'add_on'
  ) {
    return value
  }

  return null
}

function summarizeRollups(rollups: ReturnType<typeof buildTicketTierRollups>) {
  return rollups.reduce(
    (summary, rollup) => ({
      tickets_sold: summary.tickets_sold + rollup.tickets_sold,
      tickets_refunded: summary.tickets_refunded + rollup.tickets_refunded,
      gross_revenue_cents: summary.gross_revenue_cents + rollup.gross_revenue_cents,
      refund_amount_cents: summary.refund_amount_cents + rollup.refund_amount_cents,
      fees_cents: summary.fees_cents + rollup.fees_cents,
      net_revenue_cents: summary.net_revenue_cents + rollup.net_revenue_cents,
      average_ticket_price_cents:
        summary.tickets_sold + rollup.tickets_sold > 0
          ? Math.round((summary.gross_revenue_cents + rollup.gross_revenue_cents) / (summary.tickets_sold + rollup.tickets_sold))
          : 0,
    }),
    emptySummary()
  )
}

function emptySummary() {
  return {
    tickets_sold: 0,
    tickets_refunded: 0,
    gross_revenue_cents: 0,
    refund_amount_cents: 0,
    fees_cents: 0,
    net_revenue_cents: 0,
    average_ticket_price_cents: 0,
  }
}

function toCents(value: number | string | null) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100)
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Math.round(Number(value) * 100)
  return 0
}
