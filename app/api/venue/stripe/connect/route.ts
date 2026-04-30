import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  getAppBaseUrl,
  getAuthenticatedVenueOwner,
  getStripeClient,
  getStripeCompletionPercent,
  saveVenueStripeAccount,
} from '@/lib/stripe/connect'

export const runtime = 'nodejs'

/**
 * Starts Stripe Connect Express onboarding for the authenticated venue owner.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const auth = await getAuthenticatedVenueOwner(supabase)

    if (auth.error || !auth.user || !auth.owner) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createServiceRoleClient()
    const stripe = getStripeClient()
    const baseUrl = getAppBaseUrl(request)

    const { data: existing } = await (admin as any)
      .from('venue_stripe_accounts')
      .select('stripe_account_id')
      .eq('owner_id', auth.owner.id)
      .maybeSingle()

    let account

    if (existing?.stripe_account_id) {
      account = await stripe.accounts.retrieve(existing.stripe_account_id)
    } else {
      account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: auth.owner.email,
        business_profile: {
          name: auth.owner.venue_name || auth.owner.company_name || undefined,
          url: baseUrl,
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: {
          venue_owner_id: auth.owner.id,
          user_id: auth.user.id,
        },
      })
    }

    const record = await saveVenueStripeAccount(admin as any, auth.owner.id, account)
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${baseUrl}/api/venue/stripe/callback?refresh=1`,
      return_url: `${baseUrl}/api/venue/stripe/callback`,
      type: 'account_onboarding',
    })

    return NextResponse.json({
      accountLinkUrl: accountLink.url,
      url: accountLink.url,
      account: record,
      completionPercent: getStripeCompletionPercent(account),
    })
  } catch (error) {
    console.error('[venue.stripe.connect] Failed to start onboarding', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to start Stripe onboarding' },
      { status: 500 }
    )
  }
}
