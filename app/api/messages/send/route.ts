import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  createMessageNotification,
  getAuthorizedThread,
  normalizeAttachments,
  sendOfflineMessageEmail,
  truncateMessage,
  uploadMessageAttachments,
  withSignedAttachmentUrls,
} from '@/lib/messages/vendor-messaging'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Send a message with optional JSON or multipart file attachments.
 */
export async function POST(request: Request) {
  try {
    const supabase = createClient()
    const threadId = await readThreadId(request)
    const access = await getAuthorizedThread(supabase as any, threadId)

    if ('error' in access) {
      if (access.status !== 403) {
        return sendLegacyMessage(request)
      }
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const payload = await readMessagePayload(request, access.thread.id, access.user.id)

    if (!payload.message.trim() && payload.attachments.length === 0) {
      return NextResponse.json({ error: 'Message or attachment is required' }, { status: 400 })
    }

    if (payload.message.length > 10000) {
      return NextResponse.json({ error: 'Message must be 10,000 characters or less' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const { data: createdMessage, error } = await (supabase as any)
      .from('vendor_messages')
      .insert({
        thread_id: access.thread.id,
        sender_id: access.user.id,
        sender_type: access.profile.type,
        message: payload.message.trim(),
        attachments: payload.attachments,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await (supabase as any)
      .from('vendor_message_threads')
      .update({ last_message_at: now, updated_at: now })
      .eq('id', access.thread.id)

    const preview = truncateMessage(payload.message || `${payload.attachments.length} attachment(s)`)
    const notificationClient = getNotificationClient(supabase as any)

    await createMessageNotification(notificationClient, {
      userId: access.recipientUserId,
      threadId: access.thread.id,
      senderName: access.profile.display_name,
      preview,
    }).catch((notificationError) => {
      console.error('[messages.send] Failed to create notification', notificationError)
    })

    await sendOfflineMessageEmail(notificationClient, {
      recipientUserId: access.recipientUserId,
      threadId: access.thread.id,
      senderName: access.profile.display_name,
      preview,
      origin: new URL(request.url).origin,
    }).catch((emailError) => {
      console.error('[messages.send] Failed to send offline email', emailError)
    })

    const [message] = await withSignedAttachmentUrls(supabase as any, [createdMessage])
    return NextResponse.json({ message })
  } catch (error) {
    console.error('[messages.send.POST] Failed to send message', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send message' },
      { status: 500 }
    )
  }
}

/**
 * Preserves the existing generic message sender for non-vendor message threads.
 */
async function sendLegacyMessage(request: Request) {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const threadId = body.thread_id || body.threadId
  const content = body.content || body.message

  if (!threadId || !content || content.trim().length === 0) {
    return NextResponse.json(
      { error: 'Missing required fields: thread_id and content are required' },
      { status: 400 }
    )
  }

  const { data: thread, error: threadError } = await supabase
    .from('message_threads')
    .select('*')
    .eq('id', threadId)
    .or(`participant_1_id.eq.${user.id},participant_2_id.eq.${user.id}`)
    .single()

  if (threadError || !thread) {
    return NextResponse.json({ error: 'Thread not found or unauthorized' }, { status: 404 })
  }

  const legacyThread = thread as any
  const receiverId = legacyThread.participant_1_id === user.id ? legacyThread.participant_2_id : legacyThread.participant_1_id
  const { data: message, error: messageError } = await supabase
    .from('messages')
    .insert({
      thread_id: threadId,
      sender_id: user.id,
      receiver_id: receiverId,
      content: content.trim(),
      read: false,
      read_at: null,
      booking_id: legacyThread.booking_type === 'legacy_booking' ? legacyThread.booking_id : null,
      venue_booking_id: legacyThread.booking_type === 'venue_booking' ? legacyThread.booking_id : null,
      vendor_booking_id: legacyThread.booking_type === 'vendor_booking' ? legacyThread.booking_id : null,
    } as never)
    .select()
    .single()

  if (messageError) {
    console.error('Error creating legacy message:', messageError)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }

  await supabase
    .from('message_threads')
    .update({
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', threadId)

  const { data: sender } = await (supabase as any)
    .from('users')
    .select('id, company_name, email')
    .eq('id', user.id)
    .maybeSingle()

  return NextResponse.json({
    success: true,
    message: {
      ...(message as Record<string, unknown>),
      is_read: Boolean((message as { read?: boolean | null }).read),
      profiles: sender
        ? {
            id: (sender as { id: string }).id,
            name:
              (sender as { company_name: string | null; email: string }).company_name ||
              (sender as { email: string }).email,
            email: (sender as { email: string }).email,
            avatar_url: null,
          }
        : null,
    },
  })
}

/**
 * Uses service role for cross-user notification/email work when configured.
 */
function getNotificationClient(fallback: any) {
  try {
    return createServiceRoleClient() as any
  } catch {
    return fallback
  }
}

/**
 * Reads only the thread id from a JSON or multipart request without consuming the final body twice.
 */
async function readThreadId(request: Request) {
  const contentType = request.headers.get('content-type') || ''
  const clone = request.clone()

  if (contentType.includes('multipart/form-data')) {
    const formData = await clone.formData()
    return String(formData.get('threadId') || formData.get('thread_id') || '')
  }

  const body = await clone.json().catch(() => ({}))
  return String(body.threadId || body.thread_id || '')
}

/**
 * Reads message text and uploads any files included in the request.
 */
async function readMessagePayload(request: Request, threadId: string, userId: string) {
  const supabase = createClient()
  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const files = formData
      .getAll('attachments')
      .filter((value): value is File => value instanceof File && value.size > 0)
    const attachments = await uploadMessageAttachments(supabase as any, { threadId, userId, files })

    return {
      message: String(formData.get('message') || ''),
      attachments,
    }
  }

  const body = await request.json().catch(() => ({}))

  return {
    message: String(body.message || body.content || ''),
    attachments: normalizeAttachments(body.attachments),
  }
}
