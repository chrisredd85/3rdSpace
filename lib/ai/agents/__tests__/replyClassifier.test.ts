jest.mock('server-only', () => ({}))

jest.mock('@/lib/ai/client', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
  assertOpenAIConfigured: jest.fn(),
}))

import {
  replyClassifierOutputSchema,
  runReplyClassifier,
} from '@/lib/ai/agents/replyClassifier'

const validInput = {
  thread: {
    target_type: 'venue',
    target_name: 'Mission Hall',
    state: 'awaiting_reply',
    plan_title: 'Founder dinner',
    event_date: '2026-06-19',
    guest_count: 60,
    budget_cap_cents: 600000,
  },
  inbound_message: {
    from: 'events@missionhall.example',
    subject: 'Re: Founder dinner',
    body_text: 'We are available on June 19. The room minimum is $5,000 before tax and service.',
    received_at: '2026-06-02T18:00:00.000Z',
  },
}

const validOutput = {
  intent: 'price_quote',
  confidence: 0.92,
  extracted: {
    price_cents: 500000,
    date_confirmed: true,
    capacity_confirmed: false,
    alternative_date: null,
    required_action_from_creator: 'Confirm whether tax and service are inside the budget.',
  },
  suggested_next_state: 'in_negotiation',
  requires_human_review: true,
  summary_for_creator: 'Mission Hall is available and quoted a $5,000 room minimum before tax and service.',
}

describe('runReplyClassifier', () => {
  it('parses a valid classifier response', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validOutput) } }],
    })

    const result = await runReplyClassifier(validInput, { create })

    expect(result.agent_name).toBe('reply_classifier')
    expect(result.model).toBe('gpt-4o-mini')
    expect(result.output).toEqual(validOutput)
  })

  it('requires confidence between 0 and 1', () => {
    const result = replyClassifierOutputSchema.safeParse({
      ...validOutput,
      confidence: 1.4,
    })

    expect(result.success).toBe(false)
  })

  it('rejects unknown suggested states', () => {
    const result = replyClassifierOutputSchema.safeParse({
      ...validOutput,
      suggested_next_state: 'booked',
    })

    expect(result.success).toBe(false)
  })
})
