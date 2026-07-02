jest.mock('server-only', () => ({}))

import { AMBIGUOUS_PILOT_PHRASES, PILOT_PHRASES } from '@/test/fixtures/pilot-phrases'
import { resolveArchetypeMatch } from '@/lib/planner/archetypes'

describe('pilot phrase archetype classification', () => {
  for (const { phrase, expected_archetype, notes } of PILOT_PHRASES) {
    it(`"${phrase}" resolves to ${expected_archetype}${notes ? ` (${notes})` : ''}`, () => {
      const result = resolveArchetypeMatch(phrase)

      expect(result).not.toBeNull()
      expect(result?.key).toBe(expected_archetype)
      expect(result?.match_strength).toMatch(/^(exact|fuzzy)$/)
    })
  }

  it('keeps the fixture at the supplied pilot phrase count', () => {
    expect(PILOT_PHRASES).toHaveLength(96)
  })
})

describe('ambiguous pilot phrases', () => {
  for (const { phrase } of AMBIGUOUS_PILOT_PHRASES) {
    it(`"${phrase}" does not exact-match a pilot archetype`, () => {
      const result = resolveArchetypeMatch(phrase)

      expect(result?.match_strength ?? null).not.toBe('exact')
    })
  }
})
