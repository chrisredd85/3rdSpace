'use client'

import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Sidebar } from '@/components/shared/Sidebar'
import { Header } from '@/components/shared/Header'
import { useUser } from '@/lib/hooks/useUser'
import { useSessionRefresh } from '@/lib/hooks/useSessionRefresh'
import type { UserType } from '@/lib/types'

interface DashboardClientWrapperProps {
  children: React.ReactNode
  userType: UserType
}

export function DashboardClientWrapper({
  children,
  userType: initialUserType,
}: DashboardClientWrapperProps) {
  const { user, isLoading: isUserLoading, isAuthenticated } = useUser()
  // Use session refresh hook to automatically handle session expiration
  useSessionRefresh()
  const [userType, setUserType] = useState<UserType>(initialUserType)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    // Redirect to login if not authenticated
    if (!isUserLoading && !isAuthenticated) {
      router.push('/login?redirect=' + encodeURIComponent(pathname))
      return
    }

    // Set user type from user data or pathname
    if (user?.userType) {
      setUserType(user.userType)
      
      // Redirect to correct dashboard if user is on wrong dashboard
      if (user.userType === 'community_builder' && !pathname.startsWith('/builder')) {
        router.push('/builder')
        return
      } else if (user.userType === 'venue_owner' && !pathname.startsWith('/venue')) {
        router.push('/venue')
        return
      } else if (user.userType === 'vendor' && !pathname.startsWith('/vendor')) {
        router.push('/vendor')
        return
      }
    } else {
      // Fallback: determine user type from pathname
      if (pathname.startsWith('/builder')) {
        setUserType('community_builder')
      } else if (pathname.startsWith('/venue')) {
        setUserType('venue_owner')
      } else if (pathname.startsWith('/vendor')) {
        setUserType('vendor')
      }
    }
  }, [user, isUserLoading, isAuthenticated, pathname, router])

  const handleUserTypeChange = (newType: UserType) => {
    setUserType(newType)
  }

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen)
  }

  // Show loading spinner while checking authentication
  if (isUserLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-forest-500 border-t-transparent mx-auto mb-4" />
          <p className="text-slate-600 font-medium">Loading...</p>
        </div>
      </div>
    )
  }

  // Don't render dashboard if not authenticated (redirect will happen)
  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:flex-shrink-0">
        <Sidebar userType={userType} />
      </aside>

      {/* Mobile Sidebar */}
      {isMobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-900 bg-opacity-50 md:hidden"
            onClick={toggleMobileMenu}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 md:hidden">
            <Sidebar userType={userType} onClose={toggleMobileMenu} />
          </aside>
        </>
      )}

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          userType={userType}
          onMenuClick={toggleMobileMenu}
          isMobileMenuOpen={isMobileMenuOpen}
          onUserTypeChange={handleUserTypeChange}
        />

        <main className="flex-1 overflow-y-auto bg-gray-50">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-4 sm:py-6 md:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
