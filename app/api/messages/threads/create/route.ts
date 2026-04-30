import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

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

    const body = await request.json()
    const {
      participant_2_id,
      event_id,
      venue_booking_id,
      vendor_booking_id,
    } = body
    const bookingId = venue_booking_id || vendor_booking_id || null
    const bookingType = venue_booking_id
      ? 'venue_booking'
      : vendor_booking_id
        ? 'vendor_booking'
        : 'general'

    // Validate required fields
    if (!participant_2_id) {
      return NextResponse.json(
        { error: 'Missing required field: participant_2_id' },
        { status: 400 }
      )
    }

    // Check if thread already exists between these participants for this booking context.
    let existingThreadQuery = supabase
      .from('message_threads')
      .select('*')
      .or(
        `and(participant_1_id.eq.${user.id},participant_2_id.eq.${participant_2_id}),and(participant_1_id.eq.${participant_2_id},participant_2_id.eq.${user.id})`
      )
      .eq('booking_type', bookingType)

    existingThreadQuery = bookingId
      ? existingThreadQuery.eq('booking_id', bookingId)
      : existingThreadQuery.is('booking_id', null)

    const { data: existingThread } = await existingThreadQuery.maybeSingle()

    if (existingThread) {
      // Return existing thread
      return NextResponse.json({
        success: true,
        thread: existingThread,
        isNew: false,
      })
    }

    // Create new thread
    const { data: thread, error: threadError } = await supabase
      .from('message_threads')
      .insert({
        participant_1_id: user.id,
        participant_2_id,
        event_id: event_id || null,
        booking_id: bookingId,
        booking_type: bookingType,
        last_message_at: null,
      } as never)
      .select()
      .single()

    if (threadError) {
      console.error('Error creating thread:', threadError)
      return NextResponse.json(
        { error: 'Failed to create thread' },
        { status: 500 }
      )
    }

    // Get other participant's profile
    const { data: otherParticipant } = await (supabase as any)
      .from('users')
      .select('id, company_name, email')
      .eq('id', participant_2_id)
      .maybeSingle()

    return NextResponse.json({
      success: true,
      thread: {
        ...(thread as Record<string, unknown>),
        other_participant: otherParticipant
          ? {
              id: (otherParticipant as { id: string }).id,
              name:
                (otherParticipant as { company_name: string | null; email: string }).company_name ||
                (otherParticipant as { email: string }).email,
              email: (otherParticipant as { email: string }).email,
              avatar_url: null,
            }
          : null,
      },
      isNew: true,
    })
  } catch (error) {
    console.error('Create thread error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
