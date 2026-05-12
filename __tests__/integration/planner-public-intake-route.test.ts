import type { NextRequest } from 'next/server'

jest.mock('@/lib/ai/agents', () => ({
  runAgent: jest.fn(),
}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => {
      const headers = new Headers(init?.headers)
      headers.set('content-type', 'application/json')
      return new Response(JSON.stringify(data), {
        ...init,
        status: init?.status ?? 200,
        headers,
      })
    },
  },
}))

import { POST as publicIntake } from '@/app/api/planner/public-intake/route'
import { runAgent } from '@/lib/ai/agents'
import {
  ARCHETYPES,
  PENDING_ARCHETYPE_QUESTION_METADATA_KEY,
  buildArchetypeIntakeQuestions,
  type ArchetypeIntakeQuestion,
  type EventArchetypeConfig,
} from '@/lib/planner/archetypes'

const mockRunAgent = runAgent as jest.Mock
let requestCounter = 0

function makeRequest(body: Record<string, unknown>) {
  requestCounter += 1
  const request = new Request('http://localhost/api/planner/public-intake', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.30.${Math.floor(requestCounter / 250)}.${(requestCounter % 250) + 1}`,
    },
    body: JSON.stringify(body),
  }) as NextRequest
  Object.defineProperty(request, 'nextUrl', { value: new URL('http://localhost/api/planner/public-intake') })
  return request
}

async function readJson(response: Response) {
  return JSON.parse(await response.text()) as Record<string, any>
}

describe('planner public intake route', () => {
  const oldOpenAiKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OPENAI_API_KEY = 'test-key'
  })

  afterAll(() => {
    process.env.OPENAI_API_KEY = oldOpenAiKey
  })

  it('falls back to deterministic intake instead of 503 when the model fails', async () => {
    mockRunAgent.mockResolvedValue({
      agent_name: 'intake',
      status: 'failed',
      output: null,
    })

    const response = await publicIntake(makeRequest({
      user_message: 'Plan a workshop for 35 people in Mission next Tuesday. I do not know my budget yet.',
      current_plan: null,
    }))
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(json.data.agent_draft).toEqual(expect.objectContaining({
      message_type: expect.any(String),
      metadata: expect.objectContaining({
        agent_mode: 'deterministic_fallback',
      }),
    }))
    expect(json.data.plan_patch).toEqual(expect.objectContaining({
      guest_count: 35,
      neighborhood: 'Mission',
    }))
    expect(json.data.plan_patch.budget_cap_cents).toBeUndefined()
  })

  it('preserves already-cent-normalized ticket prices from the model', async () => {
    mockRunAgent.mockResolvedValue({
      agent_name: 'intake',
      status: 'succeeded',
      output: {
        reflection: 'Locked in — listening party in SOMA.',
        extracted_fields: {
          event_type: 'listening party',
          guest_count: 90,
          neighborhood: 'SOMA',
          date_window_start: '2026-05-16',
          date_window_end: '2026-05-16',
          budget_cap_cents: 400000,
          ticketed: true,
          ticket_price_target: null,
          food_responsibility: null,
          profit_goal_cents: null,
        },
        updated_event_plan: {
          event_name: 'Listening party plan',
          expected_attendance: 90,
          city: 'SOMA',
          venue_type: 'listening party',
          budget: 4000,
          event_date: '2026-05-16',
          monetization_model: 'ticketed',
          headcount_min: null,
          headcount_max: null,
          ticket_price_target: 4000,
          profit_goal: null,
        },
        neighborhood: 'SOMA',
        food_drink_needs: null,
        music_av_needs: null,
        vibe_audience: null,
        hard_constraints: [],
        missing_questions: [],
        confidence_score: 0.92,
        next_best_question: null,
        assumptions_made: [],
      },
    })

    const response = await publicIntake(makeRequest({
      user_message: 'Plan a listening party in SOMA next Saturday for 90 guests, ticketed at $40 with a $4k budget.',
      current_plan: null,
    }))
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(json.data.plan_patch.budget_cap_cents).toBe(400000)
    expect(json.data.plan_patch.metadata.ticket_price_target_cents).toBe(4000)
  })

  it('surfaces inferred archetype resolution for ambiguous dinner language', async () => {
    mockRunAgent.mockResolvedValue({
      agent_name: 'intake',
      status: 'succeeded',
      output: {
        reflection: "I'm treating this as a private dinner so we focus on intimate spots with private rooms. If it should feel more like a community meetup or a founder/operator dinner, let me know.",
        extracted_fields: {
          event_type: 'Private dinner / celebration',
          guest_count: null,
          neighborhood: null,
          date_window_start: null,
          date_window_end: null,
          budget_cap_cents: null,
          ticketed: null,
          ticket_price_target: null,
          food_responsibility: null,
          profit_goal_cents: null,
        },
        updated_event_plan: {
          event_name: "Women's dinner plan",
          expected_attendance: null,
          city: null,
          venue_type: 'Private dinner / celebration',
          budget: null,
          event_date: null,
          monetization_model: null,
          headcount_min: null,
          headcount_max: null,
          ticket_price_target: null,
          profit_goal: null,
        },
        neighborhood: null,
        food_drink_needs: null,
        music_av_needs: null,
        vibe_audience: null,
        hard_constraints: [],
        missing_questions: ['How many guests are you planning for?'],
        confidence_score: 0.81,
        next_best_question: 'How many guests are you planning for?',
        assumptions_made: ["Treating women's dinner as a private dinner unless the user corrects it."],
      },
    })

    const response = await publicIntake(makeRequest({
      user_message: "I want to host a women's dinner",
      current_plan: null,
    }))
    const json = await readJson(response)
    const createInput = mockRunAgent.mock.calls[0]?.[0] as { payload?: Record<string, any> }

    expect(response.status).toBe(200)
    expect(createInput.payload?.archetype_resolution).toEqual(expect.objectContaining({
      key: 'private_dinner_celebration',
      match_strength: 'inferred',
    }))
    expect(createInput.payload?.archetype_resolution?.alternative_archetypes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'community_meetup' }),
    ]))
    expect(json.data.agent_draft.content).toMatch(/treating this as a private dinner/i)
    expect(json.data.agent_draft.content).toMatch(/community meetup/i)
    expect(json.data.plan_patch.event_type).toBe('Private dinner / celebration')
  })

  it('treats a bare numeric reply as the pending guest count instead of repeating headcount', async () => {
    const currentPlan = {
      title: 'Networking mixer plan',
      event_type: 'Networking mixer',
      guest_count: null,
      neighborhood: 'Oakland',
      date_window_start: '2026-05-15',
      date_window_end: '2026-05-15',
      ticketed: false,
      ticketing_model: 'rsvp',
      metadata: {},
    }

    mockRunAgent.mockResolvedValue({
      agent_name: 'intake',
      status: 'succeeded',
      output: {
        reflection: 'Handling a networking mixer in Oakland on May 15, 2026.',
        extracted_fields: {
          event_type: null,
          guest_count: null,
          neighborhood: null,
          date_window_start: null,
          date_window_end: null,
          budget_cap_cents: null,
          ticketed: null,
          ticket_price_target: null,
          food_responsibility: null,
          profit_goal_cents: null,
        },
        updated_event_plan: {
          event_name: 'Networking mixer plan',
          expected_attendance: null,
          city: null,
          venue_type: 'Networking mixer',
          budget: null,
          event_date: null,
          monetization_model: null,
          headcount_min: null,
          headcount_max: null,
          ticket_price_target: null,
          profit_goal: null,
        },
        neighborhood: null,
        food_drink_needs: null,
        music_av_needs: null,
        vibe_audience: null,
        hard_constraints: [],
        missing_questions: ['How many people are you planning for?'],
        confidence_score: 0.88,
        next_best_question: 'How many people are you planning for?',
        assumptions_made: [],
      },
    })

    const response = await publicIntake(makeRequest({
      user_message: '115',
      current_plan: currentPlan,
    }))
    const json = await readJson(response)
    const content = String(json.data.agent_draft.content)

    expect(response.status).toBe(200)
    expect(json.data.plan_patch.guest_count).toBe(115)
    expect(content).not.toMatch(/how many people/i)
  })

  it('handles 300 archetype follow-up combinations without repeating answered slots', async () => {
    const combinations = buildSimulationCombinations(300)

    for (const [index, combination] of combinations.entries()) {
      const currentPlan = buildBaseCurrentPlan(combination.archetype, combination.question, combination.contextual)
      mockRunAgent.mockResolvedValueOnce({
        agent_name: 'intake',
        status: 'succeeded',
        output: buildMockIntakeOutput(currentPlan, combination.question),
      })

      const response = await publicIntake(makeRequest({
        user_message: combination.answer,
        current_plan: currentPlan,
      }))
      const json = await readJson(response)
      const content = String(json.data?.agent_draft?.content ?? '')

      expect(response.status).toBe(200)
      expect(content).not.toContain(combination.question.prompt)
      expect(json.data?.plan_patch?.metadata?.answered_archetype_questions?.[combination.question.id]).toEqual(
        expect.objectContaining({
          id: combination.question.id,
        })
      )

      if (json.data?.agent_draft?.message_type === 'text') {
        expect(json.data?.plan_patch?.metadata?.pending_archetype_question).toBeTruthy()
      }

      if (index === combinations.length - 1) {
        expect(combinations).toHaveLength(300)
      }
    }
  })
})

function buildSimulationCombinations(count: number): Array<{
  archetype: EventArchetypeConfig
  question: ArchetypeIntakeQuestion
  answer: string
  contextual: boolean
}> {
  const combinations: Array<{
    archetype: EventArchetypeConfig
    question: ArchetypeIntakeQuestion
    answer: string
    contextual: boolean
  }> = []

  for (let index = 0; combinations.length < count; index += 1) {
    const archetype = ARCHETYPES[index % ARCHETYPES.length]
    const questions = buildArchetypeIntakeQuestions(archetype, { includeRecommended: true })
    const question = questions[Math.floor(index / ARCHETYPES.length) % questions.length]
    if (!question) continue

    const contextual = index % 6 === 0
    combinations.push({
      archetype,
      question,
      contextual,
      answer: contextual ? 'yes' : answerForQuestion(question),
    })
  }

  return combinations
}

function buildBaseCurrentPlan(
  archetype: EventArchetypeConfig,
  question: ArchetypeIntakeQuestion,
  contextual: boolean
) {
  return {
    title: `${archetype.display_name} plan`,
    event_type: archetype.display_name,
    guest_count: Math.max(archetype.capacity_range[0], Math.min(archetype.capacity_range[1], 80)),
    neighborhood: 'Hayes Valley',
    date_window_start: '2026-07-15',
    date_window_end: '2026-07-15',
    ticketed: false,
    ticketing_model: 'rsvp',
    metadata: {
      event_archetype_lock: {
        key: archetype.key,
        display_name: archetype.display_name,
        locked_at: '2026-05-11T00:00:00.000Z',
        source: 'initial_intake',
      },
      ...(contextual
        ? {
            [PENDING_ARCHETYPE_QUESTION_METADATA_KEY]: {
              id: question.id,
              label: question.label,
              prompt: question.prompt,
            },
          }
        : {}),
    },
  }
}

function buildMockIntakeOutput(currentPlan: Record<string, any>, staleQuestion: ArchetypeIntakeQuestion) {
  return {
    reflection: `Tracking ${currentPlan.event_type}.`,
    extracted_fields: {
      event_type: currentPlan.event_type,
      guest_count: currentPlan.guest_count,
      neighborhood: currentPlan.neighborhood,
      date_window_start: currentPlan.date_window_start,
      date_window_end: currentPlan.date_window_end,
      budget_cap_cents: null,
      ticketed: currentPlan.ticketed,
      ticket_price_target: null,
      food_responsibility: null,
      profit_goal_cents: null,
    },
    updated_event_plan: {
      event_name: currentPlan.title,
      expected_attendance: currentPlan.guest_count,
      city: currentPlan.neighborhood,
      venue_type: currentPlan.event_type,
      budget: null,
      event_date: currentPlan.date_window_start,
      monetization_model: currentPlan.ticketing_model,
      headcount_min: currentPlan.guest_count,
      headcount_max: currentPlan.guest_count,
      ticket_price_target: null,
      profit_goal: null,
    },
    neighborhood: currentPlan.neighborhood,
    food_drink_needs: null,
    music_av_needs: null,
    vibe_audience: null,
    hard_constraints: [],
    missing_questions: [staleQuestion.prompt],
    confidence_score: 0.91,
    next_best_question: staleQuestion.prompt,
    assumptions_made: [],
  }
}

function answerForQuestion(question: ArchetypeIntakeQuestion): string {
  const byId: Record<string, string> = {
    privacy: 'Shared is okay.',
    seated_service: 'Flexible reception layout is best.',
    layout_flow: 'Open floor with a flexible layout.',
    music_dj: 'We have a DJ bringing playback.',
    sound_quality: 'Premium sound is required with house speakers and playback control.',
    vip_guest_flow: 'Yes, guest-list control and a small artist VIP area.',
    av_production: 'Mics, stage recording, and live stream.',
    food_plan: 'Light bites and snacks only.',
    bar_plan: 'Guests can buy drinks at the bar.',
    check_in: 'RSVP list with guest-list control.',
    security: 'Door staff for crowd control.',
    onsite_staffing: 'We need onsite producer support for setup and breakdown.',
    decor_branding: 'Sponsor signage and light decor.',
    operational_timing: 'Two hours for load-in, sound check, and one hour for breakdown.',
    external_tickets: 'Use external checkout with group seats.',
    weather_plan: 'Indoor is required, with a rain plan.',
    pos_data: 'POS and sales reporting are needed.',
    permits: 'We need permits and vending clearance.',
    room_setup: 'Tables, seating, and work surfaces.',
    screen_sound: 'Screens with good sightlines and sound.',
    tech_basics: 'Wi-Fi, power, outlets, and tech support.',
    demo_production: 'Demo stations and product tables.',
    load_storage: 'Load-in, storage, display, and breakdown support.',
    route_space: 'A park route with a cafe endpoint.',
    pre_post_plan: 'Drinks before and after the game.',
    seasonal_availability: 'The date is fixed around seasonal availability.',
    overnight_rooms: 'Guest rooms and meeting rooms.',
    late_hours: 'Late hours, clear door time, and curfew support.',
  }

  return byId[question.id] ?? `${question.answer_keywords[0] ?? question.label} is needed.`
}
