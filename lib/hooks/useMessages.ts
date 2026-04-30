import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Message, MessageThread } from '@/lib/types'

// Query keys
const messageKeys = {
  all: ['messages'] as const,
  threads: () => [...messageKeys.all, 'threads'] as const,
  thread: (threadId: string) => [...messageKeys.all, 'thread', threadId] as const,
  messages: (threadId: string) => [...messageKeys.all, 'messages', threadId] as const,
  unreadCount: () => [...messageKeys.all, 'unread-count'] as const,
}

interface ThreadWithDetails extends MessageThread {
  last_message: Message | null
  unread_count: number
  other_participant: {
    id: string
    name: string | null
    email: string
    avatar_url: string | null
  } | null
}

interface MessageWithSender extends Message {
  profiles?: {
    id: string
    name: string | null
    email: string
    avatar_url: string | null
  } | null
}

/**
 * Fetch all message threads for current user
 */
export function useThreads() {
  const queryClient = useQueryClient()

  const query = useQuery<ThreadWithDetails[]>({
    queryKey: messageKeys.threads(),
    queryFn: async () => {
      const response = await fetch('/api/messages/threads', {
        credentials: 'include',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to fetch threads')
      }

      const data = await response.json()
      return data.threads || []
    },
    staleTime: 30 * 1000, // Cache for 30 seconds
    refetchInterval: 60 * 1000, // Refetch every minute
  })

  // Subscribe to real-time updates for threads
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('message_threads')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_threads',
        },
        (payload) => {
          // Invalidate threads query to refetch
          queryClient.invalidateQueries({ queryKey: messageKeys.threads() })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])

  return query
}

/**
 * Fetch all messages in a thread
 */
export function useMessages(threadId: string | null) {
  const queryClient = useQueryClient()

  const query = useQuery<{
    thread: MessageThread & {
      other_participant: {
        id: string
        name: string | null
        email: string
        avatar_url: string | null
      } | null
    }
    messages: MessageWithSender[]
    count: number
  }>({
    queryKey: messageKeys.messages(threadId || ''),
    queryFn: async () => {
      if (!threadId) return null as any

      const response = await fetch(`/api/messages/threads/${threadId}`, {
        credentials: 'include',
      })

      if (!response.ok) {
        if (response.status === 404) return null
        const error = await response.json()
        throw new Error(error.error || 'Failed to fetch messages')
      }

      return response.json()
    },
    enabled: !!threadId,
    staleTime: 10 * 1000, // Cache for 10 seconds
  })

  // Subscribe to real-time updates for messages in this thread
  useEffect(() => {
    if (!threadId) return

    const supabase = createClient()
    const channel = supabase
      .channel(`messages:${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          // Optimistically add new message to cache
          queryClient.setQueryData(
            messageKeys.messages(threadId),
            (old: any) => {
              if (!old) return old
              return {
                ...old,
                messages: [...(old.messages || []), payload.new as MessageWithSender],
                count: (old.count || 0) + 1,
              }
            }
          )
          // Invalidate to refetch and get sender profile
          queryClient.invalidateQueries({ queryKey: messageKeys.messages(threadId) })
          // Invalidate threads to update last_message
          queryClient.invalidateQueries({ queryKey: messageKeys.threads() })
          // Invalidate unread count
          queryClient.invalidateQueries({ queryKey: messageKeys.unreadCount() })
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          // Update message in cache (e.g., read status)
          queryClient.setQueryData(
            messageKeys.messages(threadId),
            (old: any) => {
              if (!old) return old
              return {
                ...old,
                messages: (old.messages || []).map((msg: Message) =>
                  msg.id === payload.new.id ? payload.new : msg
                ),
              }
            }
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [threadId, queryClient])

  return query
}

/**
 * Mutation to send a message
 */
export function useSendMessage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      thread_id,
      content,
    }: {
      thread_id: string
      content: string
    }) => {
      const response = await fetch('/api/messages/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ thread_id, content }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to send message')
      }

      const data = await response.json()
      return data.message as MessageWithSender
    },
    onSuccess: (message, variables) => {
      // Optimistically add message to cache
      queryClient.setQueryData(
        messageKeys.messages(variables.thread_id),
        (old: any) => {
          if (!old) return old
          return {
            ...old,
            messages: [...(old.messages || []), message],
            count: (old.count || 0) + 1,
          }
        }
      )
      // Invalidate to refetch and ensure consistency
      queryClient.invalidateQueries({ queryKey: messageKeys.messages(variables.thread_id) })
      queryClient.invalidateQueries({ queryKey: messageKeys.threads() })
    },
  })
}

/**
 * Get total unread message count across all threads
 */
export function useUnreadCount() {
  const { data: unreadCount = 0, isLoading } = useQuery<number>({
    queryKey: messageKeys.unreadCount(),
    queryFn: async () => {
      const response = await fetch('/api/messages/unread-count', {
        credentials: 'include',
      })
      const payload = await response.json()

      if (!response.ok) {
        if (response.status === 404) return 0
        throw new Error(payload.error || 'Failed to fetch unread count')
      }

      return Number(payload.count || 0)
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  })

  return {
    unreadCount,
    isLoading,
  }
}

/**
 * Alias for useThreads - fetches all message threads for current user
 * @param userId - Optional user ID (API will use session if not provided)
 */
export function useMessageThreads(userId?: string | null) {
  // userId is accepted for API compatibility but API route uses session
  return useThreads()
}

/**
 * Mutation to mark messages in a thread as read
 */
export function useMarkAsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      threadId,
      userId,
    }: {
      threadId: string
      userId?: string | null
    }) => {
      const response = await fetch(`/api/messages/threads/${threadId}/read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ threadId }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to mark as read')
      }

      return response.json()
    },
    onSuccess: (_, variables) => {
      // Invalidate messages to refetch with updated read status
      queryClient.invalidateQueries({ queryKey: messageKeys.messages(variables.threadId) })
      // Invalidate threads to update unread count
      queryClient.invalidateQueries({ queryKey: messageKeys.threads() })
      // Invalidate unread count
      queryClient.invalidateQueries({ queryKey: messageKeys.unreadCount() })
    },
  })
}

/**
 * Mutation to create a new thread
 */
export function useCreateThread() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      participant_2_id,
      event_id,
      venue_booking_id,
      vendor_booking_id,
    }: {
      participant_2_id: string
      event_id?: string | null | undefined
      venue_booking_id?: string | null | undefined
      vendor_booking_id?: string | null | undefined
    }) => {
      const response = await fetch('/api/messages/threads/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          participant_2_id,
          event_id,
          venue_booking_id,
          vendor_booking_id,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create thread')
      }

      const data = await response.json()
      return data.thread as ThreadWithDetails
    },
    onSuccess: () => {
      // Invalidate threads to refetch
      queryClient.invalidateQueries({ queryKey: messageKeys.threads() })
    },
  })
}

/**
 * Alias for useCreateThread - create or get existing thread (API may return existing)
 */
export function useCreateOrGetThread() {
  return useCreateThread()
}
