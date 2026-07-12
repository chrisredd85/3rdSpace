export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthenticatedBuilderBillingProfile } from '@/lib/billing/builder-billing'
import {
  BuilderPaymentMethodFlowError,
  confirmBuilderPaymentMethodSetup,
  type BuilderPaymentMethodDb,
} from '@/lib/planner/builderPaymentMethods'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const confirmSetupSchema = z.object({
  setupIntentId: z.string().trim().regex(/^seti_[A-Za-z0-9_]+$/).max(255),
}).strict()

/** Verifies completed Stripe setup truth before caching safe card metadata. */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedBuilderBillingProfile(createClient())
    if (!auth.user || !auth.builder) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const parsed = confirmSetupSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payment-method confirmation request' },
        { status: 400 }
      )
    }

    const customerId = auth.builder.stripe_customer_id?.trim()
    if (!customerId) {
      return NextResponse.json(
        {
          error: 'Start a secure payment-method setup before confirming it.',
          code: 'builder_payment_customer_missing',
        },
        { status: 409 }
      )
    }

    const paymentMethod = await confirmBuilderPaymentMethodSetup({
      db: createServiceRoleClient() as unknown as BuilderPaymentMethodDb,
      builderId: auth.builder.id,
      userId: auth.user.id,
      customerId,
      setupIntentId: parsed.data.setupIntentId,
    })

    return NextResponse.json({ paymentMethod })
  } catch (error) {
    if (error instanceof BuilderPaymentMethodFlowError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      )
    }

    console.error('[planner.payment-methods.confirm] Request failed', error)
    return NextResponse.json({ error: 'Unable to confirm payment-method setup' }, { status: 500 })
  }
}
