jest.mock('server-only', () => ({}))

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

jest.mock('@/lib/server/admin-auth', () => ({
  getAdminContext: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(() => ({ from: jest.fn() })),
}))

jest.mock('@/lib/finance/settlement-checkout', () => ({
  resolveDisputedSettlement: jest.fn(),
}))

import { POST } from '@/app/api/admin/settlements/[runId]/resolve/route'
import { resolveDisputedSettlement } from '@/lib/finance/settlement-checkout'
import { getAdminContext } from '@/lib/server/admin-auth'

const mockGetAdminContext = getAdminContext as jest.Mock
const mockResolve = resolveDisputedSettlement as jest.Mock

describe('admin settlement dispute resolution route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('requires admin access', async () => {
    mockGetAdminContext.mockResolvedValue({ authorized: false, status: 403, error: 'Forbidden' })

    const response = await POST(
      new Request('https://www.3rdplace.io/api/admin/settlements/run-1/resolve', {
        method: 'POST',
        body: JSON.stringify({ note: 'Reviewed' }),
      }) as never,
      { params: { runId: 'run-1' } },
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('submits resolution note for disputed settlements', async () => {
    mockGetAdminContext.mockResolvedValue({ authorized: true, status: 200 })
    mockResolve.mockResolvedValue({ status: 200, body: { status: 'awaiting_organizer_review' } })

    const response = await POST(
      new Request('https://www.3rdplace.io/api/admin/settlements/run-1/resolve', {
        method: 'POST',
        body: JSON.stringify({ note: 'Venue and host aligned on attendee count.' }),
      }) as never,
      { params: { runId: 'run-1' } },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'awaiting_organizer_review' })
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      'run-1',
      'Venue and host aligned on attendee count.',
    )
  })
})
