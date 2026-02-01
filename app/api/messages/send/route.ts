import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
    const { thread_id, content } = body

    // Validate required fields
    if (!thread_id || !content || content.trim().length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields: thread_id and content are required' },
        { status: 400 }
      )
    }

    // Verify user is a participant in this thread
    const { data: thread, error: threadError } = await supabase
      .from('message_threads')
      .select('*')
      .eq('id', thread_id)
      .or(`participant_1_id.eq.${user.id},participant_2_id.eq.${user.id}`)
      .single()

    if (threadError || !thread) {
      return NextResponse.json(
        { error: 'Thread not found or unauthorized' },
        { status: 404 }
      )
    }

    // Create message
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .insert({
        thread_id,
        sender_id: user.id,
        content: content.trim(),
        is_read: false,
        read_at: null,
      } as never)
      .select()
      .single()

    if (messageError) {
      console.error('Error creating message:', messageError)
      return NextResponse.json(
        { error: 'Failed to send message' },
        { status: 500 }
      )
    }

    // Update thread last_message_at
    await supabase
      .from('message_threads')
      .update({
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', thread_id)

    // Get message with sender profile
    const { data: messageWithSender } = await supabase
      .from('messages')
      .select('*, profiles!messages_sender_id_fkey(id, name, email, avatar_url)')
      .eq('id', (message as { id: string }).id)
      .single()

    return NextResponse.json({
      success: true,
      message: messageWithSender,
    })
  } catch (error) {
    console.error('Send message error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
