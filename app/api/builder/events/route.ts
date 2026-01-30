import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Event, EventStatus } from '@/lib/types'

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

    // Get query parameters
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') as EventStatus | null
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    // Build query
    let query = supabase
      .from('events')
      .select('*')
      .eq('builder_id', user.id)
      .order('event_date', { ascending: false })
      .range(offset, offset + limit - 1)

    // Apply status filter if provided
    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    const { data: events, error } = await query

    if (error) {
      console.error('Error fetching events:', error)
      return NextResponse.json(
        { error: 'Failed to fetch events' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      events: events || [],
      count: events?.length || 0,
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

    const body = await request.json()
    const {
      title,
      description,
      event_type,
      event_date,
      start_time,
      end_time,
      expected_attendance_min,
      expected_attendance_max,
      budget,
      status = 'planning',
    } = body

    // Validate required fields
    if (!title || !event_date) {
      return NextResponse.json(
        { error: 'Missing required fields: title and event_date are required' },
        { status: 400 }
      )
    }

    // Create event
    const { data: event, error } = await supabase
      .from('events')
      .insert({
        builder_id: user.id,
        title,
        description: description || null,
        event_type: event_type || null,
        event_date,
        start_time: start_time || null,
        end_time: end_time || null,
        expected_attendance_min: expected_attendance_min || null,
        expected_attendance_max: expected_attendance_max || null,
        budget: budget || null,
        status,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating event:', error)
      return NextResponse.json(
        { error: 'Failed to create event' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      event,
    })
  } catch (error) {
    console.error('Create event error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
