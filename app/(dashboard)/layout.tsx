import { DashboardClientWrapper } from '@/components/shared/DashboardClientWrapper'
import { createClient } from '@/lib/supabase/server'
import type { UserType } from '@/lib/types'

// Server Component - uses inline server-side Supabase logic
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Get userType from server-side auth
  // If not available, default to community_builder (client will correct if needed)
  let userType: UserType = 'community_builder'
  
  try {
    const supabase = createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()

    if (authUser) {
      const { data: profile } = await supabase
        .from('users')
        .select('role, user_type')
        .eq('id', authUser.id)
        .single()
      
      if (profile?.user_type) {
        userType = profile.user_type as UserType
      } else if (profile?.role) {
        // Fallback mapping
        if (profile.role === 'builder') userType = 'community_builder'
        else if (profile.role === 'owner') userType = 'venue_owner'
        else if (profile.role === 'vendor') userType = 'vendor'
      }
    }
  } catch (error) {
    // If auth fails (e.g., not authenticated), use default
    // Middleware will handle redirects, client wrapper will correct userType
    console.error('Error getting user type in layout:', error)
  }

  return (
    <DashboardClientWrapper userType={userType}>
      {children}
    </DashboardClientWrapper>
  )
}
