import type { NextRequest } from 'next/server'
import { POST as postSignupEvent } from '@/app/api/auth/signup/events/route'
import { createServiceRoleClient } from '@/lib/supabase/server'

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

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))

const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock
const mockInsert = jest.fn()

describe('POST /api/auth/signup/events', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockInsert.mockResolvedValue({ error: null })
    mockCreateServiceRoleClient.mockReturnValue({
      from: jest.fn(() => ({
        insert: mockInsert,
      })),
    })
  })

  it('records valid signup funnel events', async () => {
    const response = await postSignupEvent(makeRequest({
      role: 'community_builder',
      event_name: 'signup_step_completed',
      step: 4,
      total_steps: 4,
      method: 'email',
      anonymous_id: 'anon-1',
      metadata: { selected_ticket_platform_count: 0 },
    }))

    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      role: 'community_builder',
      event_name: 'signup_step_completed',
      step: 4,
      total_steps: 4,
      method: 'email',
      anonymous_id: 'anon-1',
      metadata: { selected_ticket_platform_count: 0 },
    }))
  })

  it('rejects invalid signup events', async () => {
    const response = await postSignupEvent(makeRequest({
      role: 'admin',
      event_name: 'signup_step_completed',
    }))

    await expect(response.json()).resolves.toEqual({ error: 'Invalid signup event' })
    expect(response.status).toBe(400)
    expect(mockInsert).not.toHaveBeenCalled()
  })
})

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/auth/signup/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}
