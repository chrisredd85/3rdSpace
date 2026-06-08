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

import { POST } from '@/app/api/venue/kickbacks/[id]/spend-report/route'
import { runDocumentExtractionAgent } from '@/lib/ai/agents/documentExtractionAgent'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedVenueOwner } from '@/lib/stripe/connect'

jest.mock('@/lib/ai/agents/documentExtractionAgent', () => ({
  DOCUMENT_EXTRACTION_ALLOWED_MIME_TYPES: [
    'image/png',
    'image/jpeg',
    'image/heic',
    'application/pdf',
    'text/csv',
    'text/tab-separated-values',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ],
  runDocumentExtractionAgent: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/stripe/connect', () => ({
  getAuthenticatedVenueOwner: jest.fn(),
}))

type Row = Record<string, unknown>

const AGREEMENT_ID = '11111111-1111-4111-8111-111111111111'
const EVENT_ID = '22222222-2222-4222-8222-222222222222'
const VENUE_ID = '33333333-3333-4333-8333-333333333333'
const VENUE_OWNER_ID = '44444444-4444-4444-8444-444444444444'
const BUILDER_ID = '55555555-5555-4555-8555-555555555555'

class MemoryDb {
  rows: Record<string, Row[]> = {
    event_kickback_agreements: [
      {
        id: AGREEMENT_ID,
        event_id: EVENT_ID,
        venue_id: VENUE_ID,
        venue_owner_id: VENUE_OWNER_ID,
        builder_id: BUILDER_ID,
        actual_attendance: 90,
        per_head_amount: 3,
        lift_share_percentage: null,
        baseline_sales: null,
        actual_sales: null,
        bar_revenue_share_percent: 12,
        ticket_revenue_share_percent: null,
      },
    ],
    kickback_payments: [],
    venues: [{ id: VENUE_ID, owner_id: VENUE_OWNER_ID }],
    event_sales_data: [],
  }

  storageBucket = {
    upload: jest.fn().mockResolvedValue({ data: { path: `${AGREEMENT_ID}/square.csv` }, error: null }),
    createSignedUrl: jest.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.test/spend-report.csv?token=signed' },
      error: null,
    }),
  }

  storage = {
    from: jest.fn(() => this.storageBucket),
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'select' | 'update' | 'upsert' = 'select'
  private payload: Row | null = null
  private conflictKey: string | null = null
  private selectedColumns: string | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select(columns = '*') {
    this.selectedColumns = columns
    return this
  }

  update(payload: Row) {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  upsert(payload: Row, options?: { onConflict?: string }) {
    this.operation = 'upsert'
    this.payload = payload
    this.conflictKey = options?.onConflict ?? null
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
    if (this.operation === 'update') {
      const rows = this.applyFilters()
      rows.forEach((row) => Object.assign(row, this.payload))
      return { data: this.projectRows(rows), error: null }
    }

    if (this.operation === 'upsert') {
      const tableRows = this.db.rows[this.table]
      const conflictKey = this.conflictKey ?? 'id'
      const conflictValue = this.payload?.[conflictKey]
      let row = tableRows.find((candidate) => candidate[conflictKey] === conflictValue)
      if (row) {
        Object.assign(row, this.payload)
      } else {
        row = {
          id: this.payload?.id ?? `${this.table}-${tableRows.length + 1}`,
          ...this.payload,
        }
        tableRows.push(row)
      }
      return { data: this.projectRows([row]), error: null }
    }

    return { data: this.projectRows(this.applyFilters()), error: null }
  }

  private applyFilters() {
    return (this.db.rows[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)))
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

function makeRequest(formData: FormData) {
  return {
    formData: jest.fn().mockResolvedValue(formData),
  } as never
}

function makeUploadFile(contents: string, name: string, type: string) {
  const file = new File([contents], name, { type })
  Object.defineProperty(file, 'arrayBuffer', {
    value: jest.fn().mockResolvedValue(Buffer.from(contents).buffer),
  })
  return file
}

function makeOversizedUploadFile(name: string, type: string) {
  const file = makeUploadFile('too-large', name, type)
  Object.defineProperty(file, 'size', {
    value: 10 * 1024 * 1024 + 1,
  })
  return file
}

describe('venue spend report route', () => {
  let db: MemoryDb

  beforeEach(() => {
    jest.clearAllMocks()
    db = new MemoryDb()
    ;(createClient as jest.Mock).mockReturnValue({ auth: { getUser: jest.fn() } })
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
    ;(getAuthenticatedVenueOwner as jest.Mock).mockResolvedValue({
      user: { id: VENUE_OWNER_ID },
      owner: { id: VENUE_OWNER_ID },
      error: null,
      status: 200,
    })
  })

  it('extracts venue revenue and creates an invoice-settlement payment for bar share', async () => {
    ;(runDocumentExtractionAgent as jest.Mock).mockResolvedValue({
      output: {
        extracted_value: 428000,
        confidence: 'high',
        reasoning: 'Net sales was clearly labeled as $4,280.00.',
      },
    })

    const formData = new FormData()
    formData.set('image', makeUploadFile('Net sales,$4,280.00', 'square.csv', 'text/csv'))

    const response = await POST(makeRequest(formData), { params: { id: AGREEMENT_ID } })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      extracted_value: 428000,
      confidence: 'high',
      calculated_owed_cents: 51360,
      payment_id: 'kickback_payments-1',
      extraction_status: 'extracted',
      review_status: 'ready_for_invoice_review',
      uploaded_proof: {
        filename: 'square.csv',
        mime_type: 'text/csv',
        path: expect.stringContaining('square.csv'),
      },
    })
    expect(db.storage.from).toHaveBeenCalledWith('venue-spend-reports')
    expect(runDocumentExtractionAgent).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'venue_revenue',
      mimeType: 'text/csv',
      filename: 'square.csv',
    }))
    expect(db.rows.event_kickback_agreements[0]).toMatchObject({
      reported_revenue_cents: 428000,
      revenue_extracted_value_cents: 428000,
      revenue_extraction_confidence: 'high',
    })
    expect(db.rows.kickback_payments[0]).toMatchObject({
      agreement_id: AGREEMENT_ID,
      event_id: EVENT_ID,
      payer_id: VENUE_OWNER_ID,
      recipient_id: BUILDER_ID,
      amount_cents: 51360,
      status: 'pending_venue_approval',
      settlement_method: 'invoice',
    })
    expect(db.rows.kickback_payments[0]).not.toHaveProperty('amount')
  })

  it('supports manual revenue and per-head settlement without a file', async () => {
    db.rows.event_kickback_agreements[0].bar_revenue_share_percent = null
    const formData = new FormData()
    formData.set('reported_revenue_cents_override', '0')

    const response = await POST(makeRequest(formData), { params: { id: AGREEMENT_ID } })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.calculated_owed_cents).toBe(27000)
    expect(runDocumentExtractionAgent).not.toHaveBeenCalled()
    expect(db.storageBucket.upload).not.toHaveBeenCalled()
    expect(db.rows.kickback_payments[0]).toMatchObject({
      amount_cents: 27000,
      settlement_method: 'invoice',
    })
  })

  it('blocks venue owners who do not own the agreement venue', async () => {
    ;(getAuthenticatedVenueOwner as jest.Mock).mockResolvedValue({
      user: { id: 'not-the-owner' },
      owner: { id: 'not-the-owner' },
      error: null,
      status: 200,
    })

    const formData = new FormData()
    formData.set('reported_revenue_cents_override', '10000')

    const response = await POST(makeRequest(formData), { params: { id: AGREEMENT_ID } })
    const json = await response.json()

    expect(response.status).toBe(403)
    expect(json.error).toContain('Not authorized')
    expect(db.rows.kickback_payments).toHaveLength(0)
  })

  it('rejects venue spend report files over the 10 MB extraction limit', async () => {
    const formData = new FormData()
    formData.set('image', makeOversizedUploadFile('toast-report.pdf', 'application/pdf'))

    const response = await POST(makeRequest(formData), { params: { id: AGREEMENT_ID } })
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error).toContain('under 10 MB')
    expect(db.storageBucket.upload).not.toHaveBeenCalled()
    expect(runDocumentExtractionAgent).not.toHaveBeenCalled()
  })

  it('rejects unsupported venue spend report file types clearly', async () => {
    const formData = new FormData()
    formData.set('image', makeUploadFile('plain notes', 'notes.txt', 'text/plain'))

    const response = await POST(makeRequest(formData), { params: { id: AGREEMENT_ID } })
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error).toContain('Unsupported file type')
    expect(db.storageBucket.upload).not.toHaveBeenCalled()
    expect(runDocumentExtractionAgent).not.toHaveBeenCalled()
  })
})
