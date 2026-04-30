'use client'

import { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  /**
   * Icon component to display (from lucide-react)
   */
  icon: LucideIcon
  /**
   * Title text
   */
  title: string
  /**
   * Description text
   */
  description?: string
  /**
   * Optional CTA button text
   */
  actionLabel?: string
  /**
   * Optional CTA button click handler
   */
  onAction?: () => void
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * EmptyState component for displaying empty states when no data is available
 * 
 * @example
 * ```tsx
 * <EmptyState
 *   icon={Calendar}
 *   title="No events yet"
 *   description="Create your first event to get started"
 *   actionLabel="Create Event"
 *   onAction={() => router.push('/builder/event/new')}
 * />
 * ```
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 px-4 text-center',
        className
      )}
    >
      <div className="h-16 w-16 rounded-full bg-sidebar-accent/40 flex items-center justify-center mb-4">
        <Icon className="h-8 w-8 text-muted-foreground/60" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-md mb-6">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button onClick={onAction}>{actionLabel}</Button>
      )}
    </div>
  )
}
