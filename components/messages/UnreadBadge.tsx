'use client'

import { useEffect, useState } from 'react'
import { MessageSquare } from 'lucide-react'

/**
 * Shows the total unread message count with polling for navigation surfaces.
 */
export function UnreadMessageBadge() {
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    loadUnreadCount()

    const interval = window.setInterval(loadUnreadCount, 30000)
    return () => window.clearInterval(interval)
  }, [])

  /**
   * Loads the unread count by summing unread messages across threads.
   */
  async function loadUnreadCount() {
    const res = await fetch('/api/messages/threads')
    const data = await res.json().catch(() => ({}))

    if (res.ok && data.threads) {
      const total = data.threads.reduce(
        (sum: number, thread: { unread_count?: number }) => sum + (thread.unread_count || 0),
        0
      )
      setUnreadCount(total)
    }
  }

  return (
    <div className="relative inline-flex">
      <MessageSquare className="h-6 w-6" />
      {unreadCount > 0 && (
        <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive/100 px-1 text-xs font-bold text-white">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </div>
  )
}
