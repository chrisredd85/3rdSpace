import {
  loadVendorPricingFormMoney,
  loadVendorServicesBaseRateDollars,
  saveVendorPricingFormMoney,
  saveVendorServicesBaseRateCents,
  vendorRateCentsToFormDollars,
  vendorRateFormDollarsToCents,
} from '@/lib/vendors/vendorRateUnits'
import { readMoneyCents } from '@/lib/vendors/vendorGates'
import {
  buildVendorBaseRateRepairRpcArgs,
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

  it('round-trips $95.50 through the pricing-page load/save adapter and ranker', () => {
    const saved = saveVendorPricingFormMoney({
      baseRateDollars: 95.5,
      perPersonRateDollars: 5.25,
    })
    const loaded = loadVendorPricingFormMoney({
      baseRateCents: saved.baseRateCents,
      perPersonRateCents: saved.perPersonRateCents,
    })

    expect(saved).toEqual({ baseRateCents: 9550, perPersonRateCents: 525 })
    expect(loaded).toEqual({ baseRateDollars: 95.5, perPersonRateDollars: 5.25 })
    expect(readMoneyCents(saved.baseRateCents)).toBe(9550)
  })

  it('round-trips $95.50 through the services-page load/save adapter and ranker', () => {
    const persistedCents = saveVendorServicesBaseRateCents(95.5)

    expect(persistedCents).toBe(9550)
    expect(loadVendorServicesBaseRateDollars(persistedCents)).toBe(95.5)
    expect(readMoneyCents(persistedCents)).toBe(9550)
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

  it('builds service-role RPC arguments with audit context in metadata', () => {
    const candidate = classifyVendorBaseRateRepair({
      id: '550e8400-e29b-41d4-a716-446655440101',
      name: 'Cents Catering',
      pricing_model: 'flat_rate',
      base_rate: 95.5,
    })
    if (!candidate) throw new Error('Expected a repair candidate')

    const rpcArgs = buildVendorBaseRateRepairRpcArgs({
      candidate,
      action: 'vendor_base_rate_unit_repaired',
    })

    expect(rpcArgs).not.toHaveProperty('reason')
    expect(rpcArgs).toMatchObject({
      p_audit_action: 'vendor_base_rate_unit_repaired',
      p_vendor_id: '550e8400-e29b-41d4-a716-446655440101',
      p_expected_base_rate: 95.5,
      p_new_base_rate_cents: 9550,
      p_metadata: expect.objectContaining({
        reason: 'legacy_vendor_base_rate_dollars_to_cents',
      }),
    })
  })
})
