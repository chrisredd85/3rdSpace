export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOnboardingStatus } from '@/lib/server/account-setup'
import type { UserType } from '@/lib/types'

/**
 * Check if user has completed onboarding
 * Returns onboarding status based on user type
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()

    // Verify user is authenticated
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const userType = user.user_metadata?.user_type as UserType | undefined
    const companyName = (user.user_metadata?.company_name as string | undefined) ?? null

    if (userType) {
      const status = await getOnboardingStatus(supabase, user.id, userType, companyName)
      return NextResponse.json({
        isOnboarded: status.isOnboarded,
        userType,
        redirectPath: status.redirectPath,
      })
    }

    return NextResponse.json({
      isOnboarded: false,
      userType: null,
    })
  } catch (error) {
    console.error('Onboarding check error:', error)
    return NextResponse.json(
      { error: 'Failed to check onboarding status' },
      { status: 500 }
    )
  }
}
