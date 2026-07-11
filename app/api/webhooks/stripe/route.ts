export const dynamic = 'force-dynamic'
import * as Sentry from '@sentry/nextjs'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { sendBuilderPaidEmail, sendRefundCompletedEmail, sendVenuePaymentFailedEmail } from '@/lib/email'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  getStripeClient,
} from '@/lib/stripe/connect'
import { processStripeConnectWebhookEvent } from '@/lib/stripe/connect-webhook'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'
import { getRequestLogger } from '@/lib/server/logger'
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
  handleVenueRentalCheckoutCompleted,
  isVenueRentalEvent,
  loadVenueRentalTransaction,
  markVenueRentalFailed,
  markVenueRentalPaid,
  markVenueRentalRefunded,
  markVenueRentalTransferComplete,
  markVenueRentalTransferReversed,
  VENUE_RENTAL_PAYMENT_NAMESPACE,
} from '@/lib/payments/venue-rental'
import {
  deferStripeWebhookForMaintenance,
  failStripeWebhookProcessing,
  recordStripeWebhookProcessingResult,
  reserveStripeWebhookEvent,
  type StripeWebhookProcessingOutcome,
} from '@/lib/stripe/webhookLedger'
import {
  isAuthorizedStripeWebhookReplay,
  loadQueuedStripeWebhookReplay,
  parsePersistedStripeEvent,
} from '@/lib/stripe/webhookReplayAuth'
import {
  CHI_SETTLEMENT_METADATA_KIND,
  handleSettlementCheckoutCompleted,
  handleSettlementPaymentIntentFailed,
} from '@/lib/finance/settlement-checkout'
import { readWritePauseStatus } from '@/lib/write-pause'

export const runtime = 'nodejs'

const KICKBACK_TRANSFER_NAMESPACE = 'venue_builder_kickback'
const CHI_PAYMENT_TYPE = 'community_host_incentive'

type CHIInvoicePaidResult = {
  handled: boolean
  ignored?: boolean
  reason?: string
}

function captureLegacyCHIWebhook(stripeEventId: string, eventType: string, stripeObjectId: string) {
  Sentry.captureMessage('legacy_chi_webhook_received', {
    level: 'warning',
    tags: {
      action: 'legacy_chi_webhook_received',
      stripe_event_id: stripeEventId,
      stripe_event_type: eventType,
    },
    extra: { stripeObjectId },
  })
}

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

function isCommunityHostIncentiveInvoice(invoice: Stripe.Invoice) {
  return invoice.metadata?.payment_type === CHI_PAYMENT_TYPE
}

function assertUsdInvoice(invoice: Stripe.Invoice) {
  return !invoice.currency || invoice.currency.toLowerCase() === 'usd'
}

function isCommunityHostIncentiveTransferEvent(transfer: Stripe.Transfer) {
  return transfer.metadata?.payment_type === CHI_PAYMENT_TYPE
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

async function updateWebhookRowOrThrow(
  query: PromiseLike<{ error?: { message?: string } | null }>,
  fallback: string
) {
  const { error } = await query
  if (error) throw new Error(error.message ?? fallback)
}

async function applyKickbackCheckoutSessionCompleted(admin: any, session: Stripe.Checkout.Session, stripeEventId: string) {
  if (session.metadata?.payment_kind !== 'venue_builder_kickback') return false
  // DEPRECATED: handles in-flight legacy CHI checkout webhooks. New CHI
  // settlements use the 'chi_settlement' kind. Delete in delta.5 once Sentry
  // shows zero hits for 7+ days.
  captureLegacyCHIWebhook(stripeEventId, 'checkout.session.completed', session.id)

  const paymentId = session.metadata.kickback_payment_id
  if (!paymentId) return true

  const stripe = getStripeClient()
  const paymentIntentId = getPaymentIntentId(session.payment_intent)
  const paymentIntent = paymentIntentId
    ? await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] })
    : null
  const charge = paymentIntent ? getChargeFromPaymentIntent(paymentIntent) : { chargeId: null, transferId: null, receiptUrl: null }
  const now = new Date().toISOString()

  await updateWebhookRowOrThrow(
    admin
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
      .eq('id', paymentId),
    'Failed to complete legacy CHI checkout payment',
  )

  if (session.metadata.agreement_id) {
    await updateWebhookRowOrThrow(
      admin
        .from('event_kickback_agreements')
        .update({
          status: 'payment_completed',
          stripe_transfer_id: charge.transferId,
          payment_completed_at: now,
          updated_at: now,
        })
        .eq('id', session.metadata.agreement_id),
      'Failed to complete legacy CHI agreement',
    )
  }

  return true
}

async function applyKickbackPaymentIntent(admin: any, paymentIntent: Stripe.PaymentIntent, stripeEventId: string, eventType: string) {
  if (paymentIntent.metadata?.payment_kind !== 'venue_builder_kickback') return false
  // DEPRECATED: handles in-flight legacy CHI checkout webhooks. New CHI
  // settlements use the 'chi_settlement' kind. Delete in delta.5 once Sentry
  // shows zero hits for 7+ days.
  captureLegacyCHIWebhook(stripeEventId, eventType, paymentIntent.id)

  const paymentId = paymentIntent.metadata.kickback_payment_id
  if (!paymentId) return true

  if (paymentIntent.status === 'succeeded') {
    const charge = getChargeFromPaymentIntent(paymentIntent)
    const now = new Date().toISOString()

    await updateWebhookRowOrThrow(
      admin
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
        .eq('id', paymentId),
      'Failed to complete legacy CHI payment intent',
    )

    if (paymentIntent.metadata.agreement_id) {
      await updateWebhookRowOrThrow(
        admin
          .from('event_kickback_agreements')
          .update({
            status: 'payment_completed',
            stripe_transfer_id: charge.transferId,
            payment_completed_at: now,
            updated_at: now,
          })
          .eq('id', paymentIntent.metadata.agreement_id),
        'Failed to complete legacy CHI payment-intent agreement',
      )
    }
  }

  if (paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'canceled') {
    await updateWebhookRowOrThrow(
      admin
        .from('kickback_payments')
        .update({
          status: 'failed',
          stripe_payment_intent_id: paymentIntent.id,
          failed_at: new Date().toISOString(),
          failure_reason: paymentIntent.last_payment_error?.message ?? 'Payment failed',
        })
        .eq('id', paymentId),
      'Failed to persist legacy CHI payment-intent failure',
    )
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
    await updateWebhookRowOrThrow(
      query.eq('id', paymentId),
      'Failed to update legacy CHI transfer by payment ID',
    )
    return true
  }

  await updateWebhookRowOrThrow(
    query.eq('stripe_transfer_id', transfer.id),
    'Failed to update legacy CHI transfer by Stripe transfer ID',
  )
  return true
}

async function applyCommunityHostIncentiveInvoicePaid(admin: any, invoice: Stripe.Invoice): Promise<CHIInvoicePaidResult> {
  if (!isCommunityHostIncentiveInvoice(invoice)) return { handled: false }

  if (!assertUsdInvoice(invoice)) {
    console.error('[stripe webhook] non-USD CHI invoice rejected', {
      invoice_id: invoice.id,
      currency: invoice.currency,
      amount: invoice.amount_paid,
    })
    Sentry.captureMessage('CHI invoice non-USD', {
      level: 'error',
      extra: {
        invoice_id: invoice.id,
        currency: invoice.currency,
        amount: invoice.amount_paid,
      },
    })
    return { handled: true, ignored: true, reason: 'non_usd_currency' }
  }

  const settlementId = invoice.metadata?.chi_settlement_id
  const agreementId = invoice.metadata?.chi_agreement_id
  const builderStripeAccountId = invoice.metadata?.builder_stripe_account_id
  const principalCents = Number(invoice.metadata?.principal_cents ?? 0)

  if (!settlementId || !agreementId || !builderStripeAccountId || !Number.isSafeInteger(principalCents) || principalCents <= 0) {
    console.error('[stripe.webhook] Missing required CHI invoice metadata', {
      invoiceId: invoice.id,
      settlementId,
      agreementId,
    })
    return { handled: true }
  }

  const { data: settlement, error: settlementError } = await admin
    .from('community_host_incentive_settlements')
    .select('id, agreement_id, status, stripe_transfer_id')
    .eq('id', settlementId)
    .maybeSingle()

  if (settlementError) throw new Error(settlementError.message)
  if (!settlement?.id) return { handled: true }
  if (settlement.status === 'paid' || settlement.stripe_transfer_id) return { handled: true }

  const stripe = getStripeClient()
  const transfer = await stripe.transfers.create(
    {
      amount: principalCents,
      currency: invoice.currency ?? 'usd',
      destination: builderStripeAccountId,
      transfer_group: `community_host_incentive_${settlementId}`,
      metadata: {
        payment_type: CHI_PAYMENT_TYPE,
        chi_settlement_id: settlementId,
        chi_agreement_id: agreementId,
        event_id: invoice.metadata?.event_id ?? '',
        venue_id: invoice.metadata?.venue_id ?? '',
        organizer_id: invoice.metadata?.organizer_id ?? '',
        legacy_payment_id: invoice.metadata?.legacy_payment_id ?? '',
        principal_cents: String(principalCents),
      },
    },
    {
      idempotencyKey: `community_host_incentive_invoice_transfer_${settlementId}_${invoice.id}_${principalCents}`,
    }
  )

  const now = new Date().toISOString()
  await updateWebhookRowOrThrow(
    admin
      .from('community_host_incentive_settlements')
      .update({
        status: 'paid',
        paid_at: now,
        stripe_invoice_id: invoice.id,
        stripe_transfer_id: transfer.id,
        organizer_payout_cents: principalCents,
        updated_at: now,
      })
      .eq('id', settlementId),
    'Failed to mark CHI settlement paid'
  )

  await updateWebhookRowOrThrow(
    admin
      .from('community_host_incentive_agreements')
      .update({
        status: 'completed',
        updated_at: now,
      })
      .eq('id', agreementId),
    'Failed to mark CHI agreement completed'
  )

  const legacyPaymentId = invoice.metadata?.legacy_payment_id
  if (legacyPaymentId) {
    await updateWebhookRowOrThrow(
      admin
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
        .eq('id', legacyPaymentId),
      'Failed to update legacy payment compatibility state'
    )
  }

  return { handled: true }
}

async function applyCommunityHostIncentiveInvoicePaymentFailed(admin: any, invoice: Stripe.Invoice) {
  if (!isCommunityHostIncentiveInvoice(invoice)) return false

  const settlementId = invoice.metadata?.chi_settlement_id
  if (settlementId) {
    await updateWebhookRowOrThrow(
      admin
        .from('community_host_incentive_settlements')
        .update({
          status: 'failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', settlementId),
      'Failed to mark CHI settlement failed'
    )
  }

  const legacyPaymentId = invoice.metadata?.legacy_payment_id
  if (legacyPaymentId) {
    await updateWebhookRowOrThrow(
      admin
        .from('kickback_payments')
        .update({
          status: 'invoice_failed',
          failed_at: new Date().toISOString(),
          failure_reason: 'Stripe Community Host Incentive invoice payment failed',
        })
        .eq('id', legacyPaymentId),
      'Failed to update legacy payment compatibility failure state'
    )
  }

  return true
}

async function applyCommunityHostIncentiveTransferEvent(
  admin: any,
  transfer: Stripe.Transfer,
  eventType: 'transfer.created' | 'transfer.updated' | 'transfer.reversed'
) {
  const settlementId = transfer.metadata?.chi_settlement_id
  if (!settlementId) {
    console.warn('[stripe.webhook] CHI transfer missing settlement metadata', { transferId: transfer.id })
    return true
  }

  if (eventType === 'transfer.reversed') {
    await updateWebhookRowOrThrow(
      admin
        .from('community_host_incentive_settlements')
        .update({
          status: 'refunded',
          updated_at: new Date().toISOString(),
        })
        .eq('id', settlementId),
      'Failed to mark CHI settlement refunded'
    )
    if (transfer.metadata?.legacy_payment_id) {
      await markLegacyCompatibilityPaymentRefunded(admin, transfer.metadata.legacy_payment_id)
    }
    return true
  }

  await updateWebhookRowOrThrow(
    admin
      .from('community_host_incentive_settlements')
      .update({
        stripe_transfer_id: transfer.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', settlementId),
    'Failed to save CHI transfer state'
  )
  return true
}

async function applyCommunityHostIncentiveRefundCompleted(
  admin: any,
  metadata: {
    chiSettlementId: string
    legacyPaymentId?: string | null
  } | null
) {
  if (!metadata?.chiSettlementId) return false

  await updateWebhookRowOrThrow(
    admin
      .from('community_host_incentive_settlements')
      .update({
        status: 'refunded',
        updated_at: new Date().toISOString(),
      })
      .eq('id', metadata.chiSettlementId),
    'Failed to mark CHI settlement refunded'
  )

  if (metadata.legacyPaymentId) {
    await markLegacyCompatibilityPaymentRefunded(admin, metadata.legacyPaymentId)
  }

  return true
}

async function markLegacyCompatibilityPaymentRefunded(admin: any, paymentId: string) {
  const { data: payment, error } = await admin
    .from('kickback_payments')
    .select('id, status, refund_amount_cents, builder_payout_cents, amount_cents')
    .eq('id', paymentId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!payment?.id) return
  if (payment.status === 'refunded_full' || payment.status === 'refunded_partial') return

  const refundAmountCents = Number(payment.refund_amount_cents ?? 0)
  const payoutCents = Number(payment.builder_payout_cents ?? payment.amount_cents ?? 0)
  const nextStatus = refundAmountCents > 0 && refundAmountCents >= payoutCents
    ? 'refunded_full'
    : 'refunded_partial'

  await updateWebhookRowOrThrow(
    admin
      .from('kickback_payments')
      .update({
        status: nextStatus,
        completed_at: new Date().toISOString(),
      })
      .eq('id', paymentId),
    'Failed to mark CHI compatibility payment refunded'
  )
}

async function applyKickbackInvoicePaid(admin: any, invoice: Stripe.Invoice, stripeEventId: string) {
  const paymentId = invoice.metadata?.kickback_payment_id
  if (!paymentId) return false
  if (invoice.metadata?.settlement_method !== 'invoice') return true
  // DEPRECATED: handles in-flight legacy CHI checkout webhooks. New CHI
  // settlements use the 'chi_settlement' kind. Delete in delta.5 once Sentry
  // shows zero hits for 7+ days.
  captureLegacyCHIWebhook(stripeEventId, 'invoice.paid', invoice.id)

  const principalCents = Number(invoice.metadata?.principal_cents ?? 0)
  const builderStripeAccountId = invoice.metadata?.builder_stripe_account_id

  if (!builderStripeAccountId || principalCents <= 0) {
    console.error('[stripe.webhook] Missing builder account or principal for Community Host Incentive invoice', invoice.id)
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
  const transfer = await stripe.transfers.create(
    {
      amount: principalCents,
      currency: 'usd',
      destination: builderStripeAccountId,
      transfer_group: `kickback_${paymentId}`,
      metadata: {
        payment_kind_namespace: KICKBACK_TRANSFER_NAMESPACE,
        kickback_payment_id: paymentId,
        settlement_method: 'invoice',
      },
    },
    {
      idempotencyKey: `kickback_invoice_transfer_${paymentId}_${invoice.id}_${principalCents}`,
    }
  )

  const now = new Date().toISOString()
  await updateWebhookRowOrThrow(
    admin
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
      .eq('id', paymentId),
    'Failed to persist legacy CHI invoice payout',
  )

  if (payment.agreement_id) {
    await updateWebhookRowOrThrow(
      admin
        .from('event_kickback_agreements')
        .update({
          status: 'payment_completed',
          stripe_transfer_id: transfer.id,
          payment_completed_at: now,
          updated_at: now,
        })
        .eq('id', payment.agreement_id),
      'Failed to persist legacy CHI invoice agreement completion',
    )
  }

  await sendBuilderPaidEmail({ paymentId }).catch((error) => {
    console.error('[stripe.webhook] Failed to send builder paid email', error)
  })

  return true
}

async function applyKickbackInvoicePaymentFailed(admin: any, invoice: Stripe.Invoice, stripeEventId: string) {
  const paymentId = invoice.metadata?.kickback_payment_id
  if (!paymentId) return false
  if (invoice.metadata?.settlement_method !== 'invoice') return true
  // DEPRECATED: handles in-flight legacy CHI checkout webhooks. New CHI
  // settlements use the 'chi_settlement' kind. Delete in delta.5 once Sentry
  // shows zero hits for 7+ days.
  captureLegacyCHIWebhook(stripeEventId, 'invoice.payment_failed', invoice.id)

  await updateWebhookRowOrThrow(
    admin
      .from('kickback_payments')
      .update({
        status: 'invoice_failed',
        failed_at: new Date().toISOString(),
        failure_reason: 'Stripe invoice payment failed',
      })
      .eq('id', paymentId),
    'Failed to persist legacy CHI invoice failure',
  )

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

  await updateWebhookRowOrThrow(
    admin
      .from('kickback_payments')
      .update({
        status: nextStatus,
        completed_at: new Date().toISOString(),
      })
      .eq('id', paymentId),
    'Failed to persist legacy CHI refund completion',
  )

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

function getCommunityHostIncentiveRefundMetadataFromCharge(charge: Stripe.Charge) {
  if (charge.metadata?.payment_type === CHI_PAYMENT_TYPE && charge.metadata?.chi_settlement_id) {
    return {
      chiSettlementId: charge.metadata.chi_settlement_id,
      legacyPaymentId: charge.metadata.legacy_payment_id ?? null,
    }
  }

  const refunds = (charge.refunds?.data ?? []) as Array<Stripe.Refund>
  const metadataRefund = refunds.find((refund) =>
    refund.metadata?.payment_type === CHI_PAYMENT_TYPE && refund.metadata?.chi_settlement_id
  )
  if (!metadataRefund?.metadata?.chi_settlement_id) return null

  return {
    chiSettlementId: metadataRefund.metadata.chi_settlement_id,
    legacyPaymentId: metadataRefund.metadata.legacy_payment_id ?? null,
  }
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
  if (isCommunityHostIncentiveTransferEvent(transfer)) {
    await applyCommunityHostIncentiveTransferEvent(admin, transfer, eventType)
    return
  }

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

async function routePaidCheckoutSession(
  admin: any,
  session: Stripe.Checkout.Session,
  stripeEventId: string,
) {
  const handledSettlement = await handleSettlementCheckoutCompleted(admin, session)
  if (handledSettlement.handled) return

  const venueRentalResult = await handleVenueRentalCheckoutCompleted(
    admin,
    getStripeClient(),
    session,
  )
  if (venueRentalResult.handled) {
    if (!venueRentalResult.reconciled && venueRentalResult.reason === 'transaction_not_found') {
      logMissingVenueRentalTransaction('checkout.session.completed', session.metadata, session.id)
    }
    return
  }

  const handledKickback = await applyKickbackCheckoutSessionCompleted(
    admin,
    session,
    stripeEventId,
  )
  if (!handledKickback) await applyCheckoutSessionCompleted(admin, session)
}

async function routeFailedAsyncCheckoutSession(
  admin: any,
  session: Stripe.Checkout.Session,
  stripeEventId: string,
) {
  const paymentIntentId = getPaymentIntentId(session.payment_intent)
  if (!paymentIntentId) return false

  const paymentIntent = await getStripeClient().paymentIntents.retrieve(paymentIntentId, {
    expand: ['latest_charge'],
  })
  if (!isTerminalAsyncPaymentFailure(paymentIntent.status)) {
    console.info('[stripe.webhook] Ignoring stale async payment failure after fresh Stripe truth', {
      checkout_session_id: session.id,
      payment_intent_id: paymentIntent.id,
      stripe_status: paymentIntent.status,
    })
    return false
  }
  const handledSettlement = await handleSettlementPaymentIntentFailed(admin, paymentIntent)
  if (handledSettlement.handled) return true

  const handledVenueRental = await applyVenueRentalPaymentIntent(
    admin,
    paymentIntent,
    'payment_intent.payment_failed',
  )
  if (handledVenueRental) return true

  return applyKickbackPaymentIntent(
    admin,
    paymentIntent,
    stripeEventId,
    'checkout.session.async_payment_failed',
  )
}

function isTerminalAsyncPaymentFailure(status: Stripe.PaymentIntent.Status) {
  return status === 'requires_payment_method' || status === 'canceled'
}

/**
 * Receives Stripe platform webhooks for builder billing, venue rentals, and platform payments.
 */
export async function POST(request: NextRequest) {
  const logger = getRequestLogger(request).child({ stripe_source: 'platform' })
  const admin = createServiceRoleClient()
  const rawBody = await request.text()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const authorizedReplay = isAuthorizedStripeWebhookReplay(request)

  if (!webhookSecret && !authorizedReplay) {
    logger.error('Stripe webhook missing platform secret')
    return NextResponse.json({ error: 'Stripe webhook secret is not configured' }, { status: 500 })
  }

  const signature = request.headers.get('stripe-signature')

  if (!signature && !authorizedReplay) {
    return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = authorizedReplay
      ? parsePersistedStripeEvent(rawBody)
      : getStripeClient().webhooks.constructEvent(rawBody, signature!, webhookSecret!)
  } catch (error) {
    logger.error(authorizedReplay ? 'Stripe webhook replay payload invalid' : 'Stripe webhook invalid signature', error)
    return NextResponse.json(
      { error: authorizedReplay ? 'Invalid persisted Stripe event' : 'Invalid Stripe signature' },
      { status: 400 },
    )
  }

  if (authorizedReplay) {
    try {
      const queuedEvent = await loadQueuedStripeWebhookReplay(admin as any, {
        eventId: event.id,
        endpointPath: '/api/webhooks/stripe',
      })
      if (!queuedEvent) {
        logger.error('Stripe webhook replay rejected because no deferred ledger event exists', undefined, {
          stripe_event_id: event.id,
        })
        return NextResponse.json({ error: 'Deferred Stripe event not found' }, { status: 403 })
      }
      event = queuedEvent
    } catch (error) {
      logger.error('Stripe webhook replay ledger lookup failed', error, { stripe_event_id: event.id })
      return NextResponse.json({ error: 'Deferred Stripe event lookup failed' }, { status: 500 })
    }
  }

  const eventLogger = logger.child({ stripe_event_id: event.id, stripe_event_type: event.type })

  let reservation: Awaited<ReturnType<typeof reserveStripeWebhookEvent>>
  try {
    reservation = await reserveStripeWebhookEvent(admin as any, {
      event,
      source: 'platform',
      endpointPath: '/api/webhooks/stripe',
      replayAuthorized: authorizedReplay,
    })
  } catch (error) {
    eventLogger.error('Stripe webhook reservation failed closed', error)
    return NextResponse.json({ error: 'reservation_failed' }, { status: 500 })
  }
  if ('deferred' in reservation && reservation.deferred) {
    eventLogger.info('Stripe webhook queued by durable write-pause reservation', {
      queuedAt: reservation.queuedAt,
      controlState: reservation.controlState,
    })
    return NextResponse.json(
      { received: true, queued: true, reason: 'maintenance_in_progress' },
      { status: 202 },
    )
  }
  if ('completed' in reservation && reservation.completed) {
    eventLogger.info('Stripe webhook duplicate delivery skipped', {
      processedAt: reservation.processedAt,
    })
    return NextResponse.json({ received: true, duplicate: true })
  }
  if ('inFlight' in reservation && reservation.inFlight) {
    eventLogger.info('Stripe webhook concurrent duplicate delivery skipped')
    return NextResponse.json({ received: true, in_flight: true }, { status: 409 })
  }
  if (!('reservedNow' in reservation) || !reservation.reservedNow) {
    eventLogger.error('Stripe webhook reservation failed', undefined, {
      reservation,
    })
    return NextResponse.json({ error: 'reservation_failed' }, { status: 500 })
  }
  const reservationToken = reservation.reservationToken

  const pause = await readWritePauseStatus()
  if (!authorizedReplay && pause.available && pause.state !== 'open') {
    try {
      const deferred = await deferStripeWebhookForMaintenance(admin as any, {
        event,
        endpointPath: '/api/webhooks/stripe',
        reservationToken,
      })
      eventLogger.info('Stripe webhook queued during write pause', {
        queuedAt: deferred.queuedAt,
        pauseRevision: pause.revision,
      })
      return NextResponse.json(
        {
          received: true,
          queued: true,
          reason: 'maintenance_in_progress',
        },
        { status: 202 },
      )
    } catch (error) {
      eventLogger.error('Stripe webhook maintenance queue failed', error)
      await failStripeWebhookProcessing(admin as any, {
        event,
        source: 'platform',
        endpointPath: '/api/webhooks/stripe',
        reservationToken,
        error,
      }).catch((ledgerError) => {
        eventLogger.error('Stripe webhook failed to save queue failure', ledgerError)
      })
      return NextResponse.json({ received: true, queued: false }, { status: 500 })
    }
  }

  if (!pause.available) {
    eventLogger.error('Write-pause store unavailable; processing Stripe webhook fail-open', undefined, {
      error: pause.error,
    })
  }

  // Replays are CRON-authenticated and reload the authoritative payload from
  // the deferred ledger. Applying the public delivery rate limit here would
  // acknowledge the replay as processed without running its side effects.
  if (!authorizedReplay && !(await allowWebhookRequest(admin, getWebhookRateLimitKey('stripe', request.headers)))) {
    eventLogger.warn('Stripe webhook rate limit exceeded')
    await recordStripeWebhookProcessingResult(admin as any, {
      event,
      source: 'platform',
      endpointPath: '/api/webhooks/stripe',
      outcome: 'rate_limited',
      reservationToken,
      processed: false,
    })
    return NextResponse.json(
      { received: false, retry: true, reason: 'rate_limited' },
      { status: 429, headers: { 'retry-after': '60', 'cache-control': 'no-store' } },
    )
  }

  try {
    let outcome: StripeWebhookProcessingOutcome = 'processed'
    let responseBody: Record<string, unknown> = { received: true }

    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object as Stripe.Checkout.Session
      const isVenueOrSettlementMoney =
        session.metadata?.kind === CHI_SETTLEMENT_METADATA_KIND ||
        isVenueRentalEvent(session.metadata)
      if (isVenueOrSettlementMoney && session.payment_status !== 'paid') {
        if (event.type === 'checkout.session.async_payment_succeeded') {
          throw new Error(`Stripe async success ${session.id} is not marked paid`)
        }
        outcome = 'observed'
        responseBody = { received: true, observed: 'checkout_payment_pending' }
      } else {
        await routePaidCheckoutSession(admin as any, session, event.id)
      }
    }

    if (event.type === 'checkout.session.async_payment_failed') {
      const handled = await routeFailedAsyncCheckoutSession(
        admin as any,
        event.data.object as Stripe.Checkout.Session,
        event.id,
      )
      if (!handled) {
        outcome = 'observed'
        responseBody = { received: true, observed: 'checkout_async_payment_failed' }
      }
    }

    if (event.type === 'invoice.paid') {
      const invoice = event.data.object as Stripe.Invoice
      const handledCHIInvoice = await applyCommunityHostIncentiveInvoicePaid(admin as any, invoice)
      if (handledCHIInvoice.ignored) {
        outcome = 'ignored'
        responseBody = { received: true, ignored: true, reason: handledCHIInvoice.reason }
      }
      if (!handledCHIInvoice.handled) {
        const handledKickbackInvoice = await applyKickbackInvoicePaid(admin as any, invoice, event.id)
        if (!handledKickbackInvoice) {
          await applyInvoicePayment(admin as any, invoice)
        }
      }
    }

    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object as Stripe.Invoice
      if (!isCommunityHostIncentiveInvoice(invoice) && !invoice.metadata?.kickback_payment_id) {
        await applyInvoicePayment(admin as any, invoice)
      }
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice
      const handledCHIInvoice = await applyCommunityHostIncentiveInvoicePaymentFailed(admin as any, invoice)
      if (!handledCHIInvoice) {
        const handledKickbackInvoice = await applyKickbackInvoicePaymentFailed(admin as any, invoice, event.id)
        if (!handledKickbackInvoice) {
          await applyInvoicePaymentFailed(admin as any, invoice)
        }
      }
    }

    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      await syncBuilderSubscription(admin as any, event.data.object as Stripe.Subscription)
    }

    if (event.type === 'customer.subscription.deleted') {
      await syncBuilderSubscription(admin as any, event.data.object as Stripe.Subscription)
    }

    if (event.type === 'account.updated') {
      responseBody = await processStripeConnectWebhookEvent(admin as any, event, getStripeClient())
      if (responseBody.ignored) outcome = 'ignored'
    }

    if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object as Stripe.PaymentIntent
      const handledSettlement = event.type === 'payment_intent.payment_failed'
        ? await handleSettlementPaymentIntentFailed(admin as any, paymentIntent)
        : { handled: false }
      if (!handledSettlement.handled) {
        const handledVenueRental = await applyVenueRentalPaymentIntent(admin as any, paymentIntent, event.type)
        if (!handledVenueRental) {
        const handledPlannerDeposit = await applyPlannerStripePaymentIntentWebhook(
          admin as any,
          paymentIntent
        )
        if (!handledPlannerDeposit) {
          await applyKickbackPaymentIntent(admin as any, paymentIntent, event.id, event.type)
        }
        }
      }
    }

    if (event.type === 'payment_intent.canceled') {
      await applyPlannerStripePaymentIntentWebhook(
        admin as any,
        event.data.object as Stripe.PaymentIntent
      )
    }

    if (event.type === 'payment_intent.amount_capturable_updated') {
      await applyPlannerStripePaymentIntentWebhook(
        admin as any,
        event.data.object as Stripe.PaymentIntent
      )
    }

    if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge
      const handledVenueRental = await applyVenueRentalRefundedCharge(admin as any, charge)
      if (!handledVenueRental) {
        const handledCHIRefund = await applyCommunityHostIncentiveRefundCompleted(
          admin as any,
          getCommunityHostIncentiveRefundMetadataFromCharge(charge)
        )
        if (!handledCHIRefund) {
          const handledKickbackRefund = await applyKickbackRefundCompleted(
            admin as any,
            getKickbackPaymentIdFromRefundedCharge(charge)
          )
          if (!handledKickbackRefund) {
            await applyPlannerStripeRefundWebhook(
              admin as any,
              getPaymentIntentIdFromCharge(charge),
              {
                chargeAmountCapturedCents: Number(charge.amount_captured ?? 0),
                refundedAmountCents: Number(charge.amount_refunded ?? 0),
                currency: charge.currency,
                eventId: event.id,
                fullyRefunded: charge.refunded,
              },
              charge.metadata?.payment_kind === 'planner_deposit'
            )
          }
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
      responseBody = { received: true, observed: event.type }
      outcome = 'observed'
    }

    if (event.type === 'account.application.deauthorized') {
      responseBody = await processStripeConnectWebhookEvent(admin as any, event, getStripeClient())
    }

    await recordStripeWebhookProcessingResult(admin as any, {
      event,
      source: 'platform',
      endpointPath: '/api/webhooks/stripe',
      outcome,
      reservationToken,
    })
    eventLogger.info('Stripe webhook processed event', { outcome })
    return NextResponse.json(responseBody)
  } catch (error) {
    eventLogger.error('Stripe webhook processing failed', error)
    await failStripeWebhookProcessing(admin as any, {
      event,
      source: 'platform',
      endpointPath: '/api/webhooks/stripe',
      reservationToken,
      error,
    }).catch((ledgerError) => {
      eventLogger.error('Stripe webhook failed to save failure state', ledgerError)
    })
    return NextResponse.json({ received: true, processed: false }, { status: 500 })
  }
}
