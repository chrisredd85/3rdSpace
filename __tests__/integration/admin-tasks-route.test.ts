import type { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/admin/tasks/[id]/route'
import { getAdminContext } from '@/lib/server/admin-auth'
import { AdminTaskServiceError, mutateAdminTask } from '@/lib/server/admin-tasks'
import { createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/server/admin-auth', () => ({
  getAdminContext: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/server/admin-tasks', () => {
  class MockAdminTaskServiceError extends Error {
    constructor(
      message: string,
      public readonly status = 500
    ) {
      super(message)
      this.name = 'AdminTaskServiceError'
    }
  }

  return {
    AdminTaskServiceError: MockAdminTaskServiceError,
    mutateAdminTask: jest.fn(),
  }
})

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

const mockGetAdminContext = getAdminContext as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock
const mockMutateAdminTask = mutateAdminTask as jest.Mock

const TASK_ID = '11111111-1111-4111-8111-111111111111'

function request(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/admin/tasks/${TASK_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

function routeContext(id = TASK_ID) {
  return { params: { id } }
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

function mockAdmin() {
  mockGetAdminContext.mockResolvedValue({
    authorized: true,
    user: { id: '22222222-2222-4222-8222-222222222222', email: 'admin@example.com' },
  })
}

describe('PATCH /api/admin/tasks/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateServiceRoleClient.mockReturnValue({ from: jest.fn() })
  })

  it('rejects unauthenticated requests before creating a service-role client', async () => {
    mockGetAdminContext.mockResolvedValue({
      authorized: false,
      status: 401,
      error: 'Unauthorized',
    })

    const response = await PATCH(request({ action: 'start' }), routeContext())

    expect(response.status).toBe(401)
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
    expect(mockMutateAdminTask).not.toHaveBeenCalled()
  })

  it('rejects invalid actions', async () => {
    mockAdmin()

    const response = await PATCH(request({ action: 'delete' }), routeContext())
    const body = await json(response)

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid admin task action')
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
  })

  it('passes valid complete actions to the admin task service', async () => {
    mockAdmin()
    mockMutateAdminTask.mockResolvedValue({ id: TASK_ID, status: 'complete' })

    const response = await PATCH(request({ action: 'complete', note: 'Done.' }), routeContext())
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(body.task).toEqual({ id: TASK_ID, status: 'complete' })
    expect(mockMutateAdminTask).toHaveBeenCalledWith(expect.anything(), {
      taskId: TASK_ID,
      adminUserId: '22222222-2222-4222-8222-222222222222',
      adminUserEmail: 'admin@example.com',
      action: 'complete',
      note: 'Done.',
    })
  })

  it('returns service status codes for invalid state transitions', async () => {
    mockAdmin()
    mockMutateAdminTask.mockRejectedValue(new AdminTaskServiceError('Cannot start a complete admin task.', 409))

    const response = await PATCH(request({ action: 'start' }), routeContext())
    const body = await json(response)

    expect(response.status).toBe(409)
    expect(body.error).toBe('Cannot start a complete admin task.')
  })
})
