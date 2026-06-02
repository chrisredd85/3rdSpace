export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { normalizeVendorProfile } from '@/lib/vendors/profile-adapter'
import { flattenTieredVendorRecommendations, getTieredVendorRecommendations } from '@/lib/vendors/relationshipRecommendations'

const PUBLIC_VENDOR_SELECT_COLUMNS = `
  id,
  user_id,
  name,
  vendor_type,
  service_type,
  bio,
  regions_served,
  service_area,
  availability_notes,
  pricing_model,
  hourly_rate,
  base_rate,
  per_person_rate,
  per_head_kickback,
  requires_deposit,
  deposit_amount,
  deposit_type,
  deposit_percentage,
  deposit_refundable,
  deposit_terms,
  lead_time_days,
  cancellation_terms,
  emergency_available,
  emergency_rate_uplift,
  is_published,
  claim_status,
  is_claimed,
  claimed_user_id,
  is_admin_seeded,
  average_rating,
  rating,
  review_count,
  total_bookings,
  total_gigs,
  created_at,
  updated_at
`

/**
 * GET /api/vendors
 * 
 * Fetch ALL available vendors for hire (marketplace listings)
 * Used by:
 * - Event creation wizard (Step 3: Select Vendors)
 * - Vendor marketplace/browse pages
 * 
 * Query params:
 * - service_type: Filter by service type (dj, catering, bartending, etc.)
 * - city: Filter by city
 * - state: Filter by state
 * - is_verified: Filter by verification status
 * - min_price: Minimum price
 * - max_price: Maximum price
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createVendorCatalogClient()
    const { searchParams } = new URL(request.url)

    // Parse query parameters
    const serviceType = searchParams.get('service_type')
    const city = searchParams.get('city')
    const state = searchParams.get('state')
    const isVerified = searchParams.get('is_verified')
    const minPrice = searchParams.get('min_price')
    const maxPrice = searchParams.get('max_price')
    const plannerCatalog = searchParams.get('planner_catalog') === '1'
    const tieredRecommendations = searchParams.get('tiers') === '1'

    if (tieredRecommendations) {
      const authClient = createClient()
      const {
        data: { user },
      } = await authClient.auth.getUser()

      if (user) {
        const tiers = await getTieredVendorRecommendations(createServiceRoleClient() as any, user.id, {
          serviceType,
        })
        return NextResponse.json(
          {
            vendors: flattenTieredVendorRecommendations(tiers).map(stripContactEmail),
            vendor_tiers: {
              your_people: tiers.your_people.map(stripContactEmail),
              warm_intro: tiers.warm_intro.map(stripContactEmail),
              catalog: tiers.catalog.map(stripContactEmail),
            },
          },
          {
            headers: {
              'Cache-Control': plannerCatalog
                ? 'no-store'
                : 'private, max-age=60',
            },
          }
        )
      }
    }

    // Build query - fetch ALL published vendors (marketplace)
    let query = supabase
      .from('vendor_profiles')
      .select(PUBLIC_VENDOR_SELECT_COLUMNS)
      .eq('is_published', true) // Only active vendors
      .order('created_at', { ascending: false })

    // Apply filters
    if (serviceType) {
      query = query.eq('service_type', serviceType)
    }
    if (city) {
      query = query.ilike('regions_served', `%${city}%`)
    }
    if (isVerified !== null) {
      query = query.eq('is_published', isVerified === 'true')
    }

    const { data: vendors, error } = await query

    if (error) {
      console.error('Error fetching vendors:', error)
      return NextResponse.json(
        { error: 'Failed to fetch vendors', details: error.message },
        { status: 500 }
      )
    }

    // Filter by price range if provided (would need to check vendor packages/offerings)
    let filteredVendors = ((vendors || []) as Record<string, any>[])
      .map(normalizeVendorProfile)
      .map(stripContactEmail)
    if (minPrice || maxPrice) {
      // Note: This is a simplified filter. In production, you'd check vendor packages/offerings
      // For now, we'll just return all vendors and let the client filter
    }

    return NextResponse.json(
      {
        vendors: filteredVendors,
      },
      {
        headers: {
          'Cache-Control': plannerCatalog
            ? 'no-store'
            : 'public, s-maxage=120, stale-while-revalidate=600',
        },
      }
    )
  } catch (error) {
    console.error('Unexpected error fetching vendors:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}

function createVendorCatalogClient(): ReturnType<typeof createServiceRoleClient> {
  try {
    return createServiceRoleClient()
  } catch {
    return createClient() as unknown as ReturnType<typeof createServiceRoleClient>
  }
}

function stripContactEmail<T>(item: T): Omit<T, 'contact_email'> {
  const publicItem = { ...(item as Record<string, unknown>) }
  delete publicItem.contact_email
  return publicItem as Omit<T, 'contact_email'>
}
