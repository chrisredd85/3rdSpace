import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = createClient()
    
    // Get auth user
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('role, user_type, company_name, email')
      .eq('id', authUser.id)
      .single()

    if (profileError || !userProfile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Type assertion
    const profile = userProfile as {
      role: string
      user_type: string | null
      company_name: string | null
      email: string
    }

    // Determine userType
    let userType: string
    if (profile.user_type) {
      userType = profile.user_type
    } else {
      // Fallback mapping
      if (profile.role === 'builder') userType = 'community_builder'
      else if (profile.role === 'owner') userType = 'venue_owner'
      else userType = 'vendor'
    }

    return NextResponse.json({
      user: {
        id: authUser.id,
        email: authUser.email,
        userType,
        role: profile.role,
        companyName: profile.company_name,
      }
    })
  } catch (error) {
    console.error('Get user error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
