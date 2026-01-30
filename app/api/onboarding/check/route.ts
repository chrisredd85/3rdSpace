import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Check if user has completed onboarding
 * Returns onboarding status based on user type
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()

    // Verify user is authenticated
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const userType = user.user_metadata?.user_type

    // Community builders don't need onboarding
    if (userType === 'community_builder') {
      return NextResponse.json({
        isOnboarded: true,
        userType,
      })
    }

    // Check if venue owner has a venue
    if (userType === 'venue_owner') {
      const { data: venue } = await supabase
        .from('venues')
        .select('id, name, address')
        .eq('owner_id', user.id)
        .single()

      return NextResponse.json({
        isOnboarded: !!venue && !!venue.address, // Has venue with address
        userType,
        hasVenue: !!venue,
      })
    }

    // Check if vendor has a vendor record
    if (userType === 'vendor') {
      const { data: vendor } = await supabase
        .from('vendors')
        .select('id, business_name, service_type')
        .eq('owner_id', user.id)
        .single()

      return NextResponse.json({
        isOnboarded: !!vendor && !!vendor.service_type, // Has vendor with service type
        userType,
        hasVendor: !!vendor,
      })
    }

    return NextResponse.json({
      isOnboarded: false,
      userType: null,
    })
  } catch (error) {
    console.error('Onboarding check error:', error)
    return NextResponse.json(
      { error: 'Failed to check onboarding status' },
      { status: 500 }
    )
  }
}
