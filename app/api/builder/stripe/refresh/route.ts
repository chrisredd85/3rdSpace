export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  getAuthenticatedBuilderPayoutOwner,
  getStripeClient,
  getStripeCompletionPercent,
  saveBuilderStripeAccount,
} from '@/lib/stripe/connect'
import { validateStripeConnectAccount } from '@/lib/billing/stripeConnectGuard'

export const runtime = 'nodejs'

/**
 * Refreshes the authenticated builder's Stripe account from Stripe.
 */
export async function POST() {
  try {
    const supabase = createClient()
    const auth = await getAuthenticatedBuilderPayoutOwner(supabase)

    if (auth.error || !auth.user || !auth.builder) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createServiceRoleClient()
    const { data: record } = await (admin as any)
      .from('builder_stripe_accounts')
      .select('stripe_account_id')
      .eq('user_id', auth.user.id)
      .maybeSingle()

    if (!record?.stripe_account_id) {
      return NextResponse.json({ error: 'Stripe account not connected' }, { status: 404 })
    }

    const stripe = getStripeClient()
    const validation = await validateStripeConnectAccount({
      stripe,
      db: admin as any,
      table: 'builder_stripe_accounts',
      rowId: auth.user.id,
      currentAccountId: record.stripe_account_id,
    })

    if (validation.mismatchCleared) {
      return NextResponse.json({
        connected: false,
        status: 'not_connected',
        account: null,
        completionPercent: 0,
        onboarding_required: true,
        reason: 'stripe_mode_mismatch',
      })
    }

    const account = validation.account
    if (!account) {
      return NextResponse.json({ error: 'Stripe account not connected' }, { status: 404 })
    }

    const saved = await saveBuilderStripeAccount(admin as any, auth.user.id, auth.builder.id, account)

    return NextResponse.json({
      connected: true,
      status: saved.account_status,
      charges_enabled: saved.charges_enabled,
      payouts_enabled: saved.payouts_enabled,
      requirements: account.requirements,
      details_submitted: account.details_submitted,
      account: saved,
      completionPercent: getStripeCompletionPercent(account),
    })
  } catch (error) {
    console.error('[builder.stripe.refresh] Failed to refresh status', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to refresh Stripe status' },
      { status: 500 }
    )
  }
}
