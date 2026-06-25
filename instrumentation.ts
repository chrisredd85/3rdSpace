/**
 * Next.js instrumentation hook. This loads the correct Sentry runtime config
 * once per server start so server, edge, and route-handler errors are captured.
 */
import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateRequiredProductionSecrets } = await import('./lib/server/required-secrets')
    validateRequiredProductionSecrets()
    await import('./sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export const onRequestError = Sentry.captureRequestError
