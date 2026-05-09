export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizeVenues, VENUE_LEGACY_SELECT_COLUMNS, VENUE_SELECT_COLUMNS } from '@/lib/venues/venue-adapter'

/**
 * GET /api/venues
 * 
 * Fetch ALL available venues for rent (marketplace listings)
 * Used by:
 * - Event creation wizard (Step 2: Select Venue)
 * - Venue marketplace/browse pages
 * 
 * Query params:
 * - venue_type: Filter by venue type
 * - city: Filter by city
 * - state: Filter by state
 * - min_capacity: Minimum capacity
 * - max_capacity: Maximum capacity
 * - min_price: Minimum hourly rate
 * - max_price: Maximum hourly rate
 * - is_verified: Filter by verification status
 * - tags: Comma-separated unique feature tags
 * - page: Page number (default: 0)
 * - pageSize: Items per page (default: 20)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(request.url)

    // Parse query parameters
    const venueType = searchParams.get('venue_type')
    const city = searchParams.get('city')
    const state = searchParams.get('state')
    const minCapacity = searchParams.get('min_capacity')
    const maxCapacity = searchParams.get('max_capacity')
    const minPrice = searchParams.get('min_price')
    const maxPrice = searchParams.get('max_price')
    const isVerified = searchParams.get('is_verified')
    const tagsParam = searchParams.get('tags')
    const page = parseInt(searchParams.get('page') || '0', 10)
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10)

    const from = page * pageSize
    const to = from + pageSize - 1

    const buildQuery = (selectColumns: string) => {
      // Build query - fetch ALL published venues (marketplace)
      let query = supabase
        .from('venues')
        .select(selectColumns)
        .eq('is_published', true) // Only active venues
        .order('created_at', { ascending: false })

      // Apply filters
      if (venueType) {
        query = query.eq('venue_type', venueType)
      }
      if (city) {
        query = query.eq('city', city)
      }
      if (state) {
        query = query.eq('state', state)
      }
      if (minCapacity) {
        query = query.gte('standing_capacity', parseInt(minCapacity, 10))
      }
      if (maxCapacity) {
        query = query.lte('standing_capacity', parseInt(maxCapacity, 10))
      }
      if (minPrice) {
        query = query.gte('hourly_rate', parseFloat(minPrice))
      }
      if (maxPrice) {
        query = query.lte('hourly_rate', parseFloat(maxPrice))
      }
      if (isVerified !== null) {
        query = query.eq('is_published', isVerified === 'true')
      }
      if (tagsParam) {
        const tags = tagsParam
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)

        if (tags.length > 0) {
          query = query.overlaps('unique_features_tags', tags)
        }
      }

      return query.range(from, to)
    }

    let primaryResult = await buildQuery(VENUE_SELECT_COLUMNS)
    if (primaryResult.error && shouldRetryVenueQuery(primaryResult.error)) {
      await wait(200)
      primaryResult = await buildQuery(VENUE_SELECT_COLUMNS)
    }

    let { data: venues, error } = primaryResult

    if (error && isVenueCatalogSchemaCacheError(error)) {
      let fallback = await buildQuery(VENUE_LEGACY_SELECT_COLUMNS)
      if (fallback.error && shouldRetryVenueQuery(fallback.error)) {
        await wait(200)
        fallback = await buildQuery(VENUE_LEGACY_SELECT_COLUMNS)
      }
      venues = fallback.data
      error = fallback.error
    }

    if (error) {
      const status = shouldTreatAsUpstreamUnavailable(error) ? 503 : 500
      console.error('[/api/venues]', {
        status,
        code: error.code,
        message: error.message,
        hint: error.hint,
      })
      return NextResponse.json(
        { error: 'Failed to fetch venues', details: error.message },
        { status }
      )
    }

    const publicVenues = normalizeVenues(venues as any[]).map(stripContactEmail)

    return NextResponse.json(
      {
        venues: publicVenues,
        page,
        pageSize,
        hasMore: (venues || []).length === pageSize,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600',
        },
      }
    )
  } catch (error) {
    console.error('[/api/venues]', {
      status: 503,
      code: null,
      message: error instanceof Error ? error.message : 'Unexpected error fetching venues',
      hint: null,
    })
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 503 }
    )
  }
}

const VENUE_CATALOG_OPTIONAL_COLUMNS = [
  'ticket_sales_share_enabled',
  'ticket_sales_share_pct',
  'bar_rev_share_enabled',
  'bar_rev_share_pct',
  'sponsor_rev_share_enabled',
  'sponsor_rev_share_pct',
  'per_head_kickback_cents',
  'is_claimed',
  'is_admin_seeded',
  'requires_deposit',
  'deposit_amount',
  'deposit_type',
  'deposit_refundable',
  'deposit_terms',
  'bulk_approval_enabled',
  'auto_approve_threshold',
  'auto_approve_conditions',
  'unique_features',
  'unique_features_tags',
]

type VenueCatalogQueryError = {
  code?: string | null
  message?: string | null
  hint?: string | null
}

function isVenueCatalogSchemaCacheError(error: VenueCatalogQueryError) {
  const message = error.message ?? ''
  if (error.code === 'PGRST204') return true
  return VENUE_CATALOG_OPTIONAL_COLUMNS.some((column) => {
    return (
      message.includes(`venues.${column}`) ||
      message.includes(`'${column}' column`) ||
      message.includes(`'${column}'`)
    )
  })
}

function shouldRetryVenueQuery(error: VenueCatalogQueryError) {
  const code = error.code ?? ''
  const message = (error.message ?? '').toLowerCase()
  return (
    code === 'PGRST000' ||
    code === 'PGRST001' ||
    code === 'PGRST002' ||
    code === 'PGRST003' ||
    message.includes('connection') ||
    message.includes('timeout') ||
    message.includes('temporarily unavailable')
  )
}

function shouldTreatAsUpstreamUnavailable(error: VenueCatalogQueryError) {
  return shouldRetryVenueQuery(error) || isVenueCatalogSchemaCacheError(error)
}

function wait(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

function stripContactEmail<T extends { contact_email?: unknown }>(item: T): Omit<T, 'contact_email'> {
  const publicItem = { ...item }
  delete publicItem.contact_email
  return publicItem
}
