'use client'

import { usePathname } from 'next/navigation'
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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUnreadCount } from '@/lib/hooks/useMessages'
import { useUnreadNotificationCount } from '@/lib/hooks/useNotifications'
import { useUser } from '@/lib/hooks/useUser'
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

export function Sidebar({ userType, onClose }: SidebarProps) {
  const pathname = usePathname()
  const { user } = useUser()
  
  // Get userId from user object for unread counts
  const userId = user?.id || null
  const { unreadCount = 0 } = useUnreadCount()
  const { data: unreadNotificationCount = 0 } = useUnreadNotificationCount(userId)

  const getNavigation = (): NavSection[] => {
    const getMessagesBadge = () => {
      return unreadCount > 0 ? unreadCount : undefined
    }

    switch (userType) {
      case 'community_builder':
        return [
          {
            title: 'MAIN',
            items: [
              {
                label: 'Dashboard',
                href: '/builder',
                icon: LayoutDashboard,
              },
              {
                label: 'Events',
                href: '/builder/events',
                icon: Calendar,
                badge: 3,
              },
              {
                label: 'Past Events',
                href: '/builder/past',
                icon: Clock,
              },
              {
                label: 'Templates',
                href: '/builder/templates',
                icon: FileText,
              },
            ],
          },
          {
            title: 'BUSINESS',
            items: [
              {
                label: 'Saved Vendors',
                href: '/builder/vendors',
                icon: Heart,
              },
              {
                label: 'Saved Venues',
                href: '/builder/venues',
                icon: Building2,
              },
              {
                label: 'Messages',
                href: '/builder/messages',
                icon: MessageSquare,
                badge: unreadCount > 0 ? unreadCount : undefined,
              },
              {
                label: 'Notifications',
                href: '/builder/notifications',
                icon: Bell,
                badge: unreadNotificationCount > 0 ? unreadNotificationCount : undefined,
              },
              {
                label: 'Analytics',
                href: '/builder/analytics',
                icon: BarChart3,
              },
            ],
          },
          {
            title: 'ACCOUNT',
            items: [
              {
                label: 'Settings',
                href: '/builder/settings',
                icon: Settings,
              },
              {
                label: 'Billing',
                href: '/builder/billing',
                icon: CreditCard,
              },
            ],
          },
        ]

      case 'venue_owner':
        return [
          {
            title: 'OVERVIEW',
            items: [
              {
                label: 'Dashboard',
                href: '/venue',
                icon: LayoutDashboard,
              },
              {
                label: 'Requests',
                href: '/venue/requests',
                icon: Bell,
                badge: 7,
              },
              {
                label: 'Calendar',
                href: '/venue/calendar',
                icon: CalendarIcon,
              },
              {
                label: 'Notifications',
                href: '/venue/notifications',
                icon: Bell,
                badge: unreadNotificationCount > 0 ? unreadNotificationCount : undefined,
              },
            ],
          },
          {
            title: 'MANAGE',
            items: [
              {
                label: 'Venue Listing',
                href: '/venue/listing',
                icon: Building2,
              },
              {
                label: 'Pricing & Revenue',
                href: '/venue/pricing',
                icon: DollarSign,
              },
              {
                label: 'Requirements',
                href: '/venue/requirements',
                icon: ListChecks,
              },
            ],
          },
          {
            title: 'ACCOUNT',
            items: [
              {
                label: 'Settings',
                href: '/venue/settings',
                icon: Settings,
              },
              {
                label: 'Payouts',
                href: '/venue/payouts',
                icon: CreditCard,
              },
            ],
          },
        ]

      case 'vendor':
        return [
          {
            title: 'OVERVIEW',
            items: [
              {
                label: 'Dashboard',
                href: '/vendor',
                icon: LayoutDashboard,
              },
              {
                label: 'Booking Requests',
                href: '/vendor/requests',
                icon: Bell,
                badge: 4,
              },
              {
                label: 'Calendar',
                href: '/vendor/calendar',
                icon: CalendarIcon,
              },
              {
                label: 'Notifications',
                href: '/vendor/notifications',
                icon: Bell,
                badge: unreadNotificationCount > 0 ? unreadNotificationCount : undefined,
              },
            ],
          },
          {
            title: 'MANAGE',
            items: [
              {
                label: 'Service Listing',
                href: '/vendor/listing',
                icon: Package,
              },
              {
                label: 'Pricing & Packages',
                href: '/vendor/pricing',
                icon: DollarSign,
              },
              {
                label: 'Requirements',
                href: '/vendor/requirements',
                icon: ListChecks,
              },
            ],
          },
          {
            title: 'ACCOUNT',
            items: [
              {
                label: 'Settings',
                href: '/vendor/settings',
                icon: Settings,
              },
              {
                label: 'Payouts',
                href: '/vendor/payouts',
                icon: CreditCard,
              },
            ],
          },
        ]

      default:
        return []
    }
  }

  const navigation = getNavigation()

  const handleLinkClick = () => {
    if (onClose) {
      onClose()
    }
  }

  return (
    <div className="flex h-full w-64 flex-col bg-gray-50 border-r border-gray-200 md:relative">
      <nav className="flex-1 space-y-4 sm:space-y-6 px-2 sm:px-3 py-4">
        {navigation.map((section) => (
          <div key={section.title}>
            <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              {section.title}
            </div>
            <div className="space-y-1">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                const Icon = item.icon

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={handleLinkClick}
                    className={cn(
                      'group flex items-center gap-3 rounded-lg px-3 py-2.5 sm:py-2 text-sm font-medium transition-colors min-h-[44px]',
                      isActive
                        ? 'bg-white text-forest-600 shadow-sm'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-5 w-5 flex-shrink-0',
                        isActive ? 'text-forest-600' : 'text-slate-400 group-hover:text-slate-600'
                      )}
                    />
                    <span className="flex-1">{item.label}</span>
                    {item.badge && (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-forest-500 text-xs font-semibold text-white flex-shrink-0">
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
    </div>
  )
}
