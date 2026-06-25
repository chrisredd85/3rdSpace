export const dynamic = 'force-dynamic'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { LEGAL_TERMS_VERSION } from '@/lib/legal/constants'
import type { UserType } from '@/lib/types'

function getLoginPath(userType: UserType) {
  if (userType === 'community_builder') return '/login/builder'
  if (userType === 'venue_owner') return '/login/venue'
  return '/login/vendor'
}

function getDashboardPath(userType: UserType) {
  if (userType === 'community_builder') return '/planner'
  if (userType === 'venue_owner') return '/venue'
  return '/vendor'
}

function getRole(userType: UserType) {
  if (userType === 'community_builder') return 'builder'
  if (userType === 'venue_owner') return 'owner'
  return 'vendor'
}

function getSafeInternalRedirect(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null
  return value
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = getSafeInternalRedirect(requestUrl.searchParams.get('next'))
  const expectedUserType = requestUrl.searchParams.get('expected_user_type') as UserType | null
  const authFlow = requestUrl.searchParams.get('auth_flow')
  const termsVersion = requestUrl.searchParams.get('terms_version')
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
    const admin = createServiceRoleClient()
    
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
        .from('users')
        .select('user_type')
        .eq('id', data.user.id)
        .single()

      const profileData = profile as { user_type?: string } | null
      if (profileData?.user_type) {
        userType = profileData.user_type as UserType
      }
    }

    if (!userType && expectedUserType && authFlow === 'signup') {
      if (termsVersion !== LEGAL_TERMS_VERSION) {
        await supabase.auth.signOut()
        const signupUrl = new URL('/signup/builder', request.url)
        signupUrl.searchParams.set('error', 'terms_required')
        signupUrl.searchParams.set('message', 'Accept the current Terms of Service and Privacy Policy before creating an account.')
        return NextResponse.redirect(signupUrl)
      }

      if (expectedUserType === 'venue_owner') {
        await supabase.auth.signOut()
        const venueSignupUrl = new URL('/signup/venue', request.url)
        venueSignupUrl.searchParams.set('error', 'venue_requires_details')
        venueSignupUrl.searchParams.set('message', 'Venue sign up needs venue details, so please use the venue form instead of Google.')
        return NextResponse.redirect(venueSignupUrl)
      }

      const companyName =
        expectedUserType === 'vendor'
          ? (data.user.user_metadata?.full_name as string | undefined) || data.user.email || 'Vendor'
          : (data.user.user_metadata?.full_name as string | undefined) || data.user.email || 'Community Builder'

      const { error: profileCreateError } = await admin
        .from('users')
        .upsert({
          id: data.user.id,
          email: data.user.email!,
          role: getRole(expectedUserType),
          user_type: expectedUserType,
          company_name: companyName,
          email_verified: Boolean(data.user.email_confirmed_at),
          signup_terms_version: LEGAL_TERMS_VERSION,
          signup_terms_accepted_at: new Date().toISOString(),
        } as never, { onConflict: 'id' })

      if (profileCreateError) {
        console.error('OAuth profile create error:', profileCreateError)
        const loginUrl = new URL('/login', request.url)
        loginUrl.searchParams.set('error', 'profile_create_failed')
        loginUrl.searchParams.set('message', 'We could not finish setting up your account.')
        return NextResponse.redirect(loginUrl)
      }

      userType = expectedUserType
    }

    if (expectedUserType && userType && expectedUserType !== userType) {
      await supabase.auth.signOut()
      const wrongPortalUrl = new URL(getLoginPath(userType), request.url)
      wrongPortalUrl.searchParams.set('error', 'wrong_portal')
      wrongPortalUrl.searchParams.set(
        'message',
        `This account belongs to the ${userType === 'community_builder' ? 'community builder' : userType === 'venue_owner' ? 'venue owner' : 'vendor'} portal.`
      )
      return NextResponse.redirect(wrongPortalUrl)
    }

    // Determine dashboard path based on user type
    if (userType) {
      dashboardPath = getDashboardPath(userType)
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
