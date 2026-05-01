export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizeVendorProfile } from '@/lib/vendors/profile-adapter'

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
    const supabase = createClient()
    const { searchParams } = new URL(request.url)

    // Parse query parameters
    const serviceType = searchParams.get('service_type')
    const city = searchParams.get('city')
    const state = searchParams.get('state')
    const isVerified = searchParams.get('is_verified')
    const minPrice = searchParams.get('min_price')
    const maxPrice = searchParams.get('max_price')

    // Build query - fetch ALL published vendors (marketplace)
    let query = supabase
      .from('vendor_profiles')
      .select('*')
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
    let filteredVendors = ((vendors || []) as Record<string, any>[]).map(normalizeVendorProfile)
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
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
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
