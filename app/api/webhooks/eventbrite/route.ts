export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { verifyEventbriteWebhookSignature } from '@/lib/integrations/eventbrite/client'
import {
  getEventbriteWebhookDeliveryId,
  getEventbriteWebhookSecret,
  recordEventbriteWebhookReceipt,
  resolveEventbriteWebhookConnection,
} from '@/lib/integrations/eventbrite/sync'
import { enqueueJob } from '@/lib/server/job-queue'
import { parseWebhookJson } from '@/lib/server/ticket-webhooks'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'
import { createServiceRoleClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const admin = createServiceRoleClient()
  const rawBody = await request.text()
  let payload: Record<string, unknown>

  try {
    payload = parseWebhookJson(rawBody)
  } catch (error) {
    console.error('[Eventbrite Webhook] Invalid payload', error)
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const connection = await resolveEventbriteWebhookConnection(admin, request.nextUrl.searchParams)
  if (!connection) {
    return NextResponse.json({ error: 'Eventbrite connection not found' }, { status: 400 })
  }

  const secret = getEventbriteWebhookSecret(connection)
  const signature =
    request.headers.get('x-eventbrite-signature') ??
    request.headers.get('eventbrite-signature') ??
    request.headers.get('x-eventbrite-signature-sha256')

  if (!secret || !verifyEventbriteWebhookSignature(secret, rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid Eventbrite webhook signature' }, { status: 401 })
  }

  if (!(await allowWebhookRequest(admin, getWebhookRateLimitKey('eventbrite', request.headers)))) {
    console.warn('[Eventbrite Webhook] Rate limit exceeded')
    return NextResponse.json({ received: true, ignored: true, reason: 'rate_limited' }, { status: 200 })
  }

  const deliveryId = getEventbriteWebhookDeliveryId(payload, request.headers)
  if (!deliveryId) {
    return NextResponse.json({ error: 'Missing Eventbrite webhook id' }, { status: 400 })
  }

  try {
    const receipt = await recordEventbriteWebhookReceipt({
      db: admin,
      connection,
      payload,
      headers: request.headers,
      deliveryId,
    })

    if (receipt.duplicate) {
      return NextResponse.json({ received: true, queued: false, duplicate: true }, { status: 200 })
    }

    const headers = normalizeHeaders(request.headers)
    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries())
    const job = await enqueueJob(admin, {
      jobType: 'webhook.eventbrite',
      payload: {
        connectionId: connection.id,
        deliveryId,
        payload,
        rawBody,
        headers,
        searchParams,
      },
      uniqueKey: `webhook:eventbrite:${deliveryId}`,
      maxAttempts: 3,
    })

    return NextResponse.json({ received: true, queued: true, jobId: job.id }, { status: 202 })
  } catch (error) {
    console.error('[Eventbrite Webhook] Failed to enqueue webhook', error)
    return NextResponse.json(
      {
        received: true,
        queued: false,
        error: error instanceof Error ? error.message : 'Eventbrite webhook processing failed',
      },
      { status: 200 }
    )
  }
}

function normalizeHeaders(headers: Headers) {
  const normalized: Record<string, string> = {}
  headers.forEach((value, key) => {
    normalized[key] = value
  })
  return normalized
}
