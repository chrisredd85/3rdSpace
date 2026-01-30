import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ServiceType } from '@/lib/types'

interface VendorOnboardingRequest {
  business_name: string
  service_type: ServiceType
  service_area: string
  setup_time: '30min' | '60min' | '90min' | '2hr' | '3hr'
  description?: string
}

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

    // Verify user is a vendor
    const userType = user.user_metadata?.user_type
    if (userType !== 'vendor') {
      return NextResponse.json(
        { error: 'Invalid user type for vendor onboarding' },
        { status: 403 }
      )
    }

    const body: VendorOnboardingRequest = await request.json()
    const { business_name, service_type, service_area, setup_time, description } = body

    // Validate required fields
    if (!business_name || !service_type || !service_area || !setup_time) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Check if vendor already exists for this user
    const { data: existingVendor } = await supabase
      .from('vendors')
      .select('id')
      .eq('owner_id', user.id)
      .single()

    let vendorId: string

    if (existingVendor) {
      // Update existing vendor
      const { data: updatedVendor, error: updateError } = await supabase
        .from('vendors')
        .update({
          name: business_name,
          business_name,
          service_type,
          description: description || null,
          is_active: true, // Activate after onboarding
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingVendor.id)
        .select('id')
        .single()

      if (updateError) {
        console.error('Error updating vendor:', updateError)
        return NextResponse.json(
          { error: 'Failed to update vendor profile' },
          { status: 500 }
        )
      }

      vendorId = updatedVendor.id
    } else {
      // Create new vendor
      const { data: newVendor, error: createError } = await supabase
        .from('vendors')
        .insert({
          owner_id: user.id,
          name: business_name,
          business_name,
          service_type,
          description: description || null,
          pricing_model: 'flat_rate', // Default pricing model
          is_active: true,
          is_verified: false, // Requires admin verification
        })
        .select('id')
        .single()

      if (createError) {
        console.error('Error creating vendor:', createError)
        return NextResponse.json(
          { error: 'Failed to create vendor profile' },
          { status: 500 }
        )
      }

      vendorId = newVendor.id
    }

    // Update vendor with service_area (stored in address fields)
    // Setup time can be stored in description or as a separate field
    // For now, we'll update the vendor record with service_area in the address field
    await supabase
      .from('vendors')
      .update({
        address: service_area, // Store service area in address field for now
        description: description 
          ? `${description}\n\nSetup Time: ${setup_time}`
          : `Setup Time: ${setup_time}`,
      })
      .eq('id', vendorId)

    return NextResponse.json({
      success: true,
      vendorId,
      message: 'Vendor profile created successfully',
    })
  } catch (error) {
    console.error('Vendor onboarding error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
