'use client'

import { Loader2 } from 'lucide-react'
import { Button, ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface LoadingButtonProps extends ButtonProps {
  /**
   * Show loading state
   */
  loading?: boolean
  /**
   * Loading text (replaces children when loading)
   */
  loadingText?: string
}

/**
 * LoadingButton component with built-in loading state
 * 
 * Shows spinner and disables button when loading.
 * 
 * @example
 * ```tsx
 * <LoadingButton
 *   loading={isSubmitting}
 *   loadingText="Saving..."
 *   onClick={handleSubmit}
 * >
 *   Save Changes
 * </LoadingButton>
 * ```
 */
export function LoadingButton({
  loading = false,
  loadingText,
  children,
  disabled,
  className,
  ...props
}: LoadingButtonProps) {
  return (
    <Button
      disabled={disabled || loading}
      className={cn(className)}
      {...props}
    >
      {loading && (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      )}
      {loading ? loadingText || children : children}
    </Button>
  )
}
