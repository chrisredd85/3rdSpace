export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

import { getRequestLogger } from '@/lib/server/logger'
import { releaseStaleStripeWebhookReservations } from '@/lib/stripe/webhookLedger'
import { createServiceRoleClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const logger = getRequestLogger(request).child({
    cron_job: 'stripe_webhooks_release_stale',
  })
  const expectedSecret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')

  if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createServiceRoleClient()
    const result = await releaseStaleStripeWebhookReservations(admin as any)

    return NextResponse.json({
      ok: true,
      released_count: result.releasedCount,
    })
  } catch (error) {
    logger.error('Stripe webhook reservation release cron failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Stripe webhook reservation release failed' },
      { status: 500 },
    )
  }
}
