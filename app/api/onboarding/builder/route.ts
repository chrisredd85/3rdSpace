export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { ensureBuilderProfile } from '@/lib/server/account-setup'
import type { TicketPlatform } from '@/lib/constants/account-setup'

interface BuilderOnboardingRequest {
  name: string
  organization_name: string
  organization_type?: string | null
  social_handle?: string | null
  website?: string | null
  bio?: string | null
  event_types: string[]
  preferred_amenities?: string[]
  ticket_platforms?: TicketPlatform[]
  typical_attendance_min?: number | null
  typical_attendance_max?: number | null
  bulk_booking_enabled?: boolean | null
  invite_collaborators?: string[]
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

    if (user.user_metadata?.user_type !== 'community_builder') {
      return NextResponse.json({ error: 'Invalid user type for builder onboarding' }, { status: 403 })
    }

    const body: BuilderOnboardingRequest = await request.json()
    const {
      name,
      organization_name,
      organization_type,
      social_handle,
      website,
      bio,
      event_types,
      preferred_amenities,
      ticket_platforms,
      typical_attendance_min,
      typical_attendance_max,
      bulk_booking_enabled,
      invite_collaborators,
    } = body

    if (!name || !organization_name || !event_types?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { error: updateUserError } = await admin
      .from('users')
      .update({ company_name: organization_name, updated_at: new Date().toISOString() } as never)
      .eq('id', user.id)

    if (updateUserError) {
      return NextResponse.json({ error: 'Failed to update organization details' }, { status: 500 })
    }

    await ensureBuilderProfile(admin, {
      userId: user.id,
      name,
      organizationName: organization_name,
      organizationType: organization_type ?? null,
      socialHandle: social_handle ?? null,
      website: website ?? null,
      bio: bio ?? null,
      eventTypes: event_types,
      preferredAmenities: preferred_amenities,
      ticketPlatforms: ticket_platforms ?? [],
      typicalAttendanceMin: typical_attendance_min ?? null,
      typicalAttendanceMax: typical_attendance_max ?? null,
      bulkBookingEnabled: bulk_booking_enabled ?? false,
      inviteCollaborators: invite_collaborators ?? [],
      origin: request.nextUrl.origin,
    })

    return NextResponse.json({ success: true, message: 'Builder profile saved successfully' })
  } catch (error) {
    console.error('Builder onboarding error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
