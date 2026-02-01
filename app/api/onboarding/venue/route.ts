import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { VenueType } from '@/lib/types'

export async function POST(request: NextRequest) {
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

    // Verify user is a venue owner
    const userType = user.user_metadata?.user_type
    if (userType !== 'venue_owner') {
      return NextResponse.json(
        { error: 'Invalid user type for venue onboarding' },
        { status: 403 }
      )
    }

    // Parse form data
    const formData = await request.formData()
    const venue_name = formData.get('venue_name') as string
    const address = formData.get('address') as string
    const city = formData.get('city') as string
    const state = formData.get('state') as string
    const zip_code = formData.get('zip_code') as string
    const venue_type = formData.get('venue_type') as VenueType
    const capacity = parseInt(formData.get('capacity') as string, 10)
    const photo = formData.get('photo') as File | null

    // Validate required fields
    if (!venue_name || !address || !city || !state || !zip_code || !venue_type || !capacity) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Check if venue already exists for this user
    const { data: existingVenue } = await supabase
      .from('venues')
      .select('id')
      .eq('owner_id', user.id)
      .single()

    let venueId: string
    const existing = existingVenue as { id: string } | null

    if (existing) {
      // Update existing venue
      const { data: updatedVenue, error: updateError } = await supabase
        .from('venues')
        .update({
          name: venue_name,
          address,
          city,
          state,
          zip_code,
          country: 'US', // Default to US
          venue_type,
          capacity,
          is_active: true, // Activate after onboarding
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', existing.id)
        .select('id')
        .single()

      if (updateError) {
        console.error('Error updating venue:', updateError)
        return NextResponse.json(
          { error: 'Failed to update venue profile' },
          { status: 500 }
        )
      }

      venueId = (updatedVenue as { id: string }).id
    } else {
      // Create new venue
      const { data: newVenue, error: createError } = await supabase
        .from('venues')
        .insert({
          owner_id: user.id,
          name: venue_name,
          address,
          city,
          state,
          zip_code,
          country: 'US',
          venue_type,
          capacity,
          pricing_model: 'flat_rate', // Default pricing model
          is_active: true,
          is_verified: false, // Requires admin verification
        } as never)
        .select('id')
        .single()

      if (createError) {
        console.error('Error creating venue:', createError)
        return NextResponse.json(
          { error: 'Failed to create venue profile' },
          { status: 500 }
        )
      }

      venueId = (newVenue as { id: string }).id
    }

    // Handle photo upload if provided
    if (photo && photo.size > 0) {
      try {
        const fileExt = photo.name.split('.').pop()
        const fileName = `${venueId}-${Date.now()}.${fileExt}`
        const filePath = `venues/${venueId}/${fileName}`

        // Upload to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from('venue-photos')
          .upload(filePath, photo, {
            cacheControl: '3600',
            upsert: false,
          })

        if (uploadError) {
          console.error('Error uploading photo:', uploadError)
          // Don't fail onboarding if photo upload fails
        } else {
          // Get public URL
          const { data: { publicUrl } } = supabase.storage
            .from('venue-photos')
            .getPublicUrl(filePath)

          // Create venue photo record
          await supabase.from('venue_photos').insert({
            venue_id: venueId,
            photo_url: publicUrl,
            is_primary: true,
            display_order: 0,
          } as never)
        }
      } catch (photoError) {
        console.error('Photo upload error:', photoError)
        // Don't fail onboarding if photo upload fails
      }
    }

    return NextResponse.json({
      success: true,
      venueId,
      message: 'Venue profile created successfully',
    })
  } catch (error) {
    console.error('Venue onboarding error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
