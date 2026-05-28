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

import { POST } from '@/app/api/planner/plans/[planId]/event-report/route'
import { runDocumentExtractionAgent } from '@/lib/ai/agents/documentExtractionAgent'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

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

type Row = Record<string, unknown>

const PLAN_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const AGREEMENT_ID = '33333333-3333-4333-8333-333333333333'

class MemoryDb {
  rows: Record<string, Row[]> = {
    plans: [{ id: PLAN_ID, user_id: USER_ID }],
    event_kickback_agreements: [{ id: AGREEMENT_ID, plan_id: PLAN_ID, created_at: '2026-05-01T00:00:00.000Z' }],
  }

  storageBucket = {
    upload: jest.fn().mockResolvedValue({ data: { path: `${PLAN_ID}/report.csv` }, error: null }),
    createSignedUrl: jest.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.test/event-report.csv?token=signed' },
      error: null,
    }),
  }

  storage = {
    from: jest.fn(() => this.storageBucket),
  }

  from(table: string) {
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'select' | 'update' = 'select'
  private payload: Row | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select(_columns = '*') {
    return this
  }

  update(payload: Row) {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value)
    return this
  }

  in(field: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[field]))
    return this
  }

  order(_field: string, _options?: unknown) {
    return this
  }

  maybeSingle() {
    const rows = this.applyFilters()
    return Promise.resolve({ data: rows[0] ?? null, error: null })
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
      return { data: rows, error: null }
    }

    return { data: this.applyFilters(), error: null }
  }

  private applyFilters() {
    return (this.db.rows[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)))
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

describe('planner event report route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: USER_ID, user_metadata: { user_type: 'community_builder' } } },
          error: null,
        }),
      },
      from: (table: string) => db.from(table),
    })
  })

  let db: MemoryDb

  beforeEach(() => {
    db = new MemoryDb()
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
  })

  it('uploads proof, extracts attendance, and updates linked agreements', async () => {
    ;(runDocumentExtractionAgent as jest.Mock).mockResolvedValue({
      output: {
        extracted_value: 87,
        confidence: 'high',
        reasoning: 'Checked-in count was clearly labeled.',
      },
    })

    const formData = new FormData()
    formData.set('image', makeUploadFile('Metric,Count\nChecked in,87\n', 'eventbrite.csv', 'text/csv'))

    const response = await POST(makeRequest(formData), { params: { planId: PLAN_ID } })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      extracted_value: 87,
      confidence: 'high',
      agreement_id: AGREEMENT_ID,
      final_attendance: 87,
    })
    expect(db.storage.from).toHaveBeenCalledWith('event-reports')
    expect(runDocumentExtractionAgent).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'headcount',
      mimeType: 'text/csv',
      filename: 'eventbrite.csv',
    }))
    expect(db.rows.event_kickback_agreements[0]).toMatchObject({
      actual_attendance: 87,
      attendance_extracted_value: 87,
      attendance_extraction_confidence: 'high',
    })
  })

  it('accepts a manual attendance override without a file', async () => {
    const formData = new FormData()
    formData.set('actual_attendance_override', '92')

    const response = await POST(makeRequest(formData), { params: { planId: PLAN_ID } })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.final_attendance).toBe(92)
    expect(runDocumentExtractionAgent).not.toHaveBeenCalled()
    expect(db.storageBucket.upload).not.toHaveBeenCalled()
    expect(db.rows.event_kickback_agreements[0]).toMatchObject({
      actual_attendance: 92,
      attendance_extracted_value: null,
      attendance_extraction_confidence: 'high',
    })
  })

  it('rejects unsupported file types before upload or extraction', async () => {
    const formData = new FormData()
    formData.set('image', makeUploadFile('hello', 'notes.txt', 'text/plain'))

    const response = await POST(makeRequest(formData), { params: { planId: PLAN_ID } })
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error).toContain('Unsupported file type')
    expect(db.storageBucket.upload).not.toHaveBeenCalled()
    expect(runDocumentExtractionAgent).not.toHaveBeenCalled()
  })
})
