jest.mock('server-only', () => ({}))

import {
  ARCHETYPES,
  DEFAULT_ARCHETYPE,
  archetypeFor,
  resolveArchetypeIntakeContext,
  resolveArchetypeContext,
  resolveArchetypeKey,
} from '@/lib/planner/archetypes'
import { commercialModelSchema, venueTypeSchema } from '@/lib/planner/archetypes/types'

describe('resolveArchetypeKey', () => {
  it('resolves common archetype aliases', () => {
    expect(resolveArchetypeKey('happy hour')).toBe('networking_mixer')
    expect(resolveArchetypeKey('founders dinner')).toBe('founder_operator_dinner')
    expect(resolveArchetypeKey('fireside chat')).toBe('panel_fireside')
    expect(resolveArchetypeKey('listening party')).toBe('listening_party_showcase')
    expect(resolveArchetypeKey('offsite')).toBe('retreat_offsite')
  })

  it('resolves sparse nightlife and screening phrases without extra context', () => {
    expect(resolveArchetypeKey('afterparty')).toBe('nightlife_club_night')
    expect(resolveArchetypeKey('after party')).toBe('nightlife_club_night')
    expect(resolveArchetypeKey('club afters')).toBe('nightlife_club_night')
    expect(resolveArchetypeKey('screening')).toBe('listening_party_showcase')
    expect(resolveArchetypeKey('movie night')).toBe('listening_party_showcase')
    expect(resolveArchetypeKey('documentary screening')).toBe('listening_party_showcase')
  })

  it('canonicalizes broader user phrases for every active archetype', () => {
    const cases: Array<[string, string]> = [
      ['startup mixer for 80 in SOMA', 'networking_mixer'],
      ['operator roundtable for 18 founders', 'founder_operator_dinner'],
      ['app launch reception in Dogpatch', 'brand_product_launch'],
      ['pop-up shop with sampling', 'pop_up_activation'],
      ['AI workshop with hands-on workstations', 'workshop_class'],
      ['start up panle for 110 in Downtown SF', 'panel_fireside'],
      ['founder pitch night for investors', 'demo_day_pitch_night'],
      ['hack-a-thon for 120 builders', 'hackathon'],
      ['member gathering at a cafe', 'community_meetup'],
      ['nonprofit fundraiser dinner', 'fundraiser_gala'],
      ['birthday party for 12 in Castro', 'private_dinner_celebration'],
      ['4th of july day party', 'day_party_brunch_party'],
      ['DJ night with door staff', 'nightlife_club_night'],
      ['mariachi band concert for 40', 'listening_party_showcase'],
      ['playoff watch party', 'watch_party_screening'],
      ['run club brunch in Marina', 'fitness_wellness_run_club'],
      ['tennis outing for 30 guests', 'game_sports_outing'],
      ['xmas party for the team', 'holiday_reception'],
      ['team off-site planning day', 'retreat_offsite'],
    ]

    for (const [phrase, key] of cases) {
      expect(resolveArchetypeKey(phrase)).toBe(key)
    }
  })

  it('resolves debate, discussion, town hall, and forum as panel_fireside', () => {
    expect(resolveArchetypeKey('Debate Night for 100 guests')).toBe('panel_fireside')
    expect(resolveArchetypeKey('debate series in SF')).toBe('panel_fireside')
    expect(resolveArchetypeKey('town hall for the community')).toBe('panel_fireside')
    expect(resolveArchetypeKey('community forum for 80 people')).toBe('panel_fireside')
    expect(resolveArchetypeKey('public discussion on AI policy')).toBe('panel_fireside')
  })

  it('does not resolve debate/discussion as private_dinner_celebration', () => {
    expect(resolveArchetypeKey('Debate Night for 100 guests')).not.toBe('private_dinner_celebration')
  })

  it('does not classify negated archetype phrases', () => {
    expect(resolveArchetypeKey('Plan a panel fireside. This is not a listening party.')).toBe('panel_fireside')
    expect(resolveArchetypeKey('This is not a concert, it is a listening party with artist VIP.')).toBe('listening_party_showcase')
  })

  it('does not resolve removed conference archetypes', () => {
    expect(resolveArchetypeKey('conference')).toBeNull()
    expect(resolveArchetypeKey('summit')).toBeNull()
  })

  it('falls back to DEFAULT_ARCHETYPE when archetypeFor cannot resolve a phrase', () => {
    expect(archetypeFor('something completely custom').key).toBe(DEFAULT_ARCHETYPE.key)
  })

  it('marks contextual dinner language as inferred with adjacent alternatives', () => {
    const context = resolveArchetypeContext("I want to host a women's dinner")

    expect(context).toEqual(expect.objectContaining({
      key: 'private_dinner_celebration',
      display_name: 'Private dinner / celebration',
      match_strength: 'inferred',
    }))
    expect(context?.alternative_archetypes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'community_meetup',
        display_name: 'Community meetup',
      }),
    ]))
  })

  it('keeps all 19 archetypes internally valid', () => {
    expect(ARCHETYPES).toHaveLength(19)

    for (const archetype of ARCHETYPES) {
      expect(archetype.aliases.length).toBeGreaterThan(0)
      expect(archetype.adjacent_archetypes.length).toBeGreaterThanOrEqual(2)
      expect(archetype.adjacent_archetypes.every((key) => ARCHETYPES.some((candidate) => candidate.key === key))).toBe(true)
      expect(archetype.preferred_venue_types.every((venueType) => venueTypeSchema.safeParse(venueType).success)).toBe(true)
      expect(
        archetype.preferred_commercial_models.every((model) => commercialModelSchema.safeParse(model).success)
      ).toBe(true)
    }
  })

  it('exposes archetype intake context for the planner agent', () => {
    const context = resolveArchetypeIntakeContext('listening party in sf')

    expect(context?.key).toBe('listening_party_showcase')
    expect(context?.required_amenities).toContain('premium_sound')
    expect(context?.intake_questions.some((question) => question.id === 'music_format')).toBe(true)
    expect(context?.intake_questions.some((question) => question.id === 'av_intensity')).toBe(true)
    expect(context?.intake_questions.some((question) => question.id === 'operational_timing')).toBe(false)
  })
})
