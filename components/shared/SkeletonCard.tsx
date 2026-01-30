'use client'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface SkeletonCardProps {
  /**
   * Number of lines to show
   */
  lines?: number
  /**
   * Show header skeleton
   */
  showHeader?: boolean
  /**
   * Show image skeleton
   */
  showImage?: boolean
  /**
   * Additional CSS classes
   */
  className?: string
  /**
   * Variant: card, list, table
   */
  variant?: 'card' | 'list' | 'table'
}

/**
 * SkeletonCard component for loading states
 * 
 * Animated skeleton matching card layouts, used while data is fetching.
 * 
 * @example
 * ```tsx
 * {isLoading ? (
 *   <SkeletonCard lines={3} showHeader showImage />
 * ) : (
 *   <EventCard event={event} />
 * )}
 * ```
 */
export function SkeletonCard({
  lines = 2,
  showHeader = false,
  showImage = false,
  className,
  variant = 'card',
}: SkeletonCardProps) {
  if (variant === 'list') {
    return (
      <div className={cn('flex items-center gap-4 p-4 border-b border-gray-200', className)}>
        <div className="h-12 w-12 rounded-full bg-gray-200 animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-3/4 bg-gray-200 rounded animate-pulse" />
          <div className="h-3 w-1/2 bg-gray-200 rounded animate-pulse" />
        </div>
      </div>
    )
  }

  if (variant === 'table') {
    return (
      <div className={cn('p-4 border-b border-gray-200', className)}>
        <div className="grid grid-cols-4 gap-4">
          <div className="h-4 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 bg-gray-200 rounded animate-pulse" />
        </div>
      </div>
    )
  }

  return (
    <Card className={cn('overflow-hidden', className)}>
      {showImage && (
        <div className="h-48 w-full bg-gray-200 animate-pulse" />
      )}
      {showHeader && (
        <CardHeader>
          <div className="h-6 w-3/4 bg-gray-200 rounded animate-pulse mb-2" />
          <div className="h-4 w-1/2 bg-gray-200 rounded animate-pulse" />
        </CardHeader>
      )}
      <CardContent className={cn(showHeader ? '' : 'p-6')}>
        <div className="space-y-3">
          {Array.from({ length: lines }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-4 bg-gray-200 rounded animate-pulse',
                i === lines - 1 ? 'w-2/3' : 'w-full'
              )}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * SkeletonLoader for inline loading states
 */
export function SkeletonLoader({
  className,
  width = 'w-full',
  height = 'h-4',
}: {
  className?: string
  width?: string
  height?: string
}) {
  return (
    <div className={cn('bg-gray-200 rounded animate-pulse', width, height, className)} />
  )
}

/**
 * SkeletonText for text loading states
 */
export function SkeletonText({
  lines = 1,
  className,
}: {
  lines?: number
  className?: string
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLoader
          key={i}
          width={i === lines - 1 ? 'w-2/3' : 'w-full'}
        />
      ))}
    </div>
  )
}
