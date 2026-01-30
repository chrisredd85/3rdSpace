'use client'

import { forwardRef } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface TimePickerProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * TimePicker component for time selection
 * 
 * @example
 * ```tsx
 * <TimePicker {...register('event_time')} />
 * ```
 */
export const TimePicker = forwardRef<HTMLInputElement, TimePickerProps>(
  ({ className, ...props }, ref) => {
    return (
      <Input
        ref={ref}
        type="time"
        className={cn('', className)}
        {...props}
      />
    )
  }
)

TimePicker.displayName = 'TimePicker'
