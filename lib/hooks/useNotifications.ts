import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { Notification } from '@/lib/types/database'

// Query keys
const notificationKeys = {
  all: ['notifications'] as const,
  user: (userId: string) => [...notificationKeys.all, userId] as const,
  unreadCount: (userId: string) => [...notificationKeys.all, 'unread', userId] as const,
}

/**
 * Fetch notifications for a user
 */
export function useNotifications(userId: string | null, filters?: { type?: string; is_read?: boolean }) {
  return useQuery({
    queryKey: [...notificationKeys.user(userId || ''), filters],
    queryFn: async () => {
      if (!userId) return []

      let query = supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (filters?.type) {
        query = query.eq('type', filters.type)
      }

      if (filters?.is_read !== undefined) {
        query = query.eq('is_read', filters.is_read)
      }

      const { data, error } = await query.limit(50)

      if (error) throw error
      return (data || []) as Notification[]
    },
    enabled: !!userId,
  })
}

/**
 * Get unread notification count
 */
export function useUnreadNotificationCount(userId: string | null) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: notificationKeys.unreadCount(userId || ''),
    queryFn: async () => {
      if (!userId) return 0

      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false)

      if (error) throw error
      return count || 0
    },
    enabled: !!userId,
    refetchInterval: 30000, // Refetch every 30 seconds
  })

  // Set up realtime subscription
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
          queryClient.invalidateQueries({
            queryKey: notificationKeys.unreadCount(userId),
          })
          queryClient.invalidateQueries({
            queryKey: notificationKeys.user(userId),
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, queryClient])

  return query
}

/**
 * Mutation to mark notification as read
 */
export function useMarkNotificationAsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { data, error } = await supabase
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq('id', notificationId)
        .select()
        .single()

      if (error) throw error
      return data as Notification
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: notificationKeys.user(data.user_id),
      })
      queryClient.invalidateQueries({
        queryKey: notificationKeys.unreadCount(data.user_id),
      })
    },
  })
}

/**
 * Mutation to mark all notifications as read
 */
export function useMarkAllAsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('is_read', false)

      if (error) throw error
      return { userId }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: notificationKeys.user(data.userId),
      })
      queryClient.invalidateQueries({
        queryKey: notificationKeys.unreadCount(data.userId),
      })
    },
  })
}

/**
 * Mutation to delete notification
 */
export function useDeleteNotification() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { data: notification } = await supabase
        .from('notifications')
        .select('user_id')
        .eq('id', notificationId)
        .single()

      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId)

      if (error) throw error
      return { notificationId, userId: notification?.user_id }
    },
    onSuccess: (data) => {
      if (data.userId) {
        queryClient.invalidateQueries({
          queryKey: notificationKeys.user(data.userId),
        })
        queryClient.invalidateQueries({
          queryKey: notificationKeys.unreadCount(data.userId),
        })
      }
    },
  })
}

/**
 * Mutation to create a notification (for testing/admin)
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
      queryClient.invalidateQueries({
        queryKey: notificationKeys.user(data.user_id),
      })
      queryClient.invalidateQueries({
        queryKey: notificationKeys.unreadCount(data.user_id),
      })
    },
  })
}
