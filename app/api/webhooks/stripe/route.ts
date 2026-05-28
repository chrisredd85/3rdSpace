export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { sendBuilderPaidEmail, sendVenuePaymentFailedEmail } from '@/lib/email'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  getStripeClient,
  saveBuilderStripeAccount,
  saveVendorStripeAccount,
  saveVenueStripeAccount,
} from '@/lib/stripe/connect'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'
import {
  applyInvoicePaymentFailed,
  applyCheckoutSessionCompleted,
  applyInvoicePayment,
  syncBuilderSubscription,
} from '@/lib/billing/builder-billing'
import {
  applyPlannerStripePaymentIntentWebhook,
  applyPlannerStripeRefundWebhook,
} from '@/lib/planner/depositPayments'

export const runtime = 'nodejs'

function getPaymentIntentId(value: Stripe.PaymentIntent | string | null) {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

function getChargeFromPaymentIntent(paymentIntent: Stripe.PaymentIntent) {
  const charge = paymentIntent.latest_charge
  if (!charge || typeof charge === 'string') {
    return {
      chargeId: typeof charge === 'string' ? charge : null,
      transferId: null,
      receiptUrl: null,
    }
  }

  return {
    chargeId: charge.id,
    transferId: typeof (charge as any).transfer === 'string' ? (charge as any).transfer : (charge as any).transfer?.id ?? null,
    receiptUrl: charge.receipt_url ?? null,
  }
}

function getPaymentIntentIdFromCharge(charge: Stripe.Charge) {
  const paymentIntent = charge.payment_intent
  if (!paymentIntent) return null
  return typeof paymentIntent === 'string' ? paymentIntent : paymentIntent.id
}

async function applyKickbackCheckoutSessionCompleted(admin: any, session: Stripe.Checkout.Session) {
  if (session.metadata?.payment_kind !== 'venue_builder_kickback') return false

  const paymentId = session.metadata.kickback_payment_id
  if (!paymentId) return true

  const stripe = getStripeClient()
  const paymentIntentId = getPaymentIntentId(session.payment_intent)
  const paymentIntent = paymentIntentId
    ? await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] })
    : null
  const charge = paymentIntent ? getChargeFromPaymentIntent(paymentIntent) : { chargeId: null, transferId: null, receiptUrl: null }
  const now = new Date().toISOString()

  await admin
    .from('kickback_payments')
    .update({
      status: 'completed',
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      stripe_charge_id: charge.chargeId,
      stripe_transfer_id: charge.transferId,
      receipt_url: charge.receiptUrl,
      completed_at: now,
      failed_at: null,
      failure_reason: null,
    })
    .eq('id', paymentId)

  if (session.metadata.agreement_id) {
    await admin
      .from('event_kickback_agreements')
      .update({
        status: 'payment_completed',
        stripe_transfer_id: charge.transferId,
        payment_completed_at: now,
        updated_at: now,
      })
      .eq('id', session.metadata.agreement_id)
  }

  return true
}

async function applyKickbackPaymentIntent(admin: any, paymentIntent: Stripe.PaymentIntent) {
  if (paymentIntent.metadata?.payment_kind !== 'venue_builder_kickback') return false

  const paymentId = paymentIntent.metadata.kickback_payment_id
  if (!paymentId) return true

  if (paymentIntent.status === 'succeeded') {
    const charge = getChargeFromPaymentIntent(paymentIntent)
    const now = new Date().toISOString()

    await admin
      .from('kickback_payments')
      .update({
        status: 'completed',
        stripe_payment_intent_id: paymentIntent.id,
        stripe_charge_id: charge.chargeId,
        stripe_transfer_id: charge.transferId,
        receipt_url: charge.receiptUrl,
        completed_at: now,
        failed_at: null,
        failure_reason: null,
      })
      .eq('id', paymentId)

    if (paymentIntent.metadata.agreement_id) {
      await admin
        .from('event_kickback_agreements')
        .update({
          status: 'payment_completed',
          stripe_transfer_id: charge.transferId,
          payment_completed_at: now,
          updated_at: now,
        })
        .eq('id', paymentIntent.metadata.agreement_id)
    }
  }

  if (paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'canceled') {
    await admin
      .from('kickback_payments')
      .update({
        status: 'failed',
        stripe_payment_intent_id: paymentIntent.id,
        failed_at: new Date().toISOString(),
        failure_reason: paymentIntent.last_payment_error?.message ?? 'Payment failed',
      })
      .eq('id', paymentId)
  }

  return true
}

async function applyKickbackTransferEvent(admin: any, transfer: Stripe.Transfer, status: 'completed' | 'refunded') {
  if (transfer.metadata?.settlement_method === 'invoice') return true

  const paymentId = transfer.metadata?.kickback_payment_id
  const query = admin
    .from('kickback_payments')
    .update({
      status,
      stripe_transfer_id: transfer.id,
      ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {}),
      ...(status === 'refunded' ? { failed_at: null, failure_reason: 'Transfer was reversed in Stripe' } : {}),
    })

  if (paymentId) {
    await query.eq('id', paymentId)
    return true
  }

  await query.eq('stripe_transfer_id', transfer.id)
  return true
}

async function applyKickbackInvoicePaid(admin: any, invoice: Stripe.Invoice) {
  const paymentId = invoice.metadata?.kickback_payment_id
  if (!paymentId) return false
  if (invoice.metadata?.settlement_method !== 'invoice') return true

  const principalCents = Number(invoice.metadata?.principal_cents ?? 0)
  const builderStripeAccountId = invoice.metadata?.builder_stripe_account_id

  if (!builderStripeAccountId || principalCents <= 0) {
    console.error('[stripe.webhook] Missing builder account or principal for kickback invoice', invoice.id)
    return true
  }

  const { data: payment, error: paymentError } = await admin
    .from('kickback_payments')
    .select('id, agreement_id, status, stripe_transfer_id')
    .eq('id', paymentId)
    .maybeSingle()

  if (paymentError) throw new Error(paymentError.message)
  if (!payment?.id) return true
  if (payment.status === 'paid' || payment.stripe_transfer_id) return true

  const stripe = getStripeClient()
  const transfer = await stripe.transfers.create({
    amount: principalCents,
    currency: 'usd',
    destination: builderStripeAccountId,
    transfer_group: `kickback_${paymentId}`,
    metadata: {
      kickback_payment_id: paymentId,
      settlement_method: 'invoice',
    },
  })

  const now = new Date().toISOString()
  await admin
    .from('kickback_payments')
    .update({
      status: 'paid',
      paid_at: now,
      completed_at: now,
      stripe_transfer_id: transfer.id,
      builder_payout_cents: principalCents,
      failed_at: null,
      failure_reason: null,
    })
    .eq('id', paymentId)

  if (payment.agreement_id) {
    await admin
      .from('event_kickback_agreements')
      .update({
        status: 'payment_completed',
        stripe_transfer_id: transfer.id,
        payment_completed_at: now,
        updated_at: now,
      })
      .eq('id', payment.agreement_id)
  }

  await sendBuilderPaidEmail({ paymentId }).catch((error) => {
    console.error('[stripe.webhook] Failed to send builder paid email', error)
  })

  return true
}

async function applyKickbackInvoicePaymentFailed(admin: any, invoice: Stripe.Invoice) {
  const paymentId = invoice.metadata?.kickback_payment_id
  if (!paymentId) return false
  if (invoice.metadata?.settlement_method !== 'invoice') return true

  await admin
    .from('kickback_payments')
    .update({
      status: 'invoice_failed',
      failed_at: new Date().toISOString(),
      failure_reason: 'Stripe invoice payment failed',
    })
    .eq('id', paymentId)

  await sendVenuePaymentFailedEmail({ paymentId }).catch((error) => {
    console.error('[stripe.webhook] Failed to send venue payment failed email', error)
  })

  return true
}

/**
 * Receives Stripe webhooks for builder billing and connected vendor/venue/builder accounts.
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
      const handledKickback = await applyKickbackCheckoutSessionCompleted(admin as any, event.data.object as Stripe.Checkout.Session)
      if (!handledKickback) {
        await applyCheckoutSessionCompleted(admin as any, event.data.object as Stripe.Checkout.Session)
      }
    }

    if (event.type === 'invoice.paid') {
      const handledKickbackInvoice = await applyKickbackInvoicePaid(admin as any, event.data.object as Stripe.Invoice)
      if (!handledKickbackInvoice) {
        await applyInvoicePayment(admin as any, event.data.object as Stripe.Invoice)
      }
    }

    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object as Stripe.Invoice
      if (!invoice.metadata?.kickback_payment_id) {
        await applyInvoicePayment(admin as any, invoice)
      }
    }

    if (event.type === 'invoice.payment_failed') {
      const handledKickbackInvoice = await applyKickbackInvoicePaymentFailed(admin as any, event.data.object as Stripe.Invoice)
      if (!handledKickbackInvoice) {
        await applyInvoicePaymentFailed(admin as any, event.data.object as Stripe.Invoice)
      }
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

      if (existingVenue?.owner_id) {
        await saveVenueStripeAccount(admin as any, existingVenue.owner_id, account)
        return NextResponse.json({ received: true })
      }

      const { data: existingBuilder } = await (admin as any)
        .from('builder_stripe_accounts')
        .select('user_id, builder_id')
        .eq('stripe_account_id', account.id)
        .maybeSingle()

      if (!existingBuilder?.user_id) {
        return NextResponse.json({ received: true, ignored: true, reason: 'unknown_account' })
      }

      await saveBuilderStripeAccount(admin as any, existingBuilder.user_id, existingBuilder.builder_id ?? null, account)
    }

    if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
      const handledPlannerDeposit = await applyPlannerStripePaymentIntentWebhook(
        admin as any,
        event.data.object as Stripe.PaymentIntent
      )
      if (!handledPlannerDeposit) {
        await applyKickbackPaymentIntent(admin as any, event.data.object as Stripe.PaymentIntent)
      }
    }

    if (event.type === 'charge.refunded') {
      await applyPlannerStripeRefundWebhook(
        admin as any,
        getPaymentIntentIdFromCharge(event.data.object as Stripe.Charge)
      )
    }

    if (event.type === 'transfer.created' || event.type === 'transfer.updated') {
      await applyKickbackTransferEvent(admin as any, event.data.object as Stripe.Transfer, 'completed')
    }

    if (event.type === 'transfer.reversed') {
      await applyKickbackTransferEvent(admin as any, event.data.object as Stripe.Transfer, 'refunded')
    }

    if (event.type === 'payout.paid' || event.type === 'payout.failed') {
      return NextResponse.json({ received: true, observed: event.type })
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

        await (admin as any)
          .from('builder_stripe_accounts')
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
