export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  getAppBaseUrl,
  getAuthenticatedVendor,
  getStripeClient,
  getStripeCompletionPercent,
  saveVendorStripeAccount,
} from '@/lib/stripe/connect'
import { validateStripeConnectAccount } from '@/lib/billing/stripeConnectGuard'

export const runtime = 'nodejs'

/**
 * Starts Stripe Connect Express onboarding for the authenticated vendor.
 *
 * @param request - Request used to derive the app base URL for Stripe return links.
 * @returns Stripe Account Link URL plus the saved vendor Stripe account state.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const auth = await getAuthenticatedVendor(supabase)

    if (auth.error || !auth.user || !auth.vendor) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createServiceRoleClient()
    const stripe = getStripeClient()
    const baseUrl = getAppBaseUrl(request)

    const { data: existing } = await (admin as any)
      .from('vendor_stripe_accounts')
      .select('stripe_account_id')
      .eq('vendor_id', auth.vendor.id)
      .maybeSingle()

    let account

    if (existing?.stripe_account_id) {
      const validation = await validateStripeConnectAccount({
        stripe,
        db: admin as any,
        table: 'vendor_stripe_accounts',
        rowId: auth.vendor.id,
        currentAccountId: existing.stripe_account_id,
      })
      account = validation.account
    }

    if (!account) {
      account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: auth.user.email,
        business_profile: {
          name: auth.vendor.name || undefined,
          url: baseUrl,
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: {
          vendor_id: auth.vendor.id,
          user_id: auth.user.id,
        },
      })
    }

    const record = await saveVendorStripeAccount(admin as any, auth.vendor.id, account)
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${baseUrl}/api/vendor/stripe/callback?refresh=1`,
      return_url: `${baseUrl}/api/vendor/stripe/callback`,
      type: 'account_onboarding',
    })

    return NextResponse.json({
      accountLinkUrl: accountLink.url,
      url: accountLink.url,
      account: record,
      completionPercent: getStripeCompletionPercent(account),
    })
  } catch (error) {
    console.error('[vendor.stripe.connect] Failed to start onboarding', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to start Stripe onboarding' },
      { status: 500 }
    )
  }
}
