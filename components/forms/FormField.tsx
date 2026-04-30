'use client'

import { cloneElement, forwardRef, isValidElement, useId } from 'react'
import type { ReactElement } from 'react'
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
    const generatedId = useId()
    const child = isValidElement(children) ? children : null
    const fieldId = String((child?.props as { id?: string; name?: string } | undefined)?.id || (child?.props as { id?: string; name?: string } | undefined)?.name || generatedId)
    const descriptionId = error || helperText ? `${fieldId}-description` : undefined
    const field = child
      ? cloneElement(child as ReactElement<any>, {
          id: fieldId,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': descriptionId,
        })
      : children

    return (
      <div ref={ref} className={cn('space-y-2', className)}>
        <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </label>
        {field}
        {error && (
          <p id={descriptionId} className="text-sm text-destructive">{error}</p>
        )}
        {helperText && !error && (
          <p id={descriptionId} className="text-sm text-muted-foreground">{helperText}</p>
        )}
      </div>
    )
  }
)

FormField.displayName = 'FormField'
