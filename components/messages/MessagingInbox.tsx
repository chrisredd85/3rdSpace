'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CheckCheck, MessageSquare, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MessageThread } from '@/components/messages/MessageThread'

type InboxThread = {
  id: string
  subject: string
  last_message_at: string | null
  unread_count: number
  last_message?: {
    message: string
    preview?: string
    created_at: string
  } | null
  vendor_profiles?: {
    name?: string | null
    business_name?: string | null
  } | null
  builder_profiles?: {
    name?: string | null
  } | null
  vendor_bookings?: {
    status?: string | null
  } | null
}

/**
 * Renders the builder/vendor messaging inbox and selected thread view.
 */
export function MessagingInbox() {
  const [threads, setThreads] = useState<InboxThread[]>([])
  const [selectedThread, setSelectedThread] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadThreads = useCallback(async (query = search) => {
    setError(null)

    try {
      const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''
      const res = await fetch(`/api/messages/threads${suffix}`)
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to load threads')

      setThreads(data.threads || [])
      setSelectedThread((current) => current || data.threads?.[0]?.id || null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load threads')
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    loadThreads()
  }, [loadThreads])

  /**
   * Refreshes unread counts after a thread marks messages as read.
   */
  function handleMessagesRead() {
    loadThreads()
  }

  /**
   * Marks all visible inbox messages as read.
   */
  async function markAllAsRead() {
    const res = await fetch('/api/messages/read', { method: 'POST' })
    if (res.ok) loadThreads()
  }

  /**
   * Runs thread and message search.
   */
  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    loadThreads(search)
  }

  const totalUnread = threads.reduce((sum, thread) => sum + thread.unread_count, 0)

  if (loading) {
    return <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">Loading messages...</div>
  }

  return (
    <div className="grid h-[min(720px,calc(100vh-180px))] min-h-[560px] grid-cols-1 overflow-hidden rounded-lg border border-border bg-card/40 lg:grid-cols-[340px_1fr]">
      <aside className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
        <div className="border-b border-border p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
              <MessageSquare className="h-5 w-5" />
              Messages
            </h3>
            {totalUnread > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={markAllAsRead}>
                <CheckCheck className="mr-1 h-4 w-4" />
                Mark read
              </Button>
            )}
          </div>

          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search conversations"
              className="h-10 w-full rounded-lg border border-border pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
            />
          </form>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          ) : threads.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No messages yet</div>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => setSelectedThread(thread.id)}
                className={cn(
                  'w-full border-b border-border p-4 text-left transition-colors hover:bg-background',
                  selectedThread === thread.id && 'border-l-4 border-l-primary bg-primary/10'
                )}
              >
                <div className="mb-1 flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-foreground">{getThreadTitle(thread)}</p>
                  {thread.unread_count > 0 && (
                    <span className="rounded-full bg-primary/90 px-2 py-0.5 text-xs font-bold text-white">
                      {thread.unread_count > 9 ? '9+' : thread.unread_count}
                    </span>
                  )}
                </div>
                <p className="truncate text-sm text-muted-foreground">{thread.subject}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {thread.last_message?.preview || truncatePreview(thread.last_message?.message || 'No messages yet')}
                </p>
                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground/60">
                  <span>{formatThreadDate(thread.last_message_at)}</span>
                  {thread.vendor_bookings?.status && <span className="capitalize">{thread.vendor_bookings.status}</span>}
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="min-h-0">
        {selectedThread ? (
          <MessageThread threadId={selectedThread} onMessagesRead={handleMessagesRead} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a conversation to start messaging
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * Returns the display title for a thread participant.
 */
function getThreadTitle(thread: InboxThread) {
  return thread.vendor_profiles?.business_name ||
    thread.vendor_profiles?.name ||
    thread.builder_profiles?.name ||
    'Conversation'
}

/**
 * Formats a thread date for the inbox list.
 */
function formatThreadDate(value: string | null) {
  if (!value) return ''
  return new Date(value).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Truncates long previews for dense inbox rows.
 */
function truncatePreview(value: string, maxLength = 96) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}...`
}
