import type { SupabaseClient } from '@supabase/supabase-js'

export interface FinancialMetrics {
  tickets_sold: number
  gross_revenue: number
  total_fees: number
  total_refunds: number
  net_revenue: number
  average_ticket_price: number
  current_attendance: number
  projected_attendance: number
  projected_revenue: number
  venue_cost: number
  vendor_cost: number
  total_costs: number
  expected_profit: number
  profit_margin: number
  break_even_tickets: number
  venue_kickback_projection: number
  venue_sales_share_projection: number
  per_attendee_value: number
}

type SalesRow = {
  ticket_quantity: number | string | null
  total_amount: number | string | null
  total_amount_cents?: number | string | null
  fees: number | string | null
  fees_cents?: number | string | null
  is_refund: boolean | null
}

type BookingCostRow = {
  final_price?: number | string | null
  quoted_price?: number | string | null
}

const TYPICAL_SHOW_UP_RATE = 0.85

/**
 * Converts a database numeric value into a safe JavaScript number.
 *
 * @param value - Raw value returned by Supabase from numeric/integer columns.
 * @returns A finite number, or 0 when the source value is null/invalid.
 */
function toNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return 0
}

function centsToMoney(value: unknown) {
  return roundMoney(toNumber(value) / 100)
}

function readMoney(rowValue: unknown, rowValueCents: unknown) {
  if (rowValueCents !== null && rowValueCents !== undefined) return centsToMoney(rowValueCents)
  return toNumber(rowValue)
}

/**
 * Rounds currency-like values to two decimal places for persisted summaries.
 *
 * @param value - Unrounded numeric value.
 * @returns Number rounded to cents.
 */
function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

/**
 * Calculates the effective booking cost from local booking tables.
 *
 * @param booking - Venue or vendor booking row.
 * @returns Final price when available, otherwise quoted price, otherwise 0.
 */
function getBookingCost(booking: BookingCostRow) {
  return toNumber(booking.final_price ?? booking.quoted_price)
}

/**
 * Returns an empty metric object with known event costs and zero sales.
 *
 * @param venueCost - Total venue cost attached to the event.
 * @param vendorCost - Total vendor cost attached to the event.
 * @returns Financial metric object suitable for event_financial_summary.
 */
function createEmptyMetrics(venueCost = 0, vendorCost = 0): FinancialMetrics {
  const totalCosts = venueCost + vendorCost

  return {
    tickets_sold: 0,
    gross_revenue: 0,
    total_fees: 0,
    total_refunds: 0,
    net_revenue: 0,
    average_ticket_price: 0,
    current_attendance: 0,
    projected_attendance: 0,
    projected_revenue: 0,
    venue_cost: roundMoney(venueCost),
    vendor_cost: roundMoney(vendorCost),
    total_costs: roundMoney(totalCosts),
    expected_profit: roundMoney(-totalCosts),
    profit_margin: 0,
    break_even_tickets: 0,
    venue_kickback_projection: 0,
    venue_sales_share_projection: 0,
    per_attendee_value: 0,
  }
}

/**
 * Loads currently booked venue/vendor costs for an event.
 *
 * Venue and vendor tables in this app store `final_price` and `quoted_price`;
 * the financial model uses final price first and quoted price as the fallback.
 *
 * @param supabase - Supabase client with permission to read bookings.
 * @param eventId - Internal 3rdSpace event id.
 * @returns Venue cost, vendor cost, and total cost.
 */
async function loadEventCosts(supabase: SupabaseClient, eventId: string) {
  const [{ data: venueBookings, error: venueError }, { data: vendorBookings, error: vendorError }] =
    await Promise.all([
      supabase
        .from('venue_bookings')
        .select('final_price, quoted_price')
        .eq('event_id', eventId),
      supabase
        .from('vendor_bookings')
        .select('final_price, quoted_price')
        .eq('event_id', eventId),
    ])

  if (venueError) throw venueError
  if (vendorError) throw vendorError

  const venueCost = ((venueBookings as BookingCostRow[] | null) ?? []).reduce(
    (sum, booking) => sum + getBookingCost(booking),
    0
  )
  const vendorCost = ((vendorBookings as BookingCostRow[] | null) ?? []).reduce(
    (sum, booking) => sum + getBookingCost(booking),
    0
  )

  return {
    venueCost,
    vendorCost,
    totalCosts: venueCost + vendorCost,
  }
}

/**
 * Loads the per-head venue kickback rate configured for an event.
 *
 * Kickback projections are only projections during sales. Actual kickbacks are
 * calculated later by the database function from verified check-ins.
 *
 * @param supabase - Supabase client with permission to read kickback agreements.
 * @param eventId - Internal 3rdSpace event id.
 * @returns Per-attendee kickback amount, or 0 when no agreement exists.
 */
async function loadKickbackRate(supabase: SupabaseClient, eventId: string) {
  const { data, error } = await supabase
    .from('event_kickback_agreements')
    .select('per_head_amount')
    .eq('event_id', eventId)
    .maybeSingle()

  if (error) throw error
  return toNumber((data as { per_head_amount?: number | string | null } | null)?.per_head_amount)
}

/**
 * Loads a venue's ticket sales share setting for payout projections.
 *
 * @param supabase - Supabase client with permission to read venues.
 * @param venueId - Venue id attached to the event.
 * @returns Enabled flag and percentage of ticket sales payable to the venue.
 */
async function loadVenueTicketSalesShare(supabase: SupabaseClient, venueId: string | null) {
  if (!venueId) {
    return {
      enabled: false,
      percent: 0,
    }
  }

  const { data, error } = await supabase
    .from('venues')
    .select('ticket_sales_share_enabled, ticket_sales_share_percent')
    .eq('id', venueId)
    .maybeSingle()

  if (error) throw error

  const venue = data as {
    ticket_sales_share_enabled?: boolean | null
    ticket_sales_share_percent?: number | string | null
  } | null

  return {
    enabled: Boolean(venue?.ticket_sales_share_enabled),
    percent: toNumber(venue?.ticket_sales_share_percent),
  }
}

/**
 * Persists the current financial metrics into the cached summary table.
 *
 * @param supabase - Supabase client with write access to event_financial_summary.
 * @param eventId - Internal 3rdSpace event id.
 * @param metrics - Calculated financial metrics.
 * @returns The same metrics after a successful upsert.
 */
async function saveFinancialSummary(
  supabase: SupabaseClient,
  eventId: string,
  metrics: FinancialMetrics
) {
  const { error } = await supabase
    .from('event_financial_summary')
    .upsert(
      {
        event_id: eventId,
        ...metrics,
        calculated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: 'event_id' }
    )

  if (error) throw error
  return metrics
}

/**
 * Recalculates all event financial metrics from current sales and booking data.
 *
 * Business rules:
 * - Gross revenue includes non-refund sales only.
 * - Total refunds is the absolute value of refund rows.
 * - Net revenue is gross revenue minus refunds and platform fees.
 * - Current attendance is tickets sold, not verified attendance.
 * - Projected attendance uses an 85% show-up assumption.
 * - Venue kickback projection uses projected attendance, but actual kickback
 *   is only paid later from verified CSV check-ins.
 *
 * @param supabase - Supabase client with access to sales, bookings, events, and summaries.
 * @param eventId - Internal 3rdSpace event id.
 * @returns Calculated and persisted financial metrics.
 */
export async function recalculateEventFinancials(
  supabase: SupabaseClient,
  eventId: string
): Promise<FinancialMetrics> {
  console.log('[Financials] Recalculating event metrics', { eventId })

  const [
    { data: salesData, error: salesError },
    { data: event, error: eventError },
    costs,
    kickbackRate,
  ] = await Promise.all([
    supabase
      .from('event_sales_data')
      .select('ticket_quantity, total_amount, total_amount_cents, fees, fees_cents, is_refund')
      .eq('event_id', eventId),
    supabase
      .from('events')
      .select('expected_attendance, venue_id')
      .eq('id', eventId)
      .maybeSingle(),
    loadEventCosts(supabase, eventId),
    loadKickbackRate(supabase, eventId),
  ])

  if (salesError) throw salesError
  if (eventError) throw eventError

  const rows = ((salesData as SalesRow[] | null) ?? [])

  if (rows.length === 0) {
    const emptyMetrics = createEmptyMetrics(costs.venueCost, costs.vendorCost)
    await saveFinancialSummary(supabase, eventId, emptyMetrics)
    console.log('[Financials] No sales yet, saved empty summary', { eventId, emptyMetrics })
    return emptyMetrics
  }

  const ticketsSold = rows.reduce((sum, sale) => sum + toNumber(sale.ticket_quantity), 0)
  const paidTicketsSold = rows
    .filter((sale) => !sale.is_refund)
    .reduce((sum, sale) => sum + Math.max(toNumber(sale.ticket_quantity), 0), 0)
  const grossRevenue = rows
    .filter((sale) => !sale.is_refund)
    .reduce((sum, sale) => sum + readMoney(sale.total_amount, sale.total_amount_cents), 0)
  const totalFees = rows
    .filter((sale) => !sale.is_refund)
    .reduce((sum, sale) => sum + readMoney(sale.fees, sale.fees_cents), 0)
  const totalRefunds = rows
    .filter((sale) => sale.is_refund)
    .reduce((sum, sale) => sum + Math.abs(readMoney(sale.total_amount, sale.total_amount_cents)), 0)
  const netRevenue = grossRevenue - totalRefunds - totalFees
  const averageTicketPrice = paidTicketsSold > 0 ? grossRevenue / paidTicketsSold : 0
  const currentAttendance = Math.max(ticketsSold, 0)
  const expectedAttendees = toNumber(
    (event as { expected_attendance?: number | null; venue_id?: string | null } | null)
      ?.expected_attendance
  )
  const venueId = (event as { venue_id?: string | null } | null)?.venue_id ?? null
  const venueTicketSalesShare = await loadVenueTicketSalesShare(supabase, venueId)
  const projectedAttendance = Math.max(Math.floor(currentAttendance * TYPICAL_SHOW_UP_RATE), 0)
  const remainingCapacity = Math.max(expectedAttendees - currentAttendance, 0)
  const projectedRevenue = netRevenue + remainingCapacity * averageTicketPrice
  const expectedProfit = netRevenue - costs.totalCosts
  const profitMargin = netRevenue > 0 ? (expectedProfit / netRevenue) * 100 : 0
  const breakEvenTickets = averageTicketPrice > 0 ? Math.ceil(costs.totalCosts / averageTicketPrice) : 0
  const venueSalesShareProjection = venueTicketSalesShare.enabled
    ? projectedRevenue * (venueTicketSalesShare.percent / 100)
    : 0
  const venueKickbackProjection = projectedAttendance * kickbackRate + venueSalesShareProjection
  const perAttendeeValue = currentAttendance > 0 ? netRevenue / currentAttendance : 0

  const metrics: FinancialMetrics = {
    tickets_sold: currentAttendance,
    gross_revenue: roundMoney(grossRevenue),
    total_fees: roundMoney(totalFees),
    total_refunds: roundMoney(totalRefunds),
    net_revenue: roundMoney(netRevenue),
    average_ticket_price: roundMoney(averageTicketPrice),
    current_attendance: currentAttendance,
    projected_attendance: projectedAttendance,
    projected_revenue: roundMoney(projectedRevenue),
    venue_cost: roundMoney(costs.venueCost),
    vendor_cost: roundMoney(costs.vendorCost),
    total_costs: roundMoney(costs.totalCosts),
    expected_profit: roundMoney(expectedProfit),
    profit_margin: roundMoney(profitMargin),
    break_even_tickets: breakEvenTickets,
    venue_kickback_projection: roundMoney(venueKickbackProjection),
    venue_sales_share_projection: roundMoney(venueSalesShareProjection),
    per_attendee_value: roundMoney(perAttendeeValue),
  }

  await saveFinancialSummary(supabase, eventId, metrics)
  console.log('[Financials] Saved event metrics', { eventId, metrics })
  return metrics
}
