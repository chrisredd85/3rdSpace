jest.mock('server-only', () => ({}))

jest.mock('@/lib/ai/client', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
  assertOpenAIConfigured: jest.fn(),
}))

import { intakeAgentOutputSchema, runIntakeAgent } from '@/lib/ai/agents/intakeAgent'

const founderDinnerOutput = {
  reflection: 'Perfect — 60 person founder dinner in SF.',
  extracted_fields: {
    event_type: 'dinner',
    guest_count: 60,
    neighborhood: null,
    date_window_start: null,
    date_window_end: null,
    budget_cap_cents: null,
    ticketed: null,
    ticket_price_target: null,
    food_responsibility: 'Dinner service needed, details not confirmed.',
    profit_goal_cents: null,
  },
  updated_event_plan: {
    event_name: 'Founder dinner',
    expected_attendance: 60,
    city: 'SF',
    venue_type: null,
    budget: null,
    event_date: null,
    monetization_model: null,
    headcount_min: 60,
    headcount_max: 60,
    ticket_price_target: null,
    profit_goal: null,
  },
  neighborhood: null,
  food_drink_needs: 'Dinner service needed, details not confirmed.',
  music_av_needs: null,
  vibe_audience: 'Founder audience.',
  hard_constraints: [],
  missing_questions: [
    'What date or date window should I plan around?',
  ],
  confidence_score: 0.72,
  next_best_question: 'What date or date window should I plan around?',
  assumptions_made: [
    'Founder dinner implies a seated meal.',
  ],
}

describe('runIntakeAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns a structured draft and missing questions for a founder dinner idea', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(founderDinnerOutput) } }],
    })

    const result = await runIntakeAgent(
      {
        user_message: 'I want to host a 60 person founder dinner in SF',
      },
      { create }
    )

    expect(result.agent_name).toBe('intake')
    expect(result.model).toBe('gpt-4o')
    expect(result.output.updated_event_plan.expected_attendance).toBe(60)
    expect(result.output.updated_event_plan.city).toBe('SF')
    expect(result.output.updated_event_plan.event_name).toBe('Founder dinner')
    expect(result.output.missing_questions).toHaveLength(1)
    expect(result.output.missing_questions.join(' ')).toMatch(/date/i)
    expect(result.output.reflection).toMatch(/founder dinner/i)
    expect(result.output.food_drink_needs).toMatch(/Dinner/i)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
    }))
  })

  it('normalizes multiple missing questions down to one active prompt', () => {
    const modelOutput = {
      ...founderDinnerOutput,
      missing_questions: ['One?', 'Two?'],
    }

    expect(intakeAgentOutputSchema.parse(modelOutput).missing_questions).toEqual(['One?'])
  })

  it('coerces flexible model field shapes instead of failing public intake', () => {
    const modelOutput = {
      ...founderDinnerOutput,
      extracted_fields: {
        ...founderDinnerOutput.extracted_fields,
        guest_count: '60',
        budget_cap_cents: '$5k',
        ticketed: 'rsvp',
        ticket_price_target: '40',
      },
      food_drink_needs: ['light bites', 'cash bar'],
      music_av_needs: { summary: 'Mics and house speakers' },
      hard_constraints: { summary: 'Needs load-in access' },
      assumptions_made: null,
    }

    const parsed = intakeAgentOutputSchema.parse(modelOutput)

    expect(parsed.extracted_fields.guest_count).toBe(60)
    expect(parsed.extracted_fields.budget_cap_cents).toBe(500000)
    expect(parsed.extracted_fields.ticketed).toBe(false)
    expect(parsed.extracted_fields.ticket_price_target).toBe(4000)
    expect(parsed.food_drink_needs).toBe('light bites, cash bar')
    expect(parsed.music_av_needs).toBe('Mics and house speakers')
    expect(parsed.hard_constraints).toEqual(['Needs load-in access'])
    expect(parsed.assumptions_made).toEqual([])
  })

  it('does not multiply already-cent-normalized ticket prices', () => {
    const modelOutput = {
      ...founderDinnerOutput,
      extracted_fields: {
        ...founderDinnerOutput.extracted_fields,
        ticketed: true,
        ticket_price_target: 4000,
      },
    }

    const parsed = intakeAgentOutputSchema.parse(modelOutput)

    expect(parsed.extracted_fields.ticket_price_target).toBe(4000)
  })

  it('defaults unknown vendor need status and normalizes explicit no-vendor values', () => {
    expect(intakeAgentOutputSchema.parse(founderDinnerOutput).vendor_need_status).toBe('unknown')

    const parsed = intakeAgentOutputSchema.parse({
      ...founderDinnerOutput,
      vendor_need_status: 'no vendors',
    })

    expect(parsed.vendor_need_status).toBe('none')
  })

  it('accepts activity supply intents and clarification prompts from the model', () => {
    const parsed = intakeAgentOutputSchema.parse({
      ...founderDinnerOutput,
      supply_intents: [{
        category: 'activity_facility',
        activity_type: 'tennis',
        label: 'Tennis facilities',
        requirements: { court_count: 'TBD' },
        confidence: 0.82,
        source: 'intake',
      }],
      supply_clarification_needed: {
        status: 'pending',
        activity_type: 'golf',
        question: 'Do you need a full course, driving range, simulator, instructor, or social venue?',
        options: [{
          category: 'activity_facility',
          label: 'Golf facility',
          description: 'Find courses, ranges, and simulators first.',
        }],
      },
    })

    expect(parsed.supply_intents).toEqual([
      expect.objectContaining({
        category: 'activity_facility',
        activity_type: 'tennis',
        source: 'intake',
      }),
    ])
    expect(parsed.supply_clarification_needed).toEqual(expect.objectContaining({
      status: 'pending',
      activity_type: 'golf',
    }))
  })

  it('passes inferred archetype resolution context to the model', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(founderDinnerOutput) } }],
    })

    await runIntakeAgent(
      {
        user_message: "I want to host a women's dinner",
        archetype_resolution: {
          key: 'private_dinner_celebration',
          display_name: 'Private dinner / celebration',
          match_strength: 'inferred',
          matched_alias: 'inferred dinner gathering',
          alternative_archetypes: [
            {
              key: 'community_meetup',
              display_name: 'Community meetup',
              why: 'Use this if the event should feel more like community meetup.',
            },
          ],
        },
      },
      { create }
    )

    const createInput = create.mock.calls[0]?.[0] as { messages?: Array<{ role: string; content: string }> }
    const userPayload = JSON.parse(createInput.messages?.[1]?.content ?? '{}') as {
      archetype_resolution?: {
        match_strength?: string
        alternative_archetypes?: Array<{ key: string }>
      }
    }

    expect(userPayload.archetype_resolution?.match_strength).toBe('inferred')
    expect(userPayload.archetype_resolution?.alternative_archetypes).toEqual([
      expect.objectContaining({ key: 'community_meetup' }),
    ])
  })

  it('does not surface redundant event-type confirmation for exact archetype matches', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            ...founderDinnerOutput,
            extracted_fields: {
              ...founderDinnerOutput.extracted_fields,
              food_responsibility: null,
            },
            next_best_question: 'Should I change the event type, or keep this as founder/operator dinner?',
            missing_questions: ['Should I change the event type, or keep this as founder/operator dinner?'],
          }),
        },
      }],
    })

    const result = await runIntakeAgent(
      {
        user_message: '30-person founder dinner, Hayes Valley, July 2, $2,500 budget',
        resolved_archetype: {
          key: 'founder_operator_dinner',
          display_name: 'Founder/operator dinner',
          match_strength: 'exact',
          matched_alias: 'founder dinner',
          alternative_archetypes: [],
          capacity_range: [12, 80],
          vendor_stack: [],
          preferred_commercial_models: [],
          preferred_venue_types: ['restaurant_private_room'],
          required_amenities: [],
          bonus_amenities: [],
          default_fills: {},
          intake_questions: [
            {
              id: 'food-responsibility',
              label: 'Food model',
              prompt: 'Should food come from the venue, outside catering, or another setup?',
              source: 'matching_field',
              required: true,
              priority: 1,
              field: 'food_responsibility',
              answer_keywords: ['venue', 'catering'],
            },
          ],
        },
        archetype_resolution: {
          key: 'founder_operator_dinner',
          display_name: 'Founder/operator dinner',
          match_strength: 'exact',
          matched_alias: 'founder dinner',
          alternative_archetypes: [],
        },
      },
      { create }
    )

    expect(result.output.next_best_question).toBe('Should food come from the venue, outside catering, or another setup?')
    expect(result.output.missing_questions).toEqual(['Should food come from the venue, outside catering, or another setup?'])
  })

  it('keeps archetype clarification for fuzzy matches', async () => {
    const fuzzyQuestion = 'Should I change the event type, or keep this as founder/operator dinner?'
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            ...founderDinnerOutput,
            next_best_question: fuzzyQuestion,
            missing_questions: [fuzzyQuestion],
          }),
        },
      }],
    })

    const result = await runIntakeAgent(
      {
        user_message: 'Host something for founders',
        archetype_resolution: {
          key: 'founder_operator_dinner',
          display_name: 'Founder/operator dinner',
          match_strength: 'fuzzy',
          matched_alias: 'founders',
          alternative_archetypes: [
            {
              key: 'networking_mixer',
              display_name: 'Networking mixer',
              why: 'Could be a broader networking format.',
            },
          ],
        },
      },
      { create }
    )

    expect(result.output.next_best_question).toBe(fuzzyQuestion)
    expect(result.output.missing_questions).toEqual([fuzzyQuestion])
  })

  it('passes organizer profile preferences to the model as intake context', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(founderDinnerOutput) } }],
    })

    await runIntakeAgent(
      {
        user_message: 'Plan my usual mixer',
        organizer_profile: {
          event_archetype_keys: ['networking_mixer'],
          event_type_labels: ['Networking mixer'],
          preferred_amenities: ['full bar', 'outdoor patio'],
          preferred_ticket_platforms: ['posh'],
        },
      },
      { create }
    )

    const createInput = create.mock.calls[0]?.[0] as { messages?: Array<{ role: string; content: string }> }
    const userPayload = JSON.parse(createInput.messages?.[1]?.content ?? '{}') as {
      organizer_profile?: {
        event_archetype_keys?: string[]
        preferred_amenities?: string[]
      }
    }

    expect(userPayload.organizer_profile?.event_archetype_keys).toEqual(['networking_mixer'])
    expect(userPayload.organizer_profile?.preferred_amenities).toEqual(['full bar', 'outdoor patio'])
  })

  it('rejects missing required input fields before calling the model', async () => {
    const create = jest.fn()

    await expect(runIntakeAgent({}, { create })).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })
})
