'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Bell,
  CheckCircle,
  XCircle,
  MessageSquare,
  DollarSign,
  Star,
  Calendar,
  Check,
  Trash2,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  useNotifications,
  useUnreadNotificationCount,
  useMarkNotificationAsRead,
  useMarkAllAsRead,
  useDeleteNotification,
} from '@/lib/hooks/useNotifications'
import { useUser } from '@/lib/hooks/useUser'
import { Badge } from '@/components/shared/Badge'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { useToast } from '@/components/ui/toast'
import { NotificationPreferences } from '@/components/notifications/NotificationPreferences'
import { cn } from '@/lib/utils'
import type { Notification } from '@/lib/types/database'

type TabType = 'all' | 'unread' | 'bookings' | 'messages' | 'payments' | 'reviews'

const NOTIFICATION_TYPES = {
  new_booking_request: 'Booking Requests',
  new_booking: 'Bookings',
  booking_confirmed: 'Booking Requests',
  booking_declined: 'Booking Requests',
  booking_approved: 'Bookings',
  booking_rejected: 'Bookings',
  booking_cancelled: 'Bookings',
  new_message: 'Messages',
  payment_received: 'Payments',
  invoice_sent: 'Payments',
  payment_due: 'Payments',
  review_posted: 'Reviews',
  review_received: 'Reviews',
  review_request: 'Reviews',
  reminder: 'All',
  cancellation: 'Bookings',
}

export default function NotificationsPage() {
  const params = useParams()
  const router = useRouter()
  const userType = params.userType as string
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [activeTab, setActiveTab] = useState<TabType>('all')
  const [selectedNotifications, setSelectedNotifications] = useState<Set<string>>(new Set())
  const { addToast } = useToast()

  const userId = user?.id || null
  const { data: allNotifications = [], isLoading } = useNotifications(userId)
  const { data: unreadCount = 0 } = useUnreadNotificationCount(userId)
  const markAsRead = useMarkNotificationAsRead()
  const markAllAsRead = useMarkAllAsRead()
  const deleteNotification = useDeleteNotification()

  // Loading and error handling
  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-ink-soft">Loading...</div>
      </div>
    )
  }

  if (userError || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-brick">Please log in to continue</div>
      </div>
    )
  }

  // Filter notifications by tab
  const filteredNotifications = allNotifications.filter((notification) => {
    if (activeTab === 'unread') {
      return !notification.is_read
    }
    if (activeTab === 'bookings') {
      return ['new_booking_request', 'new_booking', 'booking_confirmed', 'booking_declined', 'booking_approved', 'booking_rejected', 'booking_cancelled', 'cancellation'].includes(
        notification.type
      )
    }
    if (activeTab === 'messages') {
      return notification.type === 'new_message'
    }
    if (activeTab === 'payments') {
      return ['payment_received', 'invoice_sent', 'payment_due'].includes(notification.type)
    }
    if (activeTab === 'reviews') {
      return ['review_posted', 'review_received', 'review_request'].includes(notification.type)
    }
    return true
  })

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      await markAsRead.mutateAsync(notificationId)
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to mark notification as read',
        variant: 'destructive',
      })
    }
  }

  const handleMarkAllAsRead = async () => {
    if (!userId) return

    try {
      await markAllAsRead.mutateAsync(userId)
      addToast({
        title: 'Success',
        description: 'All notifications marked as read',
      })
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to mark all as read',
        variant: 'destructive',
      })
    }
  }

  const handleDelete = async (notificationId: string) => {
    try {
      await deleteNotification.mutateAsync(notificationId)
      addToast({
        title: 'Notification deleted',
        description: 'The notification has been removed.',
      })
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to delete notification',
        variant: 'destructive',
      })
    }
  }

  const handleBulkDelete = async () => {
    if (selectedNotifications.size === 0) return

    try {
      await Promise.all(
        Array.from(selectedNotifications).map((id) => deleteNotification.mutateAsync(id))
      )
      setSelectedNotifications(new Set())
      addToast({
        title: 'Notifications deleted',
        description: `${selectedNotifications.size} notification(s) removed.`,
      })
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to delete notifications',
        variant: 'destructive',
      })
    }
  }

  const getNotificationIcon = (notificationType: string) => {
    switch (notificationType) {
      case 'new_booking_request':
      case 'new_booking':
        return <Calendar className="h-5 w-5 text-clay" />
      case 'booking_confirmed':
      case 'booking_approved':
        return <CheckCircle className="h-5 w-5 text-clay" />
      case 'booking_declined':
      case 'booking_rejected':
      case 'booking_cancelled':
      case 'cancellation':
        return <XCircle className="h-5 w-5 text-brick" />
      case 'new_message':
        return <MessageSquare className="h-5 w-5 text-clay" />
      case 'payment_received':
      case 'invoice_sent':
      case 'payment_due':
        return <DollarSign className="h-5 w-5 text-ochre" />
      case 'review_posted':
      case 'review_received':
      case 'review_request':
        return <Star className="h-5 w-5 text-ochre" />
      case 'reminder':
        return <Bell className="h-5 w-5 text-ochre" />
      default:
        return <Bell className="h-5 w-5 text-ink-soft" />
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
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
    if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`
    return notificationDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: notificationDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    })
  }

  const getActionButton = (notification: Notification) => {
    const metadata = notification.metadata as any
    
    if (notification.link) {
      const linkParts = notification.link.split('/')
      const actionLabel = linkParts[linkParts.length - 1] === 'messages' 
        ? 'View Message' 
        : linkParts[linkParts.length - 1] === 'bookings'
        ? 'View Booking'
        : linkParts.includes('event')
        ? 'View Event'
        : 'View'
      
      return (
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation()
            router.push(notification.link!)
          }}
        >
          {actionLabel}
        </Button>
      )
    }
    
    if (metadata?.event_id) {
      return (
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation()
            router.push(`/${userType}/event/${metadata.event_id}`)
          }}
        >
          View Event
        </Button>
      )
    }
    if (metadata?.booking_id) {
      return (
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation()
            router.push(`/${userType}/bookings`)
          }}
        >
          View Booking
        </Button>
      )
    }
    if (metadata?.thread_id) {
      return (
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation()
            router.push(`/${userType}/messages`)
          }}
        >
          View Message
        </Button>
      )
    }
    return null
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" text="Loading notifications..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-ink">Notifications</h1>
          <p className="text-ink-soft mt-1">Stay updated on your events and bookings</p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" onClick={handleMarkAllAsRead}>
            <Check className="h-4 w-4 mr-2" />
            Mark All as Read
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-tan">
        {[
          { id: 'all' as TabType, label: 'All' },
          { id: 'unread' as TabType, label: 'Unread', count: unreadCount },
          { id: 'bookings' as TabType, label: 'Bookings' },
          { id: 'messages' as TabType, label: 'Messages' },
          { id: 'payments' as TabType, label: 'Payments' },
          { id: 'reviews' as TabType, label: 'Reviews' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              activeTab === tab.id
                ? 'border-clay text-clay'
                : 'border-transparent text-ink-soft hover:text-ink'
            )}
          >
            <div className="flex items-center gap-2">
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-clay/15 text-clay text-xs font-semibold">
                  {tab.count}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Bulk Actions */}
      {selectedNotifications.size > 0 && (
        <Card className="bg-clay/10 border-clay/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-clay">
                {selectedNotifications.size} notification{selectedNotifications.size !== 1 ? 's' : ''} selected
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    Array.from(selectedNotifications).forEach((id) => {
                      const notification = allNotifications.find((n) => n.id === id)
                      if (notification && !notification.is_read) {
                        handleMarkAsRead(id)
                      }
                    })
                    setSelectedNotifications(new Set())
                  }}
                >
                  <Check className="h-4 w-4 mr-2" />
                  Mark Read
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBulkDelete}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notifications List */}
      {filteredNotifications.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Bell}
              title={
                activeTab === 'unread'
                  ? 'No unread notifications'
                  : 'No notifications'
              }
              description={
                activeTab === 'unread'
                  ? "You're all caught up!"
                  : 'Notifications will appear here when you receive updates'
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredNotifications.map((notification) => (
            <Card
              key={notification.id}
              className={cn(
                'hover:shadow-md transition-shadow cursor-pointer',
                !notification.is_read && 'border-l-4 border-l-primary'
              )}
              onClick={() => {
                if (!notification.is_read) {
                  handleMarkAsRead(notification.id)
                }
                if (notification.link) {
                  router.push(notification.link)
                } else {
                  const metadata = notification.metadata as any
                  if (metadata?.event_id) {
                    router.push(`/${userType}/event/${metadata.event_id}`)
                  } else if (metadata?.booking_id) {
                    router.push(`/${userType}/bookings`)
                  } else if (metadata?.thread_id) {
                    router.push(`/${userType}/messages`)
                  }
                }
              }}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 mt-1">
                    {getNotificationIcon(notification.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3
                            className={cn(
                              'text-sm',
                              !notification.is_read
                                ? 'font-semibold text-ink'
                                : 'text-ink'
                            )}
                          >
                            {notification.title}
                          </h3>
                          {!notification.is_read && (
                            <div className="h-2 w-2 rounded-full bg-clay flex-shrink-0" />
                          )}
                        </div>
                        {notification.message && (
                          <p className="text-sm text-ink-soft mb-2">
                            {notification.message}
                          </p>
                        )}
                        <p className="text-xs text-ink-soft/60">
                          {formatTimestamp(notification.created_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedNotifications.has(notification.id)}
                          onChange={(e) => {
                            e.stopPropagation()
                            setSelectedNotifications((prev) => {
                              const next = new Set(prev)
                              if (e.target.checked) {
                                next.add(notification.id)
                              } else {
                                next.delete(notification.id)
                              }
                              return next
                            })
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 text-clay"
                        />
                        {getActionButton(notification)}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(notification.id)
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NotificationPreferences />
    </div>
  )
}
