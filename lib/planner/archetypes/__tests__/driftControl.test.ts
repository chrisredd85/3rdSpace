import { ARCHETYPES } from '@/lib/planner/archetypes/data'
import {
  ARCHETYPE_LOCK_METADATA_KEY,
  buildMutationContract,
  createEventArchetypeLock,
  decideEventTypeMutation,
  extractEventRequirementSignals,
  humanizeEventType,
} from '@/lib/planner/archetypes/driftControl'
import { parseEventIntent } from '@/lib/planner/intentParser'

const CURRENT_ARCHETYPE_KEYS = [
  'networking_mixer',
  'founder_operator_dinner',
  'brand_product_launch',
  'pop_up_activation',
  'workshop_class',
  'panel_fireside',
  'demo_day_pitch_night',
  'hackathon',
  'community_meetup',
  'fundraiser_gala',
  'private_dinner_celebration',
  'day_party_brunch_party',
  'nightlife_club_night',
  'listening_party_showcase',
  'watch_party_screening',
  'fitness_wellness_run_club',
  'game_sports_outing',
  'holiday_reception',
  'retreat_offsite',
] as const

const CONFUSING_OPERATIONAL_PHRASES = [
  'artist VIP',
  'DJ',
  'sponsors',
  'bar minimum',
  'ticketed',
  'green room',
  'guest list',
  'venue handles drinks',
  'sound check',
  'load-in / breakdown',
] as const

const FALSE_RECLASSIFICATION_CANDIDATES = [
  'party',
  'mixer',
  'dinner',
  'popup',
  'conference',
  'retreat',
  'concert',
  'outing',
  'tennis',
] as const

describe('planner archetype drift control', () => {
  it('covers every current canonical archetype key', () => {
    expect(ARCHETYPES.map((archetype) => archetype.key)).toEqual(CURRENT_ARCHETYPE_KEYS)

    for (const archetype of ARCHETYPES) {
      expect(createEventArchetypeLock(archetype.key)?.key).toBe(archetype.key)
      expect(humanizeEventType(archetype.key)).toBe(archetype.display_name)
    }
  })

  it('keeps listening party locked through artist/VIP operational answers', () => {
    const lock = createEventArchetypeLock('listening_party_showcase')
    const metadata = { [ARCHETYPE_LOCK_METADATA_KEY]: lock }
    const message = 'Yes, guest-list control and a small artist VIP area'

    expect(parseEventIntent(message).event_type).toBeUndefined()

    const decision = decideEventTypeMutation({
      currentEventType: 'Listening party / showcase',
      currentMetadata: metadata,
      proposedEventType: 'concert',
      userMessage: message,
    })

    expect(decision.shouldApply).toBe(false)
    expect(decision.requiresConfirmation).toBe(false)
    expect(decision.eventType).toBe('Listening party / showcase')
    expect(decision.blockedCandidate).toBeNull()
    expect(decision.confirmationPrompt).toBeNull()
  })

  it('allows explicit user reclassification and relocks the archetype', () => {
    const lock = createEventArchetypeLock('listening_party_showcase')
    const decision = decideEventTypeMutation({
      currentEventType: 'Listening party / showcase',
      currentMetadata: { [ARCHETYPE_LOCK_METADATA_KEY]: lock },
      proposedEventType: 'mixer',
      userMessage: 'Actually make this a mixer',
    })

    expect(decision.shouldApply).toBe(true)
    expect(decision.requiresConfirmation).toBe(false)
    expect(decision.eventType).toBe('Networking mixer')
    expect(decision.lock?.key).toBe('networking_mixer')
  })

  it('does not ask founder/operator dinner to reconfirm a generic dinner candidate', () => {
    const lock = createEventArchetypeLock('founder_operator_dinner')
    const decision = decideEventTypeMutation({
      currentEventType: 'Founder/operator dinner',
      currentMetadata: { [ARCHETYPE_LOCK_METADATA_KEY]: lock },
      proposedEventType: 'dinner',
      userMessage: 'No photographer or other vendors. Just source venue options that can host the dinner and handle food and drinks.',
    })

    expect(decision.shouldApply).toBe(false)
    expect(decision.requiresConfirmation).toBe(false)
    expect(decision.eventType).toBe('Founder/operator dinner')
    expect(decision.blockedCandidate).toBeNull()
    expect(decision.confirmationPrompt).toBeNull()
  })

  it('still allows explicit same-family reclassification requests', () => {
    const lock = createEventArchetypeLock('founder_operator_dinner')
    const decision = decideEventTypeMutation({
      currentEventType: 'Founder/operator dinner',
      currentMetadata: { [ARCHETYPE_LOCK_METADATA_KEY]: lock },
      proposedEventType: 'private dinner',
      userMessage: 'Actually change this to a private dinner for friends.',
    })

    expect(decision.shouldApply).toBe(true)
    expect(decision.requiresConfirmation).toBe(false)
    expect(decision.eventType).toBe('Private dinner / celebration')
    expect(decision.lock?.key).toBe('private_dinner_celebration')
  })

  it('treats confusing operational language as requirements across every archetype', () => {
    for (const archetype of ARCHETYPES) {
      const lock = createEventArchetypeLock(archetype.key)
      const metadata = { [ARCHETYPE_LOCK_METADATA_KEY]: lock }

      CONFUSING_OPERATIONAL_PHRASES.forEach((phrase, index) => {
        const proposedEventType = FALSE_RECLASSIFICATION_CANDIDATES[index % FALSE_RECLASSIFICATION_CANDIDATES.length]
        const decision = decideEventTypeMutation({
          currentEventType: archetype.display_name,
          currentMetadata: metadata,
          proposedEventType,
          userMessage: `We need ${phrase}`,
        })

        expect(decision.shouldApply).toBe(false)
        expect(decision.eventType).toBe(archetype.display_name)
      })
    }
  })

  it('separates operational slots from the canonical archetype', () => {
    const signals = extractEventRequirementSignals(
      'Premium sound is required, with house speakers, playback control, guest-list control, a green room, sponsors, and load-in.'
    )

    expect(signals.music_av).toEqual(expect.arrayContaining(['Playback control']))
    expect(signals.guest_list).toEqual(expect.arrayContaining(['Guest-list control']))
    expect(signals.vip).toEqual(expect.arrayContaining(['Artist/VIP area']))
    expect(signals.sponsor).toEqual(expect.arrayContaining(['Sponsor needs']))
    expect(signals.timing).toEqual(expect.arrayContaining(['Load-in/breakdown']))
  })

  it('builds the shared mutation contract agents must honor', () => {
    const lock = createEventArchetypeLock('listening_party_showcase')
    const contract = buildMutationContract({ [ARCHETYPE_LOCK_METADATA_KEY]: lock }, 'Listening party / showcase')

    expect(contract.locked_archetype).toEqual({
      key: 'listening_party_showcase',
      display_name: 'Listening party / showcase',
    })
    expect(contract.allowed_fields).toContain('guest_count')
    expect(contract.allowed_fields).toContain('metadata.event_requirements')
    expect(contract.suggest_only_fields).toContain('event_type')
    expect(contract.confirmation_required_fields).toEqual(expect.arrayContaining(['event_type', 'guest_count', 'budget_cap_cents']))
  })
})
