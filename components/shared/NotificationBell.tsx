'use client'

import { useState, useEffect, useRef } from 'react'
import { Bell, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useUnreadNotificationCount, useNotifications, useMarkAllAsRead } from '@/lib/hooks/useNotifications'
import { useUser } from '@/lib/hooks/useUser'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Notification } from '@/lib/types/database'

export interface NotificationBellProps {
  /**
   * User ID for fetching notifications
   */
  userId?: string | null
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * NotificationBell component for header notification dropdown
 * 
 * Features:
 * - Unread count badge
 * - Dropdown panel with recent notifications
 * - Mark all as read
 * - Real-time updates
 * 
 * @example
 * ```tsx
 * <NotificationBell userId={user?.id} />
 * ```
 */
export function NotificationBell({ userId: propUserId, className }: NotificationBellProps) {
  const { user } = useUser()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Use prop userId if provided, otherwise use user from hook
  const userId = propUserId || user?.id || null

  const { data: unreadCount = 0 } = useUnreadNotificationCount(userId)
  const { data: recentNotifications = [] } = useNotifications(userId, { is_read: false })
  const markAllAsRead = useMarkAllAsRead()

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleMarkAllAsRead = async () => {
    if (!userId) return

    try {
      await markAllAsRead.mutateAsync(userId)
    } catch (error) {
      console.error('Failed to mark all as read:', error)
    }
  }

  const getNotificationIcon = (notificationType: string) => {
    switch (notificationType) {
      case 'new_booking_request':
        return '📅'
      case 'booking_confirmed':
        return '✅'
      case 'booking_declined':
        return '❌'
      case 'new_message':
        return '💬'
      case 'payment_received':
        return '💰'
      case 'review_posted':
        return '⭐'
      case 'reminder':
        return '⏰'
      default:
        return '🔔'
    }
  }

  const formatTimestamp = (date: string) => {
    const now = new Date()
    const notificationDate = new Date(date)
    const diff = now.getTime() - notificationDate.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 7) return `${days}d ago`
    return notificationDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const handleNotificationClick = (notification: Notification) => {
    // Navigate based on notification link or type
    if (notification.link) {
      router.push(notification.link)
    } else {
      // Fallback navigation based on notification type
      const metadata = notification.metadata as any
      if (metadata?.event_id) {
        router.push(`/builder/event/${metadata.event_id}`)
      } else if (metadata?.booking_id) {
        router.push(`/builder/bookings`)
      } else if (metadata?.thread_id) {
        router.push(`/builder/messages`)
      }
    }
    setIsOpen(false)
  }

  return (
    <div className={cn('relative', className)} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-600 hover:text-gray-900 transition-colors"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 h-4 w-4 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <Card className="absolute right-0 top-full mt-2 w-96 max-h-[600px] overflow-hidden z-50 shadow-lg">
          <CardContent className="p-0">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Notifications</h3>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMarkAllAsRead}
                  disabled={markAllAsRead.isPending}
                  className="text-xs"
                >
                  <Check className="h-3 w-3 mr-1" />
                  Mark all read
                </Button>
              )}
            </div>

            <div className="max-h-[500px] overflow-y-auto">
              {recentNotifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-sm text-gray-600">No notifications</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {recentNotifications.slice(0, 10).map((notification) => (
                    <div
                      key={notification.id}
                      className={cn(
                        'p-4 hover:bg-gray-50 cursor-pointer transition-colors',
                        !notification.is_read && 'bg-forest-50'
                      )}
                      onClick={() => handleNotificationClick(notification)}
                    >
                      <div className="flex items-start gap-3">
                        <div className="text-2xl flex-shrink-0">
                          {getNotificationIcon(notification.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p
                              className={cn(
                                'text-sm',
                                !notification.is_read
                                  ? 'font-semibold text-gray-900'
                                  : 'text-gray-700'
                              )}
                            >
                              {notification.title}
                            </p>
                            {!notification.is_read && (
                              <div className="h-2 w-2 rounded-full bg-forest-500 flex-shrink-0 mt-1" />
                            )}
                          </div>
                          {notification.message && (
                            <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                              {notification.message}
                            </p>
                          )}
                          <p className="text-xs text-gray-400 mt-2">
                            {formatTimestamp(notification.created_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {recentNotifications.length > 0 && (
              <div className="p-3 border-t border-gray-200">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    router.push('/builder/notifications')
                    setIsOpen(false)
                  }}
                >
                  View all notifications
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
