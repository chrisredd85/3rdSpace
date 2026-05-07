'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  Menu,
  X,
  Search,
  ChevronDown,
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
import { useUser } from '@/lib/hooks/useUser'
import type { UserType } from '@/lib/types'

interface HeaderProps {
  userType: UserType
  onMenuClick: () => void
  isMobileMenuOpen: boolean
  onUserTypeChange?: (type: UserType) => void
}

/**
 * Top navigation bar shared across all dashboard layouts.
 *
 * Renders a role-aware search placeholder, the notification bell, an optional
 * role-switcher dropdown (dev/demo only — only shown when `onUserTypeChange` is
 * provided), a "New Event" CTA for builders, and a user avatar menu.
 */
export function Header({
  userType,
  onMenuClick,
  isMobileMenuOpen,
  onUserTypeChange,
}: HeaderProps) {
  const router = useRouter()
  const { addToast } = useToast()
  const queryClient = useQueryClient()
  const { user } = useUser()
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isTypeMenuOpen, setIsTypeMenuOpen] = useState(false)

  const handleSignOut = async () => {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        addToast({ title: 'Error', description: result.error || 'Failed to sign out.', variant: 'destructive' })
        return
      }
      queryClient.clear()
      router.push('/login')
    } catch {
      addToast({ title: 'Error', description: 'Something went wrong. Please try again.', variant: 'destructive' })
    }
  }

  const getUserTypeLabel = (type: UserType) => {
    switch (type) {
      case 'community_builder': return 'Creator'
      case 'venue_owner': return 'Venue'
      case 'vendor': return 'Vendor'
    }
  }

  const getSearchPlaceholder = (type: UserType) => {
    switch (type) {
      case 'community_builder': return 'Search venues, vendors, events...'
      case 'venue_owner': return 'Search bookings, events...'
      case 'vendor': return 'Search bookings, clients...'
    }
  }

  const handleUserTypeChange = (newType: UserType) => {
    setIsTypeMenuOpen(false)
    onUserTypeChange?.(newType)
    if (newType === 'community_builder') router.push('/planner')
    else if (newType === 'venue_owner') router.push('/venue')
    else router.push('/vendor')
  }

  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : 'ME'
  const dashBase = userType === 'community_builder' ? 'planner' : userType === 'venue_owner' ? 'venue' : 'vendor'

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-background/70 px-4 backdrop-blur-xl sm:px-6">
      {/* Mobile menu toggle */}
      <button
        onClick={onMenuClick}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card/40 transition-smooth hover:bg-card md:hidden"
        aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
      >
        {isMobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {/* Search */}
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder={getSearchPlaceholder(userType)}
          className="h-10 w-full rounded-xl border border-border bg-card/40 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground transition-smooth focus:border-primary focus:bg-card"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Notification bell */}
        <NotificationBell />

        {/* User type switcher */}
        {onUserTypeChange && (
          <div className="relative hidden md:block">
            <Button
              variant="glass"
              size="sm"
              onClick={() => setIsTypeMenuOpen(!isTypeMenuOpen)}
              className="gap-1.5"
            >
              {getUserTypeLabel(userType)}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            {isTypeMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setIsTypeMenuOpen(false)} />
                <div className="absolute right-0 top-full z-20 mt-2 w-48 overflow-hidden rounded-xl border border-border bg-card shadow-card">
                  {[
                    { type: 'community_builder' as UserType, label: 'Event Creator', icon: Users },
                    { type: 'venue_owner' as UserType, label: 'Venue Owner', icon: Building2 },
                    { type: 'vendor' as UserType, label: 'Vendor', icon: Store },
                  ].map(({ type, label, icon: Icon }) => (
                    <button
                      key={type}
                      onClick={() => handleUserTypeChange(type)}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-4 py-2.5 text-sm transition-smooth hover:bg-sidebar-accent',
                        userType === type ? 'bg-primary/15 text-primary' : 'text-foreground'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* New event CTA — builder only */}
        {userType === 'community_builder' && (
          <Button variant="hero" size="sm" asChild className="hidden sm:inline-flex">
            <Link href="/planner">+ New Event</Link>
          </Button>
        )}

        {/* User avatar menu */}
        <div className="relative">
          <button
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-brand font-display text-sm font-bold text-primary-foreground shadow-glow transition-smooth hover:shadow-coral"
            aria-label="User menu"
          >
            {initials}
          </button>
          {isUserMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setIsUserMenuOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-2 w-52 overflow-hidden rounded-xl border border-border bg-card shadow-card">
                <div className="border-b border-border px-4 py-3">
                  <p className="text-sm font-medium text-foreground truncate">
                    {user?.email?.split('@')[0] || 'Account'}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email || ''}</p>
                </div>
                <div className="py-1">
                  <Link
                    href={`/${dashBase}/settings`}
                    onClick={() => setIsUserMenuOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground transition-smooth hover:bg-sidebar-accent"
                  >
                    <Settings className="h-4 w-4 text-muted-foreground" />
                    Settings
                  </Link>
                  <Link
                    href={`/${dashBase}/billing`}
                    onClick={() => setIsUserMenuOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground transition-smooth hover:bg-sidebar-accent"
                  >
                    <CreditCard className="h-4 w-4 text-muted-foreground" />
                    Billing
                  </Link>
                  <div className="my-1 border-t border-border" />
                  <button
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-destructive transition-smooth hover:bg-destructive/10"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
