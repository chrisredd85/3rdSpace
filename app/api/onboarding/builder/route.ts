import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { ensureBuilderProfile } from '@/lib/server/account-setup'
import type { TicketPlatform } from '@/lib/constants/account-setup'

interface BuilderOnboardingRequest {
  name: string
  organization_name: string
  event_types: string[]
  ticket_platforms: TicketPlatform[]
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
    const { name, organization_name, event_types, ticket_platforms } = body

    if (!name || !organization_name || !event_types?.length || !ticket_platforms?.length) {
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
      eventTypes: event_types,
      ticketPlatforms: ticket_platforms,
      origin: request.nextUrl.origin,
    })

    return NextResponse.json({ success: true, message: 'Builder profile saved successfully' })
  } catch (error) {
    console.error('Builder onboarding error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
