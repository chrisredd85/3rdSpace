'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Menu,
  X,
  ChevronDown,
  User,
  Settings,
  CreditCard,
  LogOut,
  Users,
  Building2,
  Store,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { NotificationBell } from '@/components/shared/NotificationBell'
import type { UserType } from '@/lib/types'

interface HeaderProps {
  userType: UserType
  onMenuClick: () => void
  isMobileMenuOpen: boolean
  onUserTypeChange?: (type: UserType) => void
}

export function Header({
  userType,
  onMenuClick,
  isMobileMenuOpen,
  onUserTypeChange,
}: HeaderProps) {
  const router = useRouter()
  const { addToast } = useToast()
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isTypeMenuOpen, setIsTypeMenuOpen] = useState(false)

  const handleSignOut = async () => {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        addToast({
          title: 'Error',
          description: result.error || 'Failed to sign out. Please try again.',
          variant: 'destructive',
        })
        return
      }

      // Redirect to login page
      router.push('/login')
    } catch (error) {
      // Handle network errors
      if (error instanceof TypeError && error.message.includes('fetch')) {
        addToast({
          title: 'Connection Error',
          description: 'Connection failed. Please check your internet and try again.',
          variant: 'destructive',
        })
      } else {
        addToast({
          title: 'Error',
          description: 'Something went wrong. Please try again.',
          variant: 'destructive',
        })
      }
    }
  }

  const getUserTypeLabel = (type: UserType) => {
    switch (type) {
      case 'community_builder':
        return 'Builder'
      case 'venue_owner':
        return 'Venue'
      case 'vendor':
        return 'Vendor'
    }
  }

  const getUserTypeIcon = (type: UserType) => {
    switch (type) {
      case 'community_builder':
        return Users
      case 'venue_owner':
        return Building2
      case 'vendor':
        return Store
    }
  }

  const handleUserTypeChange = (newType: UserType) => {
    setIsTypeMenuOpen(false)
    if (onUserTypeChange) {
      onUserTypeChange(newType)
    }
    // Navigate to appropriate dashboard
    if (newType === 'community_builder') {
      router.push('/builder')
    } else if (newType === 'venue_owner') {
      router.push('/venue')
    } else if (newType === 'vendor') {
      router.push('/vendor')
    }
  }

  const TypeIcon = getUserTypeIcon(userType)

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center border-b border-gray-200 bg-white px-4 shadow-sm">
      <div className="flex w-full items-center justify-between">
        {/* Left side: Logo and Mobile Menu */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onMenuClick}
          >
            {isMobileMenuOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </Button>

          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-forest-500 text-white font-bold text-lg">
              3
            </div>
            <span className="hidden sm:inline-block text-xl font-bold text-slate-900">
              3rdSpace
            </span>
          </Link>
        </div>

        {/* Right side: User Type Switcher and User Menu */}
        <div className="flex items-center gap-3">
          {/* Notification Bell */}
          <NotificationBell />

          {/* User Type Switcher (for demo/testing) */}
          {onUserTypeChange && (
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsTypeMenuOpen(!isTypeMenuOpen)}
                className="hidden md:flex items-center gap-2"
              >
                <TypeIcon className="h-4 w-4" />
                <span>{getUserTypeLabel(userType)}</span>
                <ChevronDown className="h-4 w-4" />
              </Button>

              {isTypeMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setIsTypeMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border-2 border-slate-200 bg-white shadow-xl z-20 overflow-hidden">
                    <div className="py-1">
                      <button
                        onClick={() => handleUserTypeChange('community_builder')}
                        className={cn(
                          'w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left hover:bg-slate-50 transition-colors',
                          userType === 'community_builder' && 'bg-forest-50 text-forest-700'
                        )}
                      >
                        <Users className="h-4 w-4" />
                        <span>Community Builder</span>
                      </button>
                      <button
                        onClick={() => handleUserTypeChange('venue_owner')}
                        className={cn(
                          'w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left hover:bg-slate-50 transition-colors',
                          userType === 'venue_owner' && 'bg-forest-50 text-forest-700'
                        )}
                      >
                        <Building2 className="h-4 w-4" />
                        <span>Venue Owner</span>
                      </button>
                      <button
                        onClick={() => handleUserTypeChange('vendor')}
                        className={cn(
                          'w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left hover:bg-slate-50 transition-colors',
                          userType === 'vendor' && 'bg-forest-50 text-forest-700'
                        )}
                      >
                        <Store className="h-4 w-4" />
                        <span>Vendor</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* User Menu */}
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              className="flex items-center gap-2"
            >
              <div className="h-8 w-8 rounded-full bg-forest-500 flex items-center justify-center text-white text-sm font-semibold">
                U
              </div>
              <ChevronDown className="h-4 w-4 hidden sm:inline" />
            </Button>

            {isUserMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setIsUserMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border-2 border-slate-200 bg-white shadow-xl z-20 overflow-hidden">
                  <div className="py-1">
                    <Link
                      href={`/${userType === 'community_builder' ? 'builder' : userType === 'venue_owner' ? 'venue' : 'vendor'}/settings`}
                      onClick={() => setIsUserMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <Settings className="h-4 w-4" />
                      <span>Settings</span>
                    </Link>
                    <Link
                      href={`/${userType === 'community_builder' ? 'builder' : userType === 'venue_owner' ? 'venue' : 'vendor'}/billing`}
                      onClick={() => setIsUserMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <CreditCard className="h-4 w-4" />
                      <span>Billing</span>
                    </Link>
                    <div className="border-t border-slate-200 my-1" />
                    <button
                      onClick={handleSignOut}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>Sign out</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
