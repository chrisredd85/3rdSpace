jest.mock('server-only', () => ({}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

import { getWorkerOrAdminContext } from '@/lib/server/admin-auth'
import { createClient } from '@/lib/supabase/server'

const mockCreateClient = createClient as jest.Mock

function makeRequest(token?: string) {
  return new Request('https://www.3rdplace.io/api/jobs/run', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

describe('getWorkerOrAdminContext', () => {
  const originalWorkerSecret = process.env.WORKER_SECRET
  const originalCronSecret = process.env.CRON_SECRET
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.NODE_ENV = 'production'
    delete process.env.WORKER_SECRET
    delete process.env.CRON_SECRET
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('No user'),
        }),
      },
    })
  })

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    if (originalWorkerSecret === undefined) delete process.env.WORKER_SECRET
    else process.env.WORKER_SECRET = originalWorkerSecret
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalCronSecret
  })

  it('accepts the worker bearer secret', async () => {
    process.env.WORKER_SECRET = 'worker-secret'

    const context = await getWorkerOrAdminContext(makeRequest('worker-secret'))

    expect(context).toMatchObject({
      authorized: true,
      user: { id: 'worker', email: 'worker@internal' },
    })
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('accepts the cron bearer secret for scheduled worker routes', async () => {
    process.env.CRON_SECRET = 'cron-secret'

    const context = await getWorkerOrAdminContext(makeRequest('cron-secret'))

    expect(context).toMatchObject({
      authorized: true,
      user: { id: 'worker', email: 'worker@internal' },
    })
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated requests when no worker or cron token matches', async () => {
    process.env.WORKER_SECRET = 'worker-secret'
    process.env.CRON_SECRET = 'cron-secret'

    const context = await getWorkerOrAdminContext(makeRequest('wrong-secret'))

    expect(context).toMatchObject({
      authorized: false,
      status: 401,
      error: 'Unauthorized',
    })
  })
})
