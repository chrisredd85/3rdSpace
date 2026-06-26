export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { jsonWithDeprecatedKeys } from '@/lib/api/legacy-key-compat'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { recalculateEventFinancials } from '@/lib/finance/calculate-event-financials'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

/**
 * Verifies that the authenticated user owns the requested event.
 *
 * @param eventId - Internal 3rdPlace event id.
 * @returns HTTP response on failure, otherwise null.
 */
async function verifyBuilderEventAccess(eventId: string) {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { builderProfileId, error: builderError } = await getBuilderProfileId(supabase, user.id)

  if (builderError || !builderProfileId) {
    return NextResponse.json({ error: 'Builder profile not found' }, { status: 403 })
  }

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id')
    .eq('id', eventId)
    .eq('builder_id', builderProfileId)
    .maybeSingle()

  if (eventError) {
    console.error('[Financials API] Event ownership lookup failed', eventError)
    return NextResponse.json({ error: 'Failed to verify event access' }, { status: 500 })
  }

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  }

  return null
}

/**
 * Returns the cached financial summary for an event.
 *
 * If `?recalculate=true` is provided, the endpoint recalculates from current
 * sales/bookings before returning. Otherwise it returns the cached
 * `event_financial_summary` row, with a compact empty state when no sales exist.
 *
 * @param request - Incoming API request.
 * @param params - Route params containing the event id.
 * @returns Event financial metrics.
 */
export async function GET(request: NextRequest, props: { params: Promise<{ eventId: string }> }) {
  const params = await props.params;
  try {
    const accessError = await verifyBuilderEventAccess(params.eventId)
    if (accessError) return accessError

    const admin = createServiceRoleClient()

    if (request.nextUrl.searchParams.get('recalculate') === 'true') {
      const metrics = await recalculateEventFinancials(admin, params.eventId)
      const metricsRecord = metrics as unknown as Record<string, unknown>
      return jsonWithDeprecatedKeys(
        {
          event_id: params.eventId,
          ...metrics,
          venue_chi_projection:
            metricsRecord.venue_chi_projection ??
            metricsRecord.venue_kickback_projection ??
            0,
        },
        ['venue_kickback_projection']
      )
    }

    const { data: financials, error } = await admin
      .from('event_financial_summary')
      .select('*')
      .eq('event_id', params.eventId)
      .maybeSingle()

    if (error) throw error

    if (!financials) {
      return jsonWithDeprecatedKeys({
        event_id: params.eventId,
        tickets_sold: 0,
        gross_revenue: 0,
        net_revenue: 0,
        expected_profit: 0,
        current_attendance: 0,
        projected_attendance: 0,
        venue_chi_projection: 0,
        venue_kickback_projection: 0,
        message: 'No sales data yet',
      }, ['venue_kickback_projection'])
    }

    return jsonWithDeprecatedKeys(
      {
        ...(financials as Record<string, unknown>),
        venue_chi_projection:
          (financials as Record<string, unknown>).venue_chi_projection ??
          (financials as Record<string, unknown>).venue_kickback_projection ??
          0,
      },
      ['venue_kickback_projection']
    )
  } catch (error) {
    console.error('[Financials API] Error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load financials' },
      { status: 500 }
    )
  }
}
