jest.mock('server-only', () => ({}))

import {
  sendBuilderPaidEmail,
  sendVenueInvoiceEmail,
  sendVenueOverdueWarningEmail,
} from '@/lib/email'
import { createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))

type Row = Record<string, unknown>

const PAYMENT_ID = 'payment-1'
const AGREEMENT_ID = 'agreement-1'
const PLAN_ID = 'plan-1'
const VENUE_ID = 'venue-1'
const VENUE_OWNER_ID = 'venue-owner-1'
const BUILDER_ID = 'builder-user-1'

class MemoryDb {
  rows: Record<string, Row[]> = {
    kickback_payments: [
      {
        id: PAYMENT_ID,
        agreement_id: AGREEMENT_ID,
        event_id: null,
        payer_id: VENUE_OWNER_ID,
        recipient_id: BUILDER_ID,
        amount: null,
        amount_cents: 51360,
        processing_fee_cents: 411,
        builder_payout_cents: 51360,
        invoice_hosted_url: 'https://invoice.test/in_1',
        due_date: '2026-05-20T00:00:00.000Z',
        status: 'invoice_sent',
      },
    ],
    event_kickback_agreements: [
      {
        id: AGREEMENT_ID,
        event_id: null,
        plan_id: PLAN_ID,
        venue_id: VENUE_ID,
        reported_revenue_cents: 428000,
        bar_revenue_share_percent: 12,
        ticket_revenue_share_percent: null,
        lift_share_percentage: null,
        per_head_amount: null,
      },
    ],
    venues: [
      {
        id: VENUE_ID,
        venue_name: 'The Roof',
        contact_email: 'venue@example.com',
        owner_id: VENUE_OWNER_ID,
      },
    ],
    users: [
      { id: VENUE_OWNER_ID, email: 'owner@example.com', company_name: 'The Roof Ops' },
      { id: BUILDER_ID, email: 'builder@example.com', company_name: 'Builder Co' },
    ],
    builder_profiles: [{ user_id: BUILDER_ID, name: 'Maya Builder' }],
    plans: [{ id: PLAN_ID, title: 'Tech Mixer', date_window_start: '2026-05-12' }],
    events: [],
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private selectedColumns: string | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select(columns = '*') {
    this.selectedColumns = columns
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value)
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
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private execute() {
    const rows = (this.db.rows[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)))
    return { data: this.projectRows(rows), error: null }
  }

  private projectRows(rows: Row[]) {
    if (!this.selectedColumns || this.selectedColumns === '*') return rows
    const columns = this.selectedColumns.split(',').map((column) => column.trim()).filter(Boolean)
    return rows.map((row) => {
      const projected: Row = {}
      columns.forEach((column) => {
        projected[column] = row[column]
      })
      return projected
    })
  }
}

describe('kickback notification email wrappers', () => {
  const originalApiKey = process.env.RESEND_API_KEY
  const originalFrom = process.env.NOTIFICATIONS_FROM_EMAIL
  let db: MemoryDb

  beforeEach(() => {
    jest.clearAllMocks()
    db = new MemoryDb()
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
    process.env.RESEND_API_KEY = 'resend-test'
    process.env.NOTIFICATIONS_FROM_EMAIL = '3rdPlace <notify@example.com>'
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'email-1' }), { status: 200 })) as typeof fetch
  })

  afterAll(() => {
    process.env.RESEND_API_KEY = originalApiKey
    process.env.NOTIFICATIONS_FROM_EMAIL = originalFrom
  })

  it('sends the venue invoice email with invoice link and total due context', async () => {
    const result = await sendVenueInvoiceEmail({ paymentId: PAYMENT_ID })
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)

    expect(result.sent).toBe(true)
    expect(body.to).toEqual(['venue@example.com'])
    expect(body.subject).toBe('Payment due - Community Host Incentive for Tech Mixer')
    expect(body.html).toContain('With ACH processing fee: $517.71')
    expect(body.html).toContain('https://invoice.test/in_1')
  })

  it('sends builder paid email using builder payout cents', async () => {
    const result = await sendBuilderPaidEmail({ paymentId: PAYMENT_ID })
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)

    expect(result.sent).toBe(true)
    expect(body.to).toEqual(['builder@example.com'])
    expect(body.subject).toBe('You received $513.60 from The Roof')
    expect(body.html).toContain('12% bar consumption CHI agreement')
  })

  it('sends venue overdue warning at the booking pause threshold', async () => {
    const result = await sendVenueOverdueWarningEmail({ venueId: VENUE_ID, overdueCount: 3 })
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)

    expect(result.sent).toBe(true)
    expect(body.to).toEqual(['venue@example.com'])
    expect(body.subject).toBe('Bookings paused - submit overdue revenue reports to re-enable')
    expect(body.html).toContain('New bookings are paused')
  })
})
