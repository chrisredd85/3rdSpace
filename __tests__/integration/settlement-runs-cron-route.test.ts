/**
 * @jest-environment node
 */

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
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/server/job-queue', () => ({
  enqueueJob: jest.fn(),
}))

import { GET } from '@/app/api/cron/settlement-runs/create/route'
import { enqueueJob } from '@/lib/server/job-queue'
import { createServiceRoleClient } from '@/lib/supabase/server'

type Row = Record<string, unknown>

class CronDb {
  rows: Record<string, Row[]> = {
    events: [
      {
        id: 'event-enqueue-1',
        event_date: '2026-01-01',
        venue_id: 'venue-1',
        venues: { venue_type: 'bar' },
      },
      {
        id: 'event-enqueue-fails',
        event_date: '2026-01-02',
        venue_id: 'venue-2',
        venues: { venue_type: 'lounge' },
      },
      {
        id: 'event-ineligible',
        event_date: '2026-01-03',
        venue_id: 'venue-3',
        venues: { venue_type: 'restaurant' },
      },
      {
        id: 'event-existing-run',
        event_date: '2026-01-04',
        venue_id: 'venue-4',
        venues: { venue_type: 'cafe' },
      },
    ],
    settlement_runs: [
      { id: 'run-existing', event_id: 'event-existing-run' },
    ],
  }

  from(table: string) {
    return new CronQuery(this, table)
  }
}

class CronQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private rowLimit: number | null = null
  private orderField: string | null = null
  private ascending = true

  constructor(private db: CronDb, private table: string) {}

  select() {
    return this
  }

  not(column: string, operator: string, value: unknown) {
    if (operator === 'is' && value === null) {
      this.filters.push((row) => row[column] !== null && row[column] !== undefined)
    }
    return this
  }

  lte(column: string, value: unknown) {
    this.filters.push((row) => String(row[column] ?? '') <= String(value))
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderField = column
    this.ascending = options?.ascending ?? true
    return this
  }

  limit(count: number) {
    this.rowLimit = count
    return this
  }

  maybeSingle() {
    return Promise.resolve(this.execute()).then(({ data, error }) => ({
      data: Array.isArray(data) ? data[0] ?? null : data,
      error,
    }))
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private execute() {
    let rows = (this.db.rows[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)))
    if (this.orderField) {
      rows = [...rows].sort((first, second) => {
        const left = String(first[this.orderField!] ?? '')
        const right = String(second[this.orderField!] ?? '')
        return this.ascending ? left.localeCompare(right) : right.localeCompare(left)
      })
    }
    if (this.rowLimit != null) rows = rows.slice(0, this.rowLimit)
    return { data: rows, error: null }
  }
}

function makeRequest(secret: string | null) {
  return {
    headers: new Headers(secret ? { authorization: `Bearer ${secret}` } : {}),
  } as never
}

describe('GET /api/cron/settlement-runs/create', () => {
  const originalSecret = process.env.CRON_SECRET
  let db: CronDb

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
    db = new CronDb()
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
    ;(enqueueJob as jest.Mock).mockImplementation((_admin, params) => {
      if (params.payload.event_id === 'event-enqueue-fails') {
        throw new Error('queue temporarily unavailable')
      }
      return Promise.resolve({ id: `job-${params.payload.event_id}` })
    })
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret
  })

  it('rejects requests without the cron bearer secret', async () => {
    const response = await GET(makeRequest(null))

    expect(response.status).toBe(401)
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('isolates per-event enqueue failures and continues processing candidates', async () => {
    const response = await GET(makeRequest('cron-secret'))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      ok: true,
      scanned: 4,
      enqueued: 1,
      skipped_not_eligible: 1,
      skipped_existing_run: 1,
      failed: 1,
      job_ids: ['job-event-enqueue-1'],
      errors: [{ event_id: 'event-enqueue-fails', error: 'queue temporarily unavailable' }],
    })
    expect(enqueueJob).toHaveBeenCalledWith(db, expect.objectContaining({
      jobType: 'settlement.run.create',
      payload: { event_id: 'event-enqueue-1' },
      uniqueKey: 'settlement-run-create:event-enqueue-1',
    }))
    expect(enqueueJob).toHaveBeenCalledWith(db, expect.objectContaining({
      jobType: 'settlement.run.create',
      payload: { event_id: 'event-enqueue-fails' },
      uniqueKey: 'settlement-run-create:event-enqueue-fails',
    }))
    expect(enqueueJob).toHaveBeenCalledTimes(2)
  })
})
