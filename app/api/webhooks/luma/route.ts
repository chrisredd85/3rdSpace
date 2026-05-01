export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { parseWebhookJson } from '@/lib/server/ticket-webhooks'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'
import { enqueueJob } from '@/lib/server/job-queue'

export const runtime = 'nodejs'

/**
 * Receives Luma ticket/guest webhooks.
 *
 * The endpoint is public because Luma posts directly to it. If a Luma webhook
 * secret is configured in integration config or `LUMA_WEBHOOK_SECRET`, the
 * HMAC `Webhook-Signature` header must validate against the raw request body.
 * Processing errors return HTTP 200 to prevent retry storms on unlinked tests.
 *
 * @param request - Incoming Luma webhook request.
 * @returns JSON receipt and processing summary.
 */
export async function POST(request: NextRequest) {
  const admin = createServiceRoleClient()
  const rawBody = await request.text()

  if (!(await allowWebhookRequest(admin, getWebhookRateLimitKey('luma', request.headers)))) {
    console.warn('[Luma Webhook] Rate limit exceeded')
    return NextResponse.json({ received: true, ignored: true, reason: 'rate_limited' }, { status: 200 })
  }

  let payload: Record<string, any>

  try {
    payload = parseWebhookJson(rawBody)
  } catch (error) {
    console.error('[Luma Webhook] Invalid payload', error)
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  try {
    const headers = Object.fromEntries(request.headers.entries())
    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries())
    const eventKey =
      request.headers.get('webhook-id') ||
      payload.webhook_id ||
      payload.id ||
      randomUUID()

    const job = await enqueueJob(admin, {
      jobType: 'webhook.luma',
      payload: {
        rawBody,
        payload,
        headers,
        searchParams,
      },
      uniqueKey: `webhook:luma:${eventKey}`,
      maxAttempts: 5,
    })

    return NextResponse.json({ received: true, queued: true, jobId: job.id }, { status: 202 })
  } catch (error) {
    console.error('[Luma Webhook] Queueing failed', error)
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
