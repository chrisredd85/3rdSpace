export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { sendVenueInvoiceEmail } from '@/lib/email'
import { centsToDollars } from '@/lib/money'
import { dollarsToCents } from '@/lib/payments/vendor-payments'
import { validateStripeConnectAccount } from '@/lib/billing/stripeConnectGuard'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAppBaseUrl, getAuthenticatedVenueOwner, getStripeClient } from '@/lib/stripe/connect'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  paymentId: z.string().uuid(),
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
  reported_revenue_cents: number | null
  bar_revenue_share_percent: number | string | null
  ticket_revenue_share_percent: number | string | null
  lift_share_percentage: number | string | null
  per_head_amount: number | string | null
}

type VenueForInvoice = {
  id: string
  venue_name: string | null
  contact_email: string | null
  owner_id: string | null
  stripe_customer_id?: string | null
}

/**
 * Creates a Stripe Checkout session for a venue-to-builder kickback payment.
 */
export async function POST(
  request: NextRequest,
  context: { params: { paymentId: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid kickback payment id' }, { status: 400 })
    }

    const supabase = createClient()
    const auth = await getAuthenticatedVenueOwner(supabase)

    if (auth.error || !auth.user || !auth.owner) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createServiceRoleClient()
    const { data: paymentRow, error: paymentError } = await (admin as any)
      .from('kickback_payments')
      .select('id, agreement_id, event_id, payer_id, recipient_id, amount, amount_cents, currency, status, settlement_method, events(event_name)')
      .eq('id', parsedParams.data.paymentId)
      .maybeSingle()

    if (paymentError) throw new Error(paymentError.message)
    if (!paymentRow) return NextResponse.json({ error: 'Kickback payment not found' }, { status: 404 })

    const payment = paymentRow as KickbackPaymentForCheckout
    if (payment.payer_id !== auth.owner.id) {
      return NextResponse.json({ error: 'Not authorized for this kickback payment' }, { status: 403 })
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
      return NextResponse.json({ error: 'This kickback payment is not payable right now' }, { status: 400 })
    }

    if (Number(payment.amount || 0) <= 0) {
      return NextResponse.json({ error: 'Kickback amount must be greater than zero' }, { status: 400 })
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

    if (!builderAccount.payouts_enabled || builderAccount.account_status === 'restricted') {
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
              unit_amount: dollarsToCents(Number(payment.amount)),
              product_data: {
                name: `3rdPlace kickback: ${eventName}`,
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
        success_url: `${baseUrl}/venue/payouts?kickback=success&payment=${payment.id}`,
        cancel_url: `${baseUrl}/venue/payouts?kickback=cancelled&payment=${payment.id}`,
      },
      {
        idempotencyKey: `kickback_checkout_${payment.id}_${payment.amount}`,
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
    console.error('[venue.kickbacks.checkout] Failed to create kickback checkout', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to start kickback payment' },
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
    return NextResponse.json({ error: 'This kickback payment is not ready for invoicing' }, { status: 400 })
  }

  const principalCents = Math.round(Number(payment.amount_cents ?? 0))
  if (principalCents <= 0) {
    return NextResponse.json({ error: 'Kickback amount must be greater than zero' }, { status: 400 })
  }

  const agreement = await loadAgreementForInvoice(admin, payment.agreement_id)
  if (!agreement) {
    return NextResponse.json({ error: 'Kickback agreement not found' }, { status: 404 })
  }

  const venue = await loadVenueForInvoice(admin, agreement.venue_id)
  if (!venue) {
    return NextResponse.json({ error: 'Venue not found for kickback invoice' }, { status: 404 })
  }

  if (venue.owner_id && venue.owner_id !== payment.payer_id) {
    return NextResponse.json({ error: 'Not authorized for this venue kickback' }, { status: 403 })
  }

  const { accountId, errorResponse } = await loadValidatedBuilderStripeAccount(admin, payment.recipient_id)
  if (errorResponse) return errorResponse

  const stripe = getStripeClient()
  const customerId = await getOrCreateVenueCustomer({
    admin,
    stripe,
    venue,
    fallbackEmail: venueOwnerEmail,
  })
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

  await stripe.invoiceItems.create({
    customer: customerId,
    amount: principalCents,
    currency: payment.currency || 'usd',
    description: `Revenue share for "${eventLabel.title}" - ${percentLabel} of ${formatCents(reportedRevenueCents)}`,
    metadata: { kickback_payment_id: payment.id, settlement_method: 'invoice', item_type: 'principal' },
  })

  await stripe.invoiceItems.create({
    customer: customerId,
    amount: achFeeCents,
    currency: payment.currency || 'usd',
    description: 'Payment processing fee (ACH)',
    metadata: { kickback_payment_id: payment.id, settlement_method: 'invoice', item_type: 'processing_fee' },
  })

  const invoice = await stripe.invoices.create({
    customer: customerId,
    collection_method: 'send_invoice',
    days_until_due: 7,
    payment_settings: {
      payment_method_types: ['us_bank_account', 'card'],
    },
    metadata,
  } as any)
  const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id)
  const sentInvoice = await stripe.invoices.sendInvoice(finalizedInvoice.id)
  const dueDate = sentInvoice.due_date ?? finalizedInvoice.due_date ?? null
  const hostedInvoiceUrl = sentInvoice.hosted_invoice_url ?? finalizedInvoice.hosted_invoice_url ?? null
  const now = new Date().toISOString()

  await admin
    .from('kickback_payments')
    .update({
      status: 'invoice_sent',
      stripe_invoice_id: sentInvoice.id,
      invoice_hosted_url: hostedInvoiceUrl,
      processing_fee_cents: achFeeCents,
      due_date: dueDate ? new Date(dueDate * 1000).toISOString() : null,
      initiated_at: now,
      failure_reason: null,
      updated_at: now,
    })
    .eq('id', payment.id)

  await admin
    .from('event_kickback_agreements')
    .update({
      status: 'payment_pending',
      updated_at: now,
    })
    .eq('id', payment.agreement_id)

  await sendVenueInvoiceEmail({ paymentId: payment.id }).catch((error) => {
    console.error('[venue.kickbacks.checkout] Failed to send venue invoice email', error)
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

async function loadAgreementForInvoice(admin: any, agreementId: string): Promise<KickbackAgreementForInvoice | null> {
  const { data, error } = await admin
    .from('event_kickback_agreements')
    .select(
      [
        'id',
        'event_id',
        'plan_id',
        'venue_id',
        'reported_revenue_cents',
        'bar_revenue_share_percent',
        'ticket_revenue_share_percent',
        'lift_share_percentage',
        'per_head_amount',
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
    .select('id, venue_name, contact_email, owner_id, stripe_customer_id')
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

  if (!builderAccount.payouts_enabled || builderAccount.account_status === 'restricted') {
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
}: {
  admin: any
  stripe: ReturnType<typeof getStripeClient>
  venue: VenueForInvoice
  fallbackEmail: string | null
}) {
  if (venue.stripe_customer_id) return venue.stripe_customer_id

  const customer = await stripe.customers.create({
    email: venue.contact_email || fallbackEmail || undefined,
    name: venue.venue_name || undefined,
    metadata: {
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
  if (barShare > 0) return `${barShare}% bar revenue share`

  const ticketShare = readPositiveNumber(agreement.ticket_revenue_share_percent)
  if (ticketShare > 0) return `${ticketShare}% ticket revenue share`

  const liftShare = readPositiveNumber(agreement.lift_share_percentage)
  if (liftShare > 0) return `${liftShare}% sales lift share`

  const perHeadCents = dollarsToCents(agreement.per_head_amount)
  if (perHeadCents > 0) return `${formatCents(perHeadCents)} per attendee`

  return 'agreed revenue share'
}

function readPositiveNumber(value: number | string | null | undefined) {
  const numeric = typeof value === 'string' ? Number(value) : value
  return typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0 ? numeric : 0
}

function formatCents(value: number | string | null | undefined) {
  return `$${centsToDollars(value).toFixed(2)}`
}
