/**
 * Purpose: Provides the fixed top command bar for the Agent Planner center panel.
 * Props: Accepts optional user and notification stubs so the shell can render without
 * backend data fetching.
 * Key behaviors: Keeps planner chat access, agent status, notifications, and account
 * controls visible at the top of the main planner area.
 */
'use client'

import { memo, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, LogOut, MessageSquare, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PlannerTopBarProps {
  userName?: string
  userRole?: string
  notificationCount?: number
  className?: string
}

/**
 * Planner top bar with chat access, online status, notifications, and user menu.
 */
export const PlannerTopBar = memo(function PlannerTopBar({
  userName = 'Creator',
  userRole = 'Planner',
  notificationCount = 0,
  className,
}: PlannerTopBarProps) {
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const initials = userName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  useEffect(() => {
    if (!isAccountMenuOpen) return

    function handlePointerDown(event: MouseEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setIsAccountMenuOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsAccountMenuOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isAccountMenuOpen])

  async function handleSignOut() {
    if (isSigningOut) return
    setIsSigningOut(true)

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    } finally {
      window.location.assign('/login')
    }
  }

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-tan bg-cream/92 px-4 text-ink backdrop-blur-xl lg:px-6',
        className
      )}
    >
      <Link
        href="/planner?tab=chat"
        aria-label="Jump to planner chat"
        className="flex h-11 min-w-0 flex-1 items-center justify-between gap-3 rounded-full border border-tan bg-cream-deep/70 px-3 text-sm font-semibold text-ink-soft shadow-sm transition-colors hover:border-clay hover:bg-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-clay/30"
      >
        <span className="flex min-w-0 items-center gap-3">
          <MessageSquare className="h-4 w-4 shrink-0 text-clay" />
          <span className="truncate">Jump to planner chat</span>
        </span>
        <span className="hidden shrink-0 rounded-md border border-tan bg-cream px-1.5 py-0.5 text-[10px] font-semibold text-ink-faint sm:block">
          ⌘K
        </span>
      </Link>

      <div className="hidden items-center gap-2 rounded-full border border-forest/30 bg-forest-tint px-3 py-1.5 text-xs font-semibold text-forest md:flex">
        <span className="h-2 w-2 rounded-full bg-forest" />
        Agent online
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="relative flex h-10 w-10 items-center justify-center rounded-md border border-tan bg-cream text-ink transition-smooth hover:bg-cream-deep"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {notificationCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-clay px-1 text-[10px] font-bold text-cream">
              {notificationCount}
            </span>
          )}
        </button>

        <div ref={accountMenuRef} className="relative">
          <button
            type="button"
            className="flex h-10 items-center gap-2 rounded-full border border-tan bg-cream px-2 transition-smooth hover:bg-cream-deep"
            aria-label="Open account menu"
            aria-haspopup="menu"
            aria-expanded={isAccountMenuOpen}
            onClick={() => setIsAccountMenuOpen((current) => !current)}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-clay text-xs font-bold text-cream">
              {initials}
            </span>
            <span className="hidden min-w-0 max-w-32 text-left lg:block">
              <span className="block truncate text-xs font-semibold leading-none text-ink" title={userName}>{userName}</span>
              <span className="mt-1 block truncate text-[10px] text-ink-soft" title={userRole}>{userRole}</span>
            </span>
          </button>

          {isAccountMenuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-12 z-50 w-44 overflow-hidden rounded-lg border border-tan bg-cream p-1 shadow-card"
            >
              <Link
                href="/planner/settings"
                role="menuitem"
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-ink transition-smooth hover:bg-cream-deep"
                onClick={() => setIsAccountMenuOpen(false)}
              >
                <Settings className="h-4 w-4 text-ink-soft" />
                Settings
              </Link>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold text-ink transition-smooth hover:bg-cream-deep disabled:opacity-60"
                onClick={() => void handleSignOut()}
                disabled={isSigningOut}
              >
                <LogOut className="h-4 w-4 text-ink-soft" />
                {isSigningOut ? 'Signing out...' : 'Sign out'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
})

PlannerTopBar.displayName = 'PlannerTopBar'
