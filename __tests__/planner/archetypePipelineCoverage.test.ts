jest.mock('server-only', () => ({}))

import { ARCHETYPES, type EventArchetypeConfig } from '@/lib/planner/archetypes'
import type { MatchingField } from '@/lib/planner/archetypes/types'
import { rankCatalogPartners } from '@/lib/planner/catalogRanker'
import {
  isIntakeReadyForRecommendations,
  isPlanReadyForRequestedRecommendations,
} from '@/lib/planner/intakeReadiness'
import { calculateEventPlanningEconomics } from '@/lib/finance/eventPlanningEconomics'
import type { IntakeAgentOutput } from '@/lib/ai/agents/intakeAgent'
import { rankVenuesForArchetype, type VenueRankerVenueInput } from '@/lib/venues/venueRanker'
import type { Plan } from '@/lib/types'

const EXPECTED_ARCHETYPE_KEYS = [
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
]

const SIGNAL_VALUE_BY_FIELD: Partial<Record<MatchingField, unknown>> = {
  setup_format: 'seated',
  private_or_shared: 'private',
  indoor_outdoor: 'indoor',
  duration_days: 1,
  duration_minutes: 120,
  av_intensity: 'standard',
  stage_required: true,
  demo_stations_needed: true,
  screens_count: 1,
  mics_count: 2,
  music_format: 'dj',
  lighting_intensity: 'house',
  photo_video_priority: 'none',
  decor_intensity: 'light',
  catering_style: 'venue_handles',
  bar_required: false,
  security_needs: 'none',
  check_in_needs: 'walk_in_list',
  sponsor_status: 'self_funded',
  preferred_commercial_model: 'flat_rental',
}

describe('planner archetype pipeline coverage', () => {
  it('covers every supported archetype key', () => {
    expect(ARCHETYPES.map((archetype) => archetype.key)).toEqual(EXPECTED_ARCHETYPE_KEYS)
  })

  it('keeps archetype vendor stack defaults aligned with MVP matching rules', () => {
    const byKey = new Map(ARCHETYPES.map((archetype) => [archetype.key, archetype]))
    const stackFor = (key: string) => byKey.get(key)?.vendor_stack ?? []
    const service = (key: string, serviceType: string) =>
      stackFor(key).find((item) => item.service_type === serviceType)

    expect(service('panel_fireside', 'av_production')?.necessity).toBe('required')
    expect(service('panel_fireside', 'photographer')?.necessity).toBe('optional')
    expect(service('panel_fireside', 'dj')).toBeUndefined()

    expect(service('workshop_class', 'av_production')?.necessity).toBe('optional')
    expect(service('listening_party_showcase', 'av_production')?.necessity).toBe('required')

    expect(service('founder_operator_dinner', 'dj')).toBeUndefined()
    expect(service('private_dinner_celebration', 'dj')).toBeUndefined()
    expect(service('community_meetup', 'dj')).toBeUndefined()
    expect(service('fitness_wellness_run_club', 'photographer')).toBeUndefined()
    expect(service('game_sports_outing', 'photographer')).toBeUndefined()

    expect(service('founder_operator_dinner', 'bartending')?.trigger).toEqual({
      field: 'has_bar',
      op: 'eq',
      value: true,
    })
    expect(service('private_dinner_celebration', 'catering')?.trigger).toEqual({
      field: 'catering_style',
      op: 'neq',
      value: 'venue_handles',
    })
    expect(service('fundraiser_gala', 'catering')?.trigger).toEqual({
      field: 'catering_style',
      op: 'neq',
      value: 'venue_handles',
    })
    expect(service('retreat_offsite', 'catering')?.trigger).toEqual({
      field: 'catering_style',
      op: 'neq',
      value: 'venue_handles',
    })
  })

  it.each(ARCHETYPES)('%s readiness requires core fields and passes once required fields are populated', (archetype) => {
    const incompletePlan = makePlan(archetype, { omitDate: true })
    const completePlan = makePlan(archetype)
    const incompleteOutput = makeIntakeOutput(archetype, { omitDate: true })
    const output = makeIntakeOutput(archetype)
    const conversationText = `${archetype.display_name} for 80 in Mission on May 30. RSVP/free. Venue handles food and drinks.`

    expect(isPlanReadyForRequestedRecommendations(incompletePlan, { conversationText })).toBe(false)
    expect(isIntakeReadyForRecommendations(incompleteOutput, incompletePlan, { conversationText })).toBe(false)

    expect(isPlanReadyForRequestedRecommendations(completePlan, { conversationText })).toBe(true)
    expect(isIntakeReadyForRecommendations(output, completePlan, { conversationText })).toBe(true)
  })

  it.each(ARCHETYPES)('%s rankers tolerate missing optional planning signals', (archetype) => {
    const minimalPlan = makePlan(archetype, { minimalSignals: true })
    const completePlan = makePlan(archetype)
    const venue = makeVenue(archetype)

    expect(() => rankVenuesForArchetype({
      archetype,
      plan: minimalPlan,
      venues: [venue],
    })).not.toThrow()

    expect(() => rankCatalogPartners({
      archetype,
      plan: completePlan,
      venues: [venue],
      vendors: [],
    })).not.toThrow()
  })

  it.each(ARCHETYPES)('%s economics math does not crash when ticket price is unknown', (archetype) => {
    expect(() => calculateEventPlanningEconomics({
      event_plan: {
        event_name: `${archetype.display_name} plan`,
        expected_attendance: 80,
        city: 'San Francisco',
        venue_type: archetype.display_name,
        budget: 500000,
        event_date: '2026-05-30',
        monetization_model: 'rsvp',
        headcount_min: 80,
        headcount_max: 80,
        ticket_price_target: null,
        profit_goal: null,
      },
      budget_line_items: [],
      expected_attendance: 80,
      venue_cost_cents: 200000,
      vendor_cost_cents: 100000,
      ticket_price_cents: 0,
      sponsorship_revenue_cents: 0,
    })).not.toThrow()
  })
})

function makePlan(
  archetype: EventArchetypeConfig,
  options: { omitDate?: boolean; minimalSignals?: boolean } = {}
): Plan {
  const matchingSignals = options.minimalSignals ? {} : buildMatchingSignals(archetype)

  return {
    id: `plan-${archetype.key}`,
    user_id: 'user-1',
    title: `${archetype.display_name} plan`,
    event_type: archetype.display_name,
    status: 'ready',
    guest_count: 80,
    budget_cap_cents: 500000,
    neighborhood: 'Mission',
    date_window_start: options.omitDate ? null : '2026-05-30',
    date_window_end: options.omitDate ? null : '2026-05-30',
    ticketed: false,
    ticketing_model: 'rsvp',
    food_responsibility: 'Venue handles food and drinks',
    venue_terms: null,
    agent_action: null,
    profit_goal_cents: null,
    notes: null,
    metadata: {
      matching_signals: matchingSignals,
    },
    created_at: '2026-05-16T10:00:00Z',
    updated_at: '2026-05-16T10:00:00Z',
  }
}

function makeIntakeOutput(
  archetype: EventArchetypeConfig,
  options: { omitDate?: boolean } = {}
): IntakeAgentOutput {
  return {
    reflection: 'Locked in.',
    extracted_fields: {
      event_type: archetype.display_name,
      guest_count: 80,
      neighborhood: 'Mission',
      date_window_start: options.omitDate ? null : '2026-05-30',
      date_window_end: options.omitDate ? null : '2026-05-30',
      budget_cap_cents: null,
      ticketed: false,
      ticket_price_target: null,
      food_responsibility: 'Venue handles food and drinks',
      profit_goal_cents: null,
    },
    updated_event_plan: {
      event_name: `${archetype.display_name} plan`,
      expected_attendance: 80,
      city: 'Mission',
      venue_type: archetype.display_name,
      budget: 500000,
      event_date: options.omitDate ? null : '2026-05-30',
      monetization_model: 'rsvp',
      headcount_min: 80,
      headcount_max: 80,
      ticket_price_target: null,
      profit_goal: null,
    },
    neighborhood: 'Mission',
    food_drink_needs: 'Venue handles food and drinks',
    music_av_needs: null,
    vibe_audience: null,
    hard_constraints: [],
    missing_questions: [],
    confidence_score: 0.9,
    next_best_question: null,
    assumptions_made: [],
  }
}

function buildMatchingSignals(archetype: EventArchetypeConfig): Record<string, unknown> {
  const signals: Record<string, unknown> = {}
  for (const field of [...archetype.matching_fields.critical, ...archetype.matching_fields.high_signal]) {
    if (SIGNAL_VALUE_BY_FIELD[field] !== undefined) signals[field] = SIGNAL_VALUE_BY_FIELD[field]
  }
  return signals
}

function makeVenue(archetype: EventArchetypeConfig): VenueRankerVenueInput {
  return {
    id: `venue-${archetype.key}`,
    venue_name: `${archetype.display_name} Venue`,
    venue_type: archetype.preferred_venue_types[0] ?? 'event_space',
    standing_capacity: 600,
    seated_capacity: 400,
    city: 'San Francisco',
    neighborhood: 'Mission',
    state: 'CA',
    hourly_rate: 100000,
    minimum_hours: 4,
    pricing_model: 'flat',
    outside_catering_allowed: true,
    bar_revenue_share_enabled: true,
    unique_features_tags: [
      ...archetype.required_amenities,
      ...archetype.bonus_amenities,
      'full_bar',
      'liquor_license',
      'bar_setup',
      'private_room',
      'seated_dining',
      'tables',
      'work_surfaces',
      'power',
      'outlets',
      'wifi',
      'internet',
      'screen',
      'projector',
      'microphones',
      'pa_system',
      'stage',
      'flat_floor',
      'demo_station',
      'controlled_entry',
      'single_entry',
      'kitchen',
      'food_service',
      'sound_system',
      'premium_sound',
      'outdoor',
      'rain_plan',
      'rooms',
      'meals',
      'group_seats',
      'pre_post_venue',
    ],
  }
}
