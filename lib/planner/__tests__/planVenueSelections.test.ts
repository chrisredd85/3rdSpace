import { getPlanSourceEventId } from '@/lib/planner/planVenueSelections'
import type { Plan } from '@/lib/types'

describe('plan venue selections canonical identity', () => {
  it('uses only the canonical plan event identity', () => {
    expect(getPlanSourceEventId({
      materialized_event_id: 'canonical-event',
      metadata: { event_id: 'legacy-event' },
    } as Plan)).toBe('canonical-event')
    expect(getPlanSourceEventId({
      materialized_event_id: null,
      metadata: { event_id: 'legacy-event' },
    } as Plan)).toBeNull()
  })
})
