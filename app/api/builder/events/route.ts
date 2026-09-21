export const dynamic = 'force-dynamic'
import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { Event, EventStatus } from '@/lib/types'
import {
  getBuilderBillingSummary,
  loadBuilderBillingProfileById,
  type BuilderBillingProfile,
} from '@/lib/billing/builder-billing'
import { dollarsToCents, toFiniteNumber } from '@/lib/money'
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

    const body = await request.json()
    const {
      title,
      name,
      description,
      event_type,
      event_date,
      event_time,
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
    const resolvedBudget = budget == null ? null : toFiniteNumber(budget)

    // Validate required fields
    if (!resolvedTitle || !event_date) {
      return NextResponse.json(
        { error: 'Missing required fields: title and event_date are required' },
        { status: 400 }
      )
    }

    if (budget != null && (resolvedBudget == null || resolvedBudget < 0)) {
      return NextResponse.json(
        { error: 'Budget must be a non-negative number' },
        { status: 400 }
      )
    }

    const idempotencyKey = request.headers.get('idempotency-key') ?? body.client_request_id
    if (
      typeof idempotencyKey !== 'string'
      || idempotencyKey.trim().length < 8
      || idempotencyKey.trim().length > 200
    ) {
      return NextResponse.json(
        { error: 'A valid Idempotency-Key header is required' },
        { status: 400 }
      )
    }

    // Compute duration_hours from start/end times; default to 1 if indeterminate
    const resolvedStartTime = start_time ?? event_time ?? null
    let duration_hours = 1
    if (resolvedStartTime && end_time && resolvedStartTime !== end_time) {
      const [sh, sm] = resolvedStartTime.split(':').map(Number)
      const [eh, em] = end_time.split(':').map(Number)
      const diff = (eh * 60 + em - (sh * 60 + sm)) / 60
      if (diff > 0) duration_hours = diff
    }

    const materializationPayload = {
      userId: user.id,
      builderId: builderProfileId,
      title: resolvedTitle,
      description: description ?? null,
      eventType: mapAppEventTypeToDb(event_type),
      event_date,
      startTime: resolvedStartTime,
      endTime: end_time ?? null,
      durationHours: duration_hours,
      expectedAttendance: resolvedExpectedAttendance,
      budgetCents: resolvedBudget == null ? null : dollarsToCents(resolvedBudget),
      status: mapAppEventStatusToDb(status),
    }
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(materializationPayload))
      .digest('hex')

    const { data: materializationData, error: materializationError } = await (admin as any)
      .rpc('materialize_builder_event_with_access', {
        p_user_id: user.id,
        p_builder_id: builderProfileId,
        p_idempotency_key: idempotencyKey.trim(),
        p_payload_hash: payloadHash,
        p_title: resolvedTitle,
        p_description: description ?? null,
        p_event_type: materializationPayload.eventType,
        p_event_date: event_date,
        p_start_time: resolvedStartTime,
        p_end_time: end_time ?? null,
        p_duration_hours: duration_hours,
        p_expected_attendance: resolvedExpectedAttendance,
        p_budget_cents: materializationPayload.budgetCents,
        p_status: materializationPayload.status,
      })
      .maybeSingle()

    if (materializationError) {
      const errorText = [
        materializationError.message,
        materializationError.details,
      ].filter(Boolean).join(' ')

      if (
        materializationError.code === 'P0001'
        && /builder_billing_required/i.test(errorText)
      ) {
        return NextResponse.json(
          {
            error: 'Choose pay-per-event or Pro to create another event.',
            billingRequired: true,
            billing: billingSummary,
          },
          { status: 402 }
        )
      }

      if (/builder_event_materialization_idempotency_conflict/i.test(errorText)) {
        return NextResponse.json(
          { error: 'Idempotency key was already used for a different event' },
          { status: 409 }
        )
      }

      console.error('Error materializing event:', materializationError)
      return NextResponse.json(
        { error: 'Failed to create event' },
        { status: 500 }
      )
    }

    if (!materializationData?.event_record) {
      console.error('Event materialization returned no event record')
      return NextResponse.json(
        { error: 'Failed to create event' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      event: mapDbEventToApp(materializationData.event_record as Record<string, any>),
      planId: materializationData.plan_id,
      replayed: Boolean(materializationData.existing),
      consumption: {
        id: materializationData.consumption_id,
        source: materializationData.access_source,
        amountCents: materializationData.amount_cents,
      },
    })
  } catch (error) {
    console.error('Create event error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
