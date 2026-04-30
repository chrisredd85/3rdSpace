import { createClient } from '@/lib/supabase/server'
import { getCurrentMessagingProfile } from '@/lib/messages/vendor-messaging'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Mark all received vendor-booking messages as read for the current user.
 */
export async function POST() {
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

    const threadColumn = profile.type === 'builder' ? 'builder_id' : 'vendor_id'
    const { data: threads, error: threadError } = await (supabase as any)
      .from('vendor_message_threads')
      .select('id')
      .eq(threadColumn, profile.id)

    if (threadError) {
      return NextResponse.json({ error: threadError.message }, { status: 500 })
    }

    const threadIds = (threads || []).map((thread: { id: string }) => thread.id)
    if (threadIds.length === 0) {
      return NextResponse.json({ updated: 0 })
    }

    const { data, error } = await (supabase as any)
      .from('vendor_messages')
      .update({ read_at: new Date().toISOString() })
      .in('thread_id', threadIds)
      .neq('sender_type', profile.type)
      .is('read_at', null)
      .select('id')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ updated: data?.length || 0 })
  } catch (error) {
    console.error('[messages.read.POST] Failed to mark messages read', error)
    return NextResponse.json({ error: 'Failed to mark messages read' }, { status: 500 })
  }
}
