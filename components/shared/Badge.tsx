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
        return 'bg-yellow-100 text-yellow-800'
      case 'confirmed':
      case 'active':
      case 'verified':
      case 'completed':
        return 'bg-forest-100 text-forest-800'
      case 'declined':
      case 'inactive':
        return 'bg-gray-100 text-gray-800'
      case 'cancelled':
        return 'bg-red-100 text-red-800'
      case 'in_progress':
        return 'bg-blue-100 text-blue-800'
      default:
        return 'bg-gray-100 text-gray-800'
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
        return 'Planning'
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
