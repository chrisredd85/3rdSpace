import { createClient } from '@/lib/supabase/server'
import {
  getAuthorizedThread,
  withSignedAttachmentUrls,
  type VendorMessage,
} from '@/lib/messages/vendor-messaging'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: {
    threadId: string
  }
}

/**
 * Get messages in a booking thread and mark received messages as read.
 */
export async function GET(request: Request, { params }: RouteContext) {
  try {
    const supabase = createClient()
    const access = await getAuthorizedThread(supabase as any, params.threadId)

    if ('error' in access) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const { searchParams } = new URL(request.url)
    const after = searchParams.get('after')
    const search = searchParams.get('q')?.trim()

    let query = (supabase as any)
      .from('vendor_messages')
      .select('*')
      .eq('thread_id', params.threadId)
      .order('created_at', { ascending: true })

    if (search) {
      query = query.ilike('message', `%${search}%`)
    }

    if (after) {
      const { data: afterMessage } = await (supabase as any)
        .from('vendor_messages')
        .select('created_at')
        .eq('id', after)
        .eq('thread_id', params.threadId)
        .maybeSingle()

      if (afterMessage?.created_at) {
        query = query.gt('created_at', afterMessage.created_at)
      }
    }

    const { data, error } = await query

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

    return NextResponse.json({
      thread: access.thread,
      current_user_type: access.profile.type,
      messages: signedMessages,
    })
  } catch (error) {
    console.error('[messages.thread.GET] Failed to load messages', error)
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
  }
}
