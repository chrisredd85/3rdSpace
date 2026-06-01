'use client'

import { cn } from '@/lib/utils'
import type { BookingStatus, EventStatus } from '@/lib/types'

export type BadgeStatus = BookingStatus | EventStatus | 'active' | 'inactive' | 'verified' | 'pending'

export interface BadgeProps {
  /**
   * Status value that determines badge appearance
   */
  status: BadgeStatus
  /**
   * Size of the badge
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * Badge component for displaying status indicators
 * 
 * Color coding:
 * - pending: Yellow
 * - confirmed/active/verified: Green
 * - declined/cancelled/inactive: Gray/Red
 * 
 * @example
 * ```tsx
 * <Badge status="pending" size="md" />
 * <Badge status="confirmed" />
 * ```
 */
export function Badge({ status, size = 'md', className }: BadgeProps) {
  const sizeClasses = {
    sm: 'px-1.5 py-0.5 text-xs',
    md: 'px-2 py-1 text-xs',
    lg: 'px-3 py-1.5 text-sm',
  }

  const getStatusStyles = (status: BadgeStatus) => {
    switch (status) {
      case 'pending':
      case 'planning':
        return 'bg-ochre-tint text-ochre'
      case 'confirmed':
      case 'active':
      case 'verified':
      case 'completed':
        return 'bg-clay/15 text-clay'
      case 'declined':
      case 'inactive':
        return 'bg-cream-deep/40 text-ink'
      case 'cancelled':
        return 'bg-brick/15 text-brick'
      case 'in_progress':
        return 'bg-clay/15 text-ink'
      default:
        return 'bg-cream-deep/40 text-ink'
    }
  }

  const getStatusLabel = (status: BadgeStatus) => {
    switch (status) {
      case 'pending':
        return 'Pending'
      case 'confirmed':
        return 'Confirmed'
      case 'declined':
        return 'Declined'
      case 'cancelled':
        return 'Cancelled'
      case 'planning':
        return 'Drafting'
      case 'in_progress':
        return 'In Progress'
      case 'completed':
        return 'Completed'
      case 'active':
        return 'Active'
      case 'inactive':
        return 'Inactive'
      case 'verified':
        return 'Verified'
      default:
        return (status as string).charAt(0).toUpperCase() + (status as string).slice(1)
    }
  }

  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-full',
        sizeClasses[size],
        getStatusStyles(status),
        className
      )}
    >
      {getStatusLabel(status)}
    </span>
  )
}
