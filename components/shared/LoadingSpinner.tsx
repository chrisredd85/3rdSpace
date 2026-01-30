'use client'

import { cn } from '@/lib/utils'

export interface LoadingSpinnerProps {
  /**
   * Size of the spinner
   * @default 'md'
   */
  size?: 'sm' | 'md' | 'lg'
  /**
   * Optional text to display below spinner
   */
  text?: string
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * LoadingSpinner component for displaying loading states
 * 
 * @example
 * ```tsx
 * <LoadingSpinner size="lg" text="Loading events..." />
 * ```
 */
export function LoadingSpinner({
  size = 'md',
  text,
  className,
}: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4 border-2',
    md: 'h-8 w-8 border-4',
    lg: 'h-12 w-12 border-4',
  }

  return (
    <div className={cn('flex flex-col items-center justify-center', className)}>
      <div
        className={cn(
          'animate-spin rounded-full border-forest-500 border-t-transparent',
          sizeClasses[size]
        )}
      />
      {text && (
        <p className="text-sm text-gray-600 mt-4">{text}</p>
      )}
    </div>
  )
}
