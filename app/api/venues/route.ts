import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
    const page = parseInt(searchParams.get('page') || '0', 10)
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10)

    // Build query - fetch ALL published venues (marketplace)
    let query = supabase
      .from('venues')
      .select('id, name, venue_type, city, state, capacity, hourly_rate, daily_rate, photo_url, is_verified, description, created_at')
      .eq('is_active', true) // Only active venues
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
      query = query.gte('capacity', parseInt(minCapacity, 10))
    }
    if (maxCapacity) {
      query = query.lte('capacity', parseInt(maxCapacity, 10))
    }
    if (minPrice) {
      query = query.gte('hourly_rate', parseFloat(minPrice))
    }
    if (maxPrice) {
      query = query.lte('hourly_rate', parseFloat(maxPrice))
    }
    if (isVerified !== null) {
      query = query.eq('is_verified', isVerified === 'true')
    }

    // Apply pagination
    const from = page * pageSize
    const to = from + pageSize - 1
    query = query.range(from, to)

    const { data: venues, error } = await query

    if (error) {
      console.error('Error fetching venues:', error)
      return NextResponse.json(
        { error: 'Failed to fetch venues', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      venues: venues || [],
      page,
      pageSize,
      hasMore: (venues || []).length === pageSize,
    })
  } catch (error) {
    console.error('Unexpected error fetching venues:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
