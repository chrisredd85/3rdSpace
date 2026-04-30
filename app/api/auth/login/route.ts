import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOnboardingStatus } from '@/lib/server/account-setup'
import type { UserType } from '@/lib/types'

interface LoginRequest {
  email: string
  password: string
  expectedUserType?: UserType
}

function getDashboardPath(userType: UserType) {
  if (userType === 'community_builder') return '/builder'
  if (userType === 'venue_owner') return '/venue'
  return '/vendor'
}

function getLoginPath(userType: UserType) {
  if (userType === 'community_builder') return '/login/builder'
  if (userType === 'venue_owner') return '/login/venue'
  return '/login/vendor'
}

export async function POST(request: NextRequest) {
  try {
    const body: LoginRequest = await request.json()
    const { email, password, expectedUserType } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    const supabase = createClient()

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      console.error('Auth error:', error)
      let errorMessage = 'Email or password incorrect'
      
      if (error.message.includes('Invalid login credentials')) {
        errorMessage = 'Email or password incorrect'
      } else if (error.message.includes('Email not confirmed')) {
        errorMessage = 'Please verify your email before signing in'
      } else if (error.message.includes('Too many requests')) {
        errorMessage = 'Too many login attempts. Please try again later'
      }

      return NextResponse.json({ error: errorMessage }, { status: 401 })
    }

    if (!data.user || !data.session) {
      return NextResponse.json(
        { error: 'Login failed. Please try again.' },
        { status: 500 }
      )
    }

    // Get user profile
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('role, user_type, company_name, email')
      .eq('id', data.user.id)
      .single()

    if (profileError || !userProfile) {
      console.error('Profile fetch error:', profileError)
      return NextResponse.json(
        { error: 'Failed to load user profile' },
        { status: 500 }
      )
    }

    // Type assertion
    const profile = userProfile as {
      role: string
      user_type: string | null
      company_name: string | null
      email: string
    }

    // Determine userType
    let userType: UserType
    if (profile.user_type) {
      userType = profile.user_type as UserType
    } else {
      // Fallback to role mapping
      if (profile.role === 'builder') {
        userType = 'community_builder'
      } else if (profile.role === 'owner') {
        userType = 'venue_owner'
      } else {
        userType = 'vendor'
      }
    }

    if (expectedUserType && expectedUserType !== userType) {
      await supabase.auth.signOut()

      return NextResponse.json(
        {
          error: `This account belongs to the ${userType === 'community_builder' ? 'community builder' : userType === 'venue_owner' ? 'venue owner' : 'vendor'} portal. Please sign in there instead.`,
          expectedLoginPath: getLoginPath(userType),
          actualUserType: userType,
        },
        { status: 403 }
      )
    }

    const onboarding = await getOnboardingStatus(supabase, data.user.id, userType, profile.company_name)
    const dashboardPath = onboarding.isOnboarded ? getDashboardPath(userType) : onboarding.redirectPath

    // Update last login
    await (supabase
      .from('users') as any)
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', data.user.id)

    return NextResponse.json({
      success: true,
      user: {
        id: data.user.id,
        email: data.user.email,
        userType,
        role: profile.role,
        companyName: profile.company_name,
      },
      dashboardPath,
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please contact support.' },
      { status: 500 }
    )
  }
}
