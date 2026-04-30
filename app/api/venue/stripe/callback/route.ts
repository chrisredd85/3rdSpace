import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  getAppBaseUrl,
  getAuthenticatedVenueOwner,
  getStripeClient,
  saveVenueStripeAccount,
} from '@/lib/stripe/connect'

export const runtime = 'nodejs'

function redirectToPayouts(request: NextRequest, status: string, message?: string) {
  const url = new URL('/venue/payouts', request.url)
  url.searchParams.set('stripe', status)
  if (message) url.searchParams.set('message', message)
  return NextResponse.redirect(url)
}

/**
 * Handles returns from Stripe-hosted venue owner onboarding.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)

  if (searchParams.get('error')) {
    return redirectToPayouts(request, 'error', searchParams.get('error_description') || 'Stripe onboarding was cancelled')
  }

  try {
    const supabase = createClient()
    const auth = await getAuthenticatedVenueOwner(supabase)

    if (auth.error || !auth.user || !auth.owner) {
      return redirectToPayouts(request, 'auth_required')
    }

    const admin = createServiceRoleClient()
    const stripe = getStripeClient()
    const baseUrl = getAppBaseUrl(request)
    const code = searchParams.get('code')

    if (code) {
      const token = await (stripe.oauth as any).token({
        grant_type: 'authorization_code',
        code,
      })
      const account = await stripe.accounts.retrieve(token.stripe_user_id)
      await saveVenueStripeAccount(admin as any, auth.owner.id, account)
      return redirectToPayouts(request, 'connected')
    }

    const { data: existing } = await (admin as any)
      .from('venue_stripe_accounts')
      .select('stripe_account_id')
      .eq('owner_id', auth.owner.id)
      .maybeSingle()

    if (!existing?.stripe_account_id) {
      return redirectToPayouts(request, 'missing_account')
    }

    const account = await stripe.accounts.retrieve(existing.stripe_account_id)
    await saveVenueStripeAccount(admin as any, auth.owner.id, account)

    if (searchParams.get('refresh') === '1') {
      const accountLink = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: `${baseUrl}/api/venue/stripe/callback?refresh=1`,
        return_url: `${baseUrl}/api/venue/stripe/callback`,
        type: 'account_onboarding',
      })
      return NextResponse.redirect(accountLink.url)
    }

    return redirectToPayouts(request, 'connected')
  } catch (error) {
    console.error('[venue.stripe.callback] Failed to complete onboarding', error)
    return redirectToPayouts(
      request,
      'error',
      error instanceof Error ? error.message : 'Unable to complete Stripe onboarding'
    )
  }
}
