export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

import { releaseStaleStripeWebhookReservations } from '@/lib/stripe/webhookLedger'
import { createServiceRoleClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
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
    console.error('[stripe.webhook.release-stale] Cron failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Stripe webhook reservation release failed' },
      { status: 500 },
    )
  }
}
