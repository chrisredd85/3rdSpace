export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  createBuilderCheckoutSession,
  getAuthenticatedBuilderBillingProfile,
} from '@/lib/billing/builder-billing'

export const runtime = 'nodejs'

const checkoutSchema = z.object({
  type: z.enum(['pay_per_event', 'pro_monthly', 'pro_annual']),
})

/**
 * Creates a Stripe Checkout session for builder event access or Pro.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = checkoutSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid checkout request' }, { status: 400 })
    }

    const supabase = createClient()
    const admin = createServiceRoleClient()
    const auth = await getAuthenticatedBuilderBillingProfile(supabase)

    if (!auth.user || !auth.builder) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const session = await createBuilderCheckoutSession({
      admin,
      request,
      builder: auth.builder,
      userEmail: auth.user.email,
      type: parsedBody.data.type,
    })

    return NextResponse.json({
      checkoutUrl: session.url,
      sessionId: session.id,
    })
  } catch (error) {
    console.error('[builder.billing.checkout] Failed to create checkout session', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start checkout' },
      { status: 500 }
    )
  }
}
