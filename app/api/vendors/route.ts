import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
      .from('vendors')
      .select('*')
      .eq('is_active', true) // Only active vendors
      .order('created_at', { ascending: false })

    // Apply filters
    if (serviceType) {
      query = query.eq('service_type', serviceType)
    }
    if (city) {
      query = query.eq('city', city)
    }
    if (state) {
      query = query.eq('state', state)
    }
    if (isVerified !== null) {
      query = query.eq('is_verified', isVerified === 'true')
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
    let filteredVendors = vendors || []
    if (minPrice || maxPrice) {
      // Note: This is a simplified filter. In production, you'd check vendor packages/offerings
      // For now, we'll just return all vendors and let the client filter
    }

    return NextResponse.json({
      vendors: filteredVendors,
    })
  } catch (error) {
    console.error('Unexpected error fetching vendors:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
