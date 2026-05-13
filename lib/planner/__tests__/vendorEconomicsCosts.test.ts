import { buildVendorEconomicsCostSummary } from '@/lib/planner/vendorEconomicsCosts'

describe('vendor economics cost summary', () => {
  it('marks cost confidence as mixed when only some selected vendors have confirmed organizer rates', () => {
    const summary = buildVendorEconomicsCostSummary({
      organizerUserId: 'organizer-a',
      expectedAttendance: 40,
      selections: [
        { vendor_id: 'vendor-confirmed' },
        { vendor_id: 'vendor-estimated' },
      ],
      profiles: [
        { id: 'vendor-confirmed', base_rate: 90000, pricing_model: 'flat' },
        { id: 'vendor-estimated', base_rate: 50000, pricing_model: 'flat' },
      ],
      confirmedAgreements: [
        {
          organizer_user_id: 'organizer-a',
          vendor_id: 'vendor-confirmed',
          status: 'confirmed',
          amount: 650,
          rate_type: 'flat',
          confirmed_at: '2026-05-01T00:00:00.000Z',
        },
      ],
      relationships: [
        { organizer_user_id: 'organizer-a', vendor_id: 'vendor-confirmed' },
      ],
    })

    expect(summary.cost_confidence).toBe('mixed')
    expect(summary.vendor_cost_cents).toBe(115000)
    expect(summary.confirmed_vendor_count).toBe(1)
    expect(summary.estimated_vendor_count).toBe(1)
  })

  it('marks costs as confirmed when all selected vendors have confirmed organizer rates', () => {
    const summary = buildVendorEconomicsCostSummary({
      organizerUserId: 'organizer-a',
      expectedAttendance: 50,
      selections: [
        { vendor_id: 'photographer' },
        { vendor_id: 'caterer' },
      ],
      profiles: [
        { id: 'photographer', base_rate: 100000, pricing_model: 'flat' },
        { id: 'caterer', per_person_rate: 4000, pricing_model: 'per_person' },
      ],
      confirmedAgreements: [
        {
          organizer_user_id: 'organizer-a',
          vendor_id: 'photographer',
          status: 'confirmed',
          amount: 800,
          rate_type: 'flat',
        },
        {
          organizer_user_id: 'organizer-a',
          vendor_id: 'caterer',
          status: 'confirmed',
          amount: 35,
          rate_type: 'per_person',
        },
      ],
      relationships: [
        { organizer_user_id: 'organizer-a', vendor_id: 'photographer' },
        { organizer_user_id: 'organizer-a', vendor_id: 'caterer' },
      ],
    })

    expect(summary.cost_confidence).toBe('confirmed')
    expect(summary.vendor_cost_cents).toBe(255000)
  })

  it('sums deterministic negotiated savings across tier 1 confirmed vendors', () => {
    const summary = buildVendorEconomicsCostSummary({
      organizerUserId: 'organizer-a',
      expectedAttendance: 40,
      selections: [
        { vendor_id: 'dj' },
        { vendor_id: 'av' },
        { vendor_id: 'catalog-only' },
      ],
      profiles: [
        { id: 'dj', base_rate: 90000, pricing_model: 'flat' },
        { id: 'av', base_rate: 70000, pricing_model: 'flat' },
        { id: 'catalog-only', base_rate: 50000, pricing_model: 'flat' },
      ],
      confirmedAgreements: [
        { organizer_user_id: 'organizer-a', vendor_id: 'dj', status: 'confirmed', amount: 650, rate_type: 'flat' },
        { organizer_user_id: 'organizer-a', vendor_id: 'av', status: 'confirmed', amount: 800, rate_type: 'flat' },
        { organizer_user_id: 'organizer-a', vendor_id: 'catalog-only', status: 'confirmed', amount: 400, rate_type: 'flat' },
      ],
      relationships: [
        { organizer_user_id: 'organizer-a', vendor_id: 'dj' },
        { organizer_user_id: 'organizer-a', vendor_id: 'av' },
      ],
    })

    expect(summary.negotiated_savings_cents).toBe(25000)
    expect(summary.lines.find((line) => line.vendor_id === 'catalog-only')?.negotiated_savings_cents).toBe(0)
  })

  it('never uses private confirmed rates from other organizers', () => {
    const summary = buildVendorEconomicsCostSummary({
      organizerUserId: 'organizer-b',
      expectedAttendance: 30,
      selections: [{ vendor_id: 'vendor-1' }],
      profiles: [{ id: 'vendor-1', base_rate: 120000, pricing_model: 'flat' }],
      confirmedAgreements: [
        {
          organizer_user_id: 'organizer-a',
          vendor_id: 'vendor-1',
          status: 'confirmed',
          amount: 300,
          rate_type: 'flat',
        },
      ],
      relationships: [
        { organizer_user_id: 'organizer-a', vendor_id: 'vendor-1' },
      ],
    })

    expect(summary.cost_confidence).toBe('estimated')
    expect(summary.vendor_cost_cents).toBe(120000)
    expect(summary.negotiated_savings_cents).toBe(0)
    expect(summary.lines[0]).toMatchObject({
      source: 'public_profile_rate',
      cost_cents: 120000,
    })
  })
})
