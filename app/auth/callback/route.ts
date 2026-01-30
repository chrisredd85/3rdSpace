import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { UserType } from '@/lib/types'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = requestUrl.searchParams.get('next')
  const error = requestUrl.searchParams.get('error')
  const errorDescription = requestUrl.searchParams.get('error_description')

  // Handle OAuth errors
  if (error) {
    console.error('OAuth error:', error, errorDescription)
    const errorUrl = new URL('/login', request.url)
    errorUrl.searchParams.set('error', error || 'oauth_error')
    errorUrl.searchParams.set('message', errorDescription || 'OAuth authentication failed')
    return NextResponse.redirect(errorUrl)
  }

  if (!code) {
    // No code provided, redirect to login
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('error', 'missing_code')
    return NextResponse.redirect(loginUrl)
  }

  try {
    const supabase = createClient()
    
    // Exchange code for session
    const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

    if (exchangeError || !data.user) {
      console.error('Session exchange error:', exchangeError)
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('error', 'session_exchange_failed')
      loginUrl.searchParams.set('message', 'Failed to complete authentication')
      return NextResponse.redirect(loginUrl)
    }

    // Get user type from metadata or profile
    let userType: UserType | null = null
    let dashboardPath = '/dashboard'

    // Check user metadata first
    const metadataType = data.user.user_metadata?.user_type as UserType | undefined
    if (metadataType && ['community_builder', 'venue_owner', 'vendor'].includes(metadataType)) {
      userType = metadataType
    } else {
      // Fallback: check profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('user_type')
        .eq('id', data.user.id)
        .single()

      if (profile?.user_type) {
        userType = profile.user_type as UserType
      }
    }

    // Determine dashboard path based on user type
    if (userType === 'community_builder') {
      dashboardPath = '/builder'
    } else if (userType === 'venue_owner') {
      dashboardPath = '/venue'
    } else if (userType === 'vendor') {
      dashboardPath = '/vendor'
    }

    // Use provided next URL or default to user's dashboard
    const redirectPath = next || dashboardPath
    const redirectUrl = new URL(redirectPath, request.url)

    return NextResponse.redirect(redirectUrl)
  } catch (error) {
    console.error('Callback error:', error)
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('error', 'callback_error')
    loginUrl.searchParams.set('message', 'An error occurred during authentication')
    return NextResponse.redirect(loginUrl)
  }
}
