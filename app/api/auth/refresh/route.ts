export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Refresh the current user's session
 * This endpoint can be called to refresh an expiring session
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()

    // Get current session
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'No active session' },
        { status: 401 }
      )
    }

    // Refresh the session
    const {
      data: { session: refreshedSession },
      error: refreshError,
    } = await supabase.auth.refreshSession({
      refresh_token: session.refresh_token,
    })

    if (refreshError || !refreshedSession) {
      return NextResponse.json(
        { error: 'Failed to refresh session' },
        { status: 401 }
      )
    }

    return NextResponse.json({
      success: true,
      session: {
        access_token: refreshedSession.access_token,
        expires_at: refreshedSession.expires_at,
      },
    })
  } catch (error) {
    console.error('Session refresh error:', error)
    return NextResponse.json(
      { error: 'Failed to refresh session' },
      { status: 500 }
    )
  }
}
