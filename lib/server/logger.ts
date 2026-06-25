import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { NextRequest } from 'next/server'
import { createRequestId, ensureRequestIdHeaders } from '@/lib/server/request-id'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogContext = {
  request_id?: string
  user_id?: string
  plan_id?: string
  entity_type?: string
  entity_id?: string
  route?: string
  [key: string]: unknown
}

type ConsolePayload = LogContext & {
  level: LogLevel
  message: string
  error?: Record<string, unknown> | string
}

const SENSITIVE_KEY_PARTS = ['password', 'token', 'secret', 'api_key', 'apikey', 'auth', 'authorization']

export class Logger {
  constructor(private baseContext: LogContext = {}) {}

  child(additional: LogContext): Logger {
    return new Logger({ ...this.baseContext, ...additional })
  }

  debug(message: string, context?: LogContext) {
    this.write('debug', message, context)
  }

  info(message: string, context?: LogContext) {
    this.write('info', message, context)
  }

  warn(message: string, context?: LogContext) {
    const merged = this.merge(context)
    this.write('warn', message, merged, true)
    Sentry.addBreadcrumb({
      level: 'warning',
      message,
      data: redact(merged),
    })
  }

  error(message: string, error?: unknown, context?: LogContext) {
    const merged = this.merge(context)
    this.write('error', message, merged, true, error)

    const redacted = redact(merged)
    if (error instanceof Error) {
      Sentry.captureException(error, { extra: redacted })
      return
    }

    Sentry.captureMessage(message, {
      level: 'error',
      extra: {
        ...redacted,
        error: serializeError(error),
      },
    })
  }

  private merge(context?: LogContext) {
    return { ...this.baseContext, ...context }
  }

  private write(level: LogLevel, message: string, context?: LogContext, force = false, error?: unknown) {
    if (!force && level === 'debug' && process.env.NODE_ENV === 'production') return

    const merged = this.merge(context)
    const payload: ConsolePayload = {
      level,
      message,
      ...redact(merged),
    }
    const serializedError = serializeError(error)
    if (serializedError) payload.error = serializedError as Record<string, unknown> | string

    const line = JSON.stringify(payload)
    if (level === 'error') {
      console.error(line)
      return
    }
    if (level === 'warn') {
      console.warn(line)
      return
    }
    console.log(line)
  }
}

export function redact<T>(value: T): T {
  return redactValue(value, new WeakSet()) as T
}

export function getRequestLogger(request: NextRequest): Logger {
  const requestId = request.headers.get('x-request-id') ?? createRequestId()
  return rootLogger.child({
    request_id: requestId,
    route: request.nextUrl?.pathname ?? new URL(request.url, 'http://localhost').pathname,
  })
}

export const rootLogger = new Logger()
export { ensureRequestIdHeaders }

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen))
  }

  if (!value || typeof value !== 'object') return value

  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      output[key] = '[REDACTED]'
    } else {
      output[key] = redactValue(child, seen)
    }
  }
  return output
}

function isSensitiveKey(key: string) {
  const lower = key.toLowerCase()
  return SENSITIVE_KEY_PARTS.some((part) => lower.includes(part))
}

function serializeError(error: unknown) {
  if (!error) return undefined
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  if (typeof error === 'string') return error
  return redact(error)
}
