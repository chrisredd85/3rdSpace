'use client'

import { useState, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { Sidebar } from '@/components/shared/Sidebar'
import { Header } from '@/components/shared/Header'
import { useUser } from '@/lib/hooks/useUser'
import { useSessionRefresh } from '@/lib/hooks/useSessionRefresh'
import { useToast } from '@/components/ui/toast'
import type { UserType } from '@/lib/types'
import type { User } from '@/lib/hooks/useUser'

interface DashboardClientWrapperProps {
  children: React.ReactNode
  userType: UserType
  initialUser?: User | null
}

/**
 * Client-side shell for all dashboard pages.
 *
 * The server layout (`app/(dashboard)/layout.tsx`) fetches the user's role and
 * passes it as `initialUserType` so the first render is correct without a flash.
 * This component then hydrates the Zustand auth store, enforces client-side role
 * redirects as a belt-and-suspenders check (middleware does the same server-side),
 * and handles the `?from=auth` toast for already-signed-in users.
 */
export function DashboardClientWrapper({
  children,
  userType: initialUserType,
  initialUser,
}: DashboardClientWrapperProps) {
  const { user, isLoading: isUserLoading, isAuthenticated } = useUser(initialUser)
  useSessionRefresh()
  const { addToast } = useToast()
  const [userType, setUserType] = useState<UserType>(initialUserType)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (searchParams.get('from') === 'auth') {
      addToast({
        title: "You're already signed in",
        description: 'Log out if you want to create a new account or sign in with a different email.',
      })
      window.history.replaceState(null, '', pathname)
    }
  }, [searchParams, pathname, addToast])

  useEffect(() => {
    if (!isUserLoading && !isAuthenticated) {
      router.push('/login?redirect=' + encodeURIComponent(pathname))
      return
    }

    if (user?.userType) {
      setUserType(user.userType)
      if (user.userType === 'community_builder') {
        router.push('/planner')
        return
      } else if (user.userType === 'venue_owner' && !pathname.startsWith('/venue')) {
        router.push('/venue')
        return
      } else if (user.userType === 'vendor' && !pathname.startsWith('/vendor')) {
        router.push('/vendor')
        return
      }
    } else {
      if (pathname.startsWith('/venue')) setUserType('venue_owner')
      else if (pathname.startsWith('/vendor')) setUserType('vendor')
    }
  }, [user, isUserLoading, isAuthenticated, pathname, router])

  if (isUserLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow">
            <Sparkles className="h-7 w-7 animate-pulse text-primary-foreground" />
          </div>
          <p className="font-display text-lg font-semibold text-foreground">3rdPlace</p>
          <p className="mt-1 text-sm text-muted-foreground">Loading your dashboard...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) return null
  if (userType === 'community_builder') return null

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:shrink-0">
        <Sidebar userType={userType} />
      </aside>

      {/* Mobile sidebar overlay */}
      {isMobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 md:hidden">
            <Sidebar userType={userType} onClose={() => setIsMobileMenuOpen(false)} />
          </aside>
        </>
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          userType={userType}
          onMenuClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          isMobileMenuOpen={isMobileMenuOpen}
        />
        <main className="flex-1 animate-fade-in overflow-y-auto bg-background">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
