export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  ensureStripeCustomerForBuilder,
  getAuthenticatedBuilderBillingProfile,
} from '@/lib/billing/builder-billing'
import {
  BuilderPaymentMethodFlowError,
  createBuilderPaymentMethodSetupIntent,
  listBuilderPaymentMethods,
  type BuilderPaymentMethodDb,
} from '@/lib/planner/builderPaymentMethods'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const setupIntentSchema = z.object({
  setupAttemptId: z.string().uuid(),
}).strict()

/** Lists card PaymentMethods attached to the authenticated organizer's Customer. */
export async function GET() {
  try {
    const auth = await getAuthenticatedBuilderBillingProfile(createClient())
    if (!auth.user || !auth.builder) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const customerId = auth.builder.stripe_customer_id?.trim()
    if (!customerId) return NextResponse.json({ paymentMethods: [] })

    const paymentMethods = await listBuilderPaymentMethods({
      db: createServiceRoleClient() as unknown as BuilderPaymentMethodDb,
      builderId: auth.builder.id,
      customerId,
    })

    return NextResponse.json({ paymentMethods })
  } catch (error) {
    return paymentMethodErrorResponse(error, 'Unable to load payment methods')
  }
}

/** Creates an on-session SetupIntent for the authenticated organizer. */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedBuilderBillingProfile(createClient())
    if (!auth.user || !auth.builder) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const parsed = setupIntentSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payment-method setup request' },
        { status: 400 }
      )
    }

    const admin = createServiceRoleClient()
    const customerId = await ensureStripeCustomerForBuilder({
      admin,
      builder: auth.builder,
      email: auth.user.email,
    })
    const setupIntent = await createBuilderPaymentMethodSetupIntent({
      builderId: auth.builder.id,
      userId: auth.user.id,
      customerId,
      setupAttemptId: parsed.data.setupAttemptId,
    })

    return NextResponse.json(setupIntent)
  } catch (error) {
    return paymentMethodErrorResponse(error, 'Unable to start payment-method setup')
  }
}

function paymentMethodErrorResponse(error: unknown, fallback: string) {
  if (error instanceof BuilderPaymentMethodFlowError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    )
  }

  console.error('[planner.payment-methods] Request failed', error)
  return NextResponse.json({ error: fallback }, { status: 500 })
}
