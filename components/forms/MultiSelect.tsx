'use client'

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface MultiSelectOption {
  /**
   * Unique identifier for the option
   */
  id: string
  /**
   * Display label
   */
  label: string
  /**
   * Optional description
   */
  description?: string
}

export interface MultiSelectProps {
  /**
   * Available options
   */
  options: MultiSelectOption[]
  /**
   * Selected option IDs
   */
  value: string[]
  /**
   * Change handler
   */
  onChange: (selectedIds: string[]) => void
  /**
   * Whether multiple selections are allowed
   * @default true
   */
  multiple?: boolean
  /**
   * Additional CSS classes
   */
  className?: string
  /**
   * Error message
   */
  error?: string
}

/**
 * MultiSelect component for multiple checkbox selection
 * 
 * @example
 * ```tsx
 * <MultiSelect
 *   options={amenities}
 *   value={selectedAmenities}
 *   onChange={setSelectedAmenities}
 * />
 * ```
 */
export const MultiSelect = forwardRef<HTMLDivElement, MultiSelectProps>(
  ({ options, value, onChange, multiple = true, className, error }, ref) => {
    const handleToggle = (optionId: string) => {
      if (multiple) {
        if (value.includes(optionId)) {
          onChange(value.filter((id) => id !== optionId))
        } else {
          onChange([...value, optionId])
        }
      } else {
        onChange([optionId])
      }
    }

    return (
      <div ref={ref} className={cn('space-y-2', className)}>
        {options.map((option) => (
          <label
            key={option.id}
            className={cn(
              'flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors',
              value.includes(option.id)
                ? 'border-forest-500 bg-forest-50'
                : 'border-gray-200 hover:bg-gray-50',
              error && 'border-red-500'
            )}
          >
            <input
              type="checkbox"
              checked={value.includes(option.id)}
              onChange={() => handleToggle(option.id)}
              className="mt-1 h-4 w-4 text-forest-500 focus:ring-forest-500"
            />
            <div className="flex-1">
              <div className="font-medium text-sm text-gray-900">
                {option.label}
              </div>
              {option.description && (
                <div className="text-xs text-gray-500 mt-0.5">
                  {option.description}
                </div>
              )}
            </div>
          </label>
        ))}
        {error && (
          <p className="text-sm text-red-500 mt-1">{error}</p>
        )}
      </div>
    )
  }
)

MultiSelect.displayName = 'MultiSelect'
