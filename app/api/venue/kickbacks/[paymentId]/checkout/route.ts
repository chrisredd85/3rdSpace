import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { dollarsToCents } from '@/lib/payments/vendor-payments'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAppBaseUrl, getAuthenticatedVenueOwner, getStripeClient } from '@/lib/stripe/connect'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  paymentId: z.string().uuid(),
})

type KickbackPaymentForCheckout = {
  id: string
  agreement_id: string
  event_id: string
  payer_id: string
  recipient_id: string
  amount: number
  currency: string | null
  status: string
  events?: { event_name?: string | null } | { event_name?: string | null }[] | null
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
      .select('id, agreement_id, event_id, payer_id, recipient_id, amount, currency, status, events(event_name)')
      .eq('id', parsedParams.data.paymentId)
      .maybeSingle()

    if (paymentError) throw new Error(paymentError.message)
    if (!paymentRow) return NextResponse.json({ error: 'Kickback payment not found' }, { status: 404 })

    const payment = paymentRow as KickbackPaymentForCheckout
    if (payment.payer_id !== auth.owner.id) {
      return NextResponse.json({ error: 'Not authorized for this kickback payment' }, { status: 403 })
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

    if (!builderAccount?.stripe_account_id || !builderAccount.payouts_enabled || builderAccount.account_status === 'restricted') {
      return NextResponse.json(
        { error: 'The event builder has not finished payout setup yet.' },
        { status: 400 }
      )
    }

    const stripe = getStripeClient()
    const baseUrl = getAppBaseUrl(request)
    const event = Array.isArray(payment.events) ? payment.events[0] : payment.events
    const eventName = event?.event_name || 'event'
    const metadata = {
      payment_kind: 'venue_builder_kickback',
      kickback_payment_id: payment.id,
      agreement_id: payment.agreement_id,
      event_id: payment.event_id,
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
                name: `3rdSpace kickback: ${eventName}`,
                metadata,
              },
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          transfer_data: {
            destination: builderAccount.stripe_account_id,
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
