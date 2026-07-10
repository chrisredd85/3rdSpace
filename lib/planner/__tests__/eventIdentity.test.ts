import { ARCHETYPES } from '@/lib/planner/archetypes'
import {
  CANONICAL_EVENT_TYPE_BY_ARCHETYPE,
  getPlanCanonicalEventId,
  resolveCanonicalEventTaxonomy,
} from '@/lib/planner/eventIdentity'

describe('canonical planner event identity', () => {
  it('maps all 19 archetypes losslessly and exhaustively', () => {
    const configuredKeys = ARCHETYPES.map((archetype) => archetype.key).sort()
    const mappedKeys = Object.keys(CANONICAL_EVENT_TYPE_BY_ARCHETYPE).sort()

    expect(configuredKeys).toHaveLength(19)
    expect(mappedKeys).toEqual(configuredKeys)
    for (const archetype of ARCHETYPES) {
      expect(CANONICAL_EVENT_TYPE_BY_ARCHETYPE[archetype.key as keyof typeof CANONICAL_EVENT_TYPE_BY_ARCHETYPE])
        .toBe(archetype.key)
    }
  })

  it('resolves supported aliases but never falls back for unknown taxonomy', () => {
    expect(resolveCanonicalEventTaxonomy('founders dinner')).toEqual({
      archetypeKey: 'founder_operator_dinner',
      eventType: 'founder_operator_dinner',
    })
    expect(resolveCanonicalEventTaxonomy('conference')).toBeNull()
    expect(resolveCanonicalEventTaxonomy(null)).toBeNull()
  })

  it('prefers the canonical FK and uses metadata only for legacy lineage', () => {
    expect(getPlanCanonicalEventId({
      materialized_event_id: 'canonical-event',
      metadata: { event_id: 'legacy-event' },
    })).toBe('canonical-event')
    expect(getPlanCanonicalEventId({
      materialized_event_id: null,
      metadata: { event_id: 'legacy-event' },
    })).toBe('legacy-event')
    expect(getPlanCanonicalEventId({
      materialized_event_id: null,
      metadata: {},
    })).toBeNull()
  })
})
