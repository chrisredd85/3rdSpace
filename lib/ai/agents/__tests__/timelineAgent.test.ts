jest.mock('server-only', () => ({}))

jest.mock('@/lib/ai/client', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
  assertOpenAIConfigured: jest.fn(),
}))

import { runTimelineAgent, timelineAgentOutputSchema } from '@/lib/ai/agents/timelineAgent'
import type { EventPlan } from '@/lib/ai/types'

const eventPlan: EventPlan = {
  event_name: 'Founder dinner',
  expected_attendance: 60,
  city: 'SF',
  venue_type: 'restaurant',
  budget: 600000,
  event_date: null,
  monetization_model: 'ticketed',
  headcount_min: 50,
  headcount_max: 70,
  ticket_price_target: 12500,
  profit_goal: 150000,
}

const modelOutput = {
  planning_milestones: [],
  day_of_timeline: [],
  staffing_needs: ['Volunteer check-in support'],
  reminders: ['Confirm run-of-show owner.'],
  dependency_warnings: ['Model-added dependency note.'],
  impossible_timeline: false,
}

function isoDateDaysFromNow(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

describe('runTimelineAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns a practical timeline with venue confirmation as a blocking milestone', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(modelOutput) } }],
    })
    const eventDate = isoDateDaysFromNow(30)

    const result = await runTimelineAgent({
      event_plan: { ...eventPlan, event_date: eventDate },
      event_date: eventDate,
      confirmed_venue_bookings: [],
      confirmed_vendor_bookings: [],
      venue_requirements: [],
    }, { create })

    expect(result.agent_name).toBe('timeline')
    expect(result.model).toBe('gpt-4o-mini')
    expect(result.output.impossible_timeline).toBe(false)
    expect(result.output.planning_milestones).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Confirm venue booking',
        is_blocking: true,
      }),
      expect.objectContaining({ title: 'Pay venue deposit' }),
      expect.objectContaining({ title: 'Confirm vendor bookings' }),
      expect.objectContaining({ title: 'Setup window' }),
      expect.objectContaining({ title: 'Doors open' }),
      expect.objectContaining({ title: 'Programming starts' }),
      expect.objectContaining({ title: 'Teardown and venue closeout' }),
    ]))
    expect(result.output.dependency_warnings).toContain(
      'Venue confirmation is missing and blocks deposit, setup, and day-of logistics.'
    )
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
    }))
  })

  it('marks timelines fewer than 7 days away as impossible and preserves dependency warnings', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(modelOutput) } }],
    })
    const eventDate = isoDateDaysFromNow(3)

    const result = await runTimelineAgent({
      event_plan: { ...eventPlan, event_date: eventDate },
      event_date: eventDate,
      confirmed_venue_bookings: [],
      confirmed_vendor_bookings: [],
      venue_requirements: [],
    }, { create })

    expect(result.output.impossible_timeline).toBe(true)
    expect(result.output.dependency_warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('critical milestones may not be completable'),
      'Venue confirmation is missing and blocks deposit, setup, and day-of logistics.',
      'Vendor bookings are missing and may block food, AV, entertainment, or staffing plans.',
    ]))
  })

  it('passes deterministic timeline to the model before final validation', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(modelOutput) } }],
    })
    const eventDate = isoDateDaysFromNow(30)

    await runTimelineAgent({
      event_plan: { ...eventPlan, event_date: eventDate },
      event_date: eventDate,
      confirmed_venue_bookings: [],
      confirmed_vendor_bookings: [],
      venue_requirements: [],
    }, { create })

    const request = create.mock.calls[0][0]
    const userMessage = request.messages[1]?.content
    if (typeof userMessage !== 'string') {
      throw new Error('Expected timeline user message content to be a string')
    }
    const parsedRequest = JSON.parse(userMessage) as {
      deterministic_timeline: { planning_milestones: Array<{ title: string }> }
    }

    expect(parsedRequest.deterministic_timeline.planning_milestones).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Confirm venue booking' }),
      expect.objectContaining({ title: 'Doors open' }),
    ]))
  })

  it('rejects invalid timeline output shapes', () => {
    const result = timelineAgentOutputSchema.safeParse({
      ...modelOutput,
      impossible_timeline: 'no',
    })

    expect(result.success).toBe(false)
  })
})
