export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { ensureOwnerProfile, ensureVenueSetup } from '@/lib/server/account-setup'
import type { VenueType } from '@/lib/types'

interface VenueOnboardingRequest {
  contact_name: string
  venue_name: string
  address: string
  city: string
  neighborhood?: string | null
  state: string
  zip_code: string
  venue_type: VenueType
  capacity: number
  house_rules: string
  amenities: string[]
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const admin = createServiceRoleClient()

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    if (user.user_metadata?.user_type !== 'venue_owner') {
      return NextResponse.json({ error: 'Invalid user type for venue onboarding' }, { status: 403 })
    }

    const body: VenueOnboardingRequest = await request.json()
    const { contact_name, venue_name, address, city, neighborhood, state, zip_code, venue_type, capacity, house_rules, amenities } = body

    if (!contact_name || !venue_name || !address || !city || !state || !zip_code || !venue_type || !capacity || !house_rules || !amenities?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { error: updateUserError } = await admin
      .from('users')
      .update({ company_name: venue_name, updated_at: new Date().toISOString() } as never)
      .eq('id', user.id)

    if (updateUserError) {
      return NextResponse.json({ error: 'Failed to update venue account' }, { status: 500 })
    }

    await ensureOwnerProfile(admin, {
      userId: user.id,
      contactName: contact_name,
      venueName: venue_name,
      address,
      city,
      neighborhood: neighborhood?.trim() || null,
      state,
      zipCode: zip_code,
      venueType: venue_type,
      capacity,
      houseRules: house_rules,
      amenities,
    })

    const venueId = await ensureVenueSetup(admin, {
      userId: user.id,
      contactName: contact_name,
      venueName: venue_name,
      address,
      city,
      neighborhood: neighborhood?.trim() || null,
      state,
      zipCode: zip_code,
      venueType: venue_type,
      capacity,
      houseRules: house_rules,
      amenities,
    })

    return NextResponse.json({
      success: true,
      venueId,
      message: 'Venue profile created successfully',
    })
  } catch (error) {
    console.error('Venue onboarding error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
