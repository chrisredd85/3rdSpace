export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  getAuthenticatedVenueOwner,
  getStripeClient,
  getStripeCompletionPercent,
  saveVenueStripeAccount,
} from '@/lib/stripe/connect'
import { validateStripeConnectAccount } from '@/lib/billing/stripeConnectGuard'

export const runtime = 'nodejs'

/**
 * Refreshes the authenticated venue owner's Stripe account from Stripe.
 */
export async function POST() {
  try {
    const supabase = createClient()
    const auth = await getAuthenticatedVenueOwner(supabase)

    if (auth.error || !auth.owner) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createServiceRoleClient()
    const { data: record } = await (admin as any)
      .from('venue_stripe_accounts')
      .select('stripe_account_id')
      .eq('owner_id', auth.owner.id)
      .maybeSingle()

    if (!record?.stripe_account_id) {
      return NextResponse.json({ error: 'Stripe account not connected' }, { status: 404 })
    }

    const stripe = getStripeClient()
    const validation = await validateStripeConnectAccount({
      stripe,
      db: admin as any,
      table: 'venue_stripe_accounts',
      rowId: auth.owner.id,
      currentAccountId: record.stripe_account_id,
    })

    if (validation.mismatchCleared) {
      return NextResponse.json({
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

    const saved = await saveVenueStripeAccount(admin as any, auth.owner.id, account)

    return NextResponse.json({
      account: saved,
      completionPercent: getStripeCompletionPercent(account),
    })
  } catch (error) {
    console.error('[venue.stripe.refresh] Failed to refresh status', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to refresh Stripe status' },
      { status: 500 }
    )
  }
}
