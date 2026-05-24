export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedVendor, getStripeClient } from '@/lib/stripe/connect'
import { validateStripeConnectAccount } from '@/lib/billing/stripeConnectGuard'

export const runtime = 'nodejs'

/**
 * Creates a short-lived Stripe Express Dashboard login link.
 */
export async function GET() {
  try {
    const supabase = createClient()
    const auth = await getAuthenticatedVendor(supabase)

    if (auth.error || !auth.vendor) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createServiceRoleClient()
    const { data: record } = await (admin as any)
      .from('vendor_stripe_accounts')
      .select('stripe_account_id')
      .eq('vendor_id', auth.vendor.id)
      .maybeSingle()

    if (!record?.stripe_account_id) {
      return NextResponse.json({ error: 'Stripe account not connected' }, { status: 404 })
    }

    const stripe = getStripeClient()
    const validation = await validateStripeConnectAccount({
      stripe,
      db: admin as any,
      table: 'vendor_stripe_accounts',
      rowId: auth.vendor.id,
      currentAccountId: record.stripe_account_id,
    })

    if (validation.mismatchCleared || !validation.accountId) {
      return NextResponse.json(
        {
          error: 'Reconnect Stripe to receive payouts.',
          code: 'vendor_requires_reconnect',
          onboarding_required: true,
          reason: 'stripe_mode_mismatch',
        },
        { status: 409 }
      )
    }

    const loginLink = await stripe.accounts.createLoginLink(validation.accountId)

    return NextResponse.json({ url: loginLink.url })
  } catch (error) {
    console.error('[vendor.stripe.dashboard] Failed to create dashboard link', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to open Stripe dashboard' },
      { status: 500 }
    )
  }
}
