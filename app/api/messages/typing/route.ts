import { createClient } from '@/lib/supabase/server'
import { getAuthorizedThread } from '@/lib/messages/vendor-messaging'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Record that the current user is typing in a message thread.
 */
export async function POST(request: Request) {
  try {
    const { threadId } = await request.json().catch(() => ({}))
    if (!threadId) {
      return NextResponse.json({ error: 'threadId is required' }, { status: 400 })
    }

    const supabase = createClient()
    const access = await getAuthorizedThread(supabase as any, String(threadId))

    if ('error' in access) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const { error } = await (supabase as any)
      .from('vendor_message_typing_indicators')
      .upsert({
        thread_id: access.thread.id,
        user_id: access.user.id,
        sender_type: access.profile.type,
        updated_at: new Date().toISOString(),
      })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ typing: true })
  } catch (error) {
    console.error('[messages.typing.POST] Failed to record typing state', error)
    return NextResponse.json({ error: 'Failed to update typing state' }, { status: 500 })
  }
}

/**
 * Get recent typing indicators from the other participant in a thread.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const threadId = searchParams.get('threadId')

    if (!threadId) {
      return NextResponse.json({ error: 'threadId is required' }, { status: 400 })
    }

    const supabase = createClient()
    const access = await getAuthorizedThread(supabase as any, threadId)

    if ('error' in access) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const staleBefore = new Date(Date.now() - 5000).toISOString()
    const { data, error } = await (supabase as any)
      .from('vendor_message_typing_indicators')
      .select('sender_type, updated_at')
      .eq('thread_id', threadId)
      .neq('sender_type', access.profile.type)
      .gt('updated_at', staleBefore)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ typing: (data || []).length > 0 })
  } catch (error) {
    console.error('[messages.typing.GET] Failed to load typing state', error)
    return NextResponse.json({ error: 'Failed to load typing state' }, { status: 500 })
  }
}
