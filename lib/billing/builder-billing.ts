import 'server-only'

import Stripe from 'stripe'
import { getAppBaseUrl, getStripeClient } from '@/lib/stripe/connect'

export type BuilderBillingTier = 'free_trial' | 'pay_per_event' | 'pro_monthly' | 'pro_annual'
export type BuilderCheckoutType = 'pay_per_event' | 'pro_monthly' | 'pro_annual'

export const BUILDER_BILLING_PRICES = {
  freeEventsGranted: 1,
  payPerEventAmount: getConfiguredPrice('PLATFORM_FEE_PER_EVENT', 30),
  proMonthlyAmount: getConfiguredPrice('PLATFORM_FEE_PRO_MONTHLY', 69),
  proAnnualAmount: getConfiguredPrice('PLATFORM_FEE_PRO_ANNUAL', 690),
}

export type BuilderBillingProfile = {
  id: string
  user_id: string
  name?: string | null
  billing_tier?: BuilderBillingTier | null
  subscription_status?: string | null
  subscription_started_at?: string | null
  subscription_ends_at?: string | null
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  free_events_granted?: number | null
  free_events_used?: number | null
  paid_event_credits?: number | null
}

export class BuilderBillingRequiredError extends Error {
  status = 402

  constructor() {
    super('Choose pay-per-event or Pro to create another event.')
  }
}

const BUILDER_BILLING_SELECT = `
  id,
  user_id,
  name,
  billing_tier,
  subscription_status,
  subscription_started_at,
  subscription_ends_at,
  stripe_customer_id,
  stripe_subscription_id,
  free_events_granted,
  free_events_used,
  paid_event_credits
`

const LEGACY_BUILDER_SELECT = 'id, user_id, name'

export function isBuilderBillingSchemaDriftError(error: unknown) {
  if (!error || typeof error !== 'object') return false

  const maybeError = error as { code?: string; message?: string; details?: string; hint?: string }
  const text = [maybeError.message, maybeError.details, maybeError.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return (
    maybeError.code === '42703' ||
    maybeError.code === 'PGRST204' ||
    maybeError.code === 'PGRST205' ||
    /billing_tier|free_events_|paid_event_credits|builder_event_usage|schema cache|does not exist/.test(text)
  )
}

async function loadBuilderBillingProfile(
  supabase: any,
  column: 'id' | 'user_id',
  value: string
) {
  const result = await supabase
    .from('builder_profiles')
    .select(BUILDER_BILLING_SELECT)
    .eq(column, value)
    .maybeSingle()

  if (!result.error || !isBuilderBillingSchemaDriftError(result.error)) {
    return result
  }

  console.warn('[builder.billing] Falling back to legacy builder profile shape', result.error)

  return supabase
    .from('builder_profiles')
    .select(LEGACY_BUILDER_SELECT)
    .eq(column, value)
    .maybeSingle()
}

export function loadBuilderBillingProfileById(supabase: any, builderId: string) {
  return loadBuilderBillingProfile(supabase, 'id', builderId)
}

export function loadBuilderBillingProfileByUserId(supabase: any, userId: string) {
  return loadBuilderBillingProfile(supabase, 'user_id', userId)
}

function getPriceId(type: BuilderCheckoutType) {
  if (type === 'pay_per_event') {
    return process.env.STRIPE_PRICE_PAY_PER_EVENT || process.env.STRIPE_PAY_PER_EVENT_PRICE_ID
  }

  if (type === 'pro_monthly') {
    return process.env.STRIPE_PRICE_PRO_MONTHLY || process.env.STRIPE_BUILDER_PRO_MONTHLY_PRICE_ID
  }

  if (type === 'pro_annual') {
    return process.env.STRIPE_PRICE_PRO_ANNUAL || process.env.STRIPE_BUILDER_PRO_ANNUAL_PRICE_ID
  }

  return null
}

export function getBuilderStripePriceId(type: Extract<BuilderCheckoutType, 'pro_monthly' | 'pro_annual'>) {
  return getPriceId(type)
}

function getConfiguredPrice(envKey: string, fallback: number) {
  const parsed = Number(process.env[envKey])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function getTierLabel(type: BuilderBillingTier) {
  if (type === 'pro_monthly') return 'Pro Monthly'
  if (type === 'pro_annual') return 'Annual Pro'
  if (type === 'pay_per_event') return 'Pay Per Event'
  return 'Free Trial'
}

function getFeeType(type: BuilderCheckoutType) {
  if (type === 'pro_monthly') return 'subscription_monthly'
  if (type === 'pro_annual') return 'subscription_annual'
  return 'per_event'
}

function getBillingAmount(type: BuilderCheckoutType) {
  if (type === 'pro_monthly') return BUILDER_BILLING_PRICES.proMonthlyAmount
  if (type === 'pro_annual') return BUILDER_BILLING_PRICES.proAnnualAmount
  return BUILDER_BILLING_PRICES.payPerEventAmount
}

export function getBuilderBillingAmount(type: BuilderCheckoutType) {
  return getBillingAmount(type)
}

function subscriptionStatusToProfileStatus(status: string | null | undefined) {
  if (status === 'active' || status === 'trialing') return 'active'
  if (status === 'past_due' || status === 'unpaid') return 'past_due'
  if (status === 'incomplete') return 'incomplete'
  return 'cancelled'
}

function isPro(profile: BuilderBillingProfile) {
  return (
    (profile.billing_tier === 'pro_monthly' || profile.billing_tier === 'pro_annual') &&
    profile.subscription_status === 'active'
  )
}

export function getBuilderBillingSummary(profile: BuilderBillingProfile) {
  const freeEventsGranted = profile.free_events_granted ?? BUILDER_BILLING_PRICES.freeEventsGranted
  const freeEventsUsed = profile.free_events_used ?? 0
  const paidEventCredits = profile.paid_event_credits ?? 0
  const freeEventsRemaining = Math.max(freeEventsGranted - freeEventsUsed, 0)
  const hasProAccess = isPro(profile)

  return {
    tier: profile.billing_tier || 'free_trial',
    tierLabel: getTierLabel(profile.billing_tier || 'free_trial'),
    subscriptionStatus: profile.subscription_status || 'trial',
    freeEventsGranted,
    freeEventsUsed,
    freeEventsRemaining,
    paidEventCredits,
    hasProAccess,
    canCreateEvent: hasProAccess || freeEventsRemaining > 0 || paidEventCredits > 0,
    prices: BUILDER_BILLING_PRICES,
  }
}

export async function getAuthenticatedBuilderBillingProfile(supabase: any) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { user: null, builder: null, error: 'Not authenticated', status: 401 }
  }

  const { data: builder, error } = await loadBuilderBillingProfileByUserId(supabase, user.id)

  if (error) {
    return { user, builder: null, error: 'Failed to load builder billing profile', status: 500 }
  }

  if (!builder) {
    return { user, builder: null, error: 'Builder profile not found', status: 404 }
  }

  return { user, builder: builder as BuilderBillingProfile, error: null, status: 200 }
}

export async function ensureStripeCustomerForBuilder(params: {
  admin: any
  builder: BuilderBillingProfile
  email?: string | null
}) {
  if (params.builder.stripe_customer_id) return params.builder.stripe_customer_id

  const stripe = getStripeClient()
  const customer = await stripe.customers.create({
    email: params.email || undefined,
    name: params.builder.name || undefined,
    metadata: {
      builder_id: params.builder.id,
      user_id: params.builder.user_id,
    },
  })

  await params.admin
    .from('builder_profiles')
    .update({
      stripe_customer_id: customer.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.builder.id)

  return customer.id
}

export async function createBuilderCheckoutSession(params: {
  admin: any
  request: Request
  builder: BuilderBillingProfile
  userEmail?: string | null
  type: BuilderCheckoutType
}) {
  const priceId = getPriceId(params.type)
  const isSubscription = params.type === 'pro_monthly' || params.type === 'pro_annual'

  if (isSubscription && !priceId) {
    throw new Error(`Missing Stripe price id for ${params.type}`)
  }

  const customerId = await ensureStripeCustomerForBuilder({
    admin: params.admin,
    builder: params.builder,
    email: params.userEmail,
  })
  const stripe = getStripeClient()
  const baseUrl = getAppBaseUrl(params.request)
  const metadata = {
    billing_type: params.type,
    builder_id: params.builder.id,
    user_id: params.builder.user_id,
  }

  return stripe.checkout.sessions.create({
    mode: isSubscription ? 'subscription' : 'payment',
    customer: customerId,
    line_items: priceId
      ? [{ price: priceId, quantity: 1 }]
      : [
          {
            price_data: {
              currency: 'usd',
              unit_amount: Math.round(BUILDER_BILLING_PRICES.payPerEventAmount * 100),
              product_data: {
                name: '3rdSpace Pay-Per-Event Access',
                metadata: {
                  billing_type: 'pay_per_event',
                },
              },
            },
            quantity: 1,
          },
        ],
    client_reference_id: params.builder.id,
    metadata,
    success_url: `${baseUrl}/builder/billing?checkout=success`,
    cancel_url: `${baseUrl}/builder/billing?checkout=cancelled`,
    subscription_data: isSubscription
      ? {
          metadata,
        }
      : undefined,
  })
}

function getMonthStart(value = new Date()) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)).toISOString().slice(0, 10)
}

async function getSubscriptionPlanId(admin: any, type: BuilderCheckoutType) {
  const { data } = await admin
    .from('subscription_plans')
    .select('id')
    .eq('plan_type', type)
    .maybeSingle()

  return data?.id || null
}

export async function upsertBuilderSubscription(params: {
  admin: any
  builderId: string
  userId: string
  type: BuilderCheckoutType
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
  status?: string
  periodStart?: string | null
  periodEnd?: string | null
  cancelAtPeriodEnd?: boolean
  cancelledAt?: string | null
}) {
  const planId = await getSubscriptionPlanId(params.admin, params.type)

  await params.admin
    .from('builder_subscriptions')
    .upsert(
      {
        builder_id: params.builderId,
        user_id: params.userId,
        plan_id: planId,
        plan_type: params.type,
        stripe_customer_id: params.stripeCustomerId || null,
        stripe_subscription_id: params.stripeSubscriptionId || null,
        status: params.status || 'active',
        current_period_start: params.periodStart || null,
        current_period_end: params.periodEnd || null,
        cancel_at_period_end: params.cancelAtPeriodEnd ?? false,
        cancelled_at: params.cancelledAt || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'builder_id' }
    )
}

async function updateBuilderEventUsage(params: {
  admin: any
  builderId: string
  eventCountDelta: number
  feeDelta: number
}) {
  const month = getMonthStart()
  const { data: usage } = await params.admin
    .from('builder_event_usage')
    .select('events_booked, total_fees_paid')
    .eq('builder_id', params.builderId)
    .eq('month', month)
    .maybeSingle()

  const eventsBooked = (usage?.events_booked ?? 0) + params.eventCountDelta
  const totalFeesPaid = (usage?.total_fees_paid ?? 0) + params.feeDelta
  const couldHaveSaved = Math.max(eventsBooked * BUILDER_BILLING_PRICES.payPerEventAmount - BUILDER_BILLING_PRICES.proMonthlyAmount, 0)

  await params.admin
    .from('builder_event_usage')
    .upsert(
      {
        builder_id: params.builderId,
        month,
        events_booked: eventsBooked,
        total_fees_paid: totalFeesPaid,
        could_have_saved: couldHaveSaved,
      },
      { onConflict: 'builder_id,month' }
    )
}

async function insertPlatformFeeTransaction(params: {
  admin: any
  builderId: string
  type: BuilderCheckoutType
  amount: number
  status: 'pending' | 'succeeded' | 'failed' | 'refunded'
  stripeCheckoutSessionId?: string | null
  stripePaymentIntentId?: string | null
  stripeInvoiceId?: string | null
  billingPeriodStart?: string | null
  billingPeriodEnd?: string | null
}) {
  const paidAt = params.status === 'succeeded' ? new Date().toISOString() : null
  const failedAt = params.status === 'failed' ? new Date().toISOString() : null
  const refundedAt = params.status === 'refunded' ? new Date().toISOString() : null

  await params.admin
    .from('platform_fee_transactions')
    .insert({
      builder_id: params.builderId,
      stripe_checkout_session_id: params.stripeCheckoutSessionId || null,
      stripe_payment_intent_id: params.stripePaymentIntentId || null,
      stripe_invoice_id: params.stripeInvoiceId || null,
      amount: params.amount,
      fee_type: getFeeType(params.type),
      billing_period_start: params.billingPeriodStart || null,
      billing_period_end: params.billingPeriodEnd || null,
      status: params.status,
      paid_at: paidAt,
      failed_at: failedAt,
      refunded_at: refundedAt,
    })
}

export async function consumeBuilderEventAccess(params: {
  admin: any
  builder: BuilderBillingProfile
  eventId: string
}) {
  const summary = getBuilderBillingSummary(params.builder)
  const now = new Date().toISOString()

  if (summary.hasProAccess) {
    await updateBuilderEventUsage({
      admin: params.admin,
      builderId: params.builder.id,
      eventCountDelta: 1,
      feeDelta: 0,
    })
    return { source: params.builder.billing_tier, amount: 0 }
  }

  if (summary.freeEventsRemaining > 0) {
    await params.admin
      .from('builder_profiles')
      .update({
        free_events_used: summary.freeEventsUsed + 1,
        updated_at: now,
      })
      .eq('id', params.builder.id)

    await updateBuilderEventUsage({
      admin: params.admin,
      builderId: params.builder.id,
      eventCountDelta: 1,
      feeDelta: 0,
    })
    return { source: 'free_trial', amount: 0 }
  }

  if (summary.paidEventCredits > 0) {
    await params.admin
      .from('builder_profiles')
      .update({
        paid_event_credits: summary.paidEventCredits - 1,
        billing_tier: 'pay_per_event',
        updated_at: now,
      })
      .eq('id', params.builder.id)

    await updateBuilderEventUsage({
      admin: params.admin,
      builderId: params.builder.id,
      eventCountDelta: 1,
      feeDelta: BUILDER_BILLING_PRICES.payPerEventAmount,
    })
    return { source: 'pay_per_event', amount: BUILDER_BILLING_PRICES.payPerEventAmount }
  }

  throw new BuilderBillingRequiredError()
}

export async function applyCheckoutSessionCompleted(admin: any, session: Stripe.Checkout.Session) {
  const billingType = session.metadata?.billing_type as BuilderCheckoutType | undefined
  const builderId = session.metadata?.builder_id
  const userId = session.metadata?.user_id

  if (!billingType || !builderId || !userId) return

  const { data: existing } = await admin
    .from('platform_fee_transactions')
    .select('id')
    .eq('stripe_checkout_session_id', session.id)
    .maybeSingle()

  if (existing?.id) return

  const now = new Date().toISOString()
  const amount = (session.amount_total ?? 0) / 100
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id
  const invoiceId = typeof session.invoice === 'string' ? session.invoice : session.invoice?.id

  if (billingType === 'pay_per_event') {
    const { data: builder } = await admin
      .from('builder_profiles')
      .select('paid_event_credits')
      .eq('id', builderId)
      .maybeSingle()

    await admin
      .from('builder_profiles')
      .update({
        billing_tier: 'pay_per_event',
        paid_event_credits: (builder?.paid_event_credits ?? 0) + 1,
        updated_at: now,
      })
      .eq('id', builderId)

    await upsertBuilderSubscription({
      admin,
      builderId,
      userId,
      type: 'pay_per_event',
      stripeCustomerId: customerId || null,
      status: 'active',
    })
  } else {
    await admin
      .from('builder_profiles')
      .update({
        billing_tier: billingType,
        subscription_status: 'active',
        subscription_started_at: now,
        stripe_subscription_id: subscriptionId || null,
        updated_at: now,
      })
      .eq('id', builderId)

    await upsertBuilderSubscription({
      admin,
      builderId,
      userId,
      type: billingType,
      stripeCustomerId: customerId || null,
      stripeSubscriptionId: subscriptionId || null,
      status: 'active',
    })
  }

  await insertPlatformFeeTransaction({
    admin,
    builderId,
    type: billingType,
    amount: amount || getBillingAmount(billingType),
    status: 'succeeded',
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: paymentIntentId || null,
    stripeInvoiceId: invoiceId || null,
  })
}

export async function syncBuilderSubscription(admin: any, subscription: Stripe.Subscription) {
  const billingType = subscription.metadata?.billing_type as BuilderBillingTier | undefined
  const builderId = subscription.metadata?.builder_id
  const userId = subscription.metadata?.user_id
  const now = new Date().toISOString()
  const subscriptionStatus = subscriptionStatusToProfileStatus(subscription.status)
  const periodStart = subscription.current_period_start
    ? new Date(subscription.current_period_start * 1000).toISOString()
    : null
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null

  let query = admin.from('builder_profiles').update({
    billing_tier: billingType === 'pro_annual' ? 'pro_annual' : 'pro_monthly',
    subscription_status: subscriptionStatus,
    subscription_ends_at: periodEnd,
    stripe_subscription_id: subscription.id,
    updated_at: now,
  })

  if (builderId) {
    query = query.eq('id', builderId)
  } else {
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
    query = query.eq('stripe_customer_id', customerId)
  }

  await query

  if (builderId && userId) {
    await upsertBuilderSubscription({
      admin,
      builderId,
      userId,
      type: billingType === 'pro_annual' ? 'pro_annual' : 'pro_monthly',
      stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
      stripeSubscriptionId: subscription.id,
      status: subscription.status,
      periodStart,
      periodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      cancelledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
    })
  }
}

export async function applyInvoicePayment(admin: any, invoice: Stripe.Invoice) {
  const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
  if (!subscriptionId) return

  const { data: builder } = await admin
    .from('builder_profiles')
    .select('id, billing_tier')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle()

  if (!builder?.id) return

  const { data: existing } = await admin
    .from('platform_fee_transactions')
    .select('id')
    .eq('stripe_invoice_id', invoice.id)
    .maybeSingle()

  if (existing?.id) return

  const type = builder.billing_tier === 'pro_annual' ? 'pro_annual' : 'pro_monthly'
  const period = invoice.lines.data[0]?.period
  await insertPlatformFeeTransaction({
    admin,
    builderId: builder.id,
    type,
    amount: (invoice.amount_paid ?? 0) / 100 || getBillingAmount(type),
    status: 'succeeded',
    stripeInvoiceId: invoice.id,
    billingPeriodStart: period?.start ? new Date(period.start * 1000).toISOString().slice(0, 10) : null,
    billingPeriodEnd: period?.end ? new Date(period.end * 1000).toISOString().slice(0, 10) : null,
  })
}

/**
 * Records a failed Stripe subscription invoice and marks the builder subscription past due.
 *
 * @param admin - Supabase service-role client.
 * @param invoice - Stripe invoice.payment_failed payload.
 */
export async function applyInvoicePaymentFailed(admin: any, invoice: Stripe.Invoice) {
  const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
  if (!subscriptionId) return

  const { data: builder } = await admin
    .from('builder_profiles')
    .select('id, user_id, name, billing_tier')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle()

  if (!builder?.id) return

  await admin
    .from('builder_subscriptions')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscriptionId)

  await admin
    .from('builder_profiles')
    .update({
      subscription_status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('id', builder.id)

  const { data: existing } = await admin
    .from('platform_fee_transactions')
    .select('id')
    .eq('stripe_invoice_id', invoice.id)
    .maybeSingle()

  if (existing?.id) return

  const type = builder.billing_tier === 'pro_annual' ? 'pro_annual' : 'pro_monthly'
  const period = invoice.lines.data[0]?.period
  await insertPlatformFeeTransaction({
    admin,
    builderId: builder.id,
    type,
    amount: (invoice.amount_due ?? 0) / 100 || getBillingAmount(type),
    status: 'failed',
    stripeInvoiceId: invoice.id,
    billingPeriodStart: period?.start ? new Date(period.start * 1000).toISOString().slice(0, 10) : null,
    billingPeriodEnd: period?.end ? new Date(period.end * 1000).toISOString().slice(0, 10) : null,
  })

  await sendSubscriptionPaymentFailedEmail({
    admin,
    builder,
    amountDue: (invoice.amount_due ?? 0) / 100 || getBillingAmount(type),
  })
}

/**
 * Sends a billing failure email when SendGrid is configured.
 *
 * @param params - Builder row and invoice amount context.
 */
async function sendSubscriptionPaymentFailedEmail(params: {
  admin: any
  builder: { id: string; user_id?: string | null; name?: string | null }
  amountDue: number
}) {
  const apiKey = process.env.SENDGRID_API_KEY
  const from = process.env.BILLING_FROM_EMAIL || process.env.INVOICE_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL

  if (!apiKey || !from || !params.builder.user_id) return

  const { data: userRow } = await params.admin
    .from('users')
    .select('email')
    .eq('id', params.builder.user_id)
    .maybeSingle()

  if (!userRow?.email) return

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: userRow.email }] }],
      from: { email: from },
      subject: '3rdSpace subscription payment needs attention',
      content: [
        {
          type: 'text/html',
          value: `
            <p>Hello${params.builder.name ? ` ${params.builder.name}` : ''},</p>
            <p>Your 3rdSpace Pro subscription payment of $${params.amountDue.toFixed(2)} did not go through.</p>
            <p>Please update your billing details to keep Pro booking-fee access active.</p>
          `,
        },
      ],
    }),
  })

  if (!response.ok) {
    console.warn('[builder.billing] Failed to send payment failure email', await response.text())
  }
}
