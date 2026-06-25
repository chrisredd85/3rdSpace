export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe/connect'
import { processStripeConnectWebhookEvent } from '@/lib/stripe/connect-webhook'
import {
  failStripeWebhookProcessing,
  recordStripeWebhookProcessingResult,
  reserveStripeWebhookEvent,
} from '@/lib/stripe/webhookLedger'

export const runtime = 'nodejs'

/**
 * Receives Stripe Connect account events. This route intentionally uses the
 * Connect endpoint signing secret so platform and Connect secrets cannot shadow
 * each other.
 */
export async function POST(request: NextRequest) {
  const admin = createServiceRoleClient()
  const rawBody = await request.text()
  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('[Stripe Connect Webhook] Missing Connect webhook secret')
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

  const reservation = await reserveStripeWebhookEvent(admin as any, {
    event,
    source: 'connect',
    endpointPath: '/api/webhooks/stripe/connect',
  })
  if ('completed' in reservation && reservation.completed) {
    console.info('[stripe.connect.webhook] Duplicate delivery skipped', {
      eventId: event.id,
      eventType: event.type,
      processedAt: reservation.processedAt,
    })
    return NextResponse.json({ received: true, duplicate: true })
  }
  if ('inFlight' in reservation && reservation.inFlight) {
    console.info('[stripe.connect.webhook] Concurrent duplicate delivery skipped', {
      eventId: event.id,
      eventType: event.type,
    })
    return NextResponse.json({ received: true, in_flight: true }, { status: 409 })
  }
  if (!('reservedNow' in reservation) || !reservation.reservedNow) {
    console.error('[stripe.connect.webhook] Failed to reserve event', {
      eventId: event.id,
      eventType: event.type,
      reservation,
    })
    return NextResponse.json({ error: 'reservation_failed' }, { status: 500 })
  }

  if (!(await allowWebhookRequest(admin, getWebhookRateLimitKey('stripe-connect', request.headers)))) {
    console.warn('[Stripe Connect Webhook] Rate limit exceeded', { eventId: event.id, eventType: event.type })
    await recordStripeWebhookProcessingResult(admin as any, {
      event,
      source: 'connect',
      endpointPath: '/api/webhooks/stripe/connect',
      outcome: 'rate_limited',
    })
    return NextResponse.json({ received: true, ignored: true, reason: 'rate_limited' }, { status: 200 })
  }

  try {
    const result = await processStripeConnectWebhookEvent(admin as any, event)
    await recordStripeWebhookProcessingResult(admin as any, {
      event,
      source: 'connect',
      endpointPath: '/api/webhooks/stripe/connect',
      outcome: result.observed ? 'observed' : result.ignored ? 'ignored' : 'processed',
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[Stripe Connect Webhook] Processing failed', error)
    await failStripeWebhookProcessing(admin as any, {
      event,
      source: 'connect',
      endpointPath: '/api/webhooks/stripe/connect',
      error,
    }).catch((ledgerError) => {
      console.error('[Stripe Connect Webhook] Failed to save webhook failure state', ledgerError)
    })
    return NextResponse.json({ received: true, processed: false }, { status: 500 })
  }
}
