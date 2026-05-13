import { buildRateAgreementCommitPlan } from '@/lib/vendors/rateAgreements'

describe('vendor private rate agreement commit planning', () => {
  it('does not insert a new agreement when the selected rate matches the last confirmed rate', () => {
    const plan = buildRateAgreementCommitPlan({
      lastConfirmedAmount: 450,
      newAmount: 450,
      vendorName: 'DJ Maya',
    })

    expect(plan.should_insert).toBe(false)
    expect(plan.provenance_state).toBe('same_confirmed_rate')
  })

  it('inserts a proposed agreement when the rate changes', () => {
    const plan = buildRateAgreementCommitPlan({
      lastConfirmedAmount: 450,
      newAmount: 500,
      vendorName: 'DJ Maya',
    })

    expect(plan.should_insert).toBe(true)
    expect(plan.provenance_state).toBe('edited_confirmed_rate')
    expect(plan.warning).toBeNull()
  })

  it('uses public base rate as a first known proposed agreement when no prior agreement exists', () => {
    const plan = buildRateAgreementCommitPlan({
      lastConfirmedAmount: null,
      newAmount: 650,
      vendorName: 'DJ Maya',
    })

    expect(plan.should_insert).toBe(true)
    expect(plan.provenance_state).toBe('first_known_rate')
  })

  it('surfaces a non-blocking warning when the edited rate differs by more than 20 percent', () => {
    const plan = buildRateAgreementCommitPlan({
      lastConfirmedAmount: 450,
      newAmount: 600,
      vendorName: 'DJ Maya',
    })

    expect(plan.should_insert).toBe(true)
    expect(plan.warning_delta_pct).toBe(33)
    expect(plan.warning).toContain('33% different')
  })
})
