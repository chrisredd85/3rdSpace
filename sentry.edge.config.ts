/**
 * Sentry initialization for the Edge runtime. It is a no-op until SENTRY_DSN
 * or NEXT_PUBLIC_SENTRY_DSN is configured.
 */
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    sampleRate: 1.0, // Launch burn-in: capture 100% of errors for the first two production weeks.
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    sendDefaultPii: false,
  })
}
