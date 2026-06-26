export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { z } from 'zod'
import { validateStripeConnectAccount } from '@/lib/billing/stripeConnectGuard'
import { dollarsToCents, toFiniteNumber } from '@/lib/money'
import { calculateVenueRentalProcessingFeeCents } from '@/lib/payments/venue-rental'
import {
  PAYMENT_APPROVAL_SELECT_COLUMNS,
  validatePaymentApprovalForExecution,
  type PaymentApprovalRow,
} from '@/lib/planner/execution/paymentApproval'
import {
  checkStripeReadinessForAuthorization,
  getStripeGateErrorMessage,
} from '@/lib/planner/stripeReadinessGate'
import { notifyEntityStripeSetup } from '@/lib/server/notifyEntityStripeSetup'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAppBaseUrl, getStripeClient, isConnectedStripeAccountBlocked } from '@/lib/stripe/connect'

const PAYMENT_NAMESPACE = 'venue_rental'
const MIN_AMOUNT_CENTS = 50
const MAX_AMOUNT_CENTS = 5_000_000
const ACTIVE_CHECKOUT_STATUSES = ['pending_builder_payment', 'checkout_created'] as const

const paramsSchema = z.object({
  planId: z.string().uuid(),
})

const checkoutSchema = z.object({
  venue_booking_id: z.string().uuid(),
  approval_id: z.string().uuid(),
  payment_method_type: z.enum(['card', 'us_bank_account']),
}).strict()

type PlannerDb = ReturnType<typeof createServiceRoleClient>

type PlanRow = {
  id: string
  user_id: string
}

type VenueBookingRow = {
  id: string
  venue_id: string
  organizer_id: string
  status: string | null
  final_price: number | string | null
  quoted_price: number | string | null
  total_amount: number | string | null
}

type VenueRow = {
  id: string
  venue_name: string | null
  owner_id: string | null
}

type VenueStripeAccountRow = {
  stripe_account_id: string | null
  account_status: string | null
  payouts_enabled: boolean | null
}

type VenuePaymentTransactionRow = {
  id: string
  plan_id: string
  approval_id: string | null
  venue_booking_id: string | null
  builder_id: string
  venue_id: string
  venue_owner_id: string
  amount_cents: number
  processing_fee_cents: number
  application_fee_cents: number
  venue_payout_cents: number
  currency: string
  status: string
  payment_method_type: PaymentMethodType
  stripe_checkout_session_id: string | null
}

type PaymentMethodType = 'card' | 'us_bank_account'

type SupabaseErrorLike = {
  code?: string
  message?: string
}

type CheckoutResponse = {
  hosted_checkout_url: string
  transaction_id: string
  amount_cents: number
  processing_fee_cents: number
  payment_method_type: PaymentMethodType
  total_cents: number
}

/**
 * Creates or reuses a Stripe Checkout Session for a confirmed venue booking.
 *
 * Payment-method and fee decision: the planner UI must collect the builder's
 * payment method before calling this route. The route then computes the exact
 * processing fee for that selected method, writes payment_method_type +
 * processing_fee_cents on the transaction row, and creates Checkout with a
 * single payment_method_types entry so the builder cannot switch methods inside
 * Stripe and create a fee mismatch. Re-selecting another method reuses the same
 * transaction row and replaces fee/method/session fields before creating a new
 * Checkout Session.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> }
): Promise<NextResponse<CheckoutResponse | Record<string, unknown>>> {
  try {
    const parsedParams = paramsSchema.safeParse((await context.params))
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid plan id' }, { status: 400 })
    }

    const parsedBody = checkoutSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    if (user.user_metadata?.user_type !== 'community_builder') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const admin = createServiceRoleClient()
    const plan = await loadPlan(admin, parsedParams.data.planId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (plan.user_id !== user.id) return NextResponse.json({ error: 'Not authorized for this plan' }, { status: 403 })

    const booking = await loadVenueBooking(admin, parsedBody.data.venue_booking_id)
    if (!booking) return NextResponse.json({ error: 'Venue booking not found' }, { status: 404 })
    if (booking.organizer_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized for this venue booking' }, { status: 403 })
    }
    if (booking.status !== 'confirmed') {
      return NextResponse.json({ error: 'venue_booking_not_confirmed' }, { status: 409 })
    }

    const amountCents = resolveVenueBookingAmountCents(booking)
    if (amountCents < MIN_AMOUNT_CENTS) {
      return NextResponse.json({ error: 'amount_below_minimum' }, { status: 422 })
    }
    if (amountCents > MAX_AMOUNT_CENTS) {
      return NextResponse.json(
        {
          error: 'amount_exceeds_max',
          concierge_review_required: true,
          max_amount_cents: MAX_AMOUNT_CENTS,
        },
        { status: 409 }
      )
    }

    const approval = await loadPaymentApproval(admin, parsedBody.data.approval_id)
    const approvalValidation = validatePaymentApprovalForExecution({
      approval,
      expectedAmountCents: amountCents,
      expectedPlanId: plan.id,
    })
    if (!approvalValidation.ok) {
      return NextResponse.json({ error: approvalValidation.error }, { status: approvalValidation.status })
    }
    const approvedApproval = approval as PaymentApprovalRow

    const venue = await loadVenue(admin, booking.venue_id)
    if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 })
    if (!venue.owner_id) return venueConciergeResponse()

    const readinessGate = await checkStripeReadinessForAuthorization({
      supabase: admin,
      entityType: 'venue',
      entityId: venue.id,
    })
    if (!readinessGate.ready) {
      notifyEntityStripeSetup({
        supabase: admin,
        entityType: 'venue',
        entityId: venue.id,
        planId: plan.id,
        organizerId: user.id,
        reason: readinessGate.reason,
      }).catch((notifyError) => {
        console.error('[planner.venue-payment.checkout] Stripe setup notification failed', notifyError)
      })

      if (readinessGate.reason === 'no_account') return venueConciergeResponse()

      return NextResponse.json(
        {
          error: getStripeGateErrorMessage({
            entityType: 'venue',
            entityName: venue.venue_name,
            reason: readinessGate.reason,
          }),
          code: 'stripe_recipient_not_ready',
          stripe_gate: readinessGate,
        },
        { status: 409 }
      )
    }

    const stripe = getStripeClient()
    const account = await loadVenueStripeAccount(admin, venue.owner_id)
    const connectedAccountId = await resolveVenueStripeAccount({
      admin,
      stripe,
      ownerId: venue.owner_id,
      account,
    })
    if (!connectedAccountId) return venueConciergeResponse()

    const paymentMethodType = parsedBody.data.payment_method_type
    const processingFeeCents = calculateProcessingFeeCents(amountCents, paymentMethodType)
    const existingTransaction = await loadActiveTransaction(admin, plan.id, booking.id)
    let transaction = existingTransaction ?? (await insertVenuePaymentTransaction(admin, {
      planId: plan.id,
      booking,
      builderId: user.id,
      venueOwnerId: venue.owner_id,
      amountCents,
      processingFeeCents,
      paymentMethodType,
      approvalId: approvedApproval.id,
    }))

    const canReuseExistingSession =
      transaction.stripe_checkout_session_id &&
      transaction.amount_cents === amountCents &&
      transaction.approval_id === approvedApproval.id &&
      transaction.processing_fee_cents === processingFeeCents &&
      transaction.payment_method_type === paymentMethodType

    if (canReuseExistingSession && transaction.stripe_checkout_session_id) {
      const reusable = await getReusableCheckoutSession(stripe, transaction.stripe_checkout_session_id)
      if (reusable?.url) {
        return checkoutResponse(reusable.url, transaction)
      }
    }

    if (transaction.stripe_checkout_session_id) {
      await expireCheckoutSessionIfOpen(stripe, transaction.stripe_checkout_session_id)
    }

    if (
      transaction.amount_cents !== amountCents ||
      transaction.approval_id !== approvedApproval.id ||
      transaction.processing_fee_cents !== processingFeeCents ||
      transaction.payment_method_type !== paymentMethodType ||
      transaction.stripe_checkout_session_id
    ) {
      transaction = await updateTransactionForSelectedMethod(admin, transaction.id, {
        amountCents,
        processingFeeCents,
        paymentMethodType,
        approvalId: approvedApproval.id,
      })
    }

    const session = await createCheckoutSession({
      request,
      stripe,
      transaction,
      planId: plan.id,
      bookingId: booking.id,
      venue,
      builderId: user.id,
      venueOwnerId: venue.owner_id,
      connectedAccountId,
    })

    if (!session.url) {
      throw new Error('Stripe did not return a hosted Checkout URL')
    }

    const updatedTransaction = await updateTransactionWithCheckout(admin, transaction.id, session.id)
    return checkoutResponse(session.url, updatedTransaction)
  } catch (error) {
    if (isUniqueViolation(error)) {
      console.error('[planner.venue-payment.checkout] Unique constraint recovery failed', error)
      return NextResponse.json({ error: 'Payment checkout is already being created. Please try again.' }, { status: 409 })
    }

    console.error('[planner.venue-payment.checkout] Failed to create venue rental checkout', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to start venue rental checkout' },
      { status: 500 }
    )
  }
}

async function loadPlan(db: PlannerDb, planId: string): Promise<PlanRow | null> {
  const { data, error } = await db
    .from('plans')
    .select('id, user_id')
    .eq('id', planId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as PlanRow | null) ?? null
}

async function loadVenueBooking(db: PlannerDb, bookingId: string): Promise<VenueBookingRow | null> {
  const { data, error } = await db
    .from('venue_bookings')
    .select('id, venue_id, organizer_id, status, final_price, quoted_price, total_amount')
    .eq('id', bookingId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as VenueBookingRow | null) ?? null
}

async function loadVenue(db: PlannerDb, venueId: string): Promise<VenueRow | null> {
  const { data, error } = await db
    .from('venues')
    .select('id, venue_name, owner_id')
    .eq('id', venueId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as VenueRow | null) ?? null
}

async function loadVenueStripeAccount(db: PlannerDb, ownerId: string): Promise<VenueStripeAccountRow | null> {
  const { data, error } = await db
    .from('venue_stripe_accounts')
    .select('stripe_account_id, account_status, payouts_enabled')
    .eq('owner_id', ownerId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as VenueStripeAccountRow | null) ?? null
}

async function loadPaymentApproval(db: PlannerDb, approvalId: string): Promise<PaymentApprovalRow | null> {
  const { data, error } = await db
    .from('approvals')
    .select(PAYMENT_APPROVAL_SELECT_COLUMNS)
    .eq('id', approvalId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as PaymentApprovalRow | null
}

async function resolveVenueStripeAccount({
  admin,
  stripe,
  ownerId,
  account,
}: {
  admin: PlannerDb
  stripe: ReturnType<typeof getStripeClient>
  ownerId: string
  account: VenueStripeAccountRow | null
}) {
  if (!account?.stripe_account_id || !account.payouts_enabled || isConnectedStripeAccountBlocked(account.account_status)) {
    return null
  }

  const validation = await validateStripeConnectAccount({
    stripe,
    db: admin,
    table: 'venue_stripe_accounts',
    rowId: ownerId,
    currentAccountId: account.stripe_account_id,
  })

  if (validation.mismatchCleared || !validation.accountId) return null
  if (validation.account && !validation.account.payouts_enabled) return null
  return validation.accountId
}

function resolveVenueBookingAmountCents(booking: VenueBookingRow) {
  for (const value of [booking.final_price, booking.quoted_price, booking.total_amount]) {
    if (toFiniteNumber(value) !== null) return dollarsToCents(value)
  }
  return 0
}

function calculateProcessingFeeCents(amountCents: number, paymentMethodType: PaymentMethodType) {
  return calculateVenueRentalProcessingFeeCents(amountCents, paymentMethodType)
}

async function loadActiveTransaction(
  db: PlannerDb,
  planId: string,
  bookingId: string
): Promise<VenuePaymentTransactionRow | null> {
  const { data, error } = await db
    .from('venue_payment_transactions')
    .select('*')
    .eq('plan_id', planId)
    .eq('venue_booking_id', bookingId)
    .in('status', [...ACTIVE_CHECKOUT_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as VenuePaymentTransactionRow | null) ?? null
}

async function loadTransactionByPlanBooking(
  db: PlannerDb,
  planId: string,
  bookingId: string
): Promise<VenuePaymentTransactionRow | null> {
  const { data, error } = await db
    .from('venue_payment_transactions')
    .select('*')
    .eq('plan_id', planId)
    .eq('venue_booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as VenuePaymentTransactionRow | null) ?? null
}

async function insertVenuePaymentTransaction(
  db: PlannerDb,
  input: {
    planId: string
    booking: VenueBookingRow
    builderId: string
    venueOwnerId: string
    amountCents: number
    processingFeeCents: number
    paymentMethodType: PaymentMethodType
    approvalId: string
  }
): Promise<VenuePaymentTransactionRow> {
  const { data, error } = await db
    .from('venue_payment_transactions')
    .insert({
      plan_id: input.planId,
      approval_id: input.approvalId,
      venue_booking_id: input.booking.id,
      builder_id: input.builderId,
      venue_id: input.booking.venue_id,
      venue_owner_id: input.venueOwnerId,
      amount_cents: input.amountCents,
      processing_fee_cents: input.processingFeeCents,
      application_fee_cents: 0,
      venue_payout_cents: input.amountCents,
      currency: 'usd',
      status: 'pending_builder_payment',
      payment_method_type: input.paymentMethodType,
    } as never)
    .select('*')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      const existing = await loadTransactionByPlanBooking(db, input.planId, input.booking.id)
      if (existing && ACTIVE_CHECKOUT_STATUSES.includes(existing.status as typeof ACTIVE_CHECKOUT_STATUSES[number])) {
        return existing
      }
    }
    throw error
  }

  return data as unknown as VenuePaymentTransactionRow
}

async function updateTransactionForSelectedMethod(
  db: PlannerDb,
  transactionId: string,
  input: {
    amountCents: number
    processingFeeCents: number
    paymentMethodType: PaymentMethodType
    approvalId: string
  }
): Promise<VenuePaymentTransactionRow> {
  const { data, error } = await db
    .from('venue_payment_transactions')
    .update({
      amount_cents: input.amountCents,
      approval_id: input.approvalId,
      processing_fee_cents: input.processingFeeCents,
      venue_payout_cents: input.amountCents,
      application_fee_cents: 0,
      payment_method_type: input.paymentMethodType,
      status: 'pending_builder_payment',
      stripe_checkout_session_id: null,
    } as never)
    .eq('id', transactionId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data as unknown as VenuePaymentTransactionRow
}

async function getReusableCheckoutSession(stripe: ReturnType<typeof getStripeClient>, sessionId: string) {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    const expiresAtMs = typeof session.expires_at === 'number' ? session.expires_at * 1000 : 0
    const isOpen = !session.status || session.status === 'open'
    return session.url && isOpen && expiresAtMs > Date.now() ? session : null
  } catch (error) {
    console.warn('[planner.venue-payment.checkout] Unable to retrieve existing Checkout Session', {
      sessionId,
      error,
    })
    return null
  }
}

async function expireCheckoutSessionIfOpen(stripe: ReturnType<typeof getStripeClient>, sessionId: string) {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (!session.status || session.status === 'open') {
      await stripe.checkout.sessions.expire(sessionId)
    }
  } catch (error) {
    console.warn('[planner.venue-payment.checkout] Unable to expire replaced Checkout Session', {
      sessionId,
      error,
    })
  }
}

async function createCheckoutSession({
  request,
  stripe,
  transaction,
  planId,
  bookingId,
  venue,
  builderId,
  venueOwnerId,
  connectedAccountId,
}: {
  request: NextRequest
  stripe: ReturnType<typeof getStripeClient>
  transaction: VenuePaymentTransactionRow
  planId: string
  bookingId: string
  venue: VenueRow
  builderId: string
  venueOwnerId: string
  connectedAccountId: string
}): Promise<Stripe.Checkout.Session> {
  const baseUrl = getAppBaseUrl(request)
  const metadata = {
    payment_kind_namespace: PAYMENT_NAMESPACE,
    venue_payment_transaction_id: transaction.id,
    approval_id: transaction.approval_id ?? '',
    plan_id: planId,
    venue_booking_id: bookingId,
    venue_id: venue.id,
    venue_owner_id: venueOwnerId,
    builder_id: builderId,
    payment_method_type: transaction.payment_method_type,
    processing_fee_cents: String(transaction.processing_fee_cents),
  }

  return stripe.checkout.sessions.create(
    {
      mode: 'payment',
      payment_method_types: [transaction.payment_method_type],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: transaction.amount_cents,
            product_data: {
              name: `Venue rental - ${venue.venue_name || 'confirmed venue'}`,
              metadata,
            },
          },
        },
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: transaction.processing_fee_cents,
            product_data: {
              name: 'Processing fee',
              metadata: {
                ...metadata,
                item_type: 'processing_fee',
              },
            },
          },
        },
      ],
      payment_intent_data: {
        application_fee_amount: 0,
        transfer_data: {
          destination: connectedAccountId,
          amount: transaction.amount_cents,
        },
        metadata,
      },
      metadata,
      success_url: `${baseUrl}/planner?planId=${encodeURIComponent(planId)}&venue_rental=success&transaction=${encodeURIComponent(transaction.id)}`,
      cancel_url: `${baseUrl}/planner?planId=${encodeURIComponent(planId)}&venue_rental=cancelled&transaction=${encodeURIComponent(transaction.id)}`,
    },
    {
      idempotencyKey: `venue_rental_checkout_${transaction.id}_${transaction.payment_method_type}_${transaction.amount_cents}_${transaction.processing_fee_cents}`,
    }
  )
}

async function updateTransactionWithCheckout(
  db: PlannerDb,
  transactionId: string,
  sessionId: string
): Promise<VenuePaymentTransactionRow> {
  const { data, error } = await db
    .from('venue_payment_transactions')
    .update({
      status: 'checkout_created',
      stripe_checkout_session_id: sessionId,
    } as never)
    .eq('id', transactionId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data as unknown as VenuePaymentTransactionRow
}

function checkoutResponse(url: string, transaction: VenuePaymentTransactionRow) {
  return NextResponse.json({
    hosted_checkout_url: url,
    transaction_id: transaction.id,
    amount_cents: transaction.amount_cents,
    processing_fee_cents: transaction.processing_fee_cents,
    payment_method_type: transaction.payment_method_type,
    total_cents: transaction.amount_cents + transaction.processing_fee_cents,
  })
}

function venueConciergeResponse() {
  return NextResponse.json(
    {
      error: 'venue_concierge_required',
      concierge_required: true,
    },
    { status: 409 }
  )
}

function isUniqueViolation(error: unknown) {
  const candidate = error as SupabaseErrorLike | null
  return (candidate?.code === '23505' || /duplicate key|unique constraint/i.test(candidate?.message ?? ''));
}
