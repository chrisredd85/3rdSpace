import type { VendorBaseRateCents } from '@/lib/money'
import type { Database, Json } from '@/lib/types/database-generated'
import { vendorRateFormDollarsToCents } from '@/lib/vendors/vendorRateUnits'

export const REPAIRABLE_VENDOR_PRICING_MODELS = [
  'flat_rate',
  'flat',
  'package',
  'hourly',
  'hybrid',
] as const
export const VENDOR_BASE_RATE_REPAIR_SCRIPT = 'scripts/admin/repair-vendor-base-rate-units.ts'
export const VENDOR_BASE_RATE_REPAIR_REASON = 'legacy_vendor_base_rate_dollars_to_cents'

export type VendorBaseRateRepairRow = {
  id: string
  name: string | null
  pricing_model: string | null
  base_rate: number | string | null
  updated_at?: string | null
}

export type VendorBaseRateRepairCandidate = {
  row: VendorBaseRateRepairRow
  action: 'convert' | 'review'
  currentBaseRate: number
  proposedBaseRateCents: VendorBaseRateCents | null
  reason: string
}

const LEGACY_DOLLAR_HEURISTIC_MAX_EXCLUSIVE = 500
const REALISTIC_MINIMUM_DOLLARS = 50
type AdminAuditLogInsert = Database['public']['Tables']['admin_audit_log']['Insert']

export function shouldApplyVendorBaseRateRepair(args: readonly string[]): boolean {
  return args.includes('--apply')
}

/**
 * Classifies legacy vendor rates without guessing at ambiguous low values.
 * Values outside the documented heuristic are intentionally ignored.
 */
export function classifyVendorBaseRateRepair(
  row: VendorBaseRateRepairRow
): VendorBaseRateRepairCandidate | null {
  const currentBaseRate = typeof row.base_rate === 'string'
    ? Number(row.base_rate)
    : row.base_rate
  if (
    typeof currentBaseRate !== 'number' ||
    !Number.isFinite(currentBaseRate) ||
    currentBaseRate <= 0 ||
    currentBaseRate >= LEGACY_DOLLAR_HEURISTIC_MAX_EXCLUSIVE
  ) {
    return null
  }

  if (!REPAIRABLE_VENDOR_PRICING_MODELS.includes(
    row.pricing_model as (typeof REPAIRABLE_VENDOR_PRICING_MODELS)[number]
  )) {
    return {
      row,
      action: 'review',
      currentBaseRate,
      proposedBaseRateCents: null,
      reason: 'Pricing model is missing or does not support the $50 minimum heuristic.',
    }
  }

  if (currentBaseRate < REALISTIC_MINIMUM_DOLLARS) {
    return {
      row,
      action: 'review',
      currentBaseRate,
      proposedBaseRateCents: null,
      reason: 'Value is below both the legacy-dollar heuristic and the realistic $50 minimum.',
    }
  }

  return {
    row,
    action: 'convert',
    currentBaseRate,
    proposedBaseRateCents: vendorRateFormDollarsToCents(currentBaseRate),
    reason: 'Value is a plausible $50-$499 legacy dollar rate stored in a cents-semantic column.',
  }
}

export function buildVendorBaseRateRepairAuditInsert(input: {
  candidate: VendorBaseRateRepairCandidate
  action: string
  afterBaseRate: number | null
  adminUserId?: string | null
  metadata?: Record<string, Json | undefined>
}): AdminAuditLogInsert {
  return {
    admin_user_id: input.adminUserId ?? null,
    action: input.action,
    entity_type: 'vendor_profiles',
    entity_id: input.candidate.row.id,
    before_state: { base_rate: input.candidate.currentBaseRate },
    after_state: { base_rate: input.afterBaseRate },
    metadata: {
      script: VENDOR_BASE_RATE_REPAIR_SCRIPT,
      reason: VENDOR_BASE_RATE_REPAIR_REASON,
      classification: input.candidate.action,
      heuristic: '0 < base_rate < 500; realistic minimum $50',
      ...input.metadata,
    },
  }
}
