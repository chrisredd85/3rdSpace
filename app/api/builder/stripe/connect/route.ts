import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  getAppBaseUrl,
  getAuthenticatedBuilderPayoutOwner,
  getStripeClient,
  getStripeCompletionPercent,
  saveBuilderStripeAccount,
} from '@/lib/stripe/connect'

export const runtime = 'nodejs'

/**
 * Starts Stripe Connect Express onboarding for builders receiving venue kickbacks.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const auth = await getAuthenticatedBuilderPayoutOwner(supabase)

    if (auth.error || !auth.user || !auth.builder) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createServiceRoleClient()
    const stripe = getStripeClient()
    const baseUrl = getAppBaseUrl(request)

    const { data: existing } = await (admin as any)
      .from('builder_stripe_accounts')
      .select('stripe_account_id')
      .eq('user_id', auth.user.id)
      .maybeSingle()

    let account

    if (existing?.stripe_account_id) {
      account = await stripe.accounts.retrieve(existing.stripe_account_id)
    } else {
      account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: auth.user.email,
        business_profile: {
          name: auth.builder.name || auth.user.email || undefined,
          url: baseUrl,
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: {
          builder_id: auth.builder.id,
          user_id: auth.user.id,
          account_role: 'builder',
        },
      })
    }

    const record = await saveBuilderStripeAccount(admin as any, auth.user.id, auth.builder.id, account)
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${baseUrl}/api/builder/stripe/callback?refresh=1`,
      return_url: `${baseUrl}/api/builder/stripe/callback`,
      type: 'account_onboarding',
    })

    return NextResponse.json({
      accountLinkUrl: accountLink.url,
      url: accountLink.url,
      account: record,
      completionPercent: getStripeCompletionPercent(account),
    })
  } catch (error) {
    console.error('[builder.stripe.connect] Failed to start onboarding', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to start Stripe onboarding' },
      { status: 500 }
    )
  }
}
