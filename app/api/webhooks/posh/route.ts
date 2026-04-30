import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { parseWebhookJson } from '@/lib/server/ticket-webhooks'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'
import { enqueueJob } from '@/lib/server/job-queue'

export const runtime = 'nodejs'

/**
 * Receives Posh ticket sale/refund webhooks.
 *
 * The endpoint is public because Posh posts directly to it. When a Posh secret
 * is configured in integration config or `POSH_WEBHOOK_SECRET`, the
 * `Posh-Secret` header must match. Processing errors return HTTP 200 so Posh
 * does not retry malformed or unlinked test deliveries forever.
 *
 * @param request - Incoming Posh webhook request.
 * @returns JSON receipt and processing summary.
 */
export async function POST(request: NextRequest) {
  const admin = createServiceRoleClient()
  const rawBody = await request.text()

  if (!(await allowWebhookRequest(admin, getWebhookRateLimitKey('posh', request.headers)))) {
    console.warn('[Posh Webhook] Rate limit exceeded')
    return NextResponse.json({ received: true, ignored: true, reason: 'rate_limited' }, { status: 200 })
  }

  let payload: Record<string, any>

  try {
    payload = parseWebhookJson(rawBody)
  } catch (error) {
    console.error('[Posh Webhook] Invalid payload', error)
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  try {
    const headers = Object.fromEntries(request.headers.entries())
    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries())
    const eventKey =
      request.headers.get('webhook-id') ||
      payload.order_id ||
      payload.order_number ||
      payload.tracking_link ||
      randomUUID()

    const job = await enqueueJob(admin, {
      jobType: 'webhook.posh',
      payload: {
        payload,
        headers,
        searchParams,
      },
      uniqueKey: `webhook:posh:${eventKey}`,
      maxAttempts: 5,
    })

    return NextResponse.json({ received: true, queued: true, jobId: job.id }, { status: 202 })
  } catch (error) {
    console.error('[Posh Webhook] Queueing failed', error)
    return NextResponse.json(
      {
        received: true,
        processed: false,
        error: error instanceof Error ? error.message : 'Internal processing error',
      },
      { status: 200 }
    )
  }
}
