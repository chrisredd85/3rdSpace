export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe/connect'
import { processStripeConnectWebhookEvent } from '@/lib/stripe/connect-webhook'

export const runtime = 'nodejs'

/**
 * Receives Stripe Connect account events. This route intentionally uses the
 * Connect endpoint signing secret so platform and Connect secrets cannot shadow
 * each other.
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

  try {
    const result = await processStripeConnectWebhookEvent(admin, event)
    return NextResponse.json(result)
  } catch (error) {
    console.error('[Stripe Connect Webhook] Processing failed', error)
    return NextResponse.json({ received: true, processed: false }, { status: 500 })
  }
}
