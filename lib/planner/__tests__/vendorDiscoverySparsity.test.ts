import { buildSparsePrompt, evaluateVendorPoolSparsity } from '@/lib/planner/vendorDiscoverySparsity'

describe('vendor discovery sparsity prompts', () => {
  it('prompts before widening when the in-city pool is below threshold', () => {
    const result = evaluateVendorPoolSparsity({
      plan: { event_city: 'Oakland', neighborhood: 'Downtown Oakland' },
      serviceType: 'photographer',
      results: [
        { city: 'Oakland', service_type: 'photographer' },
        { city: 'Oakland', service_type: 'photographer' },
        { city: 'San Francisco', service_type: 'photographer' },
      ],
      threshold: 3,
    })

    expect(result).toMatchObject({
      sparse: true,
      in_city_count: 2,
      in_city_threshold: 3,
    })
    expect(result.adjacent_cities).toContain('Berkeley')
    expect(result.suggested_prompt).toContain('I found only 2 in-city options for photographer in Oakland')
  })

  it('does not prompt once the organizer approved adjacent cities', () => {
    const result = evaluateVendorPoolSparsity({
      plan: {
        event_city: 'Oakland',
        vendor_out_of_city_approved: true,
        vendor_approved_adjacent_cities: ['Berkeley'],
      },
      serviceType: 'catering',
      results: [{ city: 'Oakland' }],
      threshold: 3,
    })

    expect(result.sparse).toBe(false)
    expect(result.suggested_prompt).toBeNull()
  })

  it('uses collaborative copy for sparse-pool prompts', () => {
    expect(buildSparsePrompt({
      serviceType: 'av_production',
      eventCity: 'Oakland',
      inCityCount: 1,
      adjacentCities: ['Berkeley', 'Emeryville'],
    })).toBe('I found only 1 in-city option for av production in Oakland. Want me to widen vendor sourcing to nearby cities like Berkeley or Emeryville? I will not send outreach until you approve the updated shortlist.')
  })
})
