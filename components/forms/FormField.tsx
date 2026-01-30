'use client'

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface FormFieldProps {
  /**
   * Label text for the field
   */
  label: string
  /**
   * Whether the field is required
   */
  required?: boolean
  /**
   * Error message to display
   */
  error?: string
  /**
   * Helper text to display below the field
   */
  helperText?: string
  /**
   * Additional CSS classes
   */
  className?: string
  /**
   * Child input element
   */
  children: React.ReactNode
}

/**
 * FormField wrapper component that provides consistent label, error, and helper text styling
 * 
 * @example
 * ```tsx
 * <FormField label="Email" required error={errors.email?.message}>
 *   <Input {...register('email')} />
 * </FormField>
 * ```
 */
export const FormField = forwardRef<HTMLDivElement, FormFieldProps>(
  ({ label, required, error, helperText, className, children }, ref) => {
    return (
      <div ref={ref} className={cn('space-y-2', className)}>
        <label className="text-sm font-medium text-gray-700">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {children}
        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}
        {helperText && !error && (
          <p className="text-sm text-gray-500">{helperText}</p>
        )}
      </div>
    )
  }
)

FormField.displayName = 'FormField'
