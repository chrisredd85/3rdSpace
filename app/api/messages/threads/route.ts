import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

    // Fetch all threads where user is a participant
    const { data: threads, error: threadsError } = await supabase
      .from('message_threads')
      .select('*')
      .or(`participant_1_id.eq.${user.id},participant_2_id.eq.${user.id}`)
      .order('last_message_at', { ascending: false, nullsFirst: true })

    if (threadsError) {
      console.error('Error fetching threads:', threadsError)
      return NextResponse.json(
        { error: 'Failed to fetch threads' },
        { status: 500 }
      )
    }

    // For each thread, get the last message and unread count
    const threadsWithDetails = await Promise.all(
      (threads || []).map(async (thread) => {
        // Get last message
        const { data: lastMessage } = await supabase
          .from('messages')
          .select('*')
          .eq('thread_id', thread.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        // Get unread count (messages not read by current user)
        const { count: unreadCount } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('thread_id', thread.id)
          .eq('is_read', false)
          .neq('sender_id', user.id)
          .is('read_at', null)

        // Get other participant's profile
        const otherParticipantId =
          thread.participant_1_id === user.id
            ? thread.participant_2_id
            : thread.participant_1_id

        const { data: otherParticipant } = await supabase
          .from('profiles')
          .select('id, name, email, avatar_url')
          .eq('id', otherParticipantId)
          .single()

        return {
          ...thread,
          last_message: lastMessage || null,
          unread_count: unreadCount || 0,
          other_participant: otherParticipant || null,
        }
      })
    )

    return NextResponse.json({
      threads: threadsWithDetails,
      count: threadsWithDetails.length,
    })
  } catch (error) {
    console.error('Get threads error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
