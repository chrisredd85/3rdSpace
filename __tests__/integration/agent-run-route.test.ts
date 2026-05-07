jest.mock('server-only', () => ({}))

import type { NextRequest } from 'next/server'
import { POST as runAgentRoute } from '@/app/api/ai/agents/run/route'
import { runAgent } from '@/lib/ai/agents'
import { AgentRunExecutionError } from '@/lib/ai/types'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/ai/agents', () => ({
  runAgent: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
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

const mockRunAgent = runAgent as jest.Mock
const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock

const validAgentResult = {
  agent_name: 'event_plan_extractor',
  status: 'succeeded',
  model: 'gpt-4o-mini',
  prompt_tokens: 123,
  completion_tokens: 45,
  messages_payload: [
    { role: 'system', content: 'Extract event planning details.' },
    { role: 'user', content: '{"message":"Plan a founder mixer"}' },
  ],
  raw_model_output: '{"summary":"A ticketed founder mixer."}',
  duration_ms: 42,
  output: {
    event_plan: {
      event_name: 'Founder mixer',
      expected_attendance: 120,
      city: 'San Francisco',
      venue_type: 'rooftop',
      budget: 12000,
      event_date: '2026-06-15',
      monetization_model: 'ticketed',
      headcount_min: 90,
      headcount_max: 140,
      ticket_price_target: 45,
      profit_goal: 3000,
    },
    summary: 'A ticketed founder mixer.',
    missing_fields: [],
    recommendations: ['Approve outreach before sending.'],
    risks: ['Venue terms are not confirmed.'],
    approval_required: true,
    approval_actions: [
      {
        title: 'Approve outreach',
        rationale: 'External outreach needs human approval.',
        requires_human_approval: true,
      },
    ],
  },
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/ai/agents/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe('POST /api/ai/agents/run', () => {
  let insertMock: jest.Mock
  let fromMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    insertMock = jest.fn().mockResolvedValue({ error: null })
    fromMock = jest.fn(() => ({ insert: insertMock }))

    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    })
    mockCreateServiceRoleClient.mockReturnValue({ from: fromMock })
  })

  it('routes a valid request to the selected agent and logs the successful run', async () => {
    mockRunAgent.mockResolvedValue(validAgentResult)

    const response = await runAgentRoute(makeRequest({
      agent_name: 'event_plan_extractor',
      event_id: '11111111-1111-4111-8111-111111111111',
      plan_id: '22222222-2222-4222-8222-222222222222',
      payload: { message: 'Plan a founder mixer for 120 people in SF' },
    }))
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(json.data).toEqual(validAgentResult)
    expect(mockRunAgent).toHaveBeenCalledWith({
      agent_name: 'event_plan_extractor',
      event_id: '11111111-1111-4111-8111-111111111111',
      payload: { message: 'Plan a founder mixer for 120 people in SF' },
      user_id: 'user-1',
    })
    expect(fromMock).toHaveBeenCalledWith('agent_runs')
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      event_id: '11111111-1111-4111-8111-111111111111',
      plan_id: '22222222-2222-4222-8222-222222222222',
      agent_name: 'event_plan_extractor',
      status: 'succeeded',
      input_payload: { message: 'Plan a founder mixer for 120 people in SF' },
      output_payload: validAgentResult.output,
      duration_ms: 42,
      model: 'gpt-4o-mini',
      prompt_tokens: 123,
      completion_tokens: 45,
      messages_payload: validAgentResult.messages_payload,
      raw_model_output: validAgentResult.raw_model_output,
    }))
    expect(insertMock.mock.calls[0][0]).not.toHaveProperty('quality_label')
  })

  it('logs failed agent runs before returning a 500 response', async () => {
    mockRunAgent.mockRejectedValue(new AgentRunExecutionError(
      'model output failed schema validation',
      {
        model: 'gpt-4o',
        prompt_tokens: 10,
        completion_tokens: 4,
        messages_payload: [{ role: 'system', content: 'Prompt' }],
        raw_model_output: '{"summary":"missing required fields"}',
      }
    ))

    const response = await runAgentRoute(makeRequest({
      agent_name: 'booking_ops_assistant',
      plan_id: '22222222-2222-4222-8222-222222222222',
      payload: { event_name: 'Founder mixer' },
    }))
    const json = await readJson(response)

    expect(response.status).toBe(500)
    expect(json.error).toBe('model output failed schema validation')
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      event_id: null,
      plan_id: '22222222-2222-4222-8222-222222222222',
      agent_name: 'booking_ops_assistant',
      status: 'failed',
      input_payload: { event_name: 'Founder mixer' },
      output_payload: null,
      error: 'model output failed schema validation',
      model: 'gpt-4o',
      prompt_tokens: 10,
      completion_tokens: 4,
      messages_payload: [{ role: 'system', content: 'Prompt' }],
      raw_model_output: '{"summary":"missing required fields"}',
    }))
    expect(insertMock.mock.calls[0][0]).not.toHaveProperty('quality_label')
  })

  it('rejects unauthenticated requests with 401', async () => {
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    })

    const response = await runAgentRoute(makeRequest({
      agent_name: 'event_plan_extractor',
      payload: { message: 'Plan an event' },
    }))

    expect(response.status).toBe(401)
    expect(mockRunAgent).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('rejects unknown agent names with 400', async () => {
    const response = await runAgentRoute(makeRequest({
      agent_name: 'autonomous_buyer',
      payload: { message: 'Book it automatically' },
    }))

    expect(response.status).toBe(400)
    expect(mockRunAgent).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })
})
