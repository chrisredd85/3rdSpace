jest.mock('server-only', () => ({}))

jest.mock('@/lib/ai/client', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
  assertOpenAIConfigured: jest.fn(),
}))

import { intakeAgentOutputSchema, runIntakeAgent } from '@/lib/ai/agents/intakeAgent'

const founderDinnerOutput = {
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
    'What is your target budget?',
    'Should guests pay, sponsors cover it, or should this be free?',
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
    expect(result.output.missing_questions).toHaveLength(3)
    expect(result.output.missing_questions.join(' ')).toMatch(/budget/i)
    expect(result.output.missing_questions.join(' ')).toMatch(/date/i)
    expect(result.output.food_drink_needs).toMatch(/Dinner/i)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
    }))
  })

  it('rejects model output with more than three missing questions', () => {
    const invalidOutput = {
      ...founderDinnerOutput,
      missing_questions: ['One?', 'Two?', 'Three?', 'Four?'],
    }

    expect(() => intakeAgentOutputSchema.parse(invalidOutput)).toThrow()
  })

  it('rejects missing required input fields before calling the model', async () => {
    const create = jest.fn()

    await expect(runIntakeAgent({}, { create })).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })
})
