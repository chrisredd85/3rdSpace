import type { NextRequest } from 'next/server'
import { GET } from '@/app/api/admin/reconcile/captured-deposits/route'
import { getWorkerOrAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import * as Sentry from '@sentry/nextjs'

jest.mock('@/lib/server/admin-auth', () => ({
  getWorkerOrAdminContext: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@sentry/nextjs', () => ({
  captureMessage: jest.fn(),
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

const mockGetWorkerOrAdminContext = getWorkerOrAdminContext as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock
const mockCaptureMessage = Sentry.captureMessage as jest.Mock

type Row = Record<string, unknown>

class MemoryDb {
  rows: Record<string, Row[]> = {
    payment_intents: [],
    payouts: [],
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }

  nextId(table: string) {
    return `${table}-${this.rows[table].length + 1}`
  }
}

class MemoryQuery {
  private filters: Array<[string, unknown]> = []
  private nullFilters: string[] = []
  private operation: 'select' | 'insert' = 'select'
  private payload: Row | null = null
  private limitCount: number | null = null

  constructor(
    private db: MemoryDb,
    private table: string
  ) {}

  select() {
    return this
  }

  insert(payload: Row) {
    this.operation = 'insert'
    this.payload = payload
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push([field, value])
    return this
  }

  is(field: string, value: unknown) {
    if (value === null) this.nullFilters.push(field)
    return this
  }

  order() {
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  async maybeSingle() {
    const result = await this.execute()
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: null }
  }

  then<TResult1 = { data: Row | Row[] | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row | Row[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected)
  }

  private async execute() {
    if (this.operation === 'insert' && this.payload) {
      const row = {
        id: this.payload.id ?? this.db.nextId(this.table),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...this.payload,
      }
      this.db.rows[this.table].push(row)
      return { data: row, error: null }
    }

    let selected = this.db.rows[this.table].filter((row) => this.matches(row))
    if (this.limitCount != null) selected = selected.slice(0, this.limitCount)
    return { data: selected, error: null }
  }

  private matches(row: Row) {
    return (
      this.filters.every(([field, value]) => row[field] === value) &&
      this.nullFilters.every((field) => {
        if (this.table === 'payment_intents' && field === 'payouts.id') {
          return !this.db.rows.payouts.some((payout) => payout.payment_intent_id === row.id)
        }
        return row[field] == null
      })
    )
  }
}

function request() {
  return new Request('http://localhost/api/admin/reconcile/captured-deposits', {
    method: 'GET',
  }) as NextRequest
}

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe('capture reconciler route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects unauthorized callers before loading service-role Supabase', async () => {
    mockGetWorkerOrAdminContext.mockResolvedValue({
      authorized: false,
      status: 401,
      error: 'Unauthorized',
    })

    const response = await GET(request())
    const body = await readJson(response)

    expect(response.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
  })

  it('inserts a missing payout for captured planner deposits and logs Sentry evidence', async () => {
    mockGetWorkerOrAdminContext.mockResolvedValue({
      authorized: true,
      user: { id: 'admin-1', email: 'admin@example.com' },
    })
    const db = new MemoryDb()
    db.rows.payment_intents.push({
      id: 'payment-intent-1',
      plan_id: 'plan-1',
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 25_000,
      platform_fee_cents: 1_000,
      currency: 'usd',
      status: 'captured',
      captured_at: new Date().toISOString(),
    }, {
      id: 'payment-intent-with-payout',
      plan_id: 'plan-2',
      partner_kind: 'venue',
      partner_id: 'venue-2',
      amount_cents: 50_000,
      platform_fee_cents: 0,
      currency: 'usd',
      status: 'captured',
      captured_at: new Date().toISOString(),
    })
    db.rows.payouts.push({
      id: 'existing-payout-1',
      payment_intent_id: 'payment-intent-with-payout',
      partner_kind: 'venue',
      partner_id: 'venue-2',
      amount_cents: 50_000,
      currency: 'usd',
      status: 'pending',
    })
    mockCreateServiceRoleClient.mockReturnValue(db)

    const response = await GET(request())
    const body = await readJson(response)

    expect(response.status).toBe(200)
    expect(body).toEqual({ reconciled: 1, errors: [] })
    expect(db.rows.payouts).toEqual([
      expect.objectContaining({
        payment_intent_id: 'payment-intent-with-payout',
      }),
      expect.objectContaining({
        payment_intent_id: 'payment-intent-1',
        partner_kind: 'venue',
        partner_id: 'venue-1',
        amount_cents: 24_000,
        currency: 'usd',
        status: 'pending',
      }),
    ])
    expect(mockCaptureMessage).toHaveBeenCalledWith('capture_reconciled', expect.objectContaining({
      tags: expect.objectContaining({
        action: 'capture_reconciled',
        plan_id: 'plan-1',
        payment_intent_id: 'payment-intent-1',
      }),
      extra: expect.objectContaining({
        amount_cents: 25_000,
        platform_fee_cents: 1_000,
        payout_amount_cents: 24_000,
      }),
    }))
  })
})
