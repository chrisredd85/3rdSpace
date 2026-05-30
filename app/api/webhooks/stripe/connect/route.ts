export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe/connect'
import {
  CONNECT_WEBHOOK_EVENT_TYPES,
  getConnectAccountId,
  handleConnectAccountUpdated,
  handleConnectCapabilityUpdated,
  handleConnectPayoutEvent,
} from '@/lib/stripe/connect-webhook'

/**
 * Receives Stripe Connect webhooks for connected venue, vendor, and builder
 * accounts. This endpoint is intentionally separate from the platform webhook:
 * Connect events must verify with STRIPE_CONNECT_WEBHOOK_SECRET, while platform
 * billing/rental/kickback events verify with STRIPE_WEBHOOK_SECRET.
 */
export async function POST(request: NextRequest) {
  const admin = createServiceRoleClient()
  const rawBody = await request.text()

  if (!(await allowWebhookRequest(admin, getWebhookRateLimitKey('stripe-connect', request.headers)))) {
    console.warn('[Stripe Connect Webhook] Rate limit exceeded')
    return NextResponse.json({ received: true, ignored: true, reason: 'rate_limited' }, { status: 200 })
  }

  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('[Stripe Connect Webhook] Missing webhook secret')
    return NextResponse.json({ error: 'Stripe Connect webhook secret is not configured' }, { status: 500 })
  }

  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = getStripeClient().webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (error) {
    console.error('[Stripe Connect Webhook] Invalid signature', error)
    return NextResponse.json({ error: 'Invalid Stripe signature' }, { status: 400 })
  }

  if (!CONNECT_WEBHOOK_EVENT_TYPES.has(event.type)) {
    return NextResponse.json({
      received: true,
      ignored: true,
      reason: 'unsupported_connect_event',
      event_type: event.type,
    })
  }

  const accountId = getConnectAccountId(event)
  if (!accountId) {
    console.warn('[Stripe Connect Webhook] Missing connected account id', {
      eventId: event.id,
      eventType: event.type,
    })
    return NextResponse.json({ received: true, ignored: true, reason: 'missing_connected_account' })
  }

  try {
    if (event.type === 'account.updated') {
      const result = await handleConnectAccountUpdated(
        admin as any,
        event.data.object as Stripe.Account,
        accountId
      )
      return NextResponse.json({ received: true, ...result })
    }

    if (event.type === 'capability.updated') {
      const result = await handleConnectCapabilityUpdated(
        admin as any,
        event.data.object as Stripe.Capability,
        accountId
      )
      return NextResponse.json({ received: true, ...result })
    }

    if (event.type === 'payout.created' || event.type === 'payout.paid' || event.type === 'payout.failed') {
      const result = await handleConnectPayoutEvent(
        admin as any,
        event.data.object as Stripe.Payout,
        event.type,
        accountId
      )
      return NextResponse.json({ received: true, ...result })
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[Stripe Connect Webhook] Processing failed', error)
    return NextResponse.json({ received: true, processed: false }, { status: 500 })
  }
}
