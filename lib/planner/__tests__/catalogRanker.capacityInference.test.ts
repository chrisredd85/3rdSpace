import {
  CAPACITY_INFERENCE_CONFIDENCE_THRESHOLD,
  resolveVenueCapacityForRanking,
} from '@/lib/planner/catalogRanker'

describe('resolveVenueCapacityForRanking', () => {
  it('prefers explicit catalog capacity over inferred capacity', () => {
    expect(resolveVenueCapacityForRanking({
      capacity_standing: 80,
      inferred_capacity_standing: 140,
      capacity_inference_confidence: 0.95,
    })).toBe(80)
  })

  it('trusts high-confidence inferred capacity when explicit capacity is unknown', () => {
    expect(resolveVenueCapacityForRanking({
      inferred_capacity_standing: 120,
      inferred_capacity_seated: 72,
      capacity_inference_confidence: CAPACITY_INFERENCE_CONFIDENCE_THRESHOLD,
      capacity_inference_admin_status: 'pending',
    })).toBe(120)
  })

  it('trusts admin-approved or edited inferred capacity below the automatic threshold', () => {
    expect(resolveVenueCapacityForRanking({
      inferred_capacity_standing: 90,
      capacity_inference_confidence: 0.4,
      capacity_inference_admin_status: 'approved',
    })).toBe(90)

    expect(resolveVenueCapacityForRanking({
      inferred_capacity_seated: 42,
      capacity_inference_confidence: 0.3,
      capacity_inference_admin_status: 'edited',
    })).toBe(42)
  })

  it('does not trust rejected or low-confidence pending inferred capacity', () => {
    expect(resolveVenueCapacityForRanking({
      inferred_capacity_standing: 120,
      capacity_inference_confidence: 0.9,
      capacity_inference_admin_status: 'rejected',
    })).toBeNull()

    expect(resolveVenueCapacityForRanking({
      inferred_capacity_standing: 120,
      capacity_inference_confidence: 0.69,
      capacity_inference_admin_status: 'pending',
    })).toBeNull()
  })
})
