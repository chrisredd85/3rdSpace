export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  getAppBaseUrl,
  getAuthenticatedVendor,
  getStripeClient,
  saveVendorStripeAccount,
} from '@/lib/stripe/connect'
import { validateStripeConnectAccount } from '@/lib/billing/stripeConnectGuard'

export const runtime = 'nodejs'

function redirectToVendorStripeDestination(request: NextRequest, status: string, message?: string) {
  const returnTo = sanitizeInternalReturnTo(request.nextUrl.searchParams.get('returnTo'))
  const url = new URL(returnTo ?? '/vendor/payouts', request.url)
  url.searchParams.set('stripe', status)
  if (message) url.searchParams.set('message', message)
  return NextResponse.redirect(url)
}

/**
 * Handles returns from Stripe-hosted onboarding and legacy OAuth callbacks.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)

  if (searchParams.get('error')) {
    return redirectToVendorStripeDestination(request, 'error', searchParams.get('error_description') || 'Stripe onboarding was cancelled')
  }

  try {
    const supabase = createClient()
    const auth = await getAuthenticatedVendor(supabase)

    if (auth.error || !auth.user || !auth.vendor) {
      return redirectToVendorStripeDestination(request, 'auth_required')
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
      await saveVendorStripeAccount(admin as any, auth.vendor.id, account)
      return redirectToVendorStripeDestination(request, 'connected')
    }

    const { data: existing } = await (admin as any)
      .from('vendor_stripe_accounts')
      .select('stripe_account_id')
      .eq('vendor_id', auth.vendor.id)
      .maybeSingle()

    if (!existing?.stripe_account_id) {
      return redirectToVendorStripeDestination(request, 'missing_account')
    }

    const validation = await validateStripeConnectAccount({
      stripe,
      db: admin as any,
      table: 'vendor_stripe_accounts',
      rowId: auth.vendor.id,
      currentAccountId: existing.stripe_account_id,
    })

    if (validation.mismatchCleared || !validation.account) {
      return redirectToVendorStripeDestination(
        request,
        'reconnect_required',
        'Reconnect Stripe to receive payouts.'
      )
    }

    const account = validation.account
    await saveVendorStripeAccount(admin as any, auth.vendor.id, account)

    if (searchParams.get('refresh') === '1') {
      const returnTo = sanitizeInternalReturnTo(searchParams.get('returnTo'))
      const returnToSuffix = returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''
      const accountLink = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: `${baseUrl}/api/vendor/stripe/callback?refresh=1${returnToSuffix}`,
        return_url: `${baseUrl}/api/vendor/stripe/callback${returnToSuffix}`,
        type: 'account_onboarding',
      })
      return NextResponse.redirect(accountLink.url)
    }

    return redirectToVendorStripeDestination(request, 'connected')
  } catch (error) {
    console.error('[vendor.stripe.callback] Failed to complete onboarding', error)
    return redirectToVendorStripeDestination(
      request,
      'error',
      error instanceof Error ? error.message : 'Unable to complete Stripe onboarding'
    )
  }
}

function sanitizeInternalReturnTo(value: string | null) {
  if (!value) return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('//')) return null
  return value
}
