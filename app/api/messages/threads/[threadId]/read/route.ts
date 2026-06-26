import { createClient } from '@/lib/supabase/server'
import { getAuthorizedThread } from '@/lib/messages/vendor-messaging'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{
    threadId: string
  }>
}

/**
 * Mark one vendor-booking or legacy generic message thread as read.
 */
export async function POST(_request: Request, props: RouteContext) {
  const params = await props.params;
  const vendorResponse = await markVendorThreadRead(params.threadId)
  if (vendorResponse) return vendorResponse

  return markLegacyThreadRead(params.threadId)
}

/**
 * Marks unread messages in the new vendor-booking thread model as read.
 */
async function markVendorThreadRead(threadId: string) {
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
    .update({ read_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .neq('sender_type', access.profile.type)
    .is('read_at', null)
    .select('id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ updated: data?.length || 0 })
}

/**
 * Marks unread messages in the older generic thread model as read.
 */
async function markLegacyThreadRead(threadId: string) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: thread } = await supabase
      .from('message_threads')
      .select('id')
      .eq('id', threadId)
      .or(`participant_1_id.eq.${user.id},participant_2_id.eq.${user.id}`)
      .maybeSingle()

    if (!thread) {
      return NextResponse.json({ error: 'Thread not found or unauthorized' }, { status: 404 })
    }

    const { data, error } = await supabase
      .from('messages')
      .update({ read: true, read_at: new Date().toISOString() } as never)
      .eq('thread_id', threadId)
      .neq('sender_id', user.id)
      .eq('receiver_id', user.id)
      .is('read_at', null)
      .select('id')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ updated: data?.length || 0 })
  } catch (error) {
    console.error('[messages.threads.read.POST] Failed to mark legacy thread read', error)
    return NextResponse.json({ error: 'Failed to mark thread read' }, { status: 500 })
  }
}
