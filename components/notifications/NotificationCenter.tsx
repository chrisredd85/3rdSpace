'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  Bell,
  Calendar,
  CheckCircle,
  CreditCard,
  FileText,
  MessageSquare,
  Star,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

type NotificationItem = {
  id: string
  type: string
  notification_type: string
  title: string
  message: string | null
  link: string | null
  action_url?: string | null
  read_at: string | null
  is_read: boolean
  metadata?: Record<string, unknown> | null
  created_at: string
}

export interface NotificationCenterProps {
  userId?: string | null
  className?: string
}

/**
 * Shows an in-app notification dropdown with realtime unread badge updates.
 */
export function NotificationCenter({ userId, className }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    loadNotifications()
    loadSoundPreference()
  }, [userId])

  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel(`notification-center:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload: { eventType: string }) => {
          loadNotifications()
          if (payload.eventType === 'INSERT' && soundEnabled) playNotificationSound()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [soundEnabled, userId])

  useEffect(() => {
    if (!isOpen) return

    /**
     * Closes the dropdown when clicking outside of it.
     */
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  /**
   * Loads recent notifications and unread count.
   */
  async function loadNotifications() {
    setLoading(true)
    const res = await fetch('/api/notifications')
    const data = await res.json().catch(() => ({}))

    if (res.ok) {
      const nextNotifications = data.notifications || []
      setNotifications(nextNotifications)
      setUnreadCount(nextNotifications.filter((notification: NotificationItem) => !notification.read_at && !notification.is_read).length)
    }

    setLoading(false)
  }

  /**
   * Loads whether notification sounds are enabled for this user.
   */
  async function loadSoundPreference() {
    const res = await fetch('/api/notifications/preferences')
    const data = await res.json().catch(() => ({}))
    if (res.ok) setSoundEnabled(Boolean(data.preferences?.sound_enabled))
  }

  /**
   * Marks one notification as read.
   */
  async function markAsRead(notificationId: string) {
    const res = await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationId }),
    })

    if (!res.ok) return

    const readAt = new Date().toISOString()
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === notificationId
          ? { ...notification, read_at: readAt, is_read: true }
          : notification
      )
    )
    setUnreadCount((current) => Math.max(0, current - 1))
  }

  /**
   * Marks every notification as read.
   */
  async function markAllAsRead() {
    const res = await fetch('/api/notifications/mark-all-read', { method: 'POST' })
    if (!res.ok) return

    const readAt = new Date().toISOString()
    setNotifications((current) => current.map((notification) => ({ ...notification, read_at: readAt, is_read: true })))
    setUnreadCount(0)
  }

  /**
   * Handles notification click-through and read state.
   */
  async function handleNotificationClick(notification: NotificationItem) {
    if (!notification.read_at && !notification.is_read) {
      await markAsRead(notification.id)
    }

    const href = notification.link || notification.action_url || getFallbackLink(notification, pathname)
    if (href) {
      router.push(href)
      setIsOpen(false)
    }
  }

  return (
    <div className={cn('relative', className)} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-sidebar-accent/40 hover:text-foreground"
        aria-label="Open notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive/100 px-1 text-xs font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 flex max-h-[520px] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-card/40 shadow-xl">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h3 className="font-semibold text-foreground">Notifications</h3>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllAsRead} className="text-sm font-semibold text-primary hover:text-primary">
                Mark all as read
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
            )}

            {!loading && notifications.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <Bell className="mx-auto mb-3 h-10 w-10 opacity-50" />
                No notifications yet
              </div>
            )}

            {!loading && notifications.map((notification) => {
              const unread = !notification.read_at && !notification.is_read
              const Icon = getNotificationIcon(notification.type || notification.notification_type)

              return (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => handleNotificationClick(notification)}
                  className={cn(
                    'flex w-full gap-3 border-b border-border p-4 text-left transition-colors hover:bg-background',
                    unread && 'bg-primary/10'
                  )}
                >
                  <div className="mt-0.5 rounded-lg bg-card/40 p-2 text-foreground shadow-sm">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn('text-sm text-foreground', unread && 'font-semibold text-foreground')}>
                        {notification.title}
                      </p>
                      {unread && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                    </div>
                    {notification.message && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{notification.message}</p>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground/60">{formatTimestamp(notification.created_at)}</p>
                  </div>
                </button>
              )
            })}
          </div>

          <div className="border-t border-border p-3">
            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => router.push(getNotificationPagePath(pathname))}>
              View all notifications
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Maps notification types to lucide icons.
 */
function getNotificationIcon(type: string) {
  switch (type) {
    case 'booking_approved':
    case 'booking_confirmed':
      return CheckCircle
    case 'booking_rejected':
    case 'booking_declined':
    case 'booking_cancelled':
    case 'cancellation':
      return XCircle
    case 'new_booking':
    case 'new_booking_request':
      return Calendar
    case 'new_message':
      return MessageSquare
    case 'payment_received':
    case 'payment_due':
      return CreditCard
    case 'invoice_sent':
      return FileText
    case 'review_received':
    case 'review_posted':
    case 'review_request':
      return Star
    default:
      return Bell
  }
}

/**
 * Formats a notification timestamp relative to now.
 */
function formatTimestamp(value: string) {
  const now = Date.now()
  const createdAt = new Date(value).getTime()
  const diff = now - createdAt
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Returns a role-aware notification page path.
 */
function getNotificationPagePath(pathname: string) {
  const role = pathname.split('/').filter(Boolean)[0] || 'builder'
  return `/${role}/notifications`
}

/**
 * Returns a sensible destination when a notification row has no explicit link.
 */
function getFallbackLink(notification: NotificationItem, pathname: string) {
  const role = pathname.split('/').filter(Boolean)[0] || 'builder'
  const metadata = notification.metadata || {}

  if (metadata.thread_id) return `/${role}/messages`
  if (metadata.booking_id) return `/${role}/bookings`
  if (metadata.event_id) return role === 'builder' ? '/planner/experiences' : `/${role}/bookings`
  return null
}

/**
 * Plays a small notification tone after realtime inserts when the browser allows it.
 */
function playNotificationSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContextClass) return
    const context = new AudioContextClass()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = 740
    gain.gain.value = 0.03
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.12)
  } catch {
    // Browsers may block audio until the user interacts with the page.
  }
}
