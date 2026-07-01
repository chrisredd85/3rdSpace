import {
  buildSupplyIntentPlacesSearches,
  mergeSupplyIntentMetadata,
  pickSupplyIntentClarificationQuestion,
  readPlanSupplyIntents,
} from '@/lib/planner/supplyIntent/activityCatalog'

describe('activity supply intent catalog', () => {
  it('asks a clarifying question for ambiguous activity events', () => {
    const metadata = mergeSupplyIntentMetadata({}, {
      userMessage: 'I want to host a tennis event for 24 people',
    })

    expect(metadata).not.toBeNull()
    expect(readPlanSupplyIntents(metadata)).toEqual([])
    expect(pickSupplyIntentClarificationQuestion({ metadata })).toBe(
      'For tennis, do you need a place to play, a nearby social spot, an instructor, or a place to watch?'
    )
  })

  it('resolves a pending clarification into an activity facility intent', () => {
    const ambiguous = mergeSupplyIntentMetadata({}, {
      userMessage: 'I want to host a tennis event for 24 people',
    })

    const metadata = mergeSupplyIntentMetadata(ambiguous, {
      userMessage: 'We need courts where people can play',
    })

    const intents = readPlanSupplyIntents(metadata)

    expect(intents).toEqual([
      expect.objectContaining({
        category: 'activity_facility',
        activity_type: 'tennis',
        label: 'Tennis facilities',
        source: 'intake',
      }),
    ])
    expect(pickSupplyIntentClarificationQuestion({ metadata })).toBeNull()
  })

  it('builds activity-specific Places searches before falling back to generic venues', () => {
    const metadata = mergeSupplyIntentMetadata({}, {
      userMessage: 'Find tennis courts in Oakland for a mixer',
    })

    const searches = buildSupplyIntentPlacesSearches({
      metadata,
      neighborhood: 'Oakland',
      event_type: 'game_sports_outing',
    })

    expect(searches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'activity_facility',
        activity_type: 'tennis',
        includedType: 'tennis_court',
        textQuery: 'tennis court in Oakland',
      }),
    ]))
  })

  it('distinguishes watch parties from play-location searches', () => {
    const metadata = mergeSupplyIntentMetadata({}, {
      userMessage: 'I want to watch a basketball game with friends',
    })

    expect(readPlanSupplyIntents(metadata)).toEqual([
      expect.objectContaining({
        category: 'watch_party',
        activity_type: 'basketball',
      }),
    ])
    expect(buildSupplyIntentPlacesSearches({
      metadata,
      neighborhood: 'Downtown Oakland',
      event_type: 'game_sports_outing',
    })).toEqual([
      expect.objectContaining({
        includedType: 'bar',
        textQuery: 'sports bar basketball game in Downtown Oakland',
      }),
    ])
  })
})
