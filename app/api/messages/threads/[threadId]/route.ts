import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface RouteContext {
  params: {
    threadId: string
  }
}

export async function GET(
  request: NextRequest,
  { params }: RouteContext
) {
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

    const { threadId } = params

    // Verify user is a participant in this thread
    const { data: thread, error: threadError } = await supabase
      .from('message_threads')
      .select('*')
      .eq('id', threadId)
      .or(`participant_1_id.eq.${user.id},participant_2_id.eq.${user.id}`)
      .single()

    if (threadError || !thread) {
      return NextResponse.json(
        { error: 'Thread not found or unauthorized' },
        { status: 404 }
      )
    }

    // Fetch all messages in thread
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('*, profiles!messages_sender_id_fkey(id, name, email, avatar_url)')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })

    if (messagesError) {
      console.error('Error fetching messages:', messagesError)
      return NextResponse.json(
        { error: 'Failed to fetch messages' },
        { status: 500 }
      )
    }

    // Mark all unread messages as read (where user is not the sender)
    const unreadMessages = (messages || []).filter(
      (msg) => !msg.is_read && msg.sender_id !== user.id
    )

    if (unreadMessages.length > 0) {
      const messageIds = unreadMessages.map((msg) => msg.id)
      await supabase
        .from('messages')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .in('id', messageIds)
    }

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

    return NextResponse.json({
      thread: {
        ...thread,
        other_participant: otherParticipant || null,
      },
      messages: messages || [],
      count: messages?.length || 0,
    })
  } catch (error) {
    console.error('Get thread messages error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
