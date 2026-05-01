export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const depositConfigSchema = z.object({
  vendorId: z.string().uuid('Invalid vendor id'),
  requiresDeposit: z.boolean(),
  depositType: z.enum(['fixed', 'percentage']).default('fixed'),
  depositAmount: z.number().positive().nullable().optional(),
  depositPercentage: z.number().int().min(1).max(100).nullable().optional(),
  depositRefundable: z.boolean().default(true),
  depositTerms: z.string().trim().max(2000).nullable().optional(),
})

type DepositConfigInput = z.infer<typeof depositConfigSchema>

const NO_DEPOSIT_CONFIG = {
  requires_deposit: false,
  deposit_amount: null,
  deposit_type: null,
  deposit_percentage: null,
  deposit_refundable: true,
  deposit_terms: null,
}

/**
 * Detects older databases that do not have the newer deposit columns yet.
 *
 * @param error - Supabase/PostgREST error.
 * @returns Whether a legacy fallback should be used.
 */
function isMissingDepositSchema(error: unknown) {
  const issue = error as { code?: string; message?: string } | null
  return (
    issue?.code === '42703' ||
    issue?.code === 'PGRST204' ||
    Boolean(issue?.message?.includes('requires_deposit'))
  )
}

/**
 * Builds the row update for a vendor deposit configuration.
 *
 * @param config - Validated deposit payload from the vendor owner.
 * @returns Column updates for the vendor_profiles table.
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
      deposit_amount: null,
      deposit_percentage: null,
    }
  }

  return {
    ...baseUpdate,
    deposit_type: config.depositType,
    deposit_amount: config.depositType === 'fixed' ? config.depositAmount : null,
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
 * Returns public deposit requirements for a vendor.
 *
 * @route GET /api/vendor/deposit?vendorId={id}
 * @auth Public
 *
 * @param request - Request with a vendorId query parameter.
 * @returns Deposit configuration used during booking.
 */
export async function GET(request: NextRequest) {
  try {
    const vendorId = request.nextUrl.searchParams.get('vendorId')

    if (!vendorId) {
      return NextResponse.json({ error: 'vendorId required' }, { status: 400 })
    }

    const parsedVendorId = z.string().uuid().safeParse(vendorId)
    if (!parsedVendorId.success) {
      return NextResponse.json({ error: 'Invalid vendor id' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: vendor, error } = await supabase
      .from('vendor_profiles')
      .select(`
        requires_deposit,
        deposit_amount,
        deposit_type,
        deposit_percentage,
        deposit_refundable,
        deposit_terms
      `)
      .eq('id', parsedVendorId.data)
      .maybeSingle()

    if (error) {
      if (isMissingDepositSchema(error)) {
        const { data: legacyVendor, error: legacyError } = await supabase
          .from('vendor_profiles')
          .select('id, deposit_required, deposit_amount')
          .eq('id', parsedVendorId.data)
          .maybeSingle()

        if (!legacyError && legacyVendor) {
          const legacy = legacyVendor as { deposit_required?: boolean | number | null; deposit_amount?: number | null }
          const requiresDeposit = Boolean(legacy.deposit_required)
          return NextResponse.json({
            ...NO_DEPOSIT_CONFIG,
            requires_deposit: requiresDeposit,
            deposit_amount: requiresDeposit ? legacy.deposit_amount ?? null : null,
            deposit_type: requiresDeposit ? 'fixed' : null,
          })
        }

        const { data: existingVendor } = await supabase
          .from('vendor_profiles')
          .select('id')
          .eq('id', parsedVendorId.data)
          .maybeSingle()

        if (existingVendor) {
          return NextResponse.json(NO_DEPOSIT_CONFIG)
        }
      }

      console.error('[vendor.deposit] Failed to load deposit config', error)
      return NextResponse.json({ error: 'Failed to load deposit requirements' }, { status: 500 })
    }

    if (!vendor) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    return NextResponse.json(vendor)
  } catch (error) {
    console.error('[vendor.deposit] Unexpected GET error', error)
    return NextResponse.json({ error: 'Failed to load deposit requirements' }, { status: 500 })
  }
}

/**
 * Saves vendor deposit requirements for a vendor owner.
 *
 * @route POST /api/vendor/deposit
 * @auth Required - vendor owner only.
 *
 * @param request - JSON body containing vendorId and deposit settings.
 * @returns Updated vendor row.
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

    const { data: vendor, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select('id, user_id')
      .eq('id', parsedBody.data.vendorId)
      .maybeSingle()

    if (vendorError) {
      console.error('[vendor.deposit] Vendor lookup failed', vendorError)
      return NextResponse.json({ error: 'Failed to verify vendor ownership' }, { status: 500 })
    }

    if (!vendor) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    if ((vendor as { user_id?: string }).user_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const { data: updated, error: updateError } = await supabase
      .from('vendor_profiles')
      .update(buildDepositUpdate(parsedBody.data) as never)
      .eq('id', parsedBody.data.vendorId)
      .select('*')
      .single()

    if (updateError) {
      console.error('[vendor.deposit] Failed to update deposit config', updateError)
      return NextResponse.json({ error: 'Failed to save deposit requirements' }, { status: 500 })
    }

    return NextResponse.json({ vendor: updated })
  } catch (error) {
    console.error('[vendor.deposit] Unexpected POST error', error)
    return NextResponse.json({ error: 'Failed to save deposit requirements' }, { status: 500 })
  }
}
