export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { sendBuilderPaidEmail, sendRefundCompletedEmail, sendVenuePaymentFailedEmail } from '@/lib/email'
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
import {
  getVenueRentalTransactionId,
  isVenueRentalEvent,
  loadVenueRentalTransaction,
  markVenueRentalFailed,
  markVenueRentalPaid,
  markVenueRentalRefunded,
  markVenueRentalTransferComplete,
  markVenueRentalTransferReversed,
  VENUE_RENTAL_PAYMENT_NAMESPACE,
} from '@/lib/payments/venue-rental'

export const runtime = 'nodejs'

const KICKBACK_TRANSFER_NAMESPACE = 'venue_builder_kickback'

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

function isKickbackTransferEvent(transfer: Stripe.Transfer) {
  return (
    transfer.metadata?.payment_kind_namespace === KICKBACK_TRANSFER_NAMESPACE ||
    Boolean(transfer.metadata?.kickback_payment_id)
  )
}

function logUnrecognizedTransferEvent(transfer: Stripe.Transfer) {
  console.log('[stripe.webhook] transfer event with no recognized namespace', {
    transferId: transfer.id,
    metadata: transfer.metadata,
  })
}

function logMissingVenueRentalTransaction(source: string, metadata: Stripe.Metadata | null | undefined, stripeObjectId: string) {
  console.error('[stripe.webhook] venue rental event could not load transaction', {
    source,
    stripeObjectId,
    metadata,
  })
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
      payment_kind_namespace: KICKBACK_TRANSFER_NAMESPACE,
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

async function applyKickbackRefundCompleted(admin: any, paymentId: string | null) {
  if (!paymentId) return false

  const { data: payment, error } = await admin
    .from('kickback_payments')
    .select('id, status, refund_amount_cents, builder_payout_cents, amount_cents')
    .eq('id', paymentId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!payment?.id) return true
  if (payment.status === 'refunded_full' || payment.status === 'refunded_partial') return true

  const refundAmountCents = Number(payment.refund_amount_cents ?? 0)
  const payoutCents = Number(payment.builder_payout_cents ?? payment.amount_cents ?? 0)
  const isFullRefund = refundAmountCents > 0 && refundAmountCents >= payoutCents
  const nextStatus = isFullRefund ? 'refunded_full' : 'refunded_partial'

  await admin
    .from('kickback_payments')
    .update({
      status: nextStatus,
      completed_at: new Date().toISOString(),
    })
    .eq('id', paymentId)

  await sendRefundCompletedEmail({ paymentId, isFullRefund }).catch((emailError) => {
    console.error('[stripe.webhook] Failed to send refund completed email', emailError)
  })

  return true
}

function getKickbackPaymentIdFromRefundedCharge(charge: Stripe.Charge) {
  const directPaymentId = charge.metadata?.kickback_payment_id
  if (directPaymentId) return directPaymentId

  const refunds = (charge.refunds?.data ?? []) as Array<Stripe.Refund>
  const metadataRefund = refunds.find((refund) => refund.metadata?.kickback_payment_id)
  return metadataRefund?.metadata?.kickback_payment_id ?? null
}

async function applyVenueRentalCheckoutSessionCompleted(admin: any, session: Stripe.Checkout.Session) {
  const paymentIntentId = getPaymentIntentId(session.payment_intent)
  const transaction = await loadVenueRentalTransaction(admin, {
    venuePaymentTransactionId: getVenueRentalTransactionId(session.metadata),
    checkoutSessionId: session.id,
    paymentIntentId,
  })

  if (!isVenueRentalEvent(session.metadata) && !transaction) return false
  if (!transaction) {
    logMissingVenueRentalTransaction('checkout.session.completed', session.metadata, session.id)
    return true
  }

  const stripe = getStripeClient()
  const paymentIntent = paymentIntentId
    ? await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] })
    : null
  const charge = paymentIntent ? getChargeFromPaymentIntent(paymentIntent) : { chargeId: null, transferId: null, receiptUrl: null }

  await markVenueRentalPaid(admin, transaction, {
    stripe_payment_intent_id: paymentIntentId,
    stripe_charge_id: charge.chargeId,
    stripe_transfer_id: charge.transferId,
    paid_at: new Date().toISOString(),
  })

  return true
}

async function applyVenueRentalPaymentIntent(
  admin: any,
  paymentIntent: Stripe.PaymentIntent,
  eventType: 'payment_intent.succeeded' | 'payment_intent.payment_failed'
) {
  const charge = getChargeFromPaymentIntent(paymentIntent)
  const transaction = await loadVenueRentalTransaction(admin, {
    venuePaymentTransactionId: getVenueRentalTransactionId(paymentIntent.metadata),
    paymentIntentId: paymentIntent.id,
    chargeId: charge.chargeId,
  })

  if (!isVenueRentalEvent(paymentIntent.metadata) && !transaction) return false
  if (!transaction) {
    logMissingVenueRentalTransaction(eventType, paymentIntent.metadata, paymentIntent.id)
    return true
  }

  if (eventType === 'payment_intent.payment_failed') {
    await markVenueRentalFailed(admin, transaction, {
      failed_at: new Date().toISOString(),
      failure_reason: paymentIntent.last_payment_error?.message ?? 'Payment failed',
    })
    return true
  }

  await markVenueRentalPaid(admin, transaction, {
    stripe_payment_intent_id: paymentIntent.id,
    stripe_charge_id: charge.chargeId,
    stripe_transfer_id: charge.transferId,
    paid_at: new Date().toISOString(),
  })

  return true
}

async function applyVenueRentalRefundedCharge(admin: any, charge: Stripe.Charge) {
  const paymentIntentId = getPaymentIntentIdFromCharge(charge)
  const transaction = await loadVenueRentalTransaction(admin, {
    venuePaymentTransactionId: getVenueRentalTransactionId(charge.metadata),
    paymentIntentId,
    chargeId: charge.id,
  })

  if (!isVenueRentalEvent(charge.metadata) && !transaction) return false
  if (!transaction) {
    logMissingVenueRentalTransaction('charge.refunded', charge.metadata, charge.id)
    return true
  }

  await markVenueRentalRefunded(admin, transaction, {
    refund_amount_cents: Number(charge.amount_refunded ?? 0),
    stripe_refund_id: getLatestRefundId(charge),
  })

  return true
}

async function routeTransferEvent(
  admin: any,
  transfer: Stripe.Transfer,
  eventType: 'transfer.created' | 'transfer.updated' | 'transfer.reversed'
) {
  if (isKickbackTransferEvent(transfer)) {
    if (eventType === 'transfer.reversed') {
      const handledKickbackRefund = await applyKickbackRefundCompleted(
        admin,
        transfer.metadata?.settlement_method === 'invoice'
          ? transfer.metadata?.kickback_payment_id ?? null
          : null
      )
      if (!handledKickbackRefund) {
        await applyKickbackTransferEvent(admin, transfer, 'refunded')
      }
      return
    }

    await applyKickbackTransferEvent(admin, transfer, 'completed')
    return
  }

  const transaction = await loadVenueRentalTransaction(admin, {
    venuePaymentTransactionId: getVenueRentalTransactionId(transfer.metadata),
    transferId: transfer.id,
  })

  if (transfer.metadata?.payment_kind_namespace === VENUE_RENTAL_PAYMENT_NAMESPACE || transaction) {
    if (!transaction) {
      logMissingVenueRentalTransaction(eventType, transfer.metadata, transfer.id)
      return
    }

    if (eventType === 'transfer.reversed') {
      await markVenueRentalTransferReversed(admin, transaction, {
        stripe_transfer_reversal_id: getLatestTransferReversalId(transfer),
      })
      return
    }

    await markVenueRentalTransferComplete(admin, transaction, {
      stripe_transfer_id: transfer.id,
      transfer_completed_at: new Date().toISOString(),
    })
    return
  }

  logUnrecognizedTransferEvent(transfer)
}

function getLatestRefundId(charge: Stripe.Charge) {
  const refunds = (charge.refunds?.data ?? []) as Array<Stripe.Refund>
  return refunds[0]?.id ?? null
}

function getLatestTransferReversalId(transfer: Stripe.Transfer) {
  const reversals = (transfer.reversals?.data ?? []) as Array<{ id?: string }>
  return reversals[0]?.id ?? transfer.id
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
      const session = event.data.object as Stripe.Checkout.Session
      const handledVenueRental = await applyVenueRentalCheckoutSessionCompleted(admin as any, session)
      if (!handledVenueRental) {
        const handledKickback = await applyKickbackCheckoutSessionCompleted(admin as any, session)
        if (!handledKickback) {
          await applyCheckoutSessionCompleted(admin as any, session)
        }
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
      const paymentIntent = event.data.object as Stripe.PaymentIntent
      const handledVenueRental = await applyVenueRentalPaymentIntent(admin as any, paymentIntent, event.type)
      if (!handledVenueRental) {
        const handledPlannerDeposit = await applyPlannerStripePaymentIntentWebhook(
          admin as any,
          paymentIntent
        )
        if (!handledPlannerDeposit) {
          await applyKickbackPaymentIntent(admin as any, paymentIntent)
        }
      }
    }

    if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge
      const handledVenueRental = await applyVenueRentalRefundedCharge(admin as any, charge)
      if (!handledVenueRental) {
        const handledKickbackRefund = await applyKickbackRefundCompleted(
          admin as any,
          getKickbackPaymentIdFromRefundedCharge(charge)
        )
        if (!handledKickbackRefund) {
          await applyPlannerStripeRefundWebhook(
            admin as any,
            getPaymentIntentIdFromCharge(charge)
          )
        }
      }
    }

    if (event.type === 'transfer.created' || event.type === 'transfer.updated') {
      const transfer = event.data.object as Stripe.Transfer
      await routeTransferEvent(admin as any, transfer, event.type)
    }

    if (event.type === 'transfer.reversed') {
      const transfer = event.data.object as Stripe.Transfer
      await routeTransferEvent(admin as any, transfer, event.type)
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
    return NextResponse.json({ received: true, processed: false }, { status: 500 })
  }
}
