'use client'

import { forwardRef } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface DatePickerProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /**
   * Minimum date allowed
   */
  minDate?: string
  /**
   * Maximum date allowed
   */
  maxDate?: string
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * DatePicker component for date selection
 * 
 * @example
 * ```tsx
 * <DatePicker
 *   {...register('event_date')}
 *   minDate={new Date().toISOString().split('T')[0]}
 * />
 * ```
 */
export const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(
  ({ minDate, maxDate, className, ...props }, ref) => {
    return (
      <Input
        ref={ref}
        type="date"
        min={minDate}
        max={maxDate}
        className={cn('', className)}
        {...props}
      />
    )
  }
)

DatePicker.displayName = 'DatePicker'
