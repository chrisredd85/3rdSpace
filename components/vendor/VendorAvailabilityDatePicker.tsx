'use client'

import { forwardRef, useState } from 'react'
import { DatePicker, type DatePickerProps } from '@/components/forms/DatePicker'
import { ConflictAlert } from '@/components/vendor/ConflictAlert'

export interface VendorAvailabilityDatePickerProps extends DatePickerProps {
  vendorId?: string | null
  onConflictChange?: (hasConflict: boolean) => void
}

/**
 * Date picker that overlays vendor availability conflict feedback for builders.
 *
 * @param props - Date input props plus vendor id.
 * @returns Date picker with conflict alert.
 */
export const VendorAvailabilityDatePicker = forwardRef<HTMLInputElement, VendorAvailabilityDatePickerProps>(
  ({ vendorId, onConflictChange, onChange, value, defaultValue, ...props }, ref) => {
    const [selectedDate, setSelectedDate] = useState(String(value || defaultValue || ''))

    return (
      <div className="space-y-2">
        <DatePicker
          ref={ref}
          value={value}
          defaultValue={defaultValue}
          onChange={(event) => {
            setSelectedDate(event.target.value)
            onChange?.(event)
          }}
          {...props}
        />
        <ConflictAlert
          vendorId={vendorId}
          date={selectedDate}
          compact
          onConflictChange={onConflictChange}
        />
      </div>
    )
  }
)

VendorAvailabilityDatePicker.displayName = 'VendorAvailabilityDatePicker'

