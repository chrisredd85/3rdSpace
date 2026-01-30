import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { UserType } from '@/lib/types'

interface SignupRequest {
  userType: UserType
  email: string
  password: string
  name: string
  // Venue-specific fields
  venue_name?: string
  venue_type?: string
  capacity?: number
  phone?: string
  // Vendor-specific fields
  business_name?: string
  service_type?: string
  service_area?: string
}

export async function POST(request: NextRequest) {
  try {
    const body: SignupRequest = await request.json()
    const {
      userType,
      email,
      password,
      name,
      venue_name,
      venue_type,
      capacity,
      phone,
      business_name,
      service_type,
      service_area,
    } = body

    // Validate required fields
    if (!email || !password || !name || !userType) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const supabase = createClient()

    // Create user account
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          user_type: userType,
        },
        emailRedirectTo: `${request.nextUrl.origin}/auth/callback`,
      },
    })

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: authError?.message || 'Failed to create account' },
        { status: 400 }
      )
    }

    // Map userType to role (REQUIRED by database)
    let role: string
    if (userType === 'community_builder') {
      role = 'builder'
    } else if (userType === 'venue_owner') {
      role = 'owner'
    } else if (userType === 'vendor') {
      role = 'vendor'
    } else {
      role = 'builder' // default fallback
    }

    // Create user record in public.users table
    const { error: userError } = await supabase.from('users').insert({
      id: authData.user.id,
      email: authData.user.email!,
      role: role,              // REQUIRED: 'builder', 'owner', or 'vendor'
      user_type: userType,     // Optional: keeps original value
      company_name: name,      // Using name as company_name
      email_verified: false,
    } as any)

    if (userError) {
      console.error('Error creating user:', userError)
      // Try to clean up auth user if profile creation fails
      try {
        await supabase.auth.admin.deleteUser(authData.user.id)
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError)
      }
      return NextResponse.json(
        { error: `Failed to create user profile: ${userError.message}` },
        { status: 500 }
      )
    }

    // Create venue record for venue owners
    if (userType === 'venue_owner' && venue_name && venue_type && capacity !== undefined) {
      const { error: venueError } = await supabase.from('venues').insert({
        owner_id: authData.user.id,
        name: venue_name,
        venue_type,
        capacity,
        is_active: false,
        is_verified: false,
      } as any)

      if (venueError) {
        console.error('Error creating venue:', venueError)
        // Don't fail signup if venue creation fails
      }
    }

    // Create vendor record for vendors
    if (userType === 'vendor' && business_name && service_type) {
      const { error: vendorError } = await supabase.from('vendors').insert({
        owner_id: authData.user.id,
        name: business_name,
        business_name,
        service_type,
        is_active: false,
        is_verified: false,
      } as any)

      if (vendorError) {
        console.error('Error creating vendor:', vendorError)
        // Don't fail signup if vendor creation fails
      }
    }

    return NextResponse.json({
      success: true,
      user: {
        id: authData.user.id,
        email: authData.user.email,
      },
    })
  } catch (error) {
    console.error('Signup error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
