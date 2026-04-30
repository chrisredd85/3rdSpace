import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Mark all notifications as read for the current user.
 *
 * @route POST /api/notifications/mark-all-read
 * @auth Required
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

    const { data, error } = await (supabase as any)
      .from('notifications')
      .update({ read_at: new Date().toISOString(), is_read: true })
      .eq('user_id', user.id)
      .or('read_at.is.null,is_read.eq.false')
      .select('id')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, updated: data?.length || 0 })
  } catch (error) {
    console.error('[notifications.mark-all-read.POST] Failed to mark all read', error)
    return NextResponse.json({ error: 'Failed to mark all notifications read' }, { status: 500 })
  }
}
