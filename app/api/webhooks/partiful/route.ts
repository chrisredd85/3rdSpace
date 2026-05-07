export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { parseWebhookJson } from '@/lib/server/ticket-webhooks'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'
import { enqueueJob } from '@/lib/server/job-queue'

export const runtime = 'nodejs'

/**
 * Receives Partiful RSVP/ticket webhook payloads.
 *
 * Partiful support starts with normalized webhook/import intake. When a
 * `PARTIFUL_WEBHOOK_SECRET` or per-connection secret is configured, the worker
 * validates the `Partiful-Secret` or `X-Partiful-Secret` header before import.
 *
 * @param request - Incoming Partiful webhook request.
 * @returns JSON receipt and queued job id.
 */
export async function POST(request: NextRequest) {
  const admin = createServiceRoleClient()
  const rawBody = await request.text()

  if (!(await allowWebhookRequest(admin, getWebhookRateLimitKey('partiful', request.headers)))) {
    console.warn('[Partiful Webhook] Rate limit exceeded')
    return NextResponse.json({ received: true, ignored: true, reason: 'rate_limited' }, { status: 200 })
  }

  let payload: Record<string, any>

  try {
    payload = parseWebhookJson(rawBody)
  } catch (error) {
    console.error('[Partiful Webhook] Invalid payload', error)
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  try {
    const headers = Object.fromEntries(request.headers.entries())
    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries())
    const eventKey =
      request.headers.get('webhook-id') ||
      payload.webhook_id ||
      payload.id ||
      payload.order_id ||
      payload.rsvp_id ||
      payload.guest_id ||
      randomUUID()

    const job = await enqueueJob(admin, {
      jobType: 'webhook.partiful',
      payload: {
        rawBody,
        payload,
        headers,
        searchParams,
      },
      uniqueKey: `webhook:partiful:${eventKey}`,
      maxAttempts: 5,
    })

    return NextResponse.json({ received: true, queued: true, jobId: job.id }, { status: 202 })
  } catch (error) {
    console.error('[Partiful Webhook] Queueing failed', error)
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
