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

jest.mock('@/lib/finance/calculate-event-financials', () => ({
  recalculateEventFinancials: jest.fn().mockResolvedValue({}),
}))

jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
}))

import { POST } from '@/app/api/webhooks/posh/route'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { encryptSecret } from '@/lib/server/token-crypto'

type Row = Record<string, any>

const BUILDER_ID = '11111111-1111-4111-8111-111111111111'
const EVENT_ID = '22222222-2222-4222-8222-222222222222'
const INTEGRATION_ID = '33333333-3333-4333-8333-333333333333'
const SECRET = 'posh-secret-value'

describe('Posh webhook route', () => {
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const originalFallbackSecret = process.env.POSH_WEBHOOK_SECRET

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-tests'
    delete process.env.POSH_WEBHOOK_SECRET
  })

  afterEach(() => {
    restoreEnv('NEXT_PUBLIC_SUPABASE_URL', originalSupabaseUrl)
    restoreEnv('SUPABASE_SERVICE_ROLE_KEY', originalServiceRoleKey)
    restoreEnv('POSH_WEBHOOK_SECRET', originalFallbackSecret)
    jest.clearAllMocks()
  })

  it('creates sales data, platform fee commitment, and heartbeat for a valid linked Posh order', async () => {
    const db = new MemoryDb()
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)

    const response = await POST(makeRequest(makeOrderPayload(), SECRET))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.processed).toBe(true)
    expect(db.rows.event_sales_data).toHaveLength(1)
    expect(db.rows.event_sales_data[0]).toMatchObject({
      event_id: EVENT_ID,
      order_id: 'posh-event-1:order-1',
      platform: 'posh',
      total_amount_cents: 185000,
      gross_cents: 185000,
      fees_cents: 1250,
      tier_name: 'General Admission',
      source: 'posh_webhook',
    })
    expect(db.rows.event_cost_commitments).toHaveLength(1)
    expect(db.rows.event_cost_commitments[0]).toMatchObject({
      event_id: EVENT_ID,
      org_id: BUILDER_ID,
      category: 'platform_fee',
      amount_cents: 1250,
      state: 'paid',
      source: 'webhook',
      confidence: 'high',
      source_ref: 'posh:posh-event-1:order-1:platform_fee',
    })
    expect(db.rows.builder_ticketing_connections[0]).toMatchObject({
      status: 'connected',
      last_webhook_event_type: 'new_order',
    })
    expect(db.rows.builder_ticketing_connections[0].last_webhook_received_at).toEqual(expect.any(String))
  })

  it('rejects a wrong Posh secret without writes', async () => {
    const db = new MemoryDb()
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)

    const response = await POST(makeRequest(makeOrderPayload(), 'wrong-secret'))

    expect(response.status).toBe(401)
    expect(db.rows.event_sales_data).toHaveLength(0)
    expect(db.rows.event_cost_commitments).toHaveLength(0)
    expect(db.rows.unlinked_ticket_events).toHaveLength(0)
    expect(db.rows.builder_ticketing_connections[0].status).toBe('awaiting_test')
  })

  it('marks stale encrypted webhook secrets setup_required and ignores the delivery without a 500', async () => {
    const db = new MemoryDb()
    db.rows.builder_ticketing_connections[0].webhook_secret_encrypted = 'stale.ciphertext.value'
    db.rows.builder_profiles = [{
      id: BUILDER_ID,
      user_id: '99999999-9999-4999-8999-999999999999',
    }]
    db.rows.provider_connections = [{
      id: 'provider-connection-1',
      user_id: '99999999-9999-4999-8999-999999999999',
      builder_id: BUILDER_ID,
      provider: 'posh',
      status: 'connected',
      plan_id: null,
      encrypted_credentials: { webhook_secret: 'stale.ciphertext.value' },
      last_error: null,
    }]
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)

    const response = await POST(makeRequest(makeOrderPayload(), SECRET))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ received: true, ignored: true, reason: 'stale_secret' })
    expect(db.rows.event_sales_data).toHaveLength(0)
    expect(db.rows.event_cost_commitments).toHaveLength(0)
    expect(db.rows.builder_ticketing_connections[0]).toMatchObject({
      status: 'setup_required',
      last_error: 'stale_encryption',
    })
    expect(db.rows.provider_connections[0]).toMatchObject({
      status: 'setup_required',
      last_error: 'stale_encryption',
    })
    expect(db.rows.notifications).toHaveLength(1)
    expect(db.rows.notifications[0]).toMatchObject({
      user_id: '99999999-9999-4999-8999-999999999999',
      notification_type: 'ticketing_reconnect_required',
      group_key: `ticketing-stale-secret:posh:${db.rows.builder_ticketing_connections[0].id}`,
    })
  })

  it('does not re-attempt decrypt or duplicate notifications after stale secret was already marked', async () => {
    const db = new MemoryDb()
    db.rows.builder_ticketing_connections[0].status = 'setup_required'
    db.rows.builder_ticketing_connections[0].last_error = 'stale_encryption'
    db.rows.builder_ticketing_connections[0].webhook_secret_encrypted = 'stale.ciphertext.value'
    db.rows.builder_profiles = [{
      id: BUILDER_ID,
      user_id: '99999999-9999-4999-8999-999999999999',
    }]
    db.rows.notifications = [{
      id: 'notification-1',
      user_id: '99999999-9999-4999-8999-999999999999',
      group_key: `ticketing-stale-secret:posh:${db.rows.builder_ticketing_connections[0].id}`,
      notification_type: 'ticketing_reconnect_required',
      created_at: new Date().toISOString(),
    }]
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)

    const response = await POST(makeRequest(makeOrderPayload(), SECRET))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ received: true, ignored: true, reason: 'stale_secret' })
    expect(db.rows.event_sales_data).toHaveLength(0)
    expect(db.rows.notifications).toHaveLength(1)
  })

  it('quarantines a valid Posh order when the Posh event id is not linked', async () => {
    const db = new MemoryDb({ linkedEvent: false })
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)

    const response = await POST(makeRequest({
      ...makeOrderPayload(),
      event_id: 'unmapped-posh-event',
      order_id: 'order-2',
    }, SECRET))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.processed).toBe(false)
    expect(body.skippedReason).toMatch(/No linked/)
    expect(db.rows.event_sales_data).toHaveLength(0)
    expect(db.rows.event_cost_commitments).toHaveLength(0)
    expect(db.rows.unlinked_ticket_events).toHaveLength(1)
    expect(db.rows.unlinked_ticket_events[0]).toMatchObject({
      builder_id: BUILDER_ID,
      platform: 'posh',
      external_event_id: 'unmapped-posh-event',
      webhook_type: 'new_order',
    })
  })
})

function makeOrderPayload() {
  return {
    type: 'new_order',
    event_id: 'posh-event-1',
    order_id: 'order-1',
    ticket_buyer_name: 'Maya Host',
    ticket_buyer_email: 'maya@example.com',
    ticket_quantity: 1,
    ticket_type: 'General Admission',
    ticket_price: 1850,
    total_amount: 1850,
    fees: 12.5,
    currency: 'usd',
    purchase_timestamp: '2026-06-02T18:00:00.000Z',
  }
}

function makeRequest(payload: Row, secret: string) {
  return {
    text: jest.fn().mockResolvedValue(JSON.stringify(payload)),
    headers: new Headers({
      'posh-secret': secret,
      'x-forwarded-for': '127.0.0.1',
      'webhook-id': `${payload.event_id}:${payload.order_id}`,
    }),
    nextUrl: new URL(`http://localhost:3000/api/webhooks/posh?integration=${BUILDER_ID}`),
  } as never
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

class MemoryDb {
  rows: Record<string, Row[]>

  constructor(options: { linkedEvent?: boolean } = {}) {
    const linkedEvent = options.linkedEvent !== false
    this.rows = {
      builder_ticketing_connections: [{
        id: '44444444-4444-4444-8444-444444444444',
        builder_id: BUILDER_ID,
        platform: 'posh',
        status: 'awaiting_test',
        webhook_secret_encrypted: encryptSecret(SECRET),
        webhook_url: `https://www.3rdplace.io/api/webhooks/posh?integration=${BUILDER_ID}`,
        config: { has_webhook_secret: true },
        last_connected_at: null,
        last_webhook_received_at: null,
        last_webhook_event_type: null,
        updated_at: '2026-06-02T17:00:00.000Z',
      }],
      events: linkedEvent
        ? [{
            id: EVENT_ID,
            builder_id: BUILDER_ID,
            event_name: 'Founder Mixer',
            event_date: '2026-06-30',
            posh_event_id: 'posh-event-1',
          }]
        : [{
            id: EVENT_ID,
            builder_id: BUILDER_ID,
            event_name: 'Founder Mixer',
            event_date: '2026-06-30',
            posh_event_id: 'different-posh-event',
          }],
      external_event_integrations: linkedEvent
        ? [{
            id: INTEGRATION_ID,
            event_id: EVENT_ID,
            platform: 'posh',
            external_event_id: 'posh-event-1',
            config: {},
            created_at: '2026-06-02T17:00:00.000Z',
          }]
        : [],
      event_sales_data: [],
      imported_attendees: [],
      event_cost_commitments: [],
      unlinked_ticket_events: [],
      event_webhook_events: [],
      provider_connections: [],
      builder_profiles: [],
      notifications: [],
    }
  }

  rpc() {
    return Promise.resolve({ data: true, error: null })
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private pendingInsert: Row | Row[] | null = null
  private pendingUpsert: { value: Row | Row[]; options?: Record<string, unknown> } | null = null
  private pendingUpdate: Row | null = null
  private limitCount: number | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select() {
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value)
    return this
  }

  is(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value)
    return this
  }

  gte(field: string, value: unknown) {
    this.filters.push((row) => typeof row[field] === 'string' && typeof value === 'string' && row[field] >= value)
    return this
  }

  order() {
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  insert(value: Row | Row[]) {
    this.pendingInsert = value
    return this
  }

  update(value: Row) {
    this.pendingUpdate = value
    return this
  }

  upsert(value: Row | Row[], options?: Record<string, unknown>) {
    this.pendingUpsert = { value, options }
    return this
  }

  async maybeSingle() {
    return { data: this.execute().data[0] ?? null, error: null }
  }

  async single() {
    return { data: this.execute().data[0] ?? null, error: null }
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private execute() {
    if (this.pendingInsert) {
      const rows = asRows(this.pendingInsert).map((value) => this.materializeRow(value))
      this.db.rows[this.table].push(...rows)
      return { data: rows, error: null }
    }

    if (this.pendingUpsert) {
      const rows = asRows(this.pendingUpsert.value).map((value) =>
        this.upsertRow(value, this.pendingUpsert?.options)
      )
      return { data: rows, error: null }
    }

    if (this.pendingUpdate) {
      const rows = this.matchingRows()
      rows.forEach((row) => Object.assign(row, this.pendingUpdate))
      return { data: rows, error: null }
    }

    return { data: this.matchingRows(), error: null }
  }

  private matchingRows() {
    const rows = this.db.rows[this.table].filter((row) => this.filters.every((filter) => filter(row)))
    return this.limitCount === null ? rows : rows.slice(0, this.limitCount)
  }

  private upsertRow(value: Row, options?: Record<string, unknown>) {
    const conflict = typeof options?.onConflict === 'string'
      ? options.onConflict.split(',').map((field) => field.trim())
      : defaultConflictFields(this.table)
    const existing = this.db.rows[this.table].find((row) =>
      conflict.length > 0 && conflict.every((field) => row[field] === value[field])
    )
    if (existing) {
      Object.assign(existing, value)
      return existing
    }

    const row = this.materializeRow(value)
    this.db.rows[this.table].push(row)
    return row
  }

  private materializeRow(value: Row) {
    if (this.table === 'event_cost_commitments') {
      return {
        id: '55555555-5555-4555-8555-555555555555',
        currency: 'USD',
        evidence_url: null,
        evidence_type: 'none',
        metadata: {},
        committed_at: null,
        paid_at: null,
        created_at: '2026-06-02T18:00:00.000Z',
        updated_at: '2026-06-02T18:00:00.000Z',
        ...value,
      }
    }

    return {
      id: `${this.table}-${this.db.rows[this.table].length + 1}`,
      created_at: '2026-06-02T18:00:00.000Z',
      updated_at: '2026-06-02T18:00:00.000Z',
      ...value,
    }
  }
}

function asRows(value: Row | Row[]) {
  return Array.isArray(value) ? value : [value]
}

function defaultConflictFields(table: string) {
  if (table === 'builder_ticketing_connections') return ['builder_id', 'platform']
  if (table === 'event_webhook_events') return ['platform', 'webhook_event_id']
  if (table === 'event_sales_data') return ['event_id', 'platform', 'order_id']
  if (table === 'imported_attendees') return ['integration_id', 'external_attendee_id']
  if (table === 'unlinked_ticket_events') return ['platform', 'builder_id', 'webhook_event_id']
  return []
}
