import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { calculateBookingRefund } from '@/lib/payments/refund-calculator'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

export const runtime = 'nodejs'

const refundCalculationSchema = z.object({
  bookingId: z.string().uuid(),
})

/**
 * Calculates the refundable platform fee and vendor service amount for a booking cancellation.
 *
 * @route POST /api/payments/refund/calculate
 * @auth Required - builder owner of the event.
 *
 * @param request - JSON body containing bookingId.
 * @returns Policy-based refund breakdown.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = refundCalculationSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid refund calculation payload', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const supabase = createClient()
    const admin = createServiceRoleClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { builderProfileId, error: builderProfileError } = await getBuilderProfileId(supabase, user.id)
    if (builderProfileError || !builderProfileId) {
      return NextResponse.json({ error: 'Builder profile not found' }, { status: 403 })
    }

    const calculation = await calculateBookingRefund({
      admin,
      builderId: builderProfileId,
      bookingId: parsedBody.data.bookingId,
    })

    return NextResponse.json(calculation)
  } catch (error) {
    const status = (error as Error & { status?: number }).status || 500
    console.error('[payments.refund.calculate] Failed to calculate refund', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to calculate refund' },
      { status }
    )
  }
}
