import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  getAuthenticatedVendor,
  getStripeClient,
  getStripeCompletionPercent,
  saveVendorStripeAccount,
} from '@/lib/stripe/connect'

export const runtime = 'nodejs'

/**
 * Returns the authenticated vendor's Stripe Connect account status.
 *
 * @returns Connection status, live Stripe requirements, and legacy account shape used by the payout page.
 */
export async function GET() {
  try {
    const supabase = createClient()
    const auth = await getAuthenticatedVendor(supabase)

    if (auth.error || !auth.vendor) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createServiceRoleClient()
    const { data: record, error } = await (admin as any)
      .from('vendor_stripe_accounts')
      .select('*')
      .eq('vendor_id', auth.vendor.id)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: 'Failed to load Stripe account' }, { status: 500 })
    }

    if (!record?.stripe_account_id) {
      return NextResponse.json({
        connected: false,
        status: 'not_connected',
        account: null,
        completionPercent: 0,
      })
    }

    const stripe = getStripeClient()
    const account = await stripe.accounts.retrieve(record.stripe_account_id)
    const saved = await saveVendorStripeAccount(admin as any, auth.vendor.id, account)

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
    console.error('[vendor.stripe.status] Failed to load status', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load Stripe status' },
      { status: 500 }
    )
  }
}
