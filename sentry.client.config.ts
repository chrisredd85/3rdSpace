/**
 * Browser-side Sentry initialization. It is a no-op until
 * NEXT_PUBLIC_SENTRY_DSN is configured in the hosting environment.
 */
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    sampleRate: 1.0, // Launch burn-in: capture 100% of errors for the first two production weeks.
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0,
    sendDefaultPii: false,
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
    ],
    beforeSend(event) {
      if (event.request?.url) {
        try {
          const url = new URL(event.request.url)
          event.request.url = `${url.origin}${url.pathname}`
        } catch {
          // Leave non-URL values untouched.
        }
      }
      return event
    },
  })
}
