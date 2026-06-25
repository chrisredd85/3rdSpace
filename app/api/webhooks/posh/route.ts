export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  getConfiguredTicketWebhookSecret,
  parseWebhookJson,
  processPoshWebhook,
  recordPoshWebhookHeartbeat,
  recordWebhookDelivery,
  resolveIntegrationContext,
  isStaleWebhookSecretContext,
  staleWebhookSecretResponse,
  verifyConfiguredTicketWebhook,
} from '@/lib/server/ticket-webhooks'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'

export const runtime = 'nodejs'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

  let payload: Record<string, any>

  try {
    payload = parseWebhookJson(rawBody)
  } catch (error) {
    console.error('[Posh Webhook] Invalid payload', error)
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const integrationId = request.nextUrl.searchParams.get('integration')
  if (integrationId && !UUID_PATTERN.test(integrationId)) {
    return NextResponse.json({ error: 'Invalid Posh integration id' }, { status: 400 })
  }

  const context = await resolveIntegrationContext(admin, 'posh', payload, request.nextUrl.searchParams)
  if (isStaleWebhookSecretContext(context)) {
    return NextResponse.json(staleWebhookSecretResponse(), { status: 200 })
  }

  const configuredSecret = getConfiguredTicketWebhookSecret(context, process.env.POSH_WEBHOOK_SECRET)
  if (!verifyConfiguredTicketWebhook('posh', configuredSecret, request.headers, rawBody)) {
    return NextResponse.json({ error: 'Invalid Posh webhook secret' }, { status: 401 })
  }

  if (!(await allowWebhookRequest(admin, getWebhookRateLimitKey('posh', request.headers)))) {
    console.warn('[Posh Webhook] Rate limit exceeded')
    return NextResponse.json({ received: true, ignored: true, reason: 'rate_limited' }, { status: 200 })
  }

  try {
    await recordPoshWebhookHeartbeat(admin, context, payload)
    const result = await processPoshWebhook(admin, payload, context)
    await recordWebhookDelivery(
      admin,
      'posh',
      payload,
      request.headers,
      context,
      result.processed ? null : result.skippedReason
    )

    return NextResponse.json({ received: true, queued: false, ...result }, { status: 200 })
  } catch (error) {
    console.error('[Posh Webhook] Processing failed', error)
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
