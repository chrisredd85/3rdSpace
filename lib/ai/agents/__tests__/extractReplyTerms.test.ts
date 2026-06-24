jest.mock('server-only', () => ({}))
jest.mock('@/lib/ai/client', () => ({
  assertOpenAIConfigured: jest.fn(),
  openai: {
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  },
}))

import {
  extractReplyTerms,
  vendorReplyTermsSchema,
  venueReplyTermsSchema,
} from '@/lib/ai/agents/extractReplyTerms'

describe('extractReplyTerms', () => {
  it('parses venue reply terms with integer-cent quotes', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            classification: 'quote_received',
            confidence: 0.92,
            quoted_price_cents: 550000,
            quoted_deal_model: 'flat rental',
            availability_confirmed: true,
            capacity_confirmed: 80,
            conditions: [{ type: 'hold', detail: 'Hold expires Friday' }],
            raw_response_excerpt: '$5,500 flat rental.',
          }),
        },
      }],
    })

    const result = await extractReplyTerms({
      entityType: 'venue',
      entityName: 'The Valencia Room',
      threadText: 'We can do $5,500 with a $1,650 deposit and 80 capacity.',
    }, { create })

    expect(result.classification).toBe('quote_received')
    expect(result.quoted_price_cents).toBe(550000)
    expect(Number.isInteger(result.quoted_price_cents)).toBe(true)
    expect(venueReplyTermsSchema.safeParse(result).success).toBe(true)
  })

  it('parses vendor reply terms with package and deposit details', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            classification: 'conditional',
            confidence: 0.88,
            quoted_hourly_cents: null,
            quoted_package_cents: 120000,
            quoted_minimum_cents: null,
            quoted_deposit_pct: 0.5,
            availability_confirmed: true,
            conditions: [{ type: 'delivery', detail: 'Gallery delivered in 5 days' }],
            raw_response_excerpt: '$1,200 event package with 50% deposit.',
          }),
        },
      }],
    })

    const result = await extractReplyTerms({
      entityType: 'vendor',
      entityName: 'Moongate Photo',
      serviceType: 'photographer',
      threadText: 'We can cover it for $1,200, 50% deposit.',
    }, { create })

    expect(result.classification).toBe('conditional')
    expect(result.quoted_package_cents).toBe(120000)
    expect(result.quoted_deposit_pct).toBe(0.5)
    expect(vendorReplyTermsSchema.safeParse(result).success).toBe(true)
  })
})
