export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  createBuilderBillingPortalSession,
  getAuthenticatedBuilderBillingProfile,
} from '@/lib/billing/builder-billing'

export const runtime = 'nodejs'

/**
 * Creates a Stripe Customer Portal session for builder billing self-service.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const admin = createServiceRoleClient()
    const auth = await getAuthenticatedBuilderBillingProfile(supabase)

    if (!auth.user || !auth.builder) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const session = await createBuilderBillingPortalSession({
      admin,
      request,
      builder: auth.builder,
      userEmail: auth.user.email,
    })

    return NextResponse.json({
      portalUrl: session.url,
      sessionId: session.id,
    })
  } catch (error) {
    console.error('[builder.billing.portal] Failed to create portal session', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to open billing portal' },
      { status: 500 }
    )
  }
}
