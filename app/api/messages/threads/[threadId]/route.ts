import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getAuthorizedThread,
  withSignedAttachmentUrls,
  type VendorMessage,
} from '@/lib/messages/vendor-messaging'
import type { Message, MessageThread } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: {
    threadId: string
  }
}

/**
 * Get messages for either the new vendor-booking thread model or legacy generic threads.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const vendorResponse = await getVendorThreadResponse(params.threadId)
  if (vendorResponse) return vendorResponse

  return getLegacyThreadResponse(params.threadId)
}

/**
 * Returns the vendor-booking thread response when the id belongs to the new messaging model.
 */
async function getVendorThreadResponse(threadId: string) {
  const supabase = createClient()
  const access = await getAuthorizedThread(supabase as any, threadId)

  if ('error' in access) {
    if (access.status === 403) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    return null
  }

  const { data, error } = await (supabase as any)
    .from('vendor_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const messages = (data || []) as VendorMessage[]
  const unreadIds = messages
    .filter((message) => !message.read_at && message.sender_type !== access.profile.type)
    .map((message) => message.id)

  if (unreadIds.length > 0) {
    await (supabase as any)
      .from('vendor_messages')
      .update({ read_at: new Date().toISOString() })
      .in('id', unreadIds)
  }

  const signedMessages = await withSignedAttachmentUrls(supabase as any, messages)
  const legacyMessages = signedMessages.map((message) => ({
    ...message,
    content: message.message,
    is_read: Boolean(message.read_at),
    profiles: null,
  }))

  return NextResponse.json({
    thread: {
      ...access.thread,
      participant_1_id: access.thread.builder_id,
      participant_2_id: access.thread.vendor_id,
      vendor_booking_id: access.thread.booking_id,
      venue_booking_id: null,
      other_participant: null,
    },
    messages: legacyMessages,
    count: legacyMessages.length,
  })
}

/**
 * Returns the existing generic message thread response for older venue/general messaging flows.
 */
async function getLegacyThreadResponse(threadId: string) {
  try {
    const supabase = createClient()

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

    const threadData = thread as MessageThread

    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .eq('thread_id', threadId)
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order('created_at', { ascending: true })

    if (messagesError) {
      console.error('Error fetching messages:', messagesError)
      return NextResponse.json(
        { error: 'Failed to fetch messages' },
        { status: 500 }
      )
    }

    const rawMessages = (messages || []) as Array<Message & { read?: boolean | null }>
    const senderProfiles = await loadUserSummaries(
      supabase,
      Array.from(new Set(rawMessages.map((message) => message.sender_id)))
    )
    const messagesList = rawMessages.map((message) => ({
      ...message,
      is_read: Boolean(message.read),
      profiles: senderProfiles.get(message.sender_id) || null,
    })) as Message[]
    const unreadMessages = messagesList.filter(
      (msg) => !msg.is_read && msg.sender_id !== user.id
    )

    if (unreadMessages.length > 0) {
      const messageIds = unreadMessages.map((msg) => msg.id)
      await supabase
        .from('messages')
        .update({
          read: true,
          read_at: new Date().toISOString(),
        } as never)
        .in('id', messageIds)
        .eq('receiver_id', user.id)
    }

    const otherParticipantId =
      threadData.participant_1_id === user.id
        ? threadData.participant_2_id
        : threadData.participant_1_id

    const otherParticipant = (await loadUserSummaries(supabase, [otherParticipantId])).get(otherParticipantId) || null

    return NextResponse.json({
      thread: {
        ...threadData,
        other_participant: otherParticipant || null,
      },
      messages: messagesList,
      count: messagesList.length,
    })
  } catch (error) {
    console.error('Get thread messages error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}

async function loadUserSummaries(supabase: ReturnType<typeof createClient>, userIds: string[]) {
  const summaries = new Map<string, { id: string; name: string; email: string; avatar_url: null }>()
  if (userIds.length === 0) return summaries

  const { data } = await (supabase as any)
    .from('users')
    .select('id, company_name, email')
    .in('id', userIds)

  ;((data || []) as Array<{ id: string; company_name: string | null; email: string }>).forEach((user) => {
    summaries.set(user.id, {
      id: user.id,
      name: user.company_name || user.email,
      email: user.email,
      avatar_url: null,
    })
  })

  return summaries
}
