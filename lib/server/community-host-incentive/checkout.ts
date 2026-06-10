export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { sendVenueInvoiceEmail } from '@/lib/email'
import {
  buildCHIStripeMetadata,
  calculateCHI,
  isCHINewEngineEnabled,
  isCHIVenueTypeEligible,
  renderCHIInvoiceLine,
  type CHIAgreementInput,
  type CHISettlementResult,
  type CHIVerificationSource,
} from '@/lib/finance/community-host-incentive'
import { centsToDollars } from '@/lib/money'
import { dollarsToCents } from '@/lib/payments/vendor-payments'
import { validateStripeConnectAccount } from '@/lib/billing/stripeConnectGuard'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  getAppBaseUrl,
  getAuthenticatedVenueOwner,
  getStripeClient,
  isConnectedStripeAccountBlocked,
} from '@/lib/stripe/connect'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

type KickbackPaymentForCheckout = {
  id: string
  agreement_id: string
  event_id: string | null
  payer_id: string
  recipient_id: string
  amount: number | null
  amount_cents?: number | null
  currency: string | null
  status: string
  settlement_method?: 'checkout' | 'invoice' | null
  events?: { event_name?: string | null } | { event_name?: string | null }[] | null
}

type KickbackAgreementForInvoice = {
  id: string
  event_id: string | null
  plan_id: string | null
  venue_id: string
  builder_id: string
  venue_owner_id: string
  actual_attendance: number | null
  actual_qualified_attendance: number | null
  attendance_extracted_value: number | null
  attendance_proof_url: string | null
  reported_revenue_cents: number | null
  bar_revenue_share_percent: number | string | null
  ticket_revenue_share_percent: number | string | null
  lift_share_percentage: number | string | null
  per_head_amount: number | string | null
  minimum_attendees: number | null
  maximum_payout: number | null
  venue_approved: boolean | null
  venue_approved_at: string | null
  disputed_at: string | null
}

type VenueForInvoice = {
  id: string
  venue_name: string | null
  venue_type: string | null
  contact_email: string | null
  owner_id: string | null
  stripe_customer_id?: string | null
}

type CHIAgreementRowForInvoice = {
  id: string
  event_id: string | null
  plan_id: string | null
  venue_id: string
  organizer_user_id: string
  venue_owner_user_id: string
  agreement_type: CHIAgreementInput['agreementType']
  per_head_rate_cents: number | null
  fixed_amount_cents: number | null
  threshold_attendees: number | null
  base_amount_cents: number | null
  payout_floor_cents: number | null
  payout_cap_cents: number | null
  venue_approved: boolean
  approved_at: string | null
  approved_by_venue_user_id: string | null
}

type CHISettlementRowForInvoice = {
  id: string
  agreement_id: string
  event_id: string | null
  status: string
  stripe_invoice_id: string | null
  stripe_transfer_id: string | null
}

const CHI_AGREEMENT_SELECT = [
  'id',
  'event_id',
  'plan_id',
  'venue_id',
  'organizer_user_id',
  'venue_owner_user_id',
  'agreement_type',
  'per_head_rate_cents',
  'fixed_amount_cents',
  'threshold_attendees',
  'base_amount_cents',
  'payout_floor_cents',
  'payout_cap_cents',
  'venue_approved',
  'approved_at',
  'approved_by_venue_user_id',
].join(', ')

const CHI_SETTLEMENT_SELECT = [
  'id',
  'agreement_id',
  'event_id',
  'status',
  'stripe_invoice_id',
  'stripe_transfer_id',
].join(', ')

/**
 * Creates a Stripe Checkout session for a venue-to-builder Community Host Incentive payment.
 */
export async function POST(
  request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid Community Host Incentive payment id' }, { status: 400 })
    }
    const paymentId = parsedParams.data.id

    const supabase = createClient()
    const auth = await getAuthenticatedVenueOwner(supabase)

    if (auth.error || !auth.user || !auth.owner) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createServiceRoleClient()
    const { data: paymentRow, error: paymentError } = await (admin as any)
      .from('kickback_payments')
      .select('id, agreement_id, event_id, payer_id, recipient_id, amount, amount_cents, currency, status, settlement_method, events(event_name)')
      .eq('id', paymentId)
      .maybeSingle()

    if (paymentError) throw new Error(paymentError.message)
    if (!paymentRow) return NextResponse.json({ error: 'Community Host Incentive payment not found' }, { status: 404 })

    const payment = paymentRow as KickbackPaymentForCheckout
    if (payment.payer_id !== auth.owner.id) {
      return NextResponse.json({ error: 'Not authorized for this Community Host Incentive payment' }, { status: 403 })
    }

    if (payment.settlement_method === 'invoice') {
      return createInvoiceForKickback({
        request,
        admin: admin as any,
        payment,
        venueOwnerEmail: auth.owner.email ?? null,
      })
    }

    if (!['pending', 'failed'].includes(payment.status)) {
      return NextResponse.json({ error: 'This Community Host Incentive payment is not payable right now' }, { status: 400 })
    }

    const paymentAmountCents = resolveKickbackPaymentAmountCents(payment)
    if (paymentAmountCents <= 0) {
      return NextResponse.json({ error: 'Community Host Incentive amount must be greater than zero' }, { status: 400 })
    }

    const { data: builderAccount, error: builderAccountError } = await (admin as any)
      .from('builder_stripe_accounts')
      .select('stripe_account_id, account_status, payouts_enabled')
      .eq('user_id', payment.recipient_id)
      .maybeSingle()

    if (builderAccountError) throw new Error(builderAccountError.message)

    if (!builderAccount?.stripe_account_id) {
      return NextResponse.json(
        {
          error: 'The event builder needs to reconnect Stripe before receiving payouts.',
          code: 'builder_requires_reconnect',
          onboarding_required: true,
        },
        { status: 409 }
      )
    }

    const stripe = getStripeClient()
    const validation = await validateStripeConnectAccount({
      stripe,
      db: admin as any,
      table: 'builder_stripe_accounts',
      rowId: payment.recipient_id,
      currentAccountId: builderAccount.stripe_account_id,
    })

    if (validation.mismatchCleared || !validation.accountId) {
      return NextResponse.json(
        {
          error: 'The event builder needs to reconnect Stripe before receiving payouts.',
          code: 'builder_requires_reconnect',
          onboarding_required: true,
          reason: 'stripe_mode_mismatch',
        },
        { status: 409 }
      )
    }

    if (!builderAccount.payouts_enabled || isConnectedStripeAccountBlocked(builderAccount.account_status)) {
      return NextResponse.json(
        { error: 'The event builder has not finished payout setup yet.' },
        { status: 400 }
      )
    }

    const baseUrl = getAppBaseUrl(request)
    const event = Array.isArray(payment.events) ? payment.events[0] : payment.events
    const eventName = event?.event_name || 'event'
    const metadata = {
      payment_kind: 'venue_builder_kickback',
      kickback_payment_id: payment.id,
      agreement_id: payment.agreement_id,
      event_id: payment.event_id ?? '',
      venue_owner_id: payment.payer_id,
      builder_user_id: payment.recipient_id,
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: payment.currency || 'usd',
              unit_amount: paymentAmountCents,
              product_data: {
                name: `3rdPlace Community Host Incentive: ${eventName}`,
                metadata,
              },
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          transfer_data: {
            destination: validation.accountId,
          },
          metadata,
        },
        metadata,
        success_url: `${baseUrl}/venue/payouts?community_host_incentive=success&payment=${payment.id}`,
        cancel_url: `${baseUrl}/venue/payouts?community_host_incentive=cancelled&payment=${payment.id}`,
      },
      {
        idempotencyKey: `kickback_checkout_${payment.id}_${paymentAmountCents}`,
      }
    )

    await (admin as any)
      .from('kickback_payments')
      .update({
        status: 'processing',
        stripe_checkout_session_id: session.id,
        failure_reason: null,
        initiated_at: new Date().toISOString(),
      })
      .eq('id', payment.id)

    await (admin as any)
      .from('event_kickback_agreements')
      .update({
        status: 'payment_processing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', payment.agreement_id)

    return NextResponse.json({
      checkoutUrl: session.url,
      sessionId: session.id,
    })
  } catch (error) {
    console.error('[venue.community-host-incentive.checkout] Failed to create checkout', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to start Community Host Incentive payment' },
      { status: 500 }
    )
  }
}

async function createInvoiceForKickback({
  request,
  admin,
  payment,
  venueOwnerEmail,
}: {
  request: NextRequest
  admin: any
  payment: KickbackPaymentForCheckout
  venueOwnerEmail: string | null
}) {
  if (payment.status !== 'pending_venue_approval') {
    return NextResponse.json({ error: 'This Community Host Incentive is not ready for invoicing' }, { status: 400 })
  }

  const principalCents = Math.round(Number(payment.amount_cents ?? 0))
  if (principalCents <= 0) {
    return NextResponse.json({ error: 'Community Host Incentive amount must be greater than zero' }, { status: 400 })
  }

  const agreement = await loadAgreementForInvoice(admin, payment.agreement_id)
  if (!agreement) {
    return NextResponse.json({ error: 'Community Host Incentive agreement not found' }, { status: 404 })
  }

  const venue = await loadVenueForInvoice(admin, agreement.venue_id)
  if (!venue) {
    return NextResponse.json({ error: 'Venue not found for Community Host Incentive invoice' }, { status: 404 })
  }

  if (venue.owner_id && venue.owner_id !== payment.payer_id) {
    return NextResponse.json({ error: 'Not authorized for this Community Host Incentive' }, { status: 403 })
  }

  const { accountId, errorResponse } = await loadValidatedBuilderStripeAccount(admin, payment.recipient_id)
  if (errorResponse) return errorResponse
  if (!accountId) {
    return NextResponse.json(
      {
        error: 'The event builder needs to reconnect Stripe before receiving payouts.',
        code: 'builder_requires_reconnect',
        onboarding_required: true,
      },
      { status: 409 }
    )
  }

  const stripe = getStripeClient()
  const useCommunityHostIncentive = isCHINewEngineEnabled() && isCHIVenueTypeEligible(venue.venue_type)
  const customerId = await getOrCreateVenueCustomer({
    admin,
    stripe,
    venue,
    fallbackEmail: venueOwnerEmail,
    metadata: useCommunityHostIncentive
      ? { venue_id: venue.id, payment_type: 'community_host_incentive' }
      : undefined,
  })

  // Business invariant: legacy rows are not silently converted; CHI only runs
  // when the launch flag is on and the venue type is explicitly eligible.
  if (useCommunityHostIncentive) {
    return createInvoiceForCommunityHostIncentive({
      admin,
      payment,
      agreement,
      venue,
      customerId,
      builderStripeAccountId: accountId,
      principalCents,
      currency: payment.currency || 'usd',
    })
  }

  const eventLabel = await loadInvoiceEventLabel(admin, agreement)
  const reportedRevenueCents = agreement.reported_revenue_cents ?? 0
  const achFeeCents = Math.min(Math.round(principalCents * 0.008), 500)
  const percentLabel = getSettlementLabel(agreement)
  const metadata = {
    kickback_payment_id: payment.id,
    settlement_method: 'invoice',
    builder_id: payment.recipient_id,
    builder_stripe_account_id: accountId,
    principal_cents: String(principalCents),
  }

  await stripe.invoiceItems.create(
    {
      customer: customerId,
      amount: principalCents,
      currency: payment.currency || 'usd',
      description: `Community Host Incentive for "${eventLabel.title}" - ${percentLabel} of ${formatCents(reportedRevenueCents)}`,
      metadata: { kickback_payment_id: payment.id, settlement_method: 'invoice', item_type: 'principal' },
    },
    { idempotencyKey: `kickback_invoice_item_${payment.id}_principal_${principalCents}` }
  )

  await stripe.invoiceItems.create(
    {
      customer: customerId,
      amount: achFeeCents,
      currency: payment.currency || 'usd',
      description: 'Payment processing fee (ACH)',
      metadata: { kickback_payment_id: payment.id, settlement_method: 'invoice', item_type: 'processing_fee' },
    },
    { idempotencyKey: `kickback_invoice_item_${payment.id}_processing_${achFeeCents}` }
  )

  const invoice = await stripe.invoices.create(
    {
      customer: customerId,
      collection_method: 'send_invoice',
      pending_invoice_items_behavior: 'include',
      days_until_due: 7,
      payment_settings: {
        payment_method_types: ['us_bank_account', 'card'],
      },
      metadata,
    } as any,
    { idempotencyKey: `kickback_invoice_${payment.id}_${principalCents}_${achFeeCents}` }
  )
  const finalizedInvoice = await stripe.invoices.finalizeInvoice(
    invoice.id,
    {},
    { idempotencyKey: `kickback_invoice_finalize_${payment.id}_${invoice.id}` }
  )
  const sentInvoice = await stripe.invoices.sendInvoice(
    finalizedInvoice.id,
    {},
    { idempotencyKey: `kickback_invoice_send_${payment.id}_${finalizedInvoice.id}` }
  )
  const dueDate = sentInvoice.due_date ?? finalizedInvoice.due_date ?? null
  const hostedInvoiceUrl = sentInvoice.hosted_invoice_url ?? finalizedInvoice.hosted_invoice_url ?? null
  const now = new Date().toISOString()

  const { error: paymentUpdateError } = await admin
    .from('kickback_payments')
    .update({
      status: 'invoice_sent',
      stripe_invoice_id: sentInvoice.id,
      invoice_hosted_url: hostedInvoiceUrl,
      processing_fee_cents: achFeeCents,
      due_date: dueDate ? new Date(dueDate * 1000).toISOString() : null,
      initiated_at: now,
      failure_reason: null,
    })
    .eq('id', payment.id)

  if (paymentUpdateError) {
    throw new Error(paymentUpdateError.message ?? 'Failed to save Community Host Incentive invoice state')
  }

  const { error: agreementUpdateError } = await admin
    .from('event_kickback_agreements')
    .update({
      status: 'payment_pending',
      updated_at: now,
    })
    .eq('id', payment.agreement_id)

  if (agreementUpdateError) {
    throw new Error(agreementUpdateError.message ?? 'Failed to save Community Host Incentive agreement invoice state')
  }

  await sendVenueInvoiceEmail({ paymentId: payment.id }).catch((error) => {
    console.error('[venue.community-host-incentive.checkout] Failed to send venue invoice email', error)
  })

  return NextResponse.json({
    hosted_invoice_url: hostedInvoiceUrl,
    checkoutUrl: hostedInvoiceUrl,
    due_date: dueDate,
    principal_cents: principalCents,
    processing_fee_cents: achFeeCents,
    total_due_cents: principalCents + achFeeCents,
  })
}

async function createInvoiceForCommunityHostIncentive({
  admin,
  payment,
  agreement,
  venue,
  customerId,
  builderStripeAccountId,
  principalCents,
  currency,
}: {
  admin: any
  payment: KickbackPaymentForCheckout
  agreement: KickbackAgreementForInvoice
  venue: VenueForInvoice
  customerId: string
  builderStripeAccountId: string
  principalCents: number
  currency: string
}) {
  if (agreement.disputed_at) {
    return NextResponse.json(
      { error: 'This Community Host Incentive needs admin review before invoicing.' },
      { status: 409 }
    )
  }

  const now = new Date().toISOString()
  const dueDateIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const attendance = resolveVerifiedAttendance(agreement)
  const chiAgreementInput = buildCHIAgreementInput({
    agreement,
    principalCents,
    approvedAt: agreement.venue_approved_at ?? now,
    approvedByVenueUserId: payment.payer_id,
  })
  const chiResult = calculateCHI({
    agreement: chiAgreementInput,
    verifiedAttendees: attendance.verifiedAttendees,
    verificationSource: attendance.verificationSource,
    verificationSourceId: attendance.verificationSourceId,
  })

  if (chiResult.organizerPayoutCents <= 0) {
    return NextResponse.json(
      { error: 'Community Host Incentive payout must be greater than zero before invoicing.' },
      { status: 400 }
    )
  }

  const chiAgreement = await upsertCHIAgreementForInvoice(admin, {
    sourceAgreement: agreement,
    chiAgreementInput,
    organizerUserId: payment.recipient_id,
    venueOwnerUserId: payment.payer_id,
    now,
    dueDateIso,
    legacyPaymentId: payment.id,
  })
  const chiSettlement = await upsertCHISettlementForInvoice(admin, {
    sourceAgreement: agreement,
    chiAgreement,
    attendance,
    chiResult,
    now,
    legacyPaymentId: payment.id,
  })
  const achFeeCents = Math.min(Math.round(chiResult.organizerPayoutCents * 0.008), 500)
  const stripeMetadata = buildCHIStripeMetadata({
    chiAgreementId: chiAgreement.id,
    chiSettlementId: chiSettlement.id,
    agreement: chiAgreementInput,
    settlement: chiResult,
    verifiedAttendees: attendance.verifiedAttendees,
    eventId: agreement.event_id,
    venueId: venue.id,
    organizerId: payment.recipient_id,
    legacyPaymentId: payment.id,
    builderStripeAccountId,
  })
  const stripe = getStripeClient()

  await stripe.invoiceItems.create(
    {
      customer: customerId,
      amount: chiResult.organizerPayoutCents,
      currency,
      description: renderCHIInvoiceLine({
        agreement: chiAgreementInput,
        settlement: chiResult,
        verifiedAttendees: attendance.verifiedAttendees,
      }),
      metadata: { ...stripeMetadata, item_type: 'principal' },
    },
    {
      idempotencyKey: `community_host_incentive_invoice_item_${chiSettlement.id}_principal_${chiResult.organizerPayoutCents}`,
    }
  )

  await stripe.invoiceItems.create(
    {
      customer: customerId,
      amount: achFeeCents,
      currency,
      description: 'Payment processing fee (ACH)',
      metadata: { ...stripeMetadata, item_type: 'processing_fee' },
    },
    {
      idempotencyKey: `community_host_incentive_invoice_item_${chiSettlement.id}_processing_${achFeeCents}`,
    }
  )

  const invoice = await stripe.invoices.create(
    {
      customer: customerId,
      collection_method: 'send_invoice',
      pending_invoice_items_behavior: 'include',
      days_until_due: 7,
      payment_settings: {
        payment_method_types: ['us_bank_account', 'card'],
      },
      metadata: stripeMetadata,
    } as any,
    {
      idempotencyKey: `community_host_incentive_invoice_${chiSettlement.id}_${chiResult.organizerPayoutCents}_${achFeeCents}`,
    }
  )
  const finalizedInvoice = await stripe.invoices.finalizeInvoice(
    invoice.id,
    {},
    { idempotencyKey: `community_host_incentive_invoice_finalize_${chiSettlement.id}_${invoice.id}` }
  )
  const sentInvoice = await stripe.invoices.sendInvoice(
    finalizedInvoice.id,
    {},
    { idempotencyKey: `community_host_incentive_invoice_send_${chiSettlement.id}_${finalizedInvoice.id}` }
  )
  const dueDate = sentInvoice.due_date ?? finalizedInvoice.due_date ?? null
  const hostedInvoiceUrl = sentInvoice.hosted_invoice_url ?? finalizedInvoice.hosted_invoice_url ?? null
  const savedDueDate = dueDate ? new Date(dueDate * 1000).toISOString() : dueDateIso

  await updateOrThrow(
    admin
      .from('community_host_incentive_settlements')
      .update({
        status: 'invoice_sent',
        stripe_invoice_id: sentInvoice.id,
        due_at: savedDueDate,
        metadata: {
          legacy_payment_id: payment.id,
          stripe_invoice_id: sentInvoice.id,
          hosted_invoice_url: hostedInvoiceUrl,
        },
        updated_at: now,
      })
      .eq('id', chiSettlement.id),
    'Failed to save CHI invoice state'
  )

  await updateOrThrow(
    admin
      .from('community_host_incentive_agreements')
      .update({
        status: 'active',
        settlement_due_at: savedDueDate,
        updated_at: now,
      })
      .eq('id', chiAgreement.id),
    'Failed to save CHI agreement invoice state'
  )

  await updateOrThrow(
    admin
      .from('kickback_payments')
      .update({
        status: 'invoice_sent',
        stripe_invoice_id: sentInvoice.id,
        invoice_hosted_url: hostedInvoiceUrl,
        processing_fee_cents: achFeeCents,
        builder_payout_cents: chiResult.organizerPayoutCents,
        due_date: savedDueDate,
        initiated_at: now,
        failure_reason: null,
      })
      .eq('id', payment.id),
    'Failed to save legacy payment compatibility state'
  )

  await updateOrThrow(
    admin
      .from('event_kickback_agreements')
      .update({
        status: 'payment_pending',
        updated_at: now,
      })
      .eq('id', payment.agreement_id),
    'Failed to save legacy agreement compatibility state'
  )

  return NextResponse.json({
    hosted_invoice_url: hostedInvoiceUrl,
    checkoutUrl: hostedInvoiceUrl,
    due_date: dueDate,
    principal_cents: chiResult.organizerPayoutCents,
    processing_fee_cents: achFeeCents,
    total_due_cents: chiResult.organizerPayoutCents + achFeeCents,
    chi_agreement_id: chiAgreement.id,
    chi_settlement_id: chiSettlement.id,
  })
}

function resolveVerifiedAttendance(agreement: KickbackAgreementForInvoice): {
  verifiedAttendees: number
  verificationSource: CHIVerificationSource
  verificationSourceId?: string
} {
  const checkedInAttendance = readNonNegativeInteger(agreement.actual_qualified_attendance)
    ?? readNonNegativeInteger(agreement.actual_attendance)
  if (checkedInAttendance !== null) {
    return {
      verifiedAttendees: checkedInAttendance,
      verificationSource: 'csv_upload',
      verificationSourceId: agreement.attendance_proof_url ?? undefined,
    }
  }

  const extractedAttendance = readNonNegativeInteger(agreement.attendance_extracted_value)
  return {
    verifiedAttendees: extractedAttendance ?? 0,
    verificationSource: extractedAttendance === null ? 'ticketing_api' : 'screenshot_ocr',
    verificationSourceId: agreement.attendance_proof_url ?? undefined,
  }
}

function buildCHIAgreementInput({
  agreement,
  principalCents,
  approvedAt,
  approvedByVenueUserId,
}: {
  agreement: KickbackAgreementForInvoice
  principalCents: number
  approvedAt: string
  approvedByVenueUserId: string
}): CHIAgreementInput {
  const perHeadRateCents = dollarsToCents(agreement.per_head_amount)
  const payoutCapCents = dollarsToCents(agreement.maximum_payout)
  const common = {
    venueApproved: true,
    approvedAt,
    approvedByVenueUserId,
    payoutCapCents: payoutCapCents > 0 ? payoutCapCents : undefined,
  }

  if (perHeadRateCents > 0) {
    return {
      ...common,
      agreementType: 'per_verified_attendee',
      perHeadRateCents,
    }
  }

  if (readNonNegativeInteger(agreement.minimum_attendees) !== null) {
    return {
      ...common,
      agreementType: 'fixed_threshold',
      fixedAmountCents: principalCents,
      thresholdAttendees: agreement.minimum_attendees ?? 0,
    }
  }

  return {
    ...common,
    agreementType: 'manual_venue_approved',
    fixedAmountCents: principalCents,
  }
}

async function upsertCHIAgreementForInvoice(
  admin: any,
  input: {
    sourceAgreement: KickbackAgreementForInvoice
    chiAgreementInput: CHIAgreementInput
    organizerUserId: string
    venueOwnerUserId: string
    now: string
    dueDateIso: string
    legacyPaymentId: string
  }
): Promise<CHIAgreementRowForInvoice> {
  const existing = await loadExistingCHIAgreementForInvoice(admin, input.sourceAgreement, input.organizerUserId)
  const payload = {
    agreement_type: input.chiAgreementInput.agreementType,
    per_head_rate_cents: input.chiAgreementInput.perHeadRateCents ?? null,
    fixed_amount_cents: input.chiAgreementInput.fixedAmountCents ?? null,
    threshold_attendees: input.chiAgreementInput.thresholdAttendees ?? null,
    base_amount_cents: input.chiAgreementInput.baseAmountCents ?? null,
    payout_floor_cents: input.chiAgreementInput.payoutFloorCents ?? null,
    payout_cap_cents: input.chiAgreementInput.payoutCapCents ?? null,
    settlement_mode: 'community_host_incentive',
    status: 'approved',
    venue_approved: true,
    approved_at: input.chiAgreementInput.approvedAt,
    approved_by_venue_user_id: input.chiAgreementInput.approvedByVenueUserId,
    settlement_due_at: input.dueDateIso,
    is_legacy_revenue_share: false,
    metadata: {
      source_table: 'event_kickback_agreements',
      source_agreement_id: input.sourceAgreement.id,
      legacy_payment_id: input.legacyPaymentId,
    },
    updated_at: input.now,
  }

  if (existing?.id) {
    await updateOrThrow(
      admin
        .from('community_host_incentive_agreements')
        .update(payload)
        .eq('id', existing.id),
      'Failed to update CHI agreement'
    )

    return {
      ...existing,
      ...payload,
      agreement_type: payload.agreement_type,
      venue_approved: true,
      approved_at: payload.approved_at,
      approved_by_venue_user_id: payload.approved_by_venue_user_id,
    }
  }

  const { data, error } = await admin
    .from('community_host_incentive_agreements')
    .insert({
      event_id: input.sourceAgreement.event_id,
      plan_id: input.sourceAgreement.plan_id,
      venue_id: input.sourceAgreement.venue_id,
      organizer_user_id: input.organizerUserId,
      venue_owner_user_id: input.venueOwnerUserId,
      created_at: input.now,
      ...payload,
    })
    .select(CHI_AGREEMENT_SELECT)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to create CHI agreement')
  if (!data) throw new Error('Failed to create CHI agreement')
  return data as CHIAgreementRowForInvoice
}

async function loadExistingCHIAgreementForInvoice(
  admin: any,
  agreement: KickbackAgreementForInvoice,
  organizerUserId: string
): Promise<CHIAgreementRowForInvoice | null> {
  let query = admin
    .from('community_host_incentive_agreements')
    .select(CHI_AGREEMENT_SELECT)
    .eq('venue_id', agreement.venue_id)
    .eq('organizer_user_id', organizerUserId)

  query = agreement.event_id
    ? query.eq('event_id', agreement.event_id)
    : query.eq('plan_id', agreement.plan_id)

  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to load CHI agreement')
  return (data as CHIAgreementRowForInvoice | null) ?? null
}

async function upsertCHISettlementForInvoice(
  admin: any,
  input: {
    sourceAgreement: KickbackAgreementForInvoice
    chiAgreement: CHIAgreementRowForInvoice
    attendance: {
      verifiedAttendees: number
      verificationSource: CHIVerificationSource
      verificationSourceId?: string
    }
    chiResult: CHISettlementResult
    now: string
    legacyPaymentId: string
  }
): Promise<CHISettlementRowForInvoice> {
  const { data: existing, error: existingError } = await admin
    .from('community_host_incentive_settlements')
    .select(CHI_SETTLEMENT_SELECT)
    .eq('agreement_id', input.chiAgreement.id)
    .maybeSingle()

  if (existingError) throw new Error(existingError.message ?? 'Failed to load CHI settlement')

  const payload = {
    event_id: input.sourceAgreement.event_id,
    verified_attendees: input.attendance.verifiedAttendees,
    verification_source: input.attendance.verificationSource,
    verification_source_id: input.attendance.verificationSourceId ?? null,
    organizer_payout_cents: input.chiResult.organizerPayoutCents,
    calculation_basis: input.chiResult.calculationBasis,
    applied_floor: input.chiResult.appliedFloor,
    applied_cap: input.chiResult.appliedCap,
    status: 'pending',
    is_legacy_revenue_share: false,
    metadata: {
      source_table: 'event_kickback_agreements',
      source_agreement_id: input.sourceAgreement.id,
      legacy_payment_id: input.legacyPaymentId,
    },
    updated_at: input.now,
  }

  if ((existing as CHISettlementRowForInvoice | null)?.id) {
    const settlement = existing as CHISettlementRowForInvoice
    await updateOrThrow(
      admin
        .from('community_host_incentive_settlements')
        .update(payload)
        .eq('id', settlement.id),
      'Failed to update CHI settlement'
    )

    return {
      ...settlement,
      ...payload,
      status: payload.status,
      stripe_invoice_id: settlement.stripe_invoice_id,
      stripe_transfer_id: settlement.stripe_transfer_id,
    }
  }

  const { data, error } = await admin
    .from('community_host_incentive_settlements')
    .insert({
      agreement_id: input.chiAgreement.id,
      created_at: input.now,
      ...payload,
    })
    .select(CHI_SETTLEMENT_SELECT)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to create CHI settlement')
  if (!data) throw new Error('Failed to create CHI settlement')
  return data as CHISettlementRowForInvoice
}

async function updateOrThrow(query: PromiseLike<{ error?: { message?: string } | null }>, fallback: string) {
  const { error } = await query
  if (error) throw new Error(error.message ?? fallback)
}

function readNonNegativeInteger(value: number | string | null | undefined) {
  const numeric = typeof value === 'string' ? Number(value) : value
  if (typeof numeric !== 'number' || !Number.isSafeInteger(numeric) || numeric < 0) return null
  return numeric
}

function resolveKickbackPaymentAmountCents(payment: KickbackPaymentForCheckout) {
  const cents = typeof payment.amount_cents === 'number' ? Math.round(payment.amount_cents) : null
  return cents && cents > 0 ? cents : dollarsToCents(Number(payment.amount ?? 0))
}

async function loadAgreementForInvoice(admin: any, agreementId: string): Promise<KickbackAgreementForInvoice | null> {
  const { data, error } = await admin
    .from('event_kickback_agreements')
    .select(
      [
        'id',
        'event_id',
        'plan_id',
        'venue_id',
        'builder_id',
        'venue_owner_id',
        'actual_attendance',
        'actual_qualified_attendance',
        'attendance_extracted_value',
        'attendance_proof_url',
        'reported_revenue_cents',
        'bar_revenue_share_percent',
        'ticket_revenue_share_percent',
        'lift_share_percentage',
        'per_head_amount',
        'minimum_attendees',
        'maximum_payout',
        'venue_approved',
        'venue_approved_at',
        'disputed_at',
      ].join(', ')
    )
    .eq('id', agreementId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load kickback agreement')
  return (data as KickbackAgreementForInvoice | null) ?? null
}

async function loadVenueForInvoice(admin: any, venueId: string): Promise<VenueForInvoice | null> {
  const { data, error } = await admin
    .from('venues')
    .select('id, venue_name, venue_type, contact_email, owner_id, stripe_customer_id')
    .eq('id', venueId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load venue')
  return (data as VenueForInvoice | null) ?? null
}

async function loadValidatedBuilderStripeAccount(admin: any, builderUserId: string) {
  const { data: builderAccount, error: builderAccountError } = await admin
    .from('builder_stripe_accounts')
    .select('stripe_account_id, account_status, payouts_enabled')
    .eq('user_id', builderUserId)
    .maybeSingle()

  if (builderAccountError) throw new Error(builderAccountError.message)

  if (!builderAccount?.stripe_account_id) {
    return {
      accountId: null,
      errorResponse: NextResponse.json(
        {
          error: 'The event builder needs to reconnect Stripe before receiving payouts.',
          code: 'builder_requires_reconnect',
          onboarding_required: true,
        },
        { status: 409 }
      ),
    }
  }

  const stripe = getStripeClient()
  const validation = await validateStripeConnectAccount({
    stripe,
    db: admin as any,
    table: 'builder_stripe_accounts',
    rowId: builderUserId,
    currentAccountId: builderAccount.stripe_account_id,
  })

  if (validation.mismatchCleared || !validation.accountId) {
    return {
      accountId: null,
      errorResponse: NextResponse.json(
        {
          error: 'The event builder needs to reconnect Stripe before receiving payouts.',
          code: 'builder_requires_reconnect',
          onboarding_required: true,
          reason: 'stripe_mode_mismatch',
        },
        { status: 409 }
      ),
    }
  }

  if (!builderAccount.payouts_enabled || isConnectedStripeAccountBlocked(builderAccount.account_status)) {
    return {
      accountId: null,
      errorResponse: NextResponse.json(
        { error: 'The event builder has not finished payout setup yet.' },
        { status: 400 }
      ),
    }
  }

  return { accountId: validation.accountId, errorResponse: null }
}

async function getOrCreateVenueCustomer({
  admin,
  stripe,
  venue,
  fallbackEmail,
  metadata,
}: {
  admin: any
  stripe: ReturnType<typeof getStripeClient>
  venue: VenueForInvoice
  fallbackEmail: string | null
  metadata?: Record<string, string>
}) {
  if (venue.stripe_customer_id) {
    try {
      const existingCustomer = await stripe.customers.retrieve(venue.stripe_customer_id)
      if (!existingCustomer.deleted) return existingCustomer.id
    } catch (error) {
      if (!isMissingStripeCustomerError(error)) throw error

      console.warn('[venue.community-host-incentive.checkout] Replacing stale Stripe customer id for active Stripe mode', {
        venueId: venue.id,
        staleCustomerId: venue.stripe_customer_id,
      })
    }
  }

  const customer = await stripe.customers.create({
    email: venue.contact_email || fallbackEmail || undefined,
    name: venue.venue_name || undefined,
    metadata: metadata ?? {
      venue_id: venue.id,
      payment_kind_namespace: 'venue_builder_kickback',
    },
  })

  await admin
    .from('venues')
    .update({ stripe_customer_id: customer.id, updated_at: new Date().toISOString() })
    .eq('id', venue.id)

  return customer.id
}

function isMissingStripeCustomerError(error: unknown) {
  if (!error || typeof error !== 'object') return false

  const stripeError = error as {
    code?: string
    raw?: { code?: string }
    message?: string
  }

  const code = stripeError.code ?? stripeError.raw?.code
  return code === 'resource_missing' && /no such customer/i.test(stripeError.message ?? '')
}

async function loadInvoiceEventLabel(admin: any, agreement: KickbackAgreementForInvoice) {
  if (agreement.event_id) {
    const { data, error } = await admin
      .from('events')
      .select('event_name, event_date')
      .eq('id', agreement.event_id)
      .maybeSingle()

    if (error) throw new Error(error.message ?? 'Failed to load event')
    return {
      title: (data as { event_name?: string | null } | null)?.event_name || 'event',
      date: (data as { event_date?: string | null } | null)?.event_date ?? null,
    }
  }

  if (agreement.plan_id) {
    const { data, error } = await admin
      .from('plans')
      .select('title, date_window_start')
      .eq('id', agreement.plan_id)
      .maybeSingle()

    if (error) throw new Error(error.message ?? 'Failed to load plan')
    return {
      title: (data as { title?: string | null } | null)?.title || 'event',
      date: (data as { date_window_start?: string | null } | null)?.date_window_start ?? null,
    }
  }

  return { title: 'event', date: null }
}

function getSettlementLabel(agreement: KickbackAgreementForInvoice) {
  const barShare = readPositiveNumber(agreement.bar_revenue_share_percent)
  if (barShare > 0) return `${barShare}% bar sales incentive`

  const ticketShare = readPositiveNumber(agreement.ticket_revenue_share_percent)
  if (ticketShare > 0) return `${ticketShare}% ticket share`

  const liftShare = readPositiveNumber(agreement.lift_share_percentage)
  if (liftShare > 0) return `${liftShare}% sales lift share`

  const perHeadCents = dollarsToCents(agreement.per_head_amount)
  if (perHeadCents > 0) return `${formatCents(perHeadCents)} per attendee`

  return 'approved Community Host Incentive'
}

function readPositiveNumber(value: number | string | null | undefined) {
  const numeric = typeof value === 'string' ? Number(value) : value
  return typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0 ? numeric : 0
}

function formatCents(value: number | string | null | undefined) {
  return `$${centsToDollars(value).toFixed(2)}`
}
