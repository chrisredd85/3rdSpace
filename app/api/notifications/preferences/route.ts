import { createClient } from '@/lib/supabase/server'
import { getNotificationPreferences, updateNotificationPreferences } from '@/lib/notifications'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Get notification preferences for the current user.
 *
 * @route GET /api/notifications/preferences
 * @auth Required
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

    const preferences = await getNotificationPreferences(user.id, supabase as any)
    return NextResponse.json({ preferences })
  } catch (error) {
    console.error('[notifications.preferences.GET] Failed to load preferences', error)
    return NextResponse.json({ error: 'Failed to load notification preferences' }, { status: 500 })
  }
}

/**
 * Update notification preferences for the current user.
 *
 * @route PUT /api/notifications/preferences
 * @auth Required
 */
export async function PUT(request: Request) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const current = await getNotificationPreferences(user.id, supabase as any)
    const preferences = await updateNotificationPreferences(user.id, {
      email_enabled: typeof body.email_enabled === 'boolean' ? body.email_enabled : current.email_enabled,
      push_enabled: typeof body.push_enabled === 'boolean' ? body.push_enabled : current.push_enabled,
      sound_enabled: typeof body.sound_enabled === 'boolean' ? body.sound_enabled : current.sound_enabled,
      preferences: typeof body.preferences === 'object' && body.preferences ? body.preferences : current.preferences,
    }, supabase as any)

    return NextResponse.json({ preferences })
  } catch (error) {
    console.error('[notifications.preferences.PUT] Failed to update preferences', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update notification preferences' },
      { status: 500 }
    )
  }
}
