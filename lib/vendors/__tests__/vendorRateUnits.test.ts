import {
  vendorRateCentsToFormDollars,
  vendorRateFormDollarsToCents,
} from '@/lib/vendors/vendorRateUnits'
import {
  buildVendorBaseRateRepairAuditInsert,
  classifyVendorBaseRateRepair,
  shouldApplyVendorBaseRateRepair,
} from '@/lib/vendors/vendorBaseRateRepair'

describe('vendor rate unit boundaries', () => {
  it('round-trips pricing and services form dollars through persisted cents', () => {
    const persistedCents = vendorRateFormDollarsToCents(95.5)

    expect(persistedCents).toBe(9550)
    expect(vendorRateCentsToFormDollars(persistedCents)).toBe(95.5)
    expect(vendorRateFormDollarsToCents(vendorRateCentsToFormDollars(persistedCents))).toBe(9550)
  })

  it('classifies a plausible legacy-dollar row for deterministic conversion', () => {
    expect(classifyVendorBaseRateRepair({
      id: 'vendor-1',
      name: 'Cents Catering',
      pricing_model: 'flat_rate',
      base_rate: 95.5,
    })).toMatchObject({
      action: 'convert',
      currentBaseRate: 95.5,
      proposedBaseRateCents: 9550,
    })
  })

  it('flags sub-$50 rows for review instead of changing them', () => {
    expect(classifyVendorBaseRateRepair({
      id: 'vendor-2',
      name: 'Unknown rate',
      pricing_model: 'hourly',
      base_rate: 25,
    })).toMatchObject({
      action: 'review',
      currentBaseRate: 25,
      proposedBaseRateCents: null,
    })
  })

  it('flags a plausible amount with an unknown pricing model for admin review', () => {
    expect(classifyVendorBaseRateRepair({
      id: 'vendor-unknown-model',
      name: 'Unknown model',
      pricing_model: null,
      base_rate: 95.5,
    })).toMatchObject({
      action: 'review',
      currentBaseRate: 95.5,
      proposedBaseRateCents: null,
    })
  })

  it('does not guess outside the documented less-than-500 heuristic', () => {
    expect(classifyVendorBaseRateRepair({
      id: 'vendor-3',
      name: 'Outside heuristic',
      pricing_model: 'flat_rate',
      base_rate: 500,
    })).toBeNull()
  })

  it('keeps the repair script in dry-run mode unless apply is explicit', () => {
    expect(shouldApplyVendorBaseRateRepair([])).toBe(false)
    expect(shouldApplyVendorBaseRateRepair(['--verbose'])).toBe(false)
    expect(shouldApplyVendorBaseRateRepair(['--apply'])).toBe(true)
  })

  it('builds an admin_audit_log insert that matches the generated schema', () => {
    const candidate = classifyVendorBaseRateRepair({
      id: '550e8400-e29b-41d4-a716-446655440101',
      name: 'Cents Catering',
      pricing_model: 'flat_rate',
      base_rate: 95.5,
    })
    if (!candidate) throw new Error('Expected a repair candidate')

    const auditInsert = buildVendorBaseRateRepairAuditInsert({
      candidate,
      action: 'vendor_base_rate_unit_repaired',
      afterBaseRate: 9550,
    })

    expect(auditInsert).not.toHaveProperty('reason')
    expect(auditInsert).toMatchObject({
      action: 'vendor_base_rate_unit_repaired',
      entity_type: 'vendor_profiles',
      entity_id: '550e8400-e29b-41d4-a716-446655440101',
      before_state: { base_rate: 95.5 },
      after_state: { base_rate: 9550 },
      metadata: expect.objectContaining({
        reason: 'legacy_vendor_base_rate_dollars_to_cents',
      }),
    })
  })
})
