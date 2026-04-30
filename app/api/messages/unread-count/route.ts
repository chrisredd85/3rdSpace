import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMessagingProfile } from '@/lib/messages/vendor-messaging'

export const dynamic = 'force-dynamic'

/**
 * Lightweight unread-message count for the dashboard sidebar.
 */
export async function GET() {
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
      return NextResponse.json({ count: 0 })
    }

    let threadsQuery = (supabase as any)
      .from('vendor_message_threads')
      .select('id')

    threadsQuery = profile.type === 'builder'
      ? threadsQuery.eq('builder_id', profile.id)
      : threadsQuery.eq('vendor_id', profile.id)

    const { data: threads, error: threadsError } = await threadsQuery
    if (threadsError) {
      return NextResponse.json({ error: threadsError.message }, { status: 500 })
    }

    const threadIds = ((threads || []) as Array<{ id: string }>).map((thread) => thread.id)
    if (threadIds.length === 0) {
      return NextResponse.json({ count: 0 })
    }

    const { count, error } = await (supabase as any)
      .from('vendor_messages')
      .select('id', { count: 'exact', head: true })
      .in('thread_id', threadIds)
      .is('read_at', null)
      .neq('sender_type', profile.type)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(
      { count: count || 0 },
      { headers: { 'Cache-Control': 'private, max-age=20, stale-while-revalidate=60' } }
    )
  } catch (error) {
    console.error('[messages.unread-count.GET] Failed to load unread count', error)
    return NextResponse.json({ error: 'Failed to load unread count' }, { status: 500 })
  }
}
