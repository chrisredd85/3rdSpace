import { parseEventIntent } from '@/lib/planner/intentParser'

describe('parseEventIntent', () => {
  it('extracts a hackathon intent without confusing duration for headcount', () => {
    const intent = parseEventIntent(
      'I want to host a 36-hour hackathon for 80 builders at a private corporate office in SF'
    )

    expect(intent.event_type).toBe('hackathon')
    expect(intent.guest_count).toBe(80)
    expect(intent.budget_cap).toBeUndefined()
    expect(intent.neighborhood).toBe('SF')
  })

  it('extracts concert capacity range and large budget', () => {
    const intent = parseEventIntent(
      'Book Gunna for a one-night concert, venue 1500-2000 cap, $220k budget'
    )

    expect(intent.event_type).toBe('concert')
    expect(intent.guest_count).toBe(2000)
    expect(intent.budget_cap).toBe(22_000_000)
  })

  it('extracts group dinner details from a compact request', () => {
    const intent = parseEventIntent(
      'Group dinner for 12 people, Friday night, Hayes Valley, under $800 total'
    )

    expect(intent.event_type).toBe('dinner')
    expect(intent.guest_count).toBe(12)
    expect(intent.neighborhood).toBe('Hayes Valley')
    expect(intent.budget_cap).toBe(80_000)
    expect(intent.date_hint).toBe('friday night')
  })

  it.each([
    ['SOMA', 'SOMA'],
    ['soma', 'SOMA'],
    ['SF', 'SF'],
    ['NOPA', 'NOPA'],
    ['FiDi', 'FiDi'],
    ['Mission', 'Mission'],
  ])('normalizes "%s" to "%s"', (area, expected) => {
    const intent = parseEventIntent(`Founder dinner for 20 people in ${area}`)

    expect(intent.neighborhood).toBe(expected)
  })

  it('extracts SF Tech Week mixer intent and invite-only ticketing signal', () => {
    const intent = parseEventIntent(
      'SF Tech Week mixer for 120 founders and investors, invite-only, late October'
    )

    expect(intent.event_type).toBe('mixer')
    expect(intent.guest_count).toBe(120)
    expect(intent.ticketed).toBe(false)
    expect(intent.date_hint).toBe('late october')
    expect(intent.date_window_start).toBe('2026-10-21')
    expect(intent.date_window_end).toBe('2026-10-31')
  })

  it('extracts tennis events as a supported sports intent', () => {
    const intent = parseEventIntent('I want to host a tennis event for 24 players in the next two weeks')

    expect(intent.event_type).toBe('tennis')
    expect(intent.guest_count).toBe(24)
    expect(intent.date_hint).toBe('next two weeks')
    expect(intent.date_window_start).toBeDefined()
    expect(intent.date_window_end).toBeDefined()
  })

  it('captures unsupported but plannable event phrases for taxonomy review', () => {
    const intent = parseEventIntent('I want to host a chess tournament for 32 players in SoMa with a $2k budget')

    expect(intent.event_type).toBeUndefined()
    expect(intent.raw_event_type).toBe('chess tournament')
    expect(intent.planning_archetype).toBe('competitive_social')
    expect(intent.is_supported_event_type).toBe(false)
    expect(intent.guest_count).toBe(32)
    expect(intent.budget_cap).toBe(200_000)
    expect(intent.taxonomy_candidate?.normalized_phrase).toBe('chess tournament')
    expect(intent.taxonomy_candidate?.suggested_questions.length).toBeGreaterThan(0)
  })

  it('preserves compound events instead of flattening to the secondary component', () => {
    const intent = parseEventIntent('I want to host a night run with mocktails for 40 people next two weeks')

    expect(intent.event_type).toBeUndefined()
    expect(intent.raw_event_type).toBe('night run with mocktails')
    expect(intent.planning_archetype).toBe('sports')
    expect(intent.guest_count).toBe(40)
    expect(intent.taxonomy_candidate?.primary_component).toBe('night run')
    expect(intent.taxonomy_candidate?.secondary_components).toContain('mocktails')
    expect(intent.taxonomy_candidate?.event_components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'night run',
          role: 'primary',
          archetype: 'sports',
        }),
        expect.objectContaining({
          label: 'mocktails',
          role: 'secondary',
          archetype: 'food',
        }),
      ])
    )
    expect(intent.taxonomy_candidate?.suggested_questions).toContain(
      'Should mocktails happen during the event, after the main activity, or both?'
    )
  })

  it('fits known experimental event phrases even when they contain generic supported words', () => {
    const intent = parseEventIntent('Host a pickleball founders mixer for 60 people in SoMa with a $5k budget')

    expect(intent.event_type).toBeUndefined()
    expect(intent.raw_event_type).toBe('pickleball founders mixer')
    expect(intent.planning_archetype).toBe('sports')
    expect(intent.taxonomy_candidate?.primary_component).toBe('pickleball founders mixer')
    expect(intent.guest_count).toBe(60)
    expect(intent.budget_cap).toBe(500_000)
  })

  it.each([
    ['Plan a silent book club rave for 80 people', 'silent book club rave', 'music'],
    ['Plan a soup swap for 40 people', 'soup swap', 'food'],
    ['I want to run a PowerPoint karaoke battle', 'powerpoint karaoke battle', 'competitive_social'],
    ['Host a pitch deck funeral with drinks', 'pitch deck funeral', 'professional'],
    ['I want to do a zero-proof cocktail lab', 'zero-proof cocktail lab', 'food'],
    ['Host a founder failure wake for 80 people', 'founder failure wake', 'professional'],
    ['Plan a citywide scavenger race for 120 people', 'citywide scavenger race', 'competitive_social'],
    ['Host a parking lot drive-in screening', 'parking lot drive-in screening', 'performance'],
  ])('fits experimental phrase "%s"', (message, rawEventType, archetype) => {
    const intent = parseEventIntent(message)

    expect(intent.event_type).toBeUndefined()
    expect(intent.raw_event_type).toBe(rawEventType)
    expect(intent.planning_archetype).toBe(archetype)
    expect(intent.taxonomy_candidate?.suggested_questions.length).toBeGreaterThan(0)
  })
})
