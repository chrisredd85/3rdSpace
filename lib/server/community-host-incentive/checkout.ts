import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * DISABLED - legacy CHI checkout flow.
 *
 * This venue-pull payment flow was superseded by the new epsilon.3
 * platform-push settlement flow: scheduled run creation, dual approval,
 * venue acknowledgment, and a dispute window before Stripe settlement.
 *
 * Returning 410 Gone tells clients the endpoint is permanently unavailable.
 * Sentry alerts on any hit so we can find stale clients before the final
 * delta.5 cleanup removes this route entirely.
 */
export async function POST(_request: Request) {
  Sentry.captureMessage('legacy_chi_checkout_called', {
    level: 'warning',
    tags: { action: 'legacy_chi_checkout_called' },
  })

  return NextResponse.json(
    {
      error:
        'This payment flow has been replaced. CHI settlements now run automatically on a schedule. Check Settings -> Settlements for your active settlement records.',
      code: 'legacy_chi_checkout_disabled',
    },
    { status: 410 }
  )
}
