import { createClient } from '@/lib/supabase/server'
import {
  getCurrentMessagingProfile,
  signAttachments,
  truncateMessage,
  type VendorMessage,
  type VendorMessageThread,
} from '@/lib/messages/vendor-messaging'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Get all message threads for the current builder or vendor.
 */
export async function GET(request: Request) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = await getCurrentMessagingProfile(supabase as any, user.id)
    if (!profile) {
      return NextResponse.json({ error: 'No profile found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('q')?.trim()

    let query = (supabase as any)
      .from('vendor_message_threads')
      .select(`
        *,
        vendor_profiles(id, name, business_name, user_id),
        builder_profiles(id, name, user_id),
        vendor_bookings(id, status),
        vendor_messages(
          id,
          thread_id,
          sender_id,
          sender_type,
          message,
          attachments,
          read_at,
          created_at
        )
      `)
      .order('last_message_at', { ascending: false, nullsFirst: false })

    query = profile.type === 'builder'
      ? query.eq('builder_id', profile.id)
      : query.eq('vendor_id', profile.id)

    const { data: threads, error } = await query

    if (error) {
      if (isMessageThreadStoreUnavailable(error)) {
        console.error('[messages.threads.GET] Message store unavailable; returning empty inbox', {
          code: error.code,
          message: error.message,
          hint: error.hint,
        })
        return NextResponse.json({ threads: [] })
      }

      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const matchingThreads = search
      ? ((threads || []) as any[]).filter((thread) => threadMatchesSearch(thread, search))
      : ((threads || []) as any[])

    const threadsWithDetails = await Promise.all(
      matchingThreads.map(async (thread) => formatThreadForResponse(supabase as any, thread, profile.type))
    )

    return NextResponse.json({ threads: threadsWithDetails })
  } catch (error) {
    console.error('[messages.threads.GET] Failed to load threads', error)
    return NextResponse.json({ error: 'Failed to load message threads' }, { status: 500 })
  }
}

/**
 * Checks whether a thread subject or any loaded message body matches the search query.
 */
function threadMatchesSearch(thread: any, search: string) {
  const query = search.toLowerCase()
  const subjectMatches = String(thread.subject || '').toLowerCase().includes(query)
  const messageMatches = ((thread.vendor_messages || []) as any[]).some((message) => {
    return String(message.message || '').toLowerCase().includes(query)
  })

  return subjectMatches || messageMatches
}

type MessageThreadStoreError = {
  code?: string | null
  message?: string | null
  hint?: string | null
}

function isMessageThreadStoreUnavailable(error: MessageThreadStoreError) {
  const code = error.code ?? ''
  const message = (error.message ?? '').toLowerCase()

  return (
    code === 'PGRST200' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    code === '42P01' ||
    code === '42703' ||
    message.includes('vendor_message_threads') ||
    message.includes('vendor_messages') ||
    message.includes('could not find a relationship') ||
    message.includes('could not find the table') ||
    message.includes('schema cache')
  )
}

/**
 * Create or return the message thread for a vendor booking.
 */
export async function POST(request: Request) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const bookingId = String(body.bookingId || body.booking_id || '')
    const subject = typeof body.subject === 'string' ? body.subject.trim() : ''

    if (!bookingId) {
      return NextResponse.json({ error: 'bookingId is required' }, { status: 400 })
    }

    const profile = await getCurrentMessagingProfile(supabase as any, user.id)
    if (!profile) {
      return NextResponse.json({ error: 'No profile found' }, { status: 404 })
    }

    const { data: booking, error: bookingError } = await (supabase as any)
      .from('vendor_bookings')
      .select('id, vendor_id, event_id, status')
      .eq('id', bookingId)
      .maybeSingle()

    if (bookingError) {
      return NextResponse.json({ error: bookingError.message }, { status: 500 })
    }

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    const { data: event, error: eventError } = await (supabase as any)
      .from('events')
      .select('id, builder_id')
      .eq('id', booking.event_id)
      .maybeSingle()

    if (eventError) {
      return NextResponse.json({ error: eventError.message }, { status: 500 })
    }

    if (!event?.builder_id) {
      return NextResponse.json({ error: 'Booking event not found' }, { status: 404 })
    }

    const isParticipant =
      (profile.type === 'builder' && event.builder_id === profile.id) ||
      (profile.type === 'vendor' && booking.vendor_id === profile.id)

    if (!isParticipant) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const { data: existingThread, error: existingError } = await (supabase as any)
      .from('vendor_message_threads')
      .select('*')
      .eq('booking_id', bookingId)
      .maybeSingle()

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 })
    }

    if (existingThread) {
      return NextResponse.json({ thread: existingThread, isNew: false })
    }

    const { data: thread, error } = await (supabase as any)
      .from('vendor_message_threads')
      .insert({
        booking_id: bookingId,
        vendor_id: booking.vendor_id,
        builder_id: event.builder_id,
        subject: subject || 'Booking discussion',
        status: 'active',
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ thread, isNew: true })
  } catch (error) {
    console.error('[messages.threads.POST] Failed to create thread', error)
    return NextResponse.json({ error: 'Failed to create message thread' }, { status: 500 })
  }
}

/**
 * Formats a thread row with unread count, participant names, and signed last-message attachments.
 */
async function formatThreadForResponse(supabase: any, thread: any, currentUserType: 'builder' | 'vendor') {
  const messages = ((thread.vendor_messages || []) as VendorMessage[]).sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
  const lastMessage = messages[0] || null
  const unreadCount = messages.filter((message) => !message.read_at && message.sender_type !== currentUserType).length
  const signedLastMessage = lastMessage
    ? { ...lastMessage, attachments: await signAttachments(supabase, lastMessage.attachments) }
    : null

  return {
    ...(thread as VendorMessageThread),
    participant_1_id: thread.builder_profiles?.user_id || null,
    participant_2_id: thread.vendor_profiles?.user_id || null,
    vendor_booking_id: thread.booking_id,
    venue_booking_id: null,
    event_id: null,
    vendor_profiles: thread.vendor_profiles,
    builder_profiles: thread.builder_profiles,
    vendor_bookings: thread.vendor_bookings,
    other_participant: currentUserType === 'builder'
      ? {
          id: thread.vendor_profiles?.user_id || thread.vendor_id,
          name: thread.vendor_profiles?.business_name || thread.vendor_profiles?.name || null,
          email: '',
          avatar_url: null,
        }
      : {
          id: thread.builder_profiles?.user_id || thread.builder_id,
          name: thread.builder_profiles?.name || null,
          email: '',
          avatar_url: null,
        },
    vendor_messages: undefined,
    unread_count: unreadCount,
    last_message: signedLastMessage
      ? {
          ...signedLastMessage,
          content: signedLastMessage.message,
          is_read: Boolean(signedLastMessage.read_at),
          preview: truncateMessage(signedLastMessage.message),
        }
      : null,
  }
}
