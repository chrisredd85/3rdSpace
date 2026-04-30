'use client'

import { NotificationCenter } from '@/components/notifications/NotificationCenter'
import { useUser } from '@/lib/hooks/useUser'

export interface NotificationBellProps {
  /**
   * User ID for realtime notification updates.
   */
  userId?: string | null
  /**
   * Additional CSS classes.
   */
  className?: string
}

/**
 * Header notification bell backed by the unified notification center.
 */
export function NotificationBell({ userId: propUserId, className }: NotificationBellProps) {
  const { user } = useUser()
  const userId = propUserId || user?.id || null

  return <NotificationCenter userId={userId} className={className} />
}
