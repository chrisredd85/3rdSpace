import {
  buildSelectedVendorLine,
  estimateCommittedPriceCents,
  getPlanSourceEventId,
  mergeSelectedVendorIntoMetadata,
} from '@/lib/planner/planVendorSelections'
import type { Plan } from '@/lib/types'

describe('plan vendor selections', () => {
  it('merges invited vendors into shopping_list.selected_vendors without dropping existing metadata', () => {
    const selectedVendor = buildSelectedVendorLine({
      vendor: {
        id: 'vendor-1',
        business_name: 'DJ Maya',
        service_type: 'dj',
        claim_status: 'invited_unclaimed',
        is_claimed: false,
      },
      rateAmount: 450,
      rateType: 'flat',
      priceCents: 45000,
      sourceEventId: 'event-1',
      provenanceLabel: null,
    })

    const metadata = mergeSelectedVendorIntoMetadata({
      event_id: 'event-1',
      shopping_list: {
        selected_venue: { id: 'venue-1' },
        selected_vendors: [{ vendor_id: 'vendor-2', external_name: 'Photo Team' }],
      },
    }, selectedVendor) as Record<string, any>

    expect(metadata.event_id).toBe('event-1')
    expect(metadata.shopping_list.selected_venue).toEqual({ id: 'venue-1' })
    expect(metadata.shopping_list.selected_vendors).toHaveLength(2)
    expect(metadata.shopping_list.selected_vendors[0]).toMatchObject({
      vendor_id: 'vendor-1',
      external_name: 'DJ Maya',
      claim_status: 'invited_unclaimed',
      is_claimed: false,
      price_cents: 45000,
    })
  })

  it('replaces an existing vendor selection instead of duplicating it', () => {
    const first = buildSelectedVendorLine({
      vendor: { id: 'vendor-1', name: 'DJ Maya', service_type: 'dj' },
      rateAmount: 450,
      rateType: 'flat',
      priceCents: 45000,
      sourceEventId: null,
      provenanceLabel: null,
    })
    const second = buildSelectedVendorLine({
      vendor: { id: 'vendor-1', name: 'DJ Maya', service_type: 'dj' },
      rateAmount: 500,
      rateType: 'flat',
      priceCents: 50000,
      sourceEventId: null,
      provenanceLabel: null,
    })

    const metadata = mergeSelectedVendorIntoMetadata(
      mergeSelectedVendorIntoMetadata({}, first),
      second
    ) as Record<string, any>

    expect(metadata.shopping_list.selected_vendors).toHaveLength(1)
    expect(metadata.shopping_list.selected_vendors[0].price_cents).toBe(50000)
  })

  it('converts per-person private rates into total selected vendor cost', () => {
    expect(estimateCommittedPriceCents(35, 'per_person', 40)).toBe(140000)
  })

  it('uses the canonical plan event before legacy metadata lineage', () => {
    expect(getPlanSourceEventId({
      materialized_event_id: 'canonical-event',
      metadata: { event_id: 'legacy-event' },
    } as Plan)).toBe('canonical-event')
    expect(getPlanSourceEventId({
      materialized_event_id: null,
      metadata: { event_id: 'legacy-event' },
    } as Plan)).toBe('legacy-event')
  })
})
