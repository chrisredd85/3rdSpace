import { useCallback } from 'react'
import { useToast } from '@/components/ui/toast'
import { formatErrorMessage, logError, getErrorType } from '@/lib/utils/errorHandling'

/**
 * Hook for handling errors with toast notifications
 * 
 * Provides a consistent way to handle errors across the application
 * with automatic toast notifications and error logging.
 * 
 * @example
 * ```tsx
 * const { handleError } = useErrorHandler()
 * 
 * try {
 *   await someOperation()
 * } catch (error) {
 *   handleError(error, 'Failed to save changes')
 * }
 * ```
 */
export function useErrorHandler() {
  const { addToast } = useToast()

  const handleError = useCallback(
    (
      error: unknown,
      customMessage?: string,
      options?: {
        showToast?: boolean
        logError?: boolean
        onError?: (error: Error) => void
      }
    ) => {
      const errorMessage = formatErrorMessage(error)
      const errorType = getErrorType(error)
      const finalMessage = customMessage || errorMessage

      // Log error if enabled (default: true)
      if (options?.logError !== false) {
        logError(error instanceof Error ? error : new Error(finalMessage), {
          errorType,
          customMessage,
        })
      }

      // Show toast if enabled (default: true)
      if (options?.showToast !== false) {
        addToast({
          title: 'Error',
          description: finalMessage,
          variant: 'destructive',
        })
      }

      // Call custom error handler if provided
      if (options?.onError && error instanceof Error) {
        options.onError(error)
      }
    },
    [addToast]
  )

  const handleSuccess = useCallback(
    (message: string, title = 'Success') => {
      addToast({
        title,
        description: message,
        variant: 'success',
      })
    },
    [addToast]
  )

  const handleWarning = useCallback(
    (message: string, title = 'Warning') => {
      addToast({
        title,
        description: message,
        variant: 'warning',
      })
    },
    [addToast]
  )

  const handleInfo = useCallback(
    (message: string, title = 'Info') => {
      addToast({
        title,
        description: message,
        variant: 'info',
      })
    },
    [addToast]
  )

  return {
    handleError,
    handleSuccess,
    handleWarning,
    handleInfo,
  }
}
