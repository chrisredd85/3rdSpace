'use client'

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard,
  Calendar,
  Clock,
  FileText,
  Heart,
  Building2,
  MessageSquare,
  BarChart3,
  Settings,
  CreditCard,
  Bell,
  Calendar as CalendarIcon,
  DollarSign,
  ListChecks,
  Package,
  Sparkles,
  LogOut,
  Inbox,
  Store,
  Ticket,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUnreadCount } from '@/lib/hooks/useMessages'
import { useUnreadNotificationCount } from '@/lib/hooks/useNotifications'
import { useUser } from '@/lib/hooks/useUser'
import { useToast } from '@/components/ui/toast'
import type { UserType } from '@/lib/types'

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: number
}

interface NavSection {
  title: string
  items: NavItem[]
}

interface SidebarProps {
  userType: UserType
  onClose?: () => void
}

const roleMeta: Record<UserType, { icon: React.ComponentType<{ className?: string }>; label: string; tagline: string }> = {
  community_builder: { icon: Ticket, label: 'Event Creator', tagline: 'Plan & book' },
  venue_owner: { icon: Building2, label: 'Venue Owner', tagline: 'Manage your space' },
  vendor: { icon: Store, label: 'Vendor', tagline: 'Grow your business' },
}

/**
 * Role-aware sidebar navigation.
 *
 * Renders a different nav section list for each UserType (community_builder,
 * venue_owner, vendor).  Active link detection uses exact match for root routes
 * and prefix match for nested routes to avoid false positives.
 * Badge counts for messages and notifications are polled via React Query hooks.
 */
export function Sidebar({ userType, onClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useUser()
  const { addToast } = useToast()
  const { unreadCount = 0 } = useUnreadCount()
  const { data: unreadNotificationCount = 0 } = useUnreadNotificationCount(user?.id || null)

  const meta = roleMeta[userType]
  const RoleIcon = meta.icon

  const getNavigation = (): NavSection[] => {
    switch (userType) {
      case 'community_builder':
        return [
          {
            title: 'MAIN',
            items: [
              { label: 'Dashboard', href: '/builder', icon: LayoutDashboard },
              { label: 'My Events', href: '/builder/events', icon: Calendar },
              { label: 'Past Events', href: '/builder/past', icon: Clock },
              { label: 'Templates', href: '/builder/templates', icon: FileText },
            ],
          },
          {
            title: 'BUSINESS',
            items: [
              { label: 'Browse Venues', href: '/builder/venues', icon: Building2 },
              { label: 'Browse Vendors', href: '/builder/vendors/marketplace', icon: Heart },
              { label: 'Messages', href: '/builder/messages', icon: MessageSquare, badge: unreadCount > 0 ? unreadCount : undefined },
              { label: 'Notifications', href: '/builder/notifications', icon: Bell, badge: unreadNotificationCount > 0 ? unreadNotificationCount : undefined },
              { label: 'Analytics', href: '/builder/analytics', icon: BarChart3 },
            ],
          },
          {
            title: 'ACCOUNT',
            items: [
              { label: 'Settings', href: '/builder/settings', icon: Settings },
              { label: 'Billing', href: '/builder/billing', icon: CreditCard },
            ],
          },
        ]

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
            title: 'MANAGE',
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
              { label: 'Payouts', href: '/venue/payouts', icon: CreditCard },
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
            title: 'MANAGE',
            items: [
              { label: 'Service Listing', href: '/vendor/services', icon: Package },
              { label: 'Pricing & Packages', href: '/vendor/pricing', icon: DollarSign },
            ],
          },
          {
            title: 'ACCOUNT',
            items: [
              { label: 'Settings', href: '/vendor/settings', icon: Settings },
              { label: 'Payouts', href: '/vendor/payouts', icon: CreditCard },
            ],
          },
        ]

      default:
        return []
    }
  }

  const navigation = getNavigation()

  const handleLinkClick = () => {
    onClose?.()
  }

  const handleSignOut = async () => {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const result = await response.json()
      if (!response.ok || !result.success) {
        addToast({ title: 'Error', description: result.error || 'Failed to sign out.', variant: 'destructive' })
        return
      }
      router.push('/login')
    } catch {
      addToast({ title: 'Error', description: 'Something went wrong. Please try again.', variant: 'destructive' })
    }
  }

  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : 'ME'

  return (
    <div className="flex h-full w-64 flex-col bg-sidebar border-r border-sidebar-border">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2.5 px-6 py-5" onClick={handleLinkClick}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
          <Sparkles className="h-5 w-5 text-primary-foreground" />
        </div>
        <span className="font-display text-xl font-bold tracking-tight text-sidebar-foreground">3rdSpace</span>
      </Link>

      {/* Role card */}
      <div className="px-4 pb-4">
        <div className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/60 px-3 py-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
            <RoleIcon className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate font-display text-sm font-semibold text-sidebar-accent-foreground">{meta.label}</p>
            <p className="truncate text-[11px] text-muted-foreground">{meta.tagline}</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-4 overflow-y-auto px-4 py-2">
        {navigation.map((section) => (
          <div key={section.title}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              {section.title}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href || (item.href !== '/builder' && item.href !== '/venue' && item.href !== '/vendor' && pathname.startsWith(item.href + '/'))
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={handleLinkClick}
                    className={cn(
                      'flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-smooth',
                      isActive
                        ? 'bg-gradient-brand text-primary-foreground shadow-glow'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {item.badge !== undefined && (
                      <span className={cn(
                        'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold',
                        isActive ? 'bg-primary-foreground/20 text-white' : 'bg-primary text-primary-foreground'
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
      <div className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3 rounded-xl p-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-brand font-display text-sm font-bold text-primary-foreground shadow-glow">
            {initials}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-sm font-medium text-sidebar-foreground">
              {user?.email?.split('@')[0] || 'Account'}
            </p>
            <p className="truncate text-xs text-muted-foreground">{meta.label}</p>
          </div>
          <Link
            href={`/${userType === 'community_builder' ? 'builder' : userType === 'venue_owner' ? 'venue' : 'vendor'}/settings`}
            onClick={handleLinkClick}
            className="text-muted-foreground transition-smooth hover:text-foreground"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Link>
          <button
            onClick={handleSignOut}
            className="text-muted-foreground transition-smooth hover:text-destructive"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
