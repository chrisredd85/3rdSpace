jest.mock('server-only', () => ({}))

jest.mock('@/lib/ai/client', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
  assertOpenAIConfigured: jest.fn(),
}))

import {
  dataConnectionAgentOutputSchema,
  runDataConnectionAgent,
} from '@/lib/ai/agents/dataConnectionAgent'

const modelOutput = {
  summary: 'Eventbrite is the right setup path for ticket sales and check-in imports.',
  recommended_platform: 'eventbrite',
  setup_status: 'needs_event_link',
  setup_steps: [
    {
      title: 'Connect Eventbrite',
      detail: 'Run OAuth, then select the exact external event to import attendees and check-ins.',
      action_type: 'oauth',
    },
    {
      title: 'Verify check-ins',
      detail: 'Confirm checked-in rows appear after doors open.',
      action_type: 'verify',
    },
  ],
  data_sources: [
    {
      source: 'Eventbrite',
      metrics: ['tickets sold', 'refunds', 'check-ins'],
      collection_method: 'api',
    },
    {
      source: 'Venue post-event report',
      metrics: ['walk-ins', 'peak room count', 'bar sales'],
      collection_method: 'manual',
    },
  ],
  post_event_questions: ['How many walk-ins did the venue observe?'],
  cost_note: 'AI is only used for setup guidance; raw metrics are deterministic.',
  guardrails: ['Never invent check-in or revenue numbers.'],
}

describe('runDataConnectionAgent', () => {
  it('returns a setup guide and preserves deterministic metric guardrails', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(modelOutput) } }],
    })

    const result = await runDataConnectionAgent({
      current_plan: { title: 'Founder dinner', ticketed: true },
      requested_platform: 'eventbrite',
      external_event_url: null,
      connected_platforms: [],
      data_goal: 'Track tickets and check-ins.',
    }, { create })

    expect(result.agent_name).toBe('data_connection')
    expect(result.model).toBe('gpt-4o-mini')
    expect(result.output.setup_status).toBe('needs_event_link')
    expect(result.output.guardrails).toContain('Never invent check-in or revenue numbers.')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
    }))
  })

  it('rejects setup guides that omit post-event questions', () => {
    const result = dataConnectionAgentOutputSchema.safeParse({
      ...modelOutput,
      post_event_questions: [],
    })

    expect(result.success).toBe(false)
  })
})
