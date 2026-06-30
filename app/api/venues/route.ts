export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { jsonWithDeprecatedKeys } from '@/lib/api/legacy-key-compat'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { dollarsToCents } from '@/lib/money'
import { getVenueComplianceStatus } from '@/lib/planner/venueComplianceGate'
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
    const supabase = createVenueCatalogClient()
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
    const plannerCatalog = searchParams.get('planner_catalog') === '1'
    const applyComplianceFilter = searchParams.get('include_blocked') !== '1'
    const page = parseInt(searchParams.get('page') || '0', 10)
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10)

    const from = page * pageSize
    const to = from + pageSize - 1

    const minPriceDollars = parsePriceDollars(minPrice)
    const maxPriceDollars = parsePriceDollars(maxPrice)
    const minPriceCents = minPriceDollars === null ? null : dollarsToCents(minPriceDollars)
    const maxPriceCents = maxPriceDollars === null ? null : dollarsToCents(maxPriceDollars)

    const buildQuery = (selectColumns: string, priceColumn: 'hourly_rate_cents' | 'hourly_rate') => {
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
      if (minPriceCents !== null && minPriceDollars !== null) {
        query = query.gte(priceColumn, priceColumn === 'hourly_rate_cents' ? minPriceCents : minPriceDollars)
      }
      if (maxPriceCents !== null && maxPriceDollars !== null) {
        query = query.lte(priceColumn, priceColumn === 'hourly_rate_cents' ? maxPriceCents : maxPriceDollars)
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

    let primaryResult = await buildQuery(VENUE_SELECT_COLUMNS, 'hourly_rate_cents')
    if (primaryResult.error && shouldRetryVenueQuery(primaryResult.error)) {
      await wait(200)
      primaryResult = await buildQuery(VENUE_SELECT_COLUMNS, 'hourly_rate_cents')
    }

    let { data: venues, error } = primaryResult

    if (error && isVenueCatalogSchemaCacheError(error)) {
      let fallback = await buildQuery(VENUE_LEGACY_SELECT_COLUMNS, 'hourly_rate')
      if (fallback.error && shouldRetryVenueQuery(fallback.error)) {
        await wait(200)
        fallback = await buildQuery(VENUE_LEGACY_SELECT_COLUMNS, 'hourly_rate')
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

    const normalizedVenues = applyComplianceFilter
      ? await filterCompliantPublicVenues(supabase, normalizeVenues(venues as any[]))
      : normalizeVenues(venues as any[])
    const amenitiesByVenueId = await loadVenueAmenities(
      supabase,
      normalizedVenues.map((venue) => venue.id)
    )
    const publicVenues = normalizedVenues
      .map((venue) => {
        const amenities = amenitiesByVenueId.get(venue.id) ?? []
        const uniqueFeaturesTags = Array.from(new Set([
          ...(venue.unique_features_tags ?? []),
          ...amenities,
        ]))

        return {
          ...venue,
          amenities,
          unique_features_tags: uniqueFeaturesTags,
        }
      })
      .map(stripContactEmail)

    return jsonWithDeprecatedKeys(
      {
        venues: publicVenues,
        page,
        pageSize,
        hasMore: (venues || []).length === pageSize,
      },
      [
        'bar_rev_share_enabled',
        'bar_rev_share_pct',
        'sponsor_rev_share_enabled',
        'sponsor_rev_share_pct',
        'per_head_kickback_cents',
      ],
      {
        headers: {
          'Cache-Control': plannerCatalog
            ? 'no-store'
            : applyComplianceFilter
              ? 'no-store'
              : 'public, s-maxage=60, stale-while-revalidate=300',
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

async function filterCompliantPublicVenues<T extends { id: string }>(
  supabase: ReturnType<typeof createServiceRoleClient> | ReturnType<typeof createClient>,
  venues: T[]
): Promise<T[]> {
  const compliantVenues: T[] = []

  for (const venue of venues) {
    try {
      const status = await getVenueComplianceStatus(supabase as any, venue.id)
      if (status.is_compliant) {
        compliantVenues.push(venue)
      }
    } catch (error) {
      console.error('[/api/venues] Venue compliance filter failed', {
        venue_id: venue.id,
        error,
      })
      compliantVenues.push(venue)
    }
  }

  return compliantVenues
}

function createVenueCatalogClient(): ReturnType<typeof createServiceRoleClient> {
  try {
    return createServiceRoleClient()
  } catch {
    return createClient() as unknown as ReturnType<typeof createServiceRoleClient>
  }
}

async function loadVenueAmenities(
  supabase: ReturnType<typeof createServiceRoleClient>,
  venueIds: string[]
) {
  const amenitiesByVenueId = new Map<string, string[]>()
  if (venueIds.length === 0) return amenitiesByVenueId

  let query = supabase
    .from('venue_amenities')
    .select('venue_id, amenity_name, custom_amenity_name')

  query = query.in('venue_id', venueIds)

  const { data, error } = await query.limit(1000)
  if (error) {
    console.error('[/api/venues] Venue amenities lookup failed', error)
    return amenitiesByVenueId
  }

  for (const row of (data || []) as Array<Record<string, unknown>>) {
    const venueId = typeof row.venue_id === 'string' ? row.venue_id : null
    const amenity =
      typeof row.amenity_name === 'string'
        ? row.amenity_name
        : typeof row.custom_amenity_name === 'string'
          ? row.custom_amenity_name
          : null
    if (!venueId || !amenity) continue
    amenitiesByVenueId.set(venueId, [...(amenitiesByVenueId.get(venueId) ?? []), amenity])
  }

  return amenitiesByVenueId
}

const VENUE_CATALOG_OPTIONAL_COLUMNS = [
  'ticket_sales_share_enabled',
  'ticket_sales_share_pct',
  'bar_consumption_share_enabled',
  'bar_consumption_share_pct',
  'bar_rev_share_enabled',
  'bar_rev_share_pct',
  'sponsor_consumption_share_enabled',
  'sponsor_consumption_share_pct',
  'sponsor_rev_share_enabled',
  'sponsor_rev_share_pct',
  'per_head_chi_cents',
  'per_head_kickback_cents',
  'hourly_rate_cents',
  'daily_rate_cents',
  'price_per_night_cents',
  'is_claimed',
  'is_admin_seeded',
  'requires_deposit',
  'deposit_amount',
  'deposit_amount_cents',
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

function parsePriceDollars(value: string | null) {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
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
