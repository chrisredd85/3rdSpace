jest.mock('server-only', () => ({}))

jest.mock('@/lib/ai/client', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
  assertOpenAIConfigured: jest.fn(),
}))

import { runVenueMatchingAgent } from '@/lib/ai/agents/venueMatchingAgent'
import type { EventPlan } from '@/lib/ai/types'
import type { VenueMatchingCandidate } from '@/lib/venues/venuePreFilter'

const eventPlan: EventPlan = {
  event_name: 'Founder dinner',
  expected_attendance: 80,
  city: 'SF',
  venue_type: 'restaurant',
  budget: 400000,
  event_date: '2026-06-19',
  monetization_model: 'ticketed',
  headcount_min: 70,
  headcount_max: 90,
  ticket_price_target: 7500,
  profit_goal: 100000,
}

function makeVenue(overrides: Partial<VenueMatchingCandidate> = {}): VenueMatchingCandidate {
  return {
    id: 'venue-1',
    venue_name: 'Mission Hall',
    venue_type: 'restaurant',
    standing_capacity: 100,
    seated_capacity: 85,
    city: 'San Francisco',
    state: 'CA',
    hourly_rate: 125000,
    minimum_hours: 3,
    is_published: true,
    per_head_kickback: null,
    offers_kickbacks: false,
    deposit_percentage: 25,
    cancellation_terms: 'Refundable until 14 days out.',
    available_days: ['friday', 'saturday'],
    bar_revenue_share_enabled: false,
    venue_amenities: [{ amenity_name: 'private dining room' }],
    ...overrides,
  }
}

describe('runVenueMatchingAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns no_match without calling the model when no venues pass pre-filtering', async () => {
    const create = jest.fn()

    const result = await runVenueMatchingAgent(
      {
        event_plan: eventPlan,
        candidate_venues: [makeVenue({ id: 'oakland', city: 'Oakland' })],
      },
      { create }
    )

    expect(result.output.no_match).toBe(true)
    expect(result.output.ranked_venues).toEqual([])
    expect(create).not.toHaveBeenCalled()
  })

  it('returns a validated venue ranking with deterministic fit scores', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            ranked_venues: [{
              venue_id: 'venue-1',
              venue_name: 'Wrong Name From Model',
              fit_score: 12,
              pros: ['Capacity and city fit the dinner plan.'],
              cons: ['Final rental terms still need confirmation.'],
              questions_to_ask_venue: ['Can you support a seated dinner for 80 guests?'],
            }],
            best_recommendation: 'Mission Hall is the strongest first call.',
            reason_summary: 'The venue passes capacity and city filters and has clear dinner amenities.',
            no_match: false,
          }),
        },
      }],
    })

    const result = await runVenueMatchingAgent(
      {
        event_plan: eventPlan,
        candidate_venues: [makeVenue()],
        organizer_preferences: { priorities: ['private dining', 'quiet room'] },
      },
      { create }
    )

    expect(result.agent_name).toBe('venue_matching')
    expect(result.model).toBe('gpt-4o')
    expect(result.output.no_match).toBe(false)
    expect(result.output.ranked_venues[0]).toMatchObject({
      venue_id: 'venue-1',
      venue_name: 'Mission Hall',
      fit_score: 95,
    })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
    }))
  })

  it('normalizes common model shape drift before validation', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            ranked_venues: [{
              venue_id: 'venue-1',
              venue_name: 'Mission Hall',
              fit_score: '92',
              commercial_model_match: null,
              pros: ['Capacity and city fit the dinner plan.'],
              cons: ['Final rental terms still need confirmation.'],
              questions_to_ask_venue: ['Can you support a seated dinner for 80 guests?'],
            }],
            best_recommendation: null,
            reason_summary: 'The venue passes capacity and city filters.',
            no_match: false,
          }),
        },
      }],
    })

    const result = await runVenueMatchingAgent(
      {
        event_plan: eventPlan,
        candidate_venues: [makeVenue()],
      },
      { create }
    )

    expect(result.output.ranked_venues[0]).toMatchObject({
      venue_id: 'venue-1',
      venue_name: 'Mission Hall',
      fit_score: 95,
    })
    expect(result.output.ranked_venues[0].commercial_model_match).toBeUndefined()
    expect(result.output.best_recommendation).toMatch(/Mission Hall|Capacity/i)
  })

  it('tolerates missing optional venue question arrays from the model', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            ranked_venues: [{
              venue_id: 'venue-1',
              venue_name: 'Mission Hall',
              fit_score: 88,
            }],
            best_recommendation: 'Mission Hall is the strongest first call.',
            reason_summary: 'The venue passes capacity and city filters.',
            no_match: false,
          }),
        },
      }],
    })

    const result = await runVenueMatchingAgent(
      {
        event_plan: eventPlan,
        candidate_venues: [makeVenue()],
      },
      { create }
    )

    expect(result.output.ranked_venues[0]).toMatchObject({
      venue_id: 'venue-1',
      pros: [],
      cons: [],
      questions_to_ask_venue: [],
    })
  })

  it('sends no more than 10 pre-filtered candidates to the model', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            ranked_venues: [{
              venue_id: 'venue-0',
              venue_name: 'Venue 0',
              fit_score: 88,
              pros: ['Published SF venue with enough capacity.'],
              cons: ['Availability details need confirmation.'],
              questions_to_ask_venue: ['Is the requested date available?'],
            }],
            best_recommendation: 'Venue 0 is the best first option.',
            reason_summary: 'Top venues were pre-filtered for city and capacity before ranking.',
            no_match: false,
          }),
        },
      }],
    })
    const candidateVenues = Array.from({ length: 12 }, (_, index) => makeVenue({
      id: `venue-${index}`,
      venue_name: `Venue ${index}`,
      standing_capacity: 90 + index,
      seated_capacity: 80 + index,
    }))

    await runVenueMatchingAgent(
      {
        event_plan: eventPlan,
        candidate_venues: candidateVenues,
      },
      { create }
    )

    const request = create.mock.calls[0][0]
    const userMessage = request.messages[1]?.content
    if (typeof userMessage !== 'string') {
      throw new Error('Expected venue matching user message content to be a string')
    }
    const parsedRequest = JSON.parse(userMessage) as { candidate_venues: unknown[] }

    expect(parsedRequest.candidate_venues).toHaveLength(10)
  })
})
