import type { NextRequest } from 'next/server'
import { POST } from '@/app/api/support/contact/route'
import { PATCH } from '@/app/api/admin/support/[ticketId]/route'
import { getAdminContext } from '@/lib/server/admin-auth'
import { checkRateLimit } from '@/lib/server/rate-limit'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/server/rate-limit', () => ({
  checkRateLimit: jest.fn(),
  rateLimitHeaders: jest.fn(() => ({
    'X-RateLimit-Limit': '5',
    'X-RateLimit-Remaining': '0',
    'X-RateLimit-Reset': '60',
  })),
}))

jest.mock('@/lib/server/admin-auth', () => ({
  getAdminContext: jest.fn(),
}))

jest.mock('@/lib/email', () => ({
  sendResendEmail: jest.fn().mockResolvedValue({ sent: true, reason: null, responsePayload: { id: 'email-1' } }),
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

const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock
const mockCheckRateLimit = checkRateLimit as jest.Mock
const mockGetAdminContext = getAdminContext as jest.Mock

function request(body: Record<string, unknown>, url = 'http://localhost/api/support/contact') {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
      'user-agent': 'jest',
    },
    body: JSON.stringify(body),
  }) as NextRequest
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe('POST /api/support/contact', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      limit: 5,
      remaining: 4,
      reset: Date.now() + 60_000,
      retryAfter: 0,
    })
  })

  it('creates an authenticated support ticket with related plan context', async () => {
    const inserts: Record<string, unknown>[] = []
    const updates: Record<string, unknown>[] = []
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'creator@example.com', user_metadata: { name: 'Creator' } } },
          error: null,
        }),
      },
    })
    mockCreateServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'plans') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: '11111111-1111-4111-8111-111111111111', title: 'Founder Dinner', status: 'ready', event_type: 'dinner' },
              error: null,
            }),
          }
        }

        return {
          insert: jest.fn((payload) => {
            inserts.push(payload)
            return {
              select: jest.fn().mockReturnThis(),
              single: jest.fn().mockResolvedValue({
                data: { id: 'ticket-row-1', ticket_id: payload.ticket_id },
                error: null,
              }),
            }
          }),
          update: jest.fn((payload) => ({
            eq: jest.fn().mockImplementation(async () => {
              updates.push(payload)
              return { data: null, error: null }
            }),
          })),
        }
      }),
    })

    const response = await POST(request({
      category: 'bug',
      severity: 'high',
      subject: 'Outreach did not send',
      description: 'The approval was created but the email did not leave Gmail.',
      related_plan_id: '11111111-1111-4111-8111-111111111111',
    }))
    const body = await json(response)

    expect(response.status).toBe(201)
    expect(body.ticket_id).toMatch(/^TKT-/)
    expect(inserts[0]).toMatchObject({
      user_id: 'user-1',
      email: 'creator@example.com',
      name: 'Creator',
      category: 'bug',
      severity: 'high',
      related_plan_id: '11111111-1111-4111-8111-111111111111',
    })
    expect(updates[0]).toMatchObject({
      metadata: expect.objectContaining({
        email_forwarded: true,
        email_error: null,
      }),
    })
  })

  it('rate limits the sixth public support submission before insert', async () => {
    const adminFrom = jest.fn()
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    })
    mockCreateServiceRoleClient.mockReturnValue({ from: adminFrom })
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      limit: 5,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfter: 60,
    })

    const response = await POST(request({
      category: 'question',
      severity: 'medium',
      subject: 'How do I connect Gmail?',
      description: 'I need help connecting Gmail to my planner account.',
      email: 'public@example.com',
      name: 'Public User',
    }))
    const body = await json(response)

    expect(response.status).toBe(429)
    expect(body.error).toMatch(/Too many support requests/)
    expect(adminFrom).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/admin/support/[ticketId]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('lets admins update support ticket status and resolution notes', async () => {
    mockGetAdminContext.mockResolvedValue({
      authorized: true,
      user: { id: 'admin-1', email: 'admin@example.com' },
    })
    const update = jest.fn(() => ({
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { ticket_id: 'TKT-123', status: 'resolved', resolution_notes: 'Fixed.' },
        error: null,
      }),
    }))
    mockCreateServiceRoleClient.mockReturnValue({ from: jest.fn(() => ({ update })) })

    const response = await PATCH(
      request({ status: 'resolved', resolution_notes: 'Fixed.' }, 'http://localhost/api/admin/support/TKT-123'),
      { params: { ticketId: 'TKT-123' } }
    )
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(body.ticket).toMatchObject({ ticket_id: 'TKT-123', status: 'resolved' })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'resolved',
      resolution_notes: 'Fixed.',
      resolved_by: 'admin-1',
    }))
  })
})
