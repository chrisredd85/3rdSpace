import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Get notifications for the current user.
 *
 * @route GET /api/notifications?unread_only={boolean}
 * @auth Required
 */
export async function GET(request: Request) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const unreadOnly = searchParams.get('unread_only') === 'true'

    let query = (supabase as any)
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (unreadOnly) {
      query = query.or('read_at.is.null,is_read.eq.false')
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ notifications: normalizeNotifications(data || []) })
  } catch (error) {
    console.error('[notifications.GET] Failed to load notifications', error)
    return NextResponse.json({ error: 'Failed to load notifications' }, { status: 500 })
  }
}

/**
 * Mark a notification as read for the current user.
 *
 * @route PATCH /api/notifications
 * @auth Required
 */
export async function PATCH(request: Request) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { notificationId } = await request.json().catch(() => ({}))
    if (!notificationId) {
      return NextResponse.json({ error: 'notificationId is required' }, { status: 400 })
    }

    const readAt = new Date().toISOString()
    const { data, error } = await (supabase as any)
      .from('notifications')
      .update({ read_at: readAt, is_read: true })
      .eq('id', notificationId)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ notification: normalizeNotification(data) })
  } catch (error) {
    console.error('[notifications.PATCH] Failed to mark notification read', error)
    return NextResponse.json({ error: 'Failed to mark notification read' }, { status: 500 })
  }
}

/**
 * Delete a notification for the current user.
 *
 * @route DELETE /api/notifications?id={notificationId}
 * @auth Required
 */
export async function DELETE(request: Request) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const notificationId = searchParams.get('id')

    if (!notificationId) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const { error } = await (supabase as any)
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('user_id', user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[notifications.DELETE] Failed to delete notification', error)
    return NextResponse.json({ error: 'Failed to delete notification' }, { status: 500 })
  }
}

/**
 * Normalizes notification rows across legacy and current column names.
 */
function normalizeNotifications(rows: any[]) {
  return rows.map(normalizeNotification)
}

/**
 * Normalizes a notification row across legacy and current column names.
 */
function normalizeNotification(row: any) {
  const type = row.type || row.notification_type || 'reminder'
  const link = row.link || row.action_url || row.link_url || null
  const readAt = row.read_at || null

  return {
    ...row,
    type,
    notification_type: row.notification_type || type,
    link,
    action_url: row.action_url || link,
    link_url: row.link_url || link,
    read_at: readAt,
    is_read: Boolean(row.is_read || readAt),
    metadata: row.metadata || {},
  }
}
