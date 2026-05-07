/**
 * Purpose: Provides the fixed top command bar for the Agent Planner center panel.
 * Props: Accepts optional user and notification stubs so the shell can render without
 * backend data fetching.
 * Key behaviors: Keeps global search, agent status, new-plan command, notifications,
 * and account controls visible at the top of the main planner area.
 */
'use client'

import { memo } from 'react'
import { Bell, ChevronDown, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface PlannerTopBarProps {
  userName?: string
  userRole?: string
  notificationCount?: number
  className?: string
  onNewPlan?: () => void
}

/**
 * Planner top bar with global ask/search, online status, new-event CTA, notifications, and user menu.
 */
export const PlannerTopBar = memo(function PlannerTopBar({
  userName = 'Creator',
  userRole = 'Planner',
  notificationCount = 0,
  className,
  onNewPlan,
}: PlannerTopBarProps) {
  const initials = userName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-background/90 px-4 backdrop-blur-xl lg:px-6',
        className
      )}
    >
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Ask 3rdPlace anything"
        className="h-11 min-w-0 rounded-2xl border-border bg-card/60 pl-10 pr-14 text-sm shadow-card"
          placeholder="Ask 3rdPlace anything — 'rooftop mixer for 120...'"
        />
        <span className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground sm:block">
          ⌘K
        </span>
      </div>

      <div className="hidden items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-semibold text-success md:flex">
        <span className="h-2 w-2 rounded-full bg-success" />
        Agent online
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          className="h-10 rounded-xl bg-card text-foreground hover:bg-card/80"
          size="sm"
          type="button"
          onClick={onNewPlan}
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New Event</span>
        </Button>

        <button
          type="button"
          className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card/60 text-foreground transition-smooth hover:bg-card"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {notificationCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {notificationCount}
            </span>
          )}
        </button>

        <button
          type="button"
          className="flex h-10 items-center gap-2 rounded-xl border border-border bg-card/60 px-2 transition-smooth hover:bg-card"
          aria-label="Open user menu"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-brand text-xs font-bold text-primary-foreground">
            {initials}
          </span>
          <span className="hidden min-w-0 max-w-28 text-left lg:block">
            <span className="block truncate text-xs font-semibold leading-none" title={userName}>{userName}</span>
            <span className="mt-1 block truncate text-[10px] text-muted-foreground" title={userRole}>{userRole}</span>
          </span>
          <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground lg:block" />
        </button>
      </div>
    </header>
  )
})

PlannerTopBar.displayName = 'PlannerTopBar'
