export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe/connect'
import {
  getAuthenticatedBuilderBillingProfile,
  getBuilderStripePriceId,
  upsertBuilderSubscription,
  type BuilderCheckoutType,
} from '@/lib/billing/builder-billing'
import { getFriendlyStripeError } from '@/lib/payments/vendor-payments'

export const runtime = 'nodejs'

const createSubscriptionSchema = z.object({
  priceId: z.string().min(1),
  paymentMethodId: z.string().min(1),
})

/**
 * Resolves a Stripe Price ID into the app's Pro plan type.
 *
 * @param priceId - Stripe Price ID from the request.
 * @returns Pro billing type when the price is configured, otherwise null.
 */
function getPlanTypeFromPriceId(priceId: string): Extract<BuilderCheckoutType, 'pro_monthly' | 'pro_annual'> | null {
  if (priceId === getBuilderStripePriceId('pro_monthly')) return 'pro_monthly'
  if (priceId === getBuilderStripePriceId('pro_annual')) return 'pro_annual'
  return null
}

/**
 * Maps Stripe subscription statuses into the builder_profiles status constraint.
 *
 * @param status - Raw Stripe subscription status.
 * @returns Profile-safe subscription status.
 */
function getProfileSubscriptionStatus(status: string) {
  if (status === 'active' || status === 'trialing') return 'active'
  if (status === 'past_due' || status === 'unpaid') return 'past_due'
  if (status === 'incomplete') return 'incomplete'
  return 'cancelled'
}

/**
 * Creates a Pro subscription for the authenticated builder.
 *
 * @route POST /api/builder/subscription/create
 * @auth Required - builder only.
 *
 * @param request - JSON body with priceId and paymentMethodId.
 * @returns Stripe subscription id, status, and current period end.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = createSubscriptionSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid subscription payload', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const planType = getPlanTypeFromPriceId(parsedBody.data.priceId)
    if (!planType) {
      return NextResponse.json({ error: 'Unknown Pro price id' }, { status: 400 })
    }

    const supabase = createClient()
    const admin = createServiceRoleClient()
    const auth = await getAuthenticatedBuilderBillingProfile(supabase)

    if (!auth.user || !auth.builder) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const stripe = getStripeClient()
    const { data: existingSub } = await (admin as any)
      .from('builder_subscriptions')
      .select('stripe_customer_id, stripe_subscription_id')
      .eq('builder_id', auth.builder.id)
      .maybeSingle()

    let customerId = existingSub?.stripe_customer_id || auth.builder.stripe_customer_id || null

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: auth.user.email || undefined,
        name: auth.builder.name || undefined,
        payment_method: parsedBody.data.paymentMethodId,
        invoice_settings: {
          default_payment_method: parsedBody.data.paymentMethodId,
        },
        metadata: {
          builder_id: auth.builder.id,
          user_id: auth.user.id,
        },
      })
      customerId = customer.id
    } else {
      try {
        await stripe.paymentMethods.attach(parsedBody.data.paymentMethodId, { customer: customerId })
      } catch (error) {
        console.warn('[builder.subscription.create] Payment method attach skipped', error)
      }

      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: parsedBody.data.paymentMethodId,
        },
      })
    }

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: parsedBody.data.priceId }],
      payment_settings: {
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription',
      },
      metadata: {
        billing_type: planType,
        builder_id: auth.builder.id,
        user_id: auth.user.id,
      },
      expand: ['latest_invoice.payment_intent'],
    })
    const periodStart = new Date(subscription.current_period_start * 1000).toISOString()
    const periodEnd = new Date(subscription.current_period_end * 1000).toISOString()

    await upsertBuilderSubscription({
      admin,
      builderId: auth.builder.id,
      userId: auth.user.id,
      type: planType,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      status: subscription.status,
      periodStart,
      periodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    })

    await (admin as any)
      .from('builder_profiles')
      .update({
        billing_tier: planType,
        subscription_status: getProfileSubscriptionStatus(subscription.status),
        subscription_started_at: periodStart,
        subscription_ends_at: periodEnd,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', auth.builder.id)

    return NextResponse.json({
      subscription_id: subscription.id,
      status: subscription.status,
      current_period_end: subscription.current_period_end,
    })
  } catch (error) {
    console.error('[builder.subscription.create] Failed to create subscription', error)
    return NextResponse.json({ error: getFriendlyStripeError(error) }, { status: 500 })
  }
}
