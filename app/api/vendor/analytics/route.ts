import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type Period = 'month' | 'year' | 'all' | 'custom'

type CacheEntry = {
  expiresAt: number
  payload: unknown
}

const analyticsCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60 * 1000

/**
 * Get vendor analytics data for revenue, bookings, performance, and growth.
 *
 * @route GET /api/vendor/analytics?period={month|year|all|custom}&start=YYYY-MM-DD&end=YYYY-MM-DD
 * @auth Required - Vendor only
 */
export async function GET(request: Request) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const period = getPeriod(searchParams.get('period'))
    const range = getDateRange(period, searchParams)

    const { data: vendor, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (vendorError) {
      return NextResponse.json({ error: vendorError.message }, { status: 500 })
    }

    if (!vendor) {
      return NextResponse.json({ error: 'Vendor profile not found' }, { status: 404 })
    }

    const vendorRow = vendor as { id: string }
    // The vendor_analytics materialized view cannot apply RLS. Resolve the
    // caller's vendor id with the session client first, then use the service
    // client for the explicitly scoped financial read.
    const admin = createServiceRoleClient()
    const cacheKey = `${vendorRow.id}:${period}:${range.startDate}:${range.endDate}`
    const cached = analyticsCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload, {
        headers: getCacheHeaders(),
      })
    }

    const payload = await buildVendorAnalytics(admin as any, {
      vendorId: vendorRow.id,
      startDate: range.startDate,
      endDate: range.endDate,
    })

    analyticsCache.set(cacheKey, {
      payload,
      expiresAt: Date.now() + CACHE_TTL_MS,
    })

    return NextResponse.json(payload, {
      headers: getCacheHeaders(),
    })
  } catch (error) {
    console.error('[vendor.analytics.GET] Failed to load analytics', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load vendor analytics' },
      { status: 500 }
    )
  }
}

/**
 * Builds the analytics response using the materialized view and range RPCs.
 */
async function buildVendorAnalytics(
  supabase: any,
  params: {
    vendorId: string
    startDate: string
    endDate: string
  }
) {
  const now = new Date()
  const thisMonthStart = toDateOnly(new Date(now.getFullYear(), now.getMonth(), 1))
  const thisMonthEnd = toDateOnly(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  const lastMonthStart = toDateOnly(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const lastMonthEnd = toDateOnly(new Date(now.getFullYear(), now.getMonth(), 0))

  const [
    analyticsResult,
    revenueResult,
    bookingResult,
    pendingRevenueResult,
    thisMonthResult,
    lastMonthResult,
    popularServicesResult,
  ] = await Promise.all([
    supabase.from('vendor_analytics').select('*').eq('vendor_id', params.vendorId).maybeSingle(),
    supabase.rpc('get_vendor_revenue_by_month', {
      p_vendor_id: params.vendorId,
      p_start_date: params.startDate,
      p_end_date: params.endDate,
    }),
    supabase.rpc('get_vendor_bookings_by_month', {
      p_vendor_id: params.vendorId,
      p_start_date: params.startDate,
      p_end_date: params.endDate,
    }),
    supabase.rpc('get_vendor_pending_revenue', {
      p_vendor_id: params.vendorId,
      p_start_date: toDateOnly(now),
    }),
    supabase.rpc('get_vendor_period_summary', {
      p_vendor_id: params.vendorId,
      p_start_date: thisMonthStart,
      p_end_date: thisMonthEnd,
    }),
    supabase.rpc('get_vendor_period_summary', {
      p_vendor_id: params.vendorId,
      p_start_date: lastMonthStart,
      p_end_date: lastMonthEnd,
    }),
    supabase.rpc('get_vendor_popular_services', {
      p_vendor_id: params.vendorId,
      p_start_date: params.startDate,
      p_end_date: params.endDate,
    }),
  ])

  if (analyticsResult.error) throw new Error(analyticsResult.error.message)
  if (revenueResult.error) throw new Error(revenueResult.error.message)
  if (bookingResult.error) throw new Error(bookingResult.error.message)
  if (pendingRevenueResult.error) throw new Error(pendingRevenueResult.error.message)
  if (thisMonthResult.error) throw new Error(thisMonthResult.error.message)
  if (lastMonthResult.error) throw new Error(lastMonthResult.error.message)
  if (popularServicesResult.error) throw new Error(popularServicesResult.error.message)

  const analytics = (analyticsResult.data || {}) as Record<string, unknown>
  const thisMonth = firstRow(thisMonthResult.data)
  const lastMonth = firstRow(lastMonthResult.data)
  const thisMonthRevenue = toNumber(thisMonth?.revenue)
  const lastMonthRevenue = toNumber(lastMonth?.revenue)
  const thisMonthBookings = toNumber(thisMonth?.bookings)
  const lastMonthBookings = toNumber(lastMonth?.bookings)

  return {
    overview: {
      total_revenue: toNumber(analytics.total_revenue),
      pending_revenue: toNumber(firstRow(pendingRevenueResult.data)?.pending_revenue),
      total_bookings: toNumber(analytics.total_bookings),
      confirmed_bookings: toNumber(analytics.confirmed_bookings),
      completed_bookings: toNumber(analytics.completed_bookings),
      cancelled_bookings: toNumber(analytics.cancelled_bookings),
      average_booking_value: toNumber(analytics.avg_booking_value),
      average_rating: toNumber(analytics.average_rating),
      total_reviews: toNumber(analytics.total_reviews),
      conversion_rate: toNumber(analytics.conversion_rate),
    },
    this_month: {
      revenue: thisMonthRevenue,
      bookings: thisMonthBookings,
      growth_percentage: getGrowthPercentage(thisMonthRevenue, lastMonthRevenue),
      booking_growth_percentage: getGrowthPercentage(thisMonthBookings, lastMonthBookings),
    },
    comparison: {
      current: {
        revenue: thisMonthRevenue,
        bookings: thisMonthBookings,
        average_booking_value: toNumber(thisMonth?.avg_booking_value),
      },
      previous: {
        revenue: lastMonthRevenue,
        bookings: lastMonthBookings,
        average_booking_value: toNumber(lastMonth?.avg_booking_value),
      },
    },
    performance: {
      response_time_hours: toNumber(analytics.avg_response_hours),
      acceptance_rate: toNumber(analytics.acceptance_rate),
      cancellation_rate: toNumber(analytics.cancellation_rate),
    },
    charts: {
      revenue_by_month: revenueResult.data || [],
      bookings_by_month: bookingResult.data || [],
    },
    popular_services: popularServicesResult.data || [],
    date_range: params,
  }
}

/**
 * Parses the requested analytics period.
 */
function getPeriod(value: string | null): Period {
  if (value === 'year' || value === 'all' || value === 'custom') return value
  return 'month'
}

/**
 * Resolves the period into inclusive ISO date strings.
 */
function getDateRange(period: Period, searchParams: URLSearchParams) {
  const now = new Date()
  const customStart = searchParams.get('start')
  const customEnd = searchParams.get('end')

  if (period === 'custom' && customStart && customEnd) {
    return {
      startDate: customStart,
      endDate: customEnd,
    }
  }

  if (period === 'year') {
    return {
      startDate: toDateOnly(new Date(now.getFullYear(), 0, 1)),
      endDate: toDateOnly(now),
    }
  }

  if (period === 'all') {
    return {
      startDate: '2020-01-01',
      endDate: toDateOnly(now),
    }
  }

  return {
    startDate: toDateOnly(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate: toDateOnly(now),
  }
}

/**
 * Converts a Date into YYYY-MM-DD.
 */
function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10)
}

/**
 * Converts nullable numeric values into safe numbers.
 */
function toNumber(value: unknown) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

/**
 * Returns the first row from an RPC table response.
 */
function firstRow(value: unknown) {
  return Array.isArray(value) ? (value[0] as Record<string, unknown> | undefined) || null : null
}

/**
 * Calculates percentage growth from previous to current.
 */
function getGrowthPercentage(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

/**
 * Returns cache headers for short-lived private analytics responses.
 */
function getCacheHeaders() {
  return {
    'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
  }
}
