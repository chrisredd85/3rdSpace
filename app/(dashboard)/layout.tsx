import { DashboardClientWrapper } from '@/components/shared/DashboardClientWrapper'
import { createClient } from '@/lib/supabase/server'
import type { UserType } from '@/lib/types'
import type { User } from '@/lib/hooks/useUser'

export const dynamic = 'force-dynamic'

// Server Component - uses inline server-side Supabase logic
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Get userType from server-side auth
  // If not available, default to community_builder (client will correct if needed)
  let userType: UserType = 'community_builder'
  let initialUser: User | null = null
  
  try {
    const supabase = createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()

    if (authUser) {
      const { data } = await supabase
        .from('users')
        .select('role, user_type, company_name, email')
        .eq('id', authUser.id)
        .single()

      const profile = data as {
        role?: 'builder' | 'owner' | 'vendor'
        user_type?: UserType | null
        company_name?: string | null
        email?: string | null
      } | null

      if (profile) {
        userType = profile.user_type || (
          profile.role === 'owner'
            ? 'venue_owner'
            : profile.role === 'vendor'
              ? 'vendor'
              : 'community_builder'
        )

        initialUser = {
          id: authUser.id,
          email: authUser.email || profile.email || null,
          userType,
          role: profile.role || 'builder',
          companyName: profile.company_name || null,
        }
      }
    }
  } catch (error) {
    // If auth fails (e.g., not authenticated), use default
    // Middleware will handle redirects, client wrapper will correct userType
    console.error('Error getting user type in layout:', error)
  }

  return (
    <DashboardClientWrapper userType={userType} initialUser={initialUser}>
      {children}
    </DashboardClientWrapper>
  )
}
