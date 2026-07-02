jest.mock('server-only', () => ({}))

import { PILOT_PHRASES } from '@/test/fixtures/pilot-phrases'
import { resolveArchetypeMatch } from '@/lib/planner/archetypes'

describe('pilot phrase resolver snapshot', () => {
  it('keeps archetype resolution stable for pilot phrases', () => {
    const results = PILOT_PHRASES.map(({ phrase }) => {
      const result = resolveArchetypeMatch(phrase)

      return {
        phrase,
        archetype: result?.key ?? null,
        match_strength: result?.match_strength ?? null,
        matched_alias: result?.matched_alias ?? null,
      }
    })

    expect(results).toMatchSnapshot()
  })
})
