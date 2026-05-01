export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  getAuthenticatedVenueOwner,
  getStripeClient,
  getStripeCompletionPercent,
  saveVenueStripeAccount,
} from '@/lib/stripe/connect'

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
    const account = await stripe.accounts.retrieve(record.stripe_account_id)
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
