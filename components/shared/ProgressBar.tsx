'use client'

import { cn } from '@/lib/utils'

export interface ProgressBarProps {
  /**
   * Progress value (0-100)
   */
  value: number
  /**
   * Maximum value (default: 100)
   */
  max?: number
  /**
   * Show percentage label
   */
  showLabel?: boolean
  /**
   * Size variant
   */
  size?: 'sm' | 'md' | 'lg'
  /**
   * Color variant
   */
  variant?: 'default' | 'success' | 'warning' | 'error'
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * ProgressBar component for showing upload/download progress
 * 
 * @example
 * ```tsx
 * <ProgressBar value={uploadProgress} showLabel />
 * ```
 */
export function ProgressBar({
  value,
  max = 100,
  showLabel = false,
  size = 'md',
  variant = 'default',
  className,
}: ProgressBarProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100)

  const sizeClasses = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-3',
  }

  const variantClasses = {
    default: 'bg-forest-500',
    success: 'bg-forest-500',
    warning: 'bg-yellow-500',
    error: 'bg-red-500',
  }

  return (
    <div className={cn('w-full', className)}>
      {showLabel && (
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-700">Progress</span>
          <span className="text-xs font-medium text-gray-700">{Math.round(percentage)}%</span>
        </div>
      )}
      <div className={cn('w-full bg-gray-200 rounded-full overflow-hidden', sizeClasses[size])}>
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300 ease-out',
            variantClasses[variant]
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
