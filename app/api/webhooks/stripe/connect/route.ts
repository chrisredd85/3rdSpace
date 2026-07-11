export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'
import { getRequestLogger } from '@/lib/server/logger'
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
  const logger = getRequestLogger(request).child({ stripe_source: 'connect' })
  const admin = createServiceRoleClient()
  const rawBody = await request.text()
  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET

  if (!webhookSecret) {
    logger.error('Stripe Connect webhook missing secret')
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
    logger.error('Stripe Connect webhook invalid signature', error)
    return NextResponse.json({ error: 'Invalid Stripe signature' }, { status: 400 })
  }

  const eventLogger = logger.child({ stripe_event_id: event.id, stripe_event_type: event.type })

  const reservation = await reserveStripeWebhookEvent(admin as any, {
    event,
    source: 'connect',
    endpointPath: '/api/webhooks/stripe/connect',
  })
  if ('completed' in reservation && reservation.completed) {
    eventLogger.info('Stripe Connect webhook duplicate delivery skipped', {
      processedAt: reservation.processedAt,
    })
    return NextResponse.json({ received: true, duplicate: true })
  }
  if ('inFlight' in reservation && reservation.inFlight) {
    eventLogger.info('Stripe Connect webhook concurrent duplicate delivery skipped')
    return NextResponse.json({ received: true, in_flight: true }, { status: 409 })
  }
  if (!('reservedNow' in reservation) || !reservation.reservedNow) {
    eventLogger.error('Stripe Connect webhook reservation failed', undefined, {
      reservation,
    })
    return NextResponse.json({ error: 'reservation_failed' }, { status: 500 })
  }

  if (!(await allowWebhookRequest(admin, getWebhookRateLimitKey('stripe-connect', request.headers)))) {
    eventLogger.warn('Stripe Connect webhook rate limit exceeded')
    await recordStripeWebhookProcessingResult(admin as any, {
      event,
      source: 'connect',
      endpointPath: '/api/webhooks/stripe/connect',
      outcome: 'rate_limited',
    })
    return NextResponse.json({ received: true, ignored: true, reason: 'rate_limited' }, { status: 200 })
  }

  try {
    const result = await processStripeConnectWebhookEvent(admin as any, event, getStripeClient())
    await recordStripeWebhookProcessingResult(admin as any, {
      event,
      source: 'connect',
      endpointPath: '/api/webhooks/stripe/connect',
      outcome: result.observed ? 'observed' : result.ignored ? 'ignored' : 'processed',
    })
    return NextResponse.json(result)
  } catch (error) {
    eventLogger.error('Stripe Connect webhook processing failed', error)
    await failStripeWebhookProcessing(admin as any, {
      event,
      source: 'connect',
      endpointPath: '/api/webhooks/stripe/connect',
      error,
    }).catch((ledgerError) => {
      eventLogger.error('Stripe Connect webhook failed to save failure state', ledgerError)
    })
    return NextResponse.json({ received: true, processed: false }, { status: 500 })
  }
}
