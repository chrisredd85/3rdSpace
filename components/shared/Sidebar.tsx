'use client'

import { memo, useCallback, useMemo, type ComponentType } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  LayoutDashboard,
  Building2,
  BarChart3,
  Settings,
  Bell,
  Calendar as CalendarIcon,
  DollarSign,
  ListChecks,
  Package,
  Sparkles,
  LogOut,
  Inbox,
  Store,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUnreadNotificationCount } from '@/lib/hooks/useNotifications'
import { useUser } from '@/lib/hooks/useUser'
import { useToast } from '@/components/ui/toast'
import type { UserType } from '@/lib/types'

interface NavItem {
  label: string
  href: string
  icon: ComponentType<{ className?: string }>
  badge?: number
}

interface NavSection {
  title: string
  items: NavItem[]
}

interface SidebarProps {
  userType: Exclude<UserType, 'community_builder'>
  onClose?: () => void
}

const roleMeta: Record<Exclude<UserType, 'community_builder'>, { icon: ComponentType<{ className?: string }>; label: string; tagline: string }> = {
  venue_owner: { icon: Building2, label: 'Venue Owner', tagline: 'Operate your space' },
  vendor: { icon: Store, label: 'Vendor', tagline: 'Run your business' },
}

/**
 * Role-aware sidebar navigation.
 *
 * Renders venue_owner and vendor dashboard navigation. Community builders use
 * the dedicated PlannerSidebar under /planner.
 * Active link detection uses exact match for root routes and prefix match for
 * nested routes to avoid false positives.
 * Badge counts for messages and notifications are loaded via React Query hooks.
 */
function SidebarComponent({ userType, onClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { user } = useUser()
  const { addToast } = useToast()
  const { data: unreadNotificationCount = 0 } = useUnreadNotificationCount(user?.id || null)

  const meta = roleMeta[userType]
  const RoleIcon = meta.icon

  const navigation = useMemo<NavSection[]>(() => {
    switch (userType) {
      case 'venue_owner':
        return [
          {
            title: 'OVERVIEW',
            items: [
              { label: 'Dashboard', href: '/venue', icon: LayoutDashboard },
              { label: 'Requests', href: '/venue/requests', icon: Inbox },
              { label: 'Calendar', href: '/venue/calendar', icon: CalendarIcon },
              { label: 'Notifications', href: '/venue/notifications', icon: Bell, badge: unreadNotificationCount > 0 ? unreadNotificationCount : undefined },
            ],
          },
          {
            title: 'OPERATE',
            items: [
              { label: 'Venue Listing', href: '/venue/listing', icon: Building2 },
              { label: 'Pricing & Revenue', href: '/venue/pricing', icon: DollarSign },
              { label: 'Requirements', href: '/venue/requirements', icon: ListChecks },
            ],
          },
          {
            title: 'ACCOUNT',
            items: [
              { label: 'Settings', href: '/venue/settings', icon: Settings },
            ],
          },
        ]

      case 'vendor':
        return [
          {
            title: 'OVERVIEW',
            items: [
              { label: 'Dashboard', href: '/vendor', icon: LayoutDashboard },
              { label: 'Booking Requests', href: '/vendor/bookings', icon: Inbox },
              { label: 'Calendar', href: '/vendor/calendar', icon: CalendarIcon },
              { label: 'Analytics', href: '/vendor/analytics', icon: BarChart3 },
              { label: 'Notifications', href: '/vendor/notifications', icon: Bell, badge: unreadNotificationCount > 0 ? unreadNotificationCount : undefined },
            ],
          },
          {
            title: 'OPERATE',
            items: [
              { label: 'Service Listing', href: '/vendor/services', icon: Package },
              { label: 'Pricing & Packages', href: '/vendor/pricing', icon: DollarSign },
            ],
          },
          {
            title: 'ACCOUNT',
            items: [
              { label: 'Settings', href: '/vendor/settings', icon: Settings },
            ],
          },
        ]

      default:
        return []
    }
  }, [unreadNotificationCount, userType])

  const handleLinkClick = useCallback(() => {
    onClose?.()
  }, [onClose])

  const handleSignOut = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
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
  }, [addToast, queryClient, router])

  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : 'ME'

  return (
    <div className="flex h-full w-64 flex-col bg-cream border-r border-tan">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2.5 px-6 py-5" onClick={handleLinkClick}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-clay shadow-card">
          <Sparkles className="h-5 w-5 text-cream" />
        </div>
        <span className="font-display text-xl font-bold tracking-tight text-ink">3rdPlace</span>
      </Link>

      {/* Role card */}
      <div className="px-4 pb-4">
        <div className="flex items-center gap-3 rounded-lg border border-tan bg-cream-deep/60 px-3 py-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-clay shadow-card">
            <RoleIcon className="h-4 w-4 text-cream" />
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate font-display text-sm font-semibold text-ink">{meta.label}</p>
            <p className="truncate text-[11px] text-ink-soft">{meta.tagline}</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-4 overflow-y-auto px-4 py-2">
        {navigation.map((section) => (
          <div key={section.title}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-ink-soft/60">
              {section.title}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href || (item.href !== '/venue' && item.href !== '/vendor' && pathname.startsWith(item.href + '/'))
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={handleLinkClick}
                    className={cn(
                      'flex min-h-[40px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-smooth',
                      isActive
                        ? 'bg-clay text-cream shadow-card'
                        : 'text-ink hover:bg-cream-deep hover:text-ink'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {item.badge !== undefined && (
                      <span className={cn(
                        'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold',
                        isActive ? 'bg-cream/20 text-cream' : 'bg-clay text-cream'
                      )}>
                        {item.badge > 9 ? '9+' : item.badge}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="border-t border-tan p-4">
        <div className="flex items-center gap-3 rounded-lg p-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-clay font-display text-sm font-bold text-cream shadow-card">
            {initials}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-sm font-medium text-ink">
              {user?.email?.split('@')[0] || 'Account'}
            </p>
            <p className="truncate text-xs text-ink-soft">{meta.label}</p>
          </div>
          <Link
            href={`/${userType === 'venue_owner' ? 'venue' : 'vendor'}/settings`}
            onClick={handleLinkClick}
            className="text-ink-soft transition-smooth hover:text-ink"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Link>
          <button
            onClick={handleSignOut}
            className="text-ink-soft transition-smooth hover:text-brick"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

export const Sidebar = memo(SidebarComponent)
Sidebar.displayName = 'Sidebar'
