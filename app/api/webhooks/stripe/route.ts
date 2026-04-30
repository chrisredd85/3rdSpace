import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getStripeClient, saveVendorStripeAccount, saveVenueStripeAccount } from '@/lib/stripe/connect'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'
import {
  applyInvoicePaymentFailed,
  applyCheckoutSessionCompleted,
  applyInvoicePayment,
  syncBuilderSubscription,
} from '@/lib/billing/builder-billing'

export const runtime = 'nodejs'

/**
 * Receives Stripe webhooks for builder billing and connected vendor/venue accounts.
 */
export async function POST(request: NextRequest) {
  const admin = createServiceRoleClient()
  const rawBody = await request.text()

  if (!(await allowWebhookRequest(admin, getWebhookRateLimitKey('stripe', request.headers)))) {
    console.warn('[Stripe Webhook] Rate limit exceeded')
    return NextResponse.json({ received: true, ignored: true, reason: 'rate_limited' }, { status: 200 })
  }

  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('[Stripe Webhook] Missing webhook secret')
    return NextResponse.json({ error: 'Stripe webhook secret is not configured' }, { status: 500 })
  }

  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = getStripeClient().webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (error) {
    console.error('[Stripe Webhook] Invalid signature', error)
    return NextResponse.json({ error: 'Invalid Stripe signature' }, { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await applyCheckoutSessionCompleted(admin as any, event.data.object as Stripe.Checkout.Session)
    }

    if (event.type === 'invoice.payment_succeeded') {
      await applyInvoicePayment(admin as any, event.data.object as Stripe.Invoice)
    }

    if (event.type === 'invoice.payment_failed') {
      await applyInvoicePaymentFailed(admin as any, event.data.object as Stripe.Invoice)
    }

    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      await syncBuilderSubscription(admin as any, event.data.object as Stripe.Subscription)
    }

    if (event.type === 'customer.subscription.deleted') {
      await syncBuilderSubscription(admin as any, event.data.object as Stripe.Subscription)
    }

    if (event.type === 'account.updated') {
      const account = event.data.object as Stripe.Account
      const { data: existingVendor } = await (admin as any)
        .from('vendor_stripe_accounts')
        .select('vendor_id')
        .eq('stripe_account_id', account.id)
        .maybeSingle()

      if (existingVendor?.vendor_id) {
        await saveVendorStripeAccount(admin as any, existingVendor.vendor_id, account)
        return NextResponse.json({ received: true })
      }

      const { data: existingVenue } = await (admin as any)
        .from('venue_stripe_accounts')
        .select('owner_id')
        .eq('stripe_account_id', account.id)
        .maybeSingle()

      if (!existingVenue?.owner_id) {
        return NextResponse.json({ received: true, ignored: true, reason: 'unknown_account' })
      }

      await saveVenueStripeAccount(admin as any, existingVenue.owner_id, account)
    }

    if (event.type === 'account.application.deauthorized') {
      const accountId = event.account || (event.data.object as { id?: string }).id

      if (accountId) {
        await (admin as any)
          .from('vendor_stripe_accounts')
          .update({
            account_status: 'restricted',
            charges_enabled: false,
            payouts_enabled: false,
            requirements_due: { disabled_reason: 'application_deauthorized' },
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_account_id', accountId)

        await (admin as any)
          .from('venue_stripe_accounts')
          .update({
            account_status: 'restricted',
            charges_enabled: false,
            payouts_enabled: false,
            requirements_due: { disabled_reason: 'application_deauthorized' },
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_account_id', accountId)
      }
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[Stripe Webhook] Processing failed', error)
    return NextResponse.json({ received: true, processed: false }, { status: 200 })
  }
}
