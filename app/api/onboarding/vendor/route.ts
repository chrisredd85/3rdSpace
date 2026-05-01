export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { ensureVendorProfile } from '@/lib/server/account-setup'
import type { ServiceType } from '@/lib/types'

interface VendorOnboardingRequest {
  name: string
  service_type: ServiceType
  bank_account_holder_name: string
  bank_name: string
  availability_notes: string
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

    if (user.user_metadata?.user_type !== 'vendor') {
      return NextResponse.json({ error: 'Invalid user type for vendor onboarding' }, { status: 403 })
    }

    const body: VendorOnboardingRequest = await request.json()
    const { name, service_type, bank_account_holder_name, bank_name, availability_notes } = body

    if (!name || !service_type || !bank_account_holder_name || !bank_name || !availability_notes) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    await ensureVendorProfile(admin, {
      userId: user.id,
      name,
      serviceType: service_type,
      bankAccountHolderName: bank_account_holder_name,
      bankName: bank_name,
      availabilityNotes: availability_notes,
    })

    return NextResponse.json({
      success: true,
      message: 'Vendor profile created successfully',
    })
  } catch (error) {
    console.error('Vendor onboarding error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
