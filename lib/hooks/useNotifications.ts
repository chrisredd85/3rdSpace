import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { Notification } from '@/lib/types/database'

const notificationKeys = {
  all: ['notifications'] as const,
  user: (userId: string) => [...notificationKeys.all, userId] as const,
  unreadCount: (userId: string) => [...notificationKeys.all, 'unread', userId] as const,
}

/**
 * Fetch notifications for a user through the normalized API.
 */
export function useNotifications(userId: string | null, filters?: { type?: string; is_read?: boolean }) {
  return useQuery({
    queryKey: [...notificationKeys.user(userId || ''), filters],
    queryFn: async () => {
      if (!userId) return []

      const params = new URLSearchParams()
      if (filters?.is_read === false) params.set('unread_only', 'true')

      const response = await fetch(`/api/notifications${params.size ? `?${params}` : ''}`)
      const payload = await response.json()

      if (!response.ok) throw new Error(payload.error || 'Failed to fetch notifications')

      let notifications = (payload.notifications || []) as Notification[]
      if (filters?.type) {
        notifications = notifications.filter((notification) => notification.type === filters.type)
      }

      return notifications
    },
    enabled: !!userId,
  })
}

/**
 * Get unread notification count with polling and Supabase Realtime invalidation.
 */
export function useUnreadNotificationCount(userId: string | null) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: notificationKeys.unreadCount(userId || ''),
    queryFn: async () => {
      if (!userId) return 0

      const response = await fetch('/api/notifications?unread_only=true')
      const payload = await response.json()

      if (!response.ok) throw new Error(payload.error || 'Failed to fetch unread notifications')

      return payload.notifications?.length || 0
    },
    enabled: !!userId,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount(userId) })
          queryClient.invalidateQueries({ queryKey: notificationKeys.user(userId) })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient, userId])

  return query
}

/**
 * Mutation to mark one notification as read.
 */
export function useMarkNotificationAsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId }),
      })
      const payload = await response.json()

      if (!response.ok) throw new Error(payload.error || 'Failed to mark notification read')

      return payload.notification as Notification
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.user(data.user_id) })
      queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount(data.user_id) })
    },
  })
}

/**
 * Mutation to mark all notifications as read.
 */
export function useMarkAllAsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await fetch('/api/notifications/mark-all-read', { method: 'POST' })
      const payload = await response.json()

      if (!response.ok) throw new Error(payload.error || 'Failed to mark all notifications read')

      return { userId }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.user(data.userId) })
      queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount(data.userId) })
    },
  })
}

/**
 * Mutation to delete a notification.
 */
export function useDeleteNotification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const response = await fetch(`/api/notifications?id=${encodeURIComponent(notificationId)}`, {
        method: 'DELETE',
      })
      const payload = await response.json()

      if (!response.ok) throw new Error(payload.error || 'Failed to delete notification')

      return { notificationId }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.all })
    },
  })
}

/**
 * Mutation to create a notification through direct table access for testing/admin tooling.
 */
export function useCreateNotification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      notification: Omit<Notification, 'id' | 'created_at' | 'read_at'>
    ) => {
      const { data, error } = await supabase
        .from('notifications')
        .insert({
          ...notification,
          is_read: false,
        })
        .select()
        .single()

      if (error) throw error
      return data as Notification
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.user(data.user_id) })
      queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount(data.user_id) })
    },
  })
}
