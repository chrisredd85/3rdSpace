import {
  classifyReplyWithRules,
  replyClassifierOutputSchema,
  runReplyClassifier,
} from '@/lib/ai/agents/replyClassifier'

describe('reply classifier', () => {
  it('classifies price or terms changes as creator-review work with integer cents', () => {
    const output = classifyReplyWithRules({
      reply_text: 'We can hold June 19 with a $7,500.25 minimum spend and capacity is 120.',
      thread_context: { target_name: 'North Pier Hall', target_type: 'venue' },
    })

    expect(output.label).toBe('pricing_or_terms_change')
    expect(output.requires_creator_review).toBe(true)
    expect(output.extracted_terms.price_cents).toBe(750025)
    expect(Number.isInteger(output.extracted_terms.price_cents)).toBe(true)
    expect(output.extracted_terms.capacity).toBe(120)
  })

  it('pauses autonomy on unsubscribe requests', () => {
    const output = classifyReplyWithRules({
      reply_text: 'Please unsubscribe us and do not contact this address again.',
    })

    expect(output.label).toBe('unsubscribe')
    expect(output.requires_creator_review).toBe(true)
    expect(output.should_pause_autonomy).toBe(true)
  })

  it('validates live classifier output shape when a model client is supplied', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            label: 'needs_follow_up',
            confidence: 0.91,
            requires_creator_review: false,
            should_pause_autonomy: false,
            rationale: 'Recipient asked for more information.',
            extracted_terms: {},
          }),
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 12 },
    })

    const result = await runReplyClassifier({ reply_text: 'Can you send more details?' }, { create })

    expect(result.agent_name).toBe('reply_classifier')
    expect(result.output.label).toBe('needs_follow_up')
    expect(replyClassifierOutputSchema.safeParse(result.output).success).toBe(true)
  })
})
