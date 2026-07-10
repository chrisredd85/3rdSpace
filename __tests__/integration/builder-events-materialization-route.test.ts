import type { NextRequest } from 'next/server'

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

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/supabase/server-helpers', () => ({
  getBuilderProfileId: jest.fn(),
  mapAppEventTypeToDb: jest.fn((value?: string | null) => value || 'other'),
  mapAppEventStatusToDb: jest.fn(() => 'draft'),
  mapDbEventToApp: jest.fn((row: Record<string, unknown>) => ({
    id: row.id,
    builder_id: row.builder_id,
    title: row.event_name,
    description: row.description,
    event_type: row.event_type,
    event_date: row.event_date,
    start_time: row.start_time,
    end_time: row.end_time,
    expected_attendees: row.expected_attendance,
    status: row.status,
    venue_id: row.venue_id,
    budget: row.budget,
    created_at: row.created_at,
    updated_at: row.updated_at,
  })),
}))

jest.mock('@/lib/billing/builder-billing', () => {
  class BuilderBillingRequiredError extends Error {
    status = 402

    constructor() {
      super('Choose pay-per-event or Pro to create another event.')
    }
  }

  return {
    BuilderBillingRequiredError,
    loadBuilderBillingProfileById: jest.fn(),
    getBuilderBillingSummary: jest.fn(() => ({
      canCreateEvent: true,
      freeEventsRemaining: 1,
      paidEventCredits: 0,
    })),
  }
})

import { POST as createBuilderEvent } from '@/app/api/builder/events/route'
import {
  getBuilderBillingSummary,
  loadBuilderBillingProfileById,
} from '@/lib/billing/builder-billing'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock
const mockGetBuilderProfileId = getBuilderProfileId as jest.Mock
const mockLoadBillingProfile = loadBuilderBillingProfileById as jest.Mock
const mockGetBillingSummary = getBuilderBillingSummary as jest.Mock

const userId = '10000000-0000-4000-8000-000000000001'
const builderId = '20000000-0000-4000-8000-000000000001'
const planId = '30000000-0000-4000-8000-000000000001'
const eventId = '40000000-0000-4000-8000-000000000001'
const consumptionId = '50000000-0000-4000-8000-000000000001'

let rpcMock: jest.Mock
let fromMock: jest.Mock

function materializationRow(existing = false) {
  return {
    plan_id: planId,
    event_id: eventId,
    consumption_id: consumptionId,
    access_source: 'free_trial',
    amount_cents: 0,
    existing,
    event_record: {
      id: eventId,
      builder_id: builderId,
      event_name: 'Founder dinner',
      description: 'Private dinner',
      event_type: 'networking',
      event_date: '2026-08-20',
      start_time: '19:00:00',
      end_time: '22:00:00',
      expected_attendance: 30,
      status: 'draft',
      venue_id: null,
      budget: 5000,
      created_at: '2026-07-09T19:00:00.000Z',
      updated_at: '2026-07-09T19:00:00.000Z',
    },
  }
}

function request(idempotencyKey = 'evt-create-request-001') {
  return new Request('http://localhost/api/builder/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify({
      title: 'Founder dinner',
      description: 'Private dinner',
      event_type: 'networking',
      event_date: '2026-08-20',
      start_time: '19:00',
      end_time: '22:00',
      expected_attendees: 30,
      budget: 5000,
      status: 'planning',
    }),
  }) as NextRequest
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateClient.mockReturnValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: {
          user: {
            id: userId,
            user_metadata: { user_type: 'community_builder' },
          },
        },
        error: null,
      }),
    },
  })
  mockGetBuilderProfileId.mockResolvedValue({ builderProfileId: builderId, error: null })
  mockLoadBillingProfile.mockResolvedValue({
    data: {
      id: builderId,
      user_id: userId,
      billing_tier: 'free_trial',
      subscription_status: 'trial',
      free_events_granted: 2,
      free_events_used: 1,
      paid_event_credits: 0,
    },
    error: null,
  })
  mockGetBillingSummary.mockReturnValue({
    canCreateEvent: true,
    freeEventsRemaining: 1,
    paidEventCredits: 0,
  })

  rpcMock = jest.fn().mockReturnValue({
    maybeSingle: jest.fn().mockResolvedValue({ data: materializationRow(), error: null }),
  })
  fromMock = jest.fn(() => {
    throw new Error('The route must not perform split table writes')
  })
  mockCreateServiceRoleClient.mockReturnValue({ rpc: rpcMock, from: fromMock })
})

describe('POST /api/builder/events atomic materialization', () => {
  it('creates the plan, event, and consumption through one service-owned RPC', async () => {
    const response = await createBuilderEvent(request())
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      planId,
      replayed: false,
      event: { id: eventId, title: 'Founder dinner' },
      consumption: {
        id: consumptionId,
        source: 'free_trial',
        amountCents: 0,
      },
    })
    expect(rpcMock).toHaveBeenCalledWith(
      'materialize_builder_event_with_access',
      expect.objectContaining({
        p_user_id: userId,
        p_builder_id: builderId,
        p_idempotency_key: 'evt-create-request-001',
        p_title: 'Founder dinner',
        p_budget_cents: 500000,
        p_payload_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
    )
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('returns billing-required without a fallback event insert when the transaction rolls back', async () => {
    rpcMock.mockReturnValueOnce({
      maybeSingle: jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'builder_billing_required' },
      }),
    })

    const response = await createBuilderEvent(request('evt-create-billing-failure'))
    const body = await json(response)

    expect(response.status).toBe(402)
    expect(body).toEqual(expect.objectContaining({
      error: 'Choose pay-per-event or Pro to create another event.',
      billingRequired: true,
    }))
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('reuses the same payload hash and returns the original event on a retry', async () => {
    mockGetBillingSummary
      .mockReturnValueOnce({ canCreateEvent: true, freeEventsRemaining: 1, paidEventCredits: 0 })
      .mockReturnValueOnce({ canCreateEvent: false, freeEventsRemaining: 0, paidEventCredits: 0 })
    rpcMock
      .mockReturnValueOnce({
        maybeSingle: jest.fn().mockResolvedValue({ data: materializationRow(false), error: null }),
      })
      .mockReturnValueOnce({
        maybeSingle: jest.fn().mockResolvedValue({ data: materializationRow(true), error: null }),
      })

    const first = await json(await createBuilderEvent(request('evt-create-retry-001')))
    const second = await json(await createBuilderEvent(request('evt-create-retry-001')))

    expect(first.event.id).toBe(eventId)
    expect(first.replayed).toBe(false)
    expect(second.event.id).toBe(eventId)
    expect(second.replayed).toBe(true)
    expect(rpcMock).toHaveBeenCalledTimes(2)
    expect(rpcMock.mock.calls[0][1].p_payload_hash).toBe(rpcMock.mock.calls[1][1].p_payload_hash)
    expect(rpcMock.mock.calls[0][1].p_idempotency_key).toBe('evt-create-retry-001')
    expect(rpcMock.mock.calls[1][1].p_idempotency_key).toBe('evt-create-retry-001')
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('requires an idempotency key before any write is attempted', async () => {
    const missingKeyRequest = new Request('http://localhost/api/builder/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Founder dinner', event_date: '2026-08-20' }),
    }) as NextRequest

    const response = await createBuilderEvent(missingKeyRequest)

    expect(response.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('rejects a nonnumeric budget as a client error before the RPC', async () => {
    const invalidBudgetRequest = new Request('http://localhost/api/builder/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'evt-create-invalid-budget',
      },
      body: JSON.stringify({
        title: 'Founder dinner',
        event_date: '2026-08-20',
        budget: 'not-a-number',
      }),
    }) as NextRequest

    const response = await createBuilderEvent(invalidBudgetRequest)
    const body = await json(response)

    expect(response.status).toBe(400)
    expect(body.error).toBe('Budget must be a non-negative number')
    expect(rpcMock).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })
})
