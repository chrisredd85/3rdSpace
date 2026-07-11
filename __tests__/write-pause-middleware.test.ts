/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'
import { readWritePauseStatus } from '@/lib/write-pause'

jest.mock('@/lib/supabase/middleware', () => ({
  getAuthUser: jest.fn(),
  protectRoute: jest.fn(),
}))

jest.mock('@/lib/write-pause', () => {
  const actual = jest.requireActual('@/lib/write-pause')
  return {
    ...actual,
    readWritePauseStatus: jest.fn(),
  }
})

const mockReadWritePauseStatus = readWritePauseStatus as jest.Mock

function apiRequest(pathname: string, method: string, headers: HeadersInit = {}) {
  const nextUrl = new URL(`https://www.3rdplace.io${pathname}`) as URL & { clone: () => URL }
  nextUrl.clone = () => new URL(nextUrl.toString())
  return {
    headers: new Headers(headers),
    method,
    nextUrl,
  } as NextRequest
}

describe('write-pause middleware chokepoint', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns a clear 503 for writes while reads and health continue', async () => {
    mockReadWritePauseStatus.mockResolvedValue({
      available: true,
      state: 'paused',
      enabled: true,
      reason: 'Release window',
      enabledAt: '2026-07-10T20:00:00.000Z',
      updatedAt: '2026-07-10T20:00:00.000Z',
      revision: 7,
    })

    const blocked = await middleware(apiRequest('/api/planner/plans/plan-1/approvals', 'POST'))
    expect(blocked.status).toBe(503)
    await expect(blocked.json()).resolves.toMatchObject({
      code: 'maintenance_in_progress',
      maintenance: { revision: 7 },
    })
    expect(blocked.headers.get('retry-after')).toBe('60')

    const read = await middleware(apiRequest('/api/planner/plans/plan-1', 'GET'))
    const health = await middleware(apiRequest('/api/health', 'GET'))
    expect(read.status).toBe(200)
    expect(health.status).toBe(200)
    expect(mockReadWritePauseStatus).toHaveBeenCalledTimes(1)
  })

  it('resumes writes immediately after the durable flag is disabled', async () => {
    mockReadWritePauseStatus.mockResolvedValue({
      available: true,
      state: 'open',
      enabled: false,
      reason: 'Window complete',
      enabledAt: null,
      updatedAt: '2026-07-10T20:05:00.000Z',
      revision: 8,
    })

    const response = await middleware(apiRequest('/api/payments/create-intent', 'POST'))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('keeps ordinary writes blocked while authorized webhook replay drains', async () => {
    mockReadWritePauseStatus.mockResolvedValue({
      available: true,
      state: 'draining',
      enabled: true,
      reason: 'Draining deferred webhooks',
      enabledAt: '2026-07-10T20:00:00.000Z',
      updatedAt: '2026-07-10T20:05:00.000Z',
      revision: 8,
    })

    const response = await middleware(apiRequest('/api/payments/create-intent', 'POST'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: 'maintenance_in_progress',
      maintenance: { state: 'draining' },
    })
  })

  it('always lets Stripe webhook receipt reach its durable queue handler', async () => {
    const response = await middleware(apiRequest('/api/webhooks/stripe', 'POST'))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mockReadWritePauseStatus).not.toHaveBeenCalled()
  })

  it('lets the authenticated deferred replay endpoint run while draining', async () => {
    const response = await middleware(apiRequest(
      '/api/internal/stripe-webhooks/replay-deferred',
      'POST',
      { authorization: 'Bearer internal-secret' },
    ))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mockReadWritePauseStatus).not.toHaveBeenCalled()
  })

  it('blocks planner Server Actions through the same chokepoint', async () => {
    mockReadWritePauseStatus.mockResolvedValue({
      available: true,
      state: 'paused',
      enabled: true,
      reason: 'Release window',
      enabledAt: '2026-07-10T20:00:00.000Z',
      updatedAt: '2026-07-10T20:00:00.000Z',
      revision: 9,
    })

    const response = await middleware(apiRequest('/planner/experiences', 'POST', {
      'next-action': 'action-id',
    }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: 'maintenance_in_progress' })
  })

  it('blocks HEAD on read-on-write routes while leaving ordinary read HEAD requests available', async () => {
    mockReadWritePauseStatus.mockResolvedValue({
      available: true,
      state: 'paused',
      enabled: true,
      reason: 'Release window',
      enabledAt: '2026-07-10T20:00:00.000Z',
      updatedAt: '2026-07-10T20:00:00.000Z',
      revision: 10,
    })

    const blocked = await middleware(apiRequest('/api/messages/thread-1', 'HEAD'))
    const blockedPartnerships = await middleware(apiRequest('/api/planner/plans/plan-1/partnerships', 'HEAD'))
    const blockedRecalculation = await middleware(apiRequest('/api/events/event-1/financials?recalculate=true', 'HEAD'))
    const cachedFinancials = await middleware(apiRequest('/api/events/event-1/financials', 'HEAD'))
    const ordinaryRead = await middleware(apiRequest('/api/planner/plans/plan-1', 'HEAD'))
    const health = await middleware(apiRequest('/api/health', 'HEAD'))

    expect(blocked.status).toBe(503)
    expect(blockedPartnerships.status).toBe(503)
    expect(blockedRecalculation.status).toBe(503)
    expect(cachedFinancials.status).toBe(200)
    expect(ordinaryRead.status).toBe(200)
    expect(health.status).toBe(200)
    expect(mockReadWritePauseStatus).toHaveBeenCalledTimes(3)
  })
})
