export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { startVenueOpportunityStripeResume } from '@/lib/venues/venueOpportunityRecovery'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    token: string
  }>
}

/**
 * Token-gated Stripe Connect resume link for accepted venue opportunities.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const admin = createServiceRoleClient()
    const result = await startVenueOpportunityStripeResume(admin, request, (await context.params).token)

    if (result.ok) {
      return NextResponse.redirect(result.url)
    }

    return NextResponse.redirect(new URL(result.redirectTo, request.url))
  } catch (error) {
    console.error('[venue.opportunity.stripe-resume] Failed to create Stripe resume link', error)
    const url = new URL(`/venue/opportunity/${encodeURIComponent((await context.params).token)}/stripe-complete`, request.url)
    url.searchParams.set('stripe', 'error')
    url.searchParams.set('message', error instanceof Error ? error.message : 'Unable to start Stripe onboarding')
    return NextResponse.redirect(url)
  }
}
