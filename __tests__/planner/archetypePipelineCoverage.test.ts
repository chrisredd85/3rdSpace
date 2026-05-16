jest.mock('server-only', () => ({}))

import {
  ARCHETYPES,
  getNextArchetypeIntakeQuestion,
  type EventArchetypeConfig,
} from '@/lib/planner/archetypes'
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

  it.each([
    {
      label: 'founder dinner location/date/bar flow',
      archetypeKey: 'founder_operator_dinner',
      conversationText: [
        'Monthly founder dinner for 24 in Hayes Valley.',
        'May 30th.',
        'Venue handles food. We need a hosted bar setup.',
        'Invite-only RSVP. No photographer needed.',
      ].join('\n'),
      plan: {
        event_type: 'Founder/operator dinner',
        guest_count: 24,
        neighborhood: 'Hayes Valley',
        date_window_start: '2026-05-30',
        date_window_end: '2026-05-30',
        ticketed: false,
        ticketing_model: 'rsvp',
        food_responsibility: 'Venue handles food. Hosted bar setup.',
        metadata: {
          matching_signals: {
            catering_style: 'venue_handles',
            bar_required: true,
            photo_video_priority: 'none',
          },
        },
      },
    },
    {
      label: 'tech mixer location/date/headcount/ticket/AV flow',
      archetypeKey: 'networking_mixer',
      conversationText: [
        'Tech mixer in SoMa.',
        'May 30th.',
        '80 guests.',
        '$40 tickets.',
        'Standard AV for a short speaker segment. Venue handles bar and light bites. No photographer.',
      ].join('\n'),
      plan: {
        event_type: 'Networking mixer',
        guest_count: 80,
        neighborhood: 'SoMa',
        date_window_start: '2026-05-30',
        date_window_end: '2026-05-30',
        ticketed: true,
        ticketing_model: 'ticketed',
        food_responsibility: 'Venue handles bar and light bites.',
        metadata: {
          ticket_price_target_cents: 4000,
          matching_signals: {
            bar_required: true,
            catering_style: 'venue_handles',
            photo_video_priority: 'none',
            av_intensity: 'standard',
          },
        },
      },
    },
    {
      label: 'panel/fireside location/date/headcount/AV/ticket flow',
      archetypeKey: 'panel_fireside',
      conversationText: [
        'Startup panel in Downtown SF.',
        'May 29th.',
        '110 guests.',
        'Mics, stage, recording, and livestream.',
        '$25 tickets. Venue handles light bites.',
      ].join('\n'),
      plan: {
        event_type: 'Panel / fireside',
        guest_count: 110,
        neighborhood: 'Downtown SF',
        date_window_start: '2026-05-29',
        date_window_end: '2026-05-29',
        ticketed: true,
        ticketing_model: 'ticketed',
        food_responsibility: 'Venue handles light bites.',
        metadata: {
          ticket_price_target_cents: 2500,
          matching_signals: {
            av_intensity: 'standard',
            mics_count: 4,
            stage_required: true,
            screens_count: 1,
            catering_style: 'venue_handles',
            photo_video_priority: 'none',
          },
        },
      },
    },
    {
      label: 'nightlife location/date/headcount/ticket flow',
      archetypeKey: 'nightlife_club_night',
      conversationText: [
        'Club night in the Mission.',
        'May 30th.',
        '180 guests.',
        '$30 tickets. DJ format, full bar, and full door staff.',
      ].join('\n'),
      plan: {
        event_type: 'Nightlife / club night',
        guest_count: 180,
        neighborhood: 'Mission',
        date_window_start: '2026-05-30',
        date_window_end: '2026-05-30',
        ticketed: true,
        ticketing_model: 'ticketed',
        food_responsibility: 'Full bar.',
        metadata: {
          ticket_price_target_cents: 3000,
          matching_signals: {
            music_format: 'dj',
            bar_required: true,
            security_needs: 'full_staff',
            lighting_intensity: 'production',
            check_in_needs: 'ticket_scan',
          },
        },
      },
    },
    {
      label: 'workshop location/date/headcount/free flow',
      archetypeKey: 'workshop_class',
      conversationText: [
        'Coding workshop in SoMa.',
        'June 14th.',
        '30 guests.',
        'Free RSVP.',
        'Hands-on with work tables for two hours.',
      ].join('\n'),
      plan: {
        event_type: 'Workshop / class',
        guest_count: 30,
        neighborhood: 'SoMa',
        date_window_start: '2026-06-14',
        date_window_end: '2026-06-14',
        ticketed: false,
        ticketing_model: 'rsvp',
        food_responsibility: 'Light snacks.',
        metadata: {
          matching_signals: {
            setup_format: 'hands_on',
            duration_minutes: 120,
            av_intensity: 'light',
            catering_style: 'self',
          },
        },
      },
    },
  ])('$label is ready to fire recommendations after the final answer', ({ archetypeKey, conversationText, plan }) => {
    const archetype = ARCHETYPES.find((candidate) => candidate.key === archetypeKey)
    if (!archetype) throw new Error(`Missing archetype ${archetypeKey}`)
    const completePlan = makePlan(archetype, { overrides: plan })
    const output = makeIntakeOutput(archetype, { plan: completePlan })

    expect(getNextArchetypeIntakeQuestion({
      archetype,
      plan: completePlan,
      conversationText,
      includeRecommended: true,
    })).toBeNull()
    expect(isPlanReadyForRequestedRecommendations(completePlan, { conversationText })).toBe(true)
    expect(isIntakeReadyForRecommendations(output, completePlan, { conversationText })).toBe(true)
  })
})

function makePlan(
  archetype: EventArchetypeConfig,
  options: { omitDate?: boolean; minimalSignals?: boolean; overrides?: Partial<Plan> } = {}
): Plan {
  const matchingSignals = options.minimalSignals ? {} : buildMatchingSignals(archetype)

  const basePlan: Plan = {
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

  return {
    ...basePlan,
    ...options.overrides,
    metadata: {
      ...(readRecord(basePlan.metadata) ?? {}),
      ...(readRecord(options.overrides?.metadata) ?? {}),
    },
  }
}

function makeIntakeOutput(
  archetype: EventArchetypeConfig,
  options: { omitDate?: boolean; plan?: Plan } = {}
): IntakeAgentOutput {
  const plan = options.plan
  return {
    reflection: 'Locked in.',
    extracted_fields: {
      event_type: plan?.event_type ?? archetype.display_name,
      guest_count: plan?.guest_count ?? 80,
      neighborhood: plan?.neighborhood ?? 'Mission',
      date_window_start: options.omitDate ? null : plan?.date_window_start ?? '2026-05-30',
      date_window_end: options.omitDate ? null : plan?.date_window_end ?? '2026-05-30',
      budget_cap_cents: plan?.budget_cap_cents ?? null,
      ticketed: plan?.ticketed ?? false,
      ticket_price_target: readNumber(readRecord(plan?.metadata)?.ticket_price_target_cents),
      food_responsibility: plan?.food_responsibility ?? 'Venue handles food and drinks',
      profit_goal_cents: plan?.profit_goal_cents ?? null,
    },
    updated_event_plan: {
      event_name: `${archetype.display_name} plan`,
      expected_attendance: plan?.guest_count ?? 80,
      city: plan?.neighborhood ?? 'Mission',
      venue_type: archetype.display_name,
      budget: plan?.budget_cap_cents ?? 500000,
      event_date: options.omitDate ? null : plan?.date_window_start ?? '2026-05-30',
      monetization_model: plan?.ticketed ? 'ticketed' : 'rsvp',
      headcount_min: plan?.guest_count ?? 80,
      headcount_max: plan?.guest_count ?? 80,
      ticket_price_target: readNumber(readRecord(plan?.metadata)?.ticket_price_target_cents),
      profit_goal: plan?.profit_goal_cents ?? null,
    },
    neighborhood: plan?.neighborhood ?? 'Mission',
    food_drink_needs: plan?.food_responsibility ?? 'Venue handles food and drinks',
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

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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
