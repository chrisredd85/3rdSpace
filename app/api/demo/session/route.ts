/**
 * Demo session route — creates or returns a live Supabase session for the seeded
 * demo account so investor / stakeholder demos write real rows without exposing
 * credentials in the client bundle.
 *
 * Protected by the DEMO_MODE environment flag.  Returns 404 when demo mode is
 * disabled so the route is invisible in production.
 *
 * Flow:
 * 1. Admin client ensures the demo user exists with community_builder metadata.
 * 2. Signs in via email + password (server-only password env var).
 * 3. Returns { access_token, refresh_token, expires_in, user_id } to the client.
 * 4. Client calls supabase.auth.setSession() — all subsequent API calls hit real DB.
 */
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient as createAnonClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '@/lib/supabase/server'

const DEMO_EMAIL = 'demo@3rdspace.com'
const DEMO_DISPLAY_NAME = 'Demo Creator'

/**
 * GET /api/demo/session
 * Returns a fresh Supabase session for the demo account.
 */
export async function GET(): Promise<NextResponse> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const demoPassword = process.env.DEMO_USER_PASSWORD
  if (!demoPassword) {
    return NextResponse.json({ error: 'Demo not configured' }, { status: 503 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  try {
    // ── Ensure demo user exists ────────────────────────────────────────────────
    const adminClient = createServiceRoleClient()

    const { data: existingUsers } = await adminClient.auth.admin.listUsers()
    const existingDemo = existingUsers?.users?.find((u) => u.email === DEMO_EMAIL)

    if (!existingDemo) {
      const { error: createError } = await adminClient.auth.admin.createUser({
        email: DEMO_EMAIL,
        password: demoPassword,
        email_confirm: true,
        user_metadata: {
          user_type: 'community_builder',
          full_name: DEMO_DISPLAY_NAME,
          is_demo: true,
        },
      })

      if (createError) {
        console.error('[demo/session] Failed to create demo user:', createError)
        return NextResponse.json({ error: 'Failed to create demo account' }, { status: 500 })
      }
    } else if (!existingDemo.user_metadata?.user_type) {
      // Backfill metadata if demo user was created without it
      await adminClient.auth.admin.updateUserById(existingDemo.id, {
        user_metadata: {
          user_type: 'community_builder',
          full_name: DEMO_DISPLAY_NAME,
          is_demo: true,
        },
      })
    }

    // ── Sign in and return session tokens ─────────────────────────────────────
    // Use a plain supabase-js client (no cookies) just to do the auth exchange.
    const anonClient = createAnonClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
      email: DEMO_EMAIL,
      password: demoPassword,
    })

    if (signInError || !signInData.session) {
      console.error('[demo/session] Sign-in error:', signInError)
      return NextResponse.json({ error: 'Demo sign-in failed' }, { status: 500 })
    }

    const { access_token, refresh_token, expires_in } = signInData.session

    return NextResponse.json({
      access_token,
      refresh_token,
      expires_in,
      user_id: signInData.user?.id,
    })
  } catch (error) {
    console.error('[demo/session] Unexpected error:', error)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}
