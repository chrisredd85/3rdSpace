jest.mock('server-only', () => ({}))

import { ARCHETYPES, DEFAULT_ARCHETYPE, archetypeFor, resolveArchetypeKey } from '@/lib/planner/archetypes'
import { commercialModelSchema, venueTypeSchema } from '@/lib/planner/archetypes/types'

describe('resolveArchetypeKey', () => {
  it('resolves common archetype aliases', () => {
    expect(resolveArchetypeKey('happy hour')).toBe('networking_mixer')
    expect(resolveArchetypeKey('founders dinner')).toBe('founder_operator_dinner')
    expect(resolveArchetypeKey('fireside chat')).toBe('panel_fireside')
    expect(resolveArchetypeKey('offsite')).toBe('retreat_offsite')
  })

  it('does not resolve removed conference archetypes', () => {
    expect(resolveArchetypeKey('conference')).toBeNull()
    expect(resolveArchetypeKey('summit')).toBeNull()
  })

  it('falls back to DEFAULT_ARCHETYPE when archetypeFor cannot resolve a phrase', () => {
    expect(archetypeFor('something completely custom').key).toBe(DEFAULT_ARCHETYPE.key)
  })

  it('keeps all 18 archetypes internally valid', () => {
    expect(ARCHETYPES).toHaveLength(18)

    for (const archetype of ARCHETYPES) {
      expect(archetype.aliases.length).toBeGreaterThan(0)
      expect(archetype.preferred_venue_types.every((venueType) => venueTypeSchema.safeParse(venueType).success)).toBe(true)
      expect(
        archetype.preferred_commercial_models.every((model) => commercialModelSchema.safeParse(model).success)
      ).toBe(true)
    }
  })
})
