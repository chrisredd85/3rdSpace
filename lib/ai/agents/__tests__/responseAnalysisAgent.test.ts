jest.mock('server-only', () => ({}))

jest.mock('@/lib/ai/client', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
  assertOpenAIConfigured: jest.fn(),
}))

import {
  responseAnalysisAgentOutputSchema,
  runResponseAnalysisAgent,
} from '@/lib/ai/agents/responseAnalysisAgent'
import type { EventPlan } from '@/lib/ai/types'

const eventPlan: EventPlan = {
  event_name: 'Founder dinner',
  expected_attendance: 60,
  city: 'SF',
  venue_type: 'restaurant',
  budget: 600000,
  event_date: '2026-03-15',
  monetization_model: 'ticketed',
  headcount_min: 50,
  headcount_max: 70,
  ticket_price_target: 12500,
  profit_goal: 150000,
}

const venueReplyPayload = {
  raw_email_text:
    'Hi, we are available March 15 for your dinner. We require a $2,500 minimum spend and a 25% deposit to hold the date. The minimum includes room rental and basic staffing, but tax, gratuity, and AV are not included. Please confirm your final headcount.',
  event_plan: eventPlan,
  partner_type: 'venue',
}

const modelOutputWithDepositPercent = {
  availability_status: 'available',
  quoted_price_cents: null,
  minimum_spend_cents: 250000,
  deposit_required_cents: null,
  capacity_notes: null,
  included_services: ['Room rental', 'Basic staffing'],
  exclusions: ['Tax', 'Gratuity', 'AV'],
  hidden_fees: ['Tax and gratuity not included'],
  cancellation_terms: null,
  required_next_steps: ['Confirm final headcount'],
  summary: 'The venue is available March 15 with a $2,500 minimum spend and a 25% deposit.',
  risk_flags: ['Tax and gratuity are not included in the minimum spend.'],
  extracted_questions: ['Can you confirm your final headcount?'],
}

const vendorReplyPayload = {
  raw_email_text:
    'I can DJ the happy hour on March 15 from 6-10pm. My quote is $1,200 with a $300 deposit. I can bring controller, speakers, and a wireless mic. I am available after 5pm and would need power near the stage.',
  event_plan: eventPlan,
  partner_type: 'vendor',
} as const

const vendorModelOutput = {
  availability_status: 'available',
  service_type: 'DJ',
  quoted_price_cents: 120000,
  minimum_spend_cents: null,
  deposit_required_cents: 30000,
  availability_notes: 'Available March 15 after 5pm.',
  capacity_notes: null,
  included_services: ['Controller', 'Speakers', 'Wireless mic'],
  exclusions: ['Power near stage must be provided'],
  hidden_fees: [],
  cancellation_terms: null,
  notes: 'Needs power near the stage.',
  required_next_steps: ['Confirm stage power location'],
  summary: 'The DJ is available March 15 from 6-10pm for $1,200 with a $300 deposit.',
  risk_flags: [],
  extracted_questions: [],
}

describe('runResponseAnalysisAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('parses a venue reply and calculates deposit cents from the minimum spend', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(modelOutputWithDepositPercent) } }],
    })

    const result = await runResponseAnalysisAgent(venueReplyPayload, { create })

    expect(result.agent_name).toBe('response_analysis')
    expect(result.model).toBe('gpt-4o-mini')
    expect(result.output.availability_status).toBe('available')
    expect(result.output.minimum_spend_cents).toBe(250000)
    expect(result.output.deposit_required_cents).toBe(62500)
    expect(result.output.summary).toContain('March 15')
    expect(result.output.risk_flags).toContain(
      'Contract, payment, deposit, or cancellation terms require review before approval.'
    )
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
    }))
  })

  it('rejects dollar-decimal strings for monetary fields', () => {
    const result = responseAnalysisAgentOutputSchema.safeParse({
      ...modelOutputWithDepositPercent,
      quoted_price_cents: '$2,500',
    })

    expect(result.success).toBe(false)
  })

  it('preserves structured vendor reply details for approval capture', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(vendorModelOutput) } }],
    })

    const result = await runResponseAnalysisAgent(vendorReplyPayload, { create })

    expect(result.output.service_type).toBe('DJ')
    expect(result.output.quoted_price_cents).toBe(120000)
    expect(result.output.deposit_required_cents).toBe(30000)
    expect(result.output.availability_notes).toContain('after 5pm')
    expect(result.output.notes).toContain('power')
    expect(result.output.included_services).toContain('Speakers')
  })

  it('throws when the model output is missing required structured fields', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ summary: 'Missing terms' }) } }],
    })

    await expect(runResponseAnalysisAgent(venueReplyPayload, { create })).rejects.toThrow()
  })
})
