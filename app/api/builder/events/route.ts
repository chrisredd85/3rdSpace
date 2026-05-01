export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { Event, EventStatus } from '@/lib/types'
import {
  BuilderBillingRequiredError,
  consumeBuilderEventAccess,
  getBuilderBillingSummary,
  loadBuilderBillingProfileById,
  type BuilderBillingProfile,
} from '@/lib/billing/builder-billing'
import {
  getBuilderProfileId,
  mapAppEventTypeToDb,
  mapAppEventStatusToDb,
  mapDbEventToApp,
} from '@/lib/supabase/server-helpers'

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

    // Verify user is a community builder
    const userType = user.user_metadata?.user_type
    if (userType !== 'community_builder') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const { builderProfileId, error: builderProfileError } = await getBuilderProfileId(supabase, user.id)
    if (builderProfileError || !builderProfileId) {
      return NextResponse.json(
        { error: 'Builder profile not found' },
        { status: 404 }
      )
    }

    // Get query parameters
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') as EventStatus | null
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    // Build query
    let query = supabase
      .from('events')
      .select('*')
      .eq('builder_id', builderProfileId)
      .order('event_date', { ascending: false })
      .range(offset, offset + limit - 1)

    // Apply status filter if provided
    if (status && (status as string) !== 'all') {
      query = query.eq('status', mapAppEventStatusToDb(status))
    }

    const { data: eventsData, error } = await query

    if (error) {
      console.error('Error fetching events:', error)
      return NextResponse.json(
        { error: 'Failed to fetch events' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      events: (eventsData || []).map(mapDbEventToApp),
      count: eventsData?.length || 0,
    })
  } catch (error) {
    console.error('Get events error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const admin = createServiceRoleClient()

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

    // Verify user is a community builder
    const userType = user.user_metadata?.user_type
    if (userType !== 'community_builder') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const { builderProfileId, error: builderProfileError } = await getBuilderProfileId(supabase, user.id)
    if (builderProfileError || !builderProfileId) {
      return NextResponse.json(
        { error: 'Builder profile not found' },
        { status: 404 }
      )
    }

    const { data: billingProfile, error: billingProfileError } = await loadBuilderBillingProfileById(
      supabase,
      builderProfileId
    )

    if (billingProfileError || !billingProfile) {
      console.error('Error fetching builder billing profile:', billingProfileError)
      return NextResponse.json(
        { error: 'Failed to verify billing access' },
        { status: 500 }
      )
    }

    const billingSummary = getBuilderBillingSummary(billingProfile as BuilderBillingProfile)
    if (!billingSummary.canCreateEvent) {
      return NextResponse.json(
        {
          error: 'Choose pay-per-event or Pro to create another event.',
          billingRequired: true,
          billing: billingSummary,
        },
        { status: 402 }
      )
    }

    const body = await request.json()
    const {
      title,
      name,
      description,
      event_type,
      event_date,
      start_time,
      end_time,
      expected_attendees,
      expected_attendance_min,
      expected_attendance_max,
      budget,
      status = 'planning',
    } = body

    const resolvedTitle = title || name
    const resolvedExpectedAttendance =
      expected_attendees ?? expected_attendance_min ?? expected_attendance_max ?? null

    // Validate required fields
    if (!resolvedTitle || !event_date) {
      return NextResponse.json(
        { error: 'Missing required fields: title and event_date are required' },
        { status: 400 }
      )
    }

    // Compute duration_hours from start/end times; default to 1 if indeterminate
    let duration_hours = 1
    if (start_time && end_time && start_time !== end_time) {
      const [sh, sm] = start_time.split(':').map(Number)
      const [eh, em] = end_time.split(':').map(Number)
      const diff = (eh * 60 + em - (sh * 60 + sm)) / 60
      if (diff > 0) duration_hours = diff
    }

    // Create event
    const insertPayload = {
      builder_id: builderProfileId,
      event_name: resolvedTitle,
      event_description: description ?? null,
      description: description ?? null,
      event_type: mapAppEventTypeToDb(event_type),
      event_date,
      start_time: start_time ?? null,
      end_time: end_time ?? null,
      duration_hours,
      expected_attendance: resolvedExpectedAttendance,
      expected_attendance_min: resolvedExpectedAttendance,
      expected_attendance_max: resolvedExpectedAttendance,
      budget: budget ?? null,
      total_budget: budget ?? null,
      status: mapAppEventStatusToDb(status),
      venue_id: null,
    }

    const { data: eventData, error } = await supabase
      .from('events')
      .insert(insertPayload as never)
      .select()
      .single()

    if (error) {
      console.error('Error creating event:', error)
      return NextResponse.json(
        { error: 'Failed to create event' },
        { status: 500 }
      )
    }

    if (eventData) {
      await consumeBuilderEventAccess({
        admin,
        builder: billingProfile as BuilderBillingProfile,
        eventId: (eventData as { id: string }).id,
      })
    }

    return NextResponse.json({
      success: true,
      event: eventData ? mapDbEventToApp(eventData as Record<string, any>) : null,
    })
  } catch (error) {
    if (error instanceof BuilderBillingRequiredError) {
      return NextResponse.json(
        { error: error.message, billingRequired: true },
        { status: error.status }
      )
    }

    console.error('Create event error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
