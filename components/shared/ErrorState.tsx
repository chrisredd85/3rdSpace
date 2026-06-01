'use client'

import { AlertCircle, RefreshCw, Mail, WifiOff, Lock, FileX, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { isNetworkError } from '@/lib/utils/errorHandling'

export interface ErrorStateProps {
  /**
   * Error object or error message
   */
  error: unknown
  /**
   * Title to display
   */
  title?: string
  /**
   * Custom message to display
   */
  message?: string
  /**
   * Retry handler
   */
  onRetry?: () => void
  /**
   * Show contact support link
   */
  showSupport?: boolean
  /**
   * Optional support URL. Uses a support email link when omitted.
   */
  supportLink?: string
  /**
   * Additional CSS classes
   */
  className?: string
  /**
   * Size variant
   */
  size?: 'sm' | 'md' | 'lg'
}

/**
 * ErrorState component for displaying data fetch errors
 * 
 * Shows a friendly error UI with icon, title, message, and retry button.
 * Automatically detects error type and shows appropriate messaging.
 * 
 * @example
 * ```tsx
 * <ErrorState
 *   error={error}
 *   onRetry={() => refetch()}
 *   showSupport
 * />
 * ```
 */
export function ErrorState({
  error,
  title,
  message,
  onRetry,
  showSupport = false,
  supportLink,
  className,
  size = 'md',
}: ErrorStateProps) {
  const errorMessage = getErrorMessage(error)
  const statusCode = getErrorStatus(error)
  const isNetwork = error instanceof Error && isNetworkError(error)

  // Determine error type and default messages
  const getErrorDetails = () => {
    if (title && message) {
      return { title, message, icon: AlertCircle }
    }

    if (isNetwork) {
      return {
        title: 'Connection Error',
        message: 'Connection lost. Please check your internet connection and try again.',
        icon: WifiOff,
      }
    }

    if (statusCode === 404 || errorMessage.includes('404') || errorMessage.toLowerCase().includes('not found')) {
      return {
        title: 'Not Found',
        message: 'The requested item could not be found. It may have been deleted or moved.',
        icon: FileX,
      }
    }

    if (statusCode === 403 || errorMessage.includes('403') || errorMessage.toLowerCase().includes('forbidden')) {
      return {
        title: 'Access Denied',
        message: "You don't have permission to access this resource.",
        icon: Lock,
      }
    }

    if (statusCode === 500 || errorMessage.includes('500') || errorMessage.toLowerCase().includes('server error')) {
      return {
        title: 'Server Error',
        message: 'Something went wrong on our end. Please try again in a moment.',
        icon: Server,
      }
    }

    return {
      title: title || 'Something went wrong',
      message: message || errorMessage || 'An unexpected error occurred. Please try again.',
      icon: AlertCircle,
    }
  }

  const { title: errorTitle, message: errorMessageText, icon: Icon } = getErrorDetails()

  const sizeClasses = {
    sm: {
      container: 'p-4',
      icon: 'h-8 w-8',
      title: 'text-base',
      message: 'text-sm',
    },
    md: {
      container: 'p-6',
      icon: 'h-12 w-12',
      title: 'text-lg',
      message: 'text-base',
    },
    lg: {
      container: 'p-8',
      icon: 'h-16 w-16',
      title: 'text-xl',
      message: 'text-lg',
    },
  }

  const sizeClass = sizeClasses[size]

  return (
    <Card className={cn('border-brick/30 bg-brick/10', className)}>
      <CardContent className={cn('flex flex-col items-center justify-center text-center', sizeClass.container)}>
        <div className={cn('mb-4 flex items-center justify-center rounded-full bg-brick/15 p-3', sizeClass.icon)}>
          <Icon className={cn('text-brick', sizeClass.icon)} />
        </div>

        <CardTitle className={cn('mb-2 text-ink', sizeClass.title)}>
          {errorTitle}
        </CardTitle>

        <CardDescription className={cn('mb-6 max-w-md text-ink-soft', sizeClass.message)}>
          {errorMessageText}
        </CardDescription>

        <div className="flex flex-col sm:flex-row gap-2">
          {onRetry && (
            <Button
              onClick={onRetry}
              variant="default"
              className="min-h-[44px]"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          )}

          {(showSupport || supportLink) && (
            <a
              href={supportLink || 'mailto:support@3rdspace.com?subject=Error Report'}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-tan bg-cream/40 px-6 py-3 text-base font-semibold text-ink transition-all duration-200 hover:border-tan hover:bg-cream"
            >
              <Mail className="mr-2 h-4 w-4" />
              Contact Support
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Extracts a displayable message from unknown error shapes.
 */
function getErrorMessage(error: unknown) {
  if (!error) return ''
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    const record = error as Record<string, any>
    return String(record.message || record.error || record.statusText || '')
  }
  return String(error)
}

/**
 * Extracts an HTTP status code from common API error shapes.
 */
function getErrorStatus(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const record = error as Record<string, any>
  const status = record.status || record.response?.status
  return typeof status === 'number' ? status : null
}
