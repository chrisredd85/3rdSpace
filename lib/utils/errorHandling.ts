import type { PostgrestError } from '@supabase/supabase-js'

/**
 * Check if error is network-related
 */
export function isNetworkError(error: Error | unknown): boolean {
  if (!(error instanceof Error)) return false

  const message = error.message.toLowerCase()
  const networkKeywords = [
    'network',
    'fetch',
    'connection',
    'timeout',
    'offline',
    'failed to fetch',
    'networkerror',
    'err_network',
  ]

  return networkKeywords.some((keyword) => message.includes(keyword))
}

/**
 * Format Supabase errors to user-friendly messages
 */
export function formatErrorMessage(error: unknown): string {
  if (!error) return 'An unexpected error occurred'

  // Handle Supabase PostgrestError
  if (typeof error === 'object' && 'code' in error) {
    const supabaseError = error as PostgrestError

    switch (supabaseError.code) {
      case 'PGRST116':
        return 'The requested item was not found'
      case '23505':
        return 'This item already exists'
      case '23503':
        return 'Cannot delete this item because it is being used elsewhere'
      case '42501':
        return "You don't have permission to perform this action"
      case '23514':
        return 'Invalid data provided. Please check your input'
      default:
        return supabaseError.message || 'An error occurred with the database'
    }
  }

  // Handle standard Error objects
  if (error instanceof Error) {
    // Network errors
    if (isNetworkError(error)) {
      return 'Unable to connect. Please check your internet connection.'
    }

    // HTTP status codes
    if (error.message.includes('404')) {
      return 'The requested resource was not found'
    }
    if (error.message.includes('403')) {
      return "You don't have permission to access this resource"
    }
    if (error.message.includes('401')) {
      return 'You need to be logged in to perform this action'
    }
    if (error.message.includes('500')) {
      return 'A server error occurred. Please try again later'
    }
    if (error.message.includes('429')) {
      return 'Too many requests. Please wait a moment and try again'
    }

    return error.message
  }

  // Handle string errors
  if (typeof error === 'string') {
    return error
  }

  return 'An unexpected error occurred'
}

/**
 * Get error type for specific handling
 */
export function getErrorType(error: unknown): 'network' | 'not_found' | 'forbidden' | 'validation' | 'server' | 'unknown' {
  if (!error) return 'unknown'

  if (error instanceof Error) {
    if (isNetworkError(error)) return 'network'
    if (error.message.includes('404') || error.message.toLowerCase().includes('not found')) {
      return 'not_found'
    }
    if (error.message.includes('403') || error.message.toLowerCase().includes('forbidden')) {
      return 'forbidden'
    }
    if (error.message.includes('500') || error.message.toLowerCase().includes('server error')) {
      return 'server'
    }
    if (error.message.toLowerCase().includes('validation') || error.message.toLowerCase().includes('invalid')) {
      return 'validation'
    }
  }

  if (typeof error === 'object' && 'code' in error) {
    const supabaseError = error as PostgrestError
    if (supabaseError.code === 'PGRST116') return 'not_found'
    if (supabaseError.code === '42501') return 'forbidden'
    if (supabaseError.code === '23514') return 'validation'
  }

  return 'unknown'
}

/**
 * Log error for debugging and monitoring
 * 
 * In production, this would send to a monitoring service like Sentry, LogRocket, etc.
 */
export function logError(error: Error | unknown, context?: Record<string, unknown>) {
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorStack = error instanceof Error ? error.stack : undefined

  const logData = {
    message: errorMessage,
    stack: errorStack,
    context,
    timestamp: new Date().toISOString(),
    userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : undefined,
    url: typeof window !== 'undefined' ? window.location.href : undefined,
  }

  // Log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.error('Error logged:', logData)
  }

  // In production, send to monitoring service
  // Example: Sentry.captureException(error, { extra: context })
  // Example: LogRocket.captureException(error, { extra: context })
  
  // For now, we'll just log to console
  // You can integrate with your preferred error monitoring service here
}

/**
 * Create a user-friendly error object
 */
export function createError(
  message: string,
  type: 'network' | 'not_found' | 'forbidden' | 'validation' | 'server' | 'unknown' = 'unknown',
  originalError?: unknown
): Error {
  const error = new Error(message)
  ;(error as any).type = type
  ;(error as any).originalError = originalError
  return error
}

/**
 * Handle async errors with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  let lastError: unknown

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // Don't retry on certain errors
      if (error instanceof Error) {
        if (error.message.includes('404')) break // Not found - don't retry
        if (error.message.includes('403')) break // Forbidden - don't retry
        if (error.message.includes('401')) break // Unauthorized - don't retry
      }

      // Wait before retrying
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)))
      }
    }
  }

  throw lastError
}
