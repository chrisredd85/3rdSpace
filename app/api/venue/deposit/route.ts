export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { centsToDollars, dollarsToCents, readCents } from '@/lib/money'
import { createClient } from '@/lib/supabase/server'

const depositConfigSchema = z.object({
  venueId: z.string().uuid('Invalid venue id'),
  requiresDeposit: z.boolean(),
  depositType: z.enum(['fixed', 'percentage']).default('fixed'),
  depositAmount: z.number().positive().nullable().optional(),
  depositPercentage: z.number().int().min(1).max(100).nullable().optional(),
  depositRefundable: z.boolean().default(true),
  depositTerms: z.string().trim().max(2000).nullable().optional(),
})

type DepositConfigInput = z.infer<typeof depositConfigSchema>

/**
 * Builds the row update for a venue deposit configuration.
 *
 * @param config - Validated deposit payload from the venue owner.
 * @returns Column updates for the venues table.
 */
function buildDepositUpdate(config: DepositConfigInput) {
  const baseUpdate = {
    requires_deposit: config.requiresDeposit,
    deposit_refundable: config.depositRefundable,
    deposit_terms: config.depositTerms || null,
    updated_at: new Date().toISOString(),
  }

  if (!config.requiresDeposit) {
    return {
      ...baseUpdate,
      deposit_type: null,
      deposit_amount_cents: null,
      deposit_percentage: null,
    }
  }

  return {
    ...baseUpdate,
    deposit_type: config.depositType,
    deposit_amount_cents: config.depositType === 'fixed' ? dollarsToCents(config.depositAmount) : null,
    deposit_percentage: config.depositType === 'percentage' ? config.depositPercentage : null,
  }
}

/**
 * Applies business validation beyond shape checks.
 *
 * @param config - Validated deposit config.
 * @returns Error message when invalid, otherwise null.
 */
function validateDepositBusinessRules(config: DepositConfigInput) {
  if (!config.requiresDeposit) return null

  if (config.depositType === 'fixed' && (!config.depositAmount || config.depositAmount <= 0)) {
    return 'Deposit amount required for fixed deposits'
  }

  if (
    config.depositType === 'percentage' &&
    (!config.depositPercentage || config.depositPercentage <= 0 || config.depositPercentage > 100)
  ) {
    return 'Deposit percentage must be between 1 and 100'
  }

  return null
}

/**
 * Returns public deposit requirements for a venue.
 *
 * @route GET /api/venue/deposit?venueId={id}
 * @auth Public
 *
 * @param request - Request with a venueId query parameter.
 * @returns Deposit configuration used during booking.
 */
export async function GET(request: NextRequest) {
  try {
    const venueId = request.nextUrl.searchParams.get('venueId')

    if (!venueId) {
      return NextResponse.json({ error: 'venueId required' }, { status: 400 })
    }

    const parsedVenueId = z.string().uuid().safeParse(venueId)
    if (!parsedVenueId.success) {
      return NextResponse.json({ error: 'Invalid venue id' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: venue, error } = await supabase
      .from('venues')
      .select(`
        requires_deposit,
        deposit_amount,
        deposit_amount_cents,
        deposit_type,
        deposit_percentage,
        deposit_refundable,
        deposit_terms
      `)
      .eq('id', parsedVenueId.data)
      .maybeSingle()

    if (error) {
      console.error('[venue.deposit] Failed to load deposit config', error)
      return NextResponse.json({ error: 'Failed to load deposit requirements' }, { status: 500 })
    }

    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 })
    }

    const venueRow = venue as Record<string, unknown>
    const depositAmountCents = readCents(
      venueRow.deposit_amount_cents as number | null | undefined,
      venueRow.deposit_amount as number | null | undefined
    )

    return NextResponse.json({
      ...venueRow,
      deposit_amount: depositAmountCents === null ? null : centsToDollars(depositAmountCents),
    })
  } catch (error) {
    console.error('[venue.deposit] Unexpected GET error', error)
    return NextResponse.json({ error: 'Failed to load deposit requirements' }, { status: 500 })
  }
}

/**
 * Saves venue deposit requirements for a venue owner.
 *
 * @route POST /api/venue/deposit
 * @auth Required - venue owner only.
 *
 * @param request - JSON body containing venueId and deposit settings.
 * @returns Updated venue row.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = depositConfigSchema.safeParse(await request.json())

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid deposit payload', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const validationError = validateDepositBusinessRules(parsedBody.data)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: venue, error: venueError } = await supabase
      .from('venues')
      .select('id, owner_id')
      .eq('id', parsedBody.data.venueId)
      .maybeSingle()

    if (venueError) {
      console.error('[venue.deposit] Venue lookup failed', venueError)
      return NextResponse.json({ error: 'Failed to verify venue ownership' }, { status: 500 })
    }

    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 })
    }

    if ((venue as { owner_id?: string }).owner_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const { data: updated, error: updateError } = await supabase
      .from('venues')
      .update(buildDepositUpdate(parsedBody.data) as never)
      .eq('id', parsedBody.data.venueId)
      .select('*')
      .single()

    if (updateError) {
      console.error('[venue.deposit] Failed to update deposit config', updateError)
      return NextResponse.json({ error: 'Failed to save deposit requirements' }, { status: 500 })
    }

    return NextResponse.json({ venue: updated })
  } catch (error) {
    console.error('[venue.deposit] Unexpected POST error', error)
    return NextResponse.json({ error: 'Failed to save deposit requirements' }, { status: 500 })
  }
}
