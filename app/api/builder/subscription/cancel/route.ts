import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe/connect'
import { getAuthenticatedBuilderBillingProfile } from '@/lib/billing/builder-billing'
import { getFriendlyStripeError } from '@/lib/payments/vendor-payments'

export const runtime = 'nodejs'

const cancelSubscriptionSchema = z.object({
  immediately: z.boolean().default(false),
})

/**
 * Cancels the authenticated builder's Pro subscription.
 *
 * @route POST /api/builder/subscription/cancel
 * @auth Required - builder only.
 *
 * @param request - JSON body with immediately flag.
 * @returns Success response once Stripe and local subscription state are updated.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = cancelSubscriptionSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid cancellation payload' }, { status: 400 })
    }

    const supabase = createClient()
    const admin = createServiceRoleClient()
    const auth = await getAuthenticatedBuilderBillingProfile(supabase)

    if (!auth.builder) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { data: subscription, error: subscriptionError } = await (admin as any)
      .from('builder_subscriptions')
      .select('stripe_subscription_id')
      .eq('builder_id', auth.builder.id)
      .maybeSingle()

    if (subscriptionError) {
      return NextResponse.json({ error: 'Failed to load subscription' }, { status: 500 })
    }

    if (!subscription?.stripe_subscription_id) {
      return NextResponse.json({ error: 'No active subscription' }, { status: 404 })
    }

    const stripe = getStripeClient()
    const now = new Date().toISOString()

    if (parsedBody.data.immediately) {
      await stripe.subscriptions.cancel(subscription.stripe_subscription_id)

      await (admin as any)
        .from('builder_subscriptions')
        .update({
          status: 'cancelled',
          cancelled_at: now,
          cancel_at_period_end: false,
          plan_type: 'pay_per_event',
          updated_at: now,
        })
        .eq('builder_id', auth.builder.id)

      await (admin as any)
        .from('builder_profiles')
        .update({
          billing_tier: 'pay_per_event',
          subscription_status: 'cancelled',
          stripe_subscription_id: null,
          updated_at: now,
        })
        .eq('id', auth.builder.id)
    } else {
      const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
        cancel_at_period_end: true,
      })

      await (admin as any)
        .from('builder_subscriptions')
        .update({
          cancel_at_period_end: true,
          current_period_end: updated.current_period_end
            ? new Date(updated.current_period_end * 1000).toISOString()
            : null,
          updated_at: now,
        })
        .eq('builder_id', auth.builder.id)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[builder.subscription.cancel] Failed to cancel subscription', error)
    return NextResponse.json({ error: getFriendlyStripeError(error) }, { status: 500 })
  }
}
