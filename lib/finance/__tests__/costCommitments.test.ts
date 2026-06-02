import fs from 'fs'
import path from 'path'
import {
  computeCommittedTotals,
  inferCostConfidence,
  upsertCommitment,
  type Commitment,
} from '@/lib/finance/costCommitments'

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260602000002_add_event_cost_commitments.sql'),
  'utf8'
)

const baseCommitment: Commitment = {
  id: '11111111-1111-4111-8111-111111111111',
  event_id: '22222222-2222-4222-8222-222222222222',
  plan_id: null,
  org_id: '33333333-3333-4333-8333-333333333333',
  category: 'vendor',
  party_id: '44444444-4444-4444-8444-444444444444',
  party_name: 'DJ Analog',
  description: null,
  amount_cents: 185000,
  currency: 'USD',
  state: 'accepted',
  confidence: 'high',
  evidence_url: null,
  evidence_type: 'none',
  source: 'manual',
  metadata: {},
  committed_at: null,
  paid_at: null,
  created_at: '2026-06-02T00:00:00.000Z',
  updated_at: '2026-06-02T00:00:00.000Z',
}

describe('cost commitments', () => {
  it('computes estimated, committed, and paid totals by state and category', () => {
    const totals = computeCommittedTotals([
      { category: 'venue', amount_cents: 100000, state: 'quoted', confidence: 'medium' },
      { category: 'venue', amount_cents: 200000, state: 'accepted', confidence: 'high' },
      { category: 'vendor', amount_cents: 30000, state: 'estimated', confidence: 'low' },
      { category: 'staff', amount_cents: 40000, state: 'invoiced', confidence: 'high' },
      { category: 'marketing', amount_cents: 50000, state: 'paid', confidence: 'high' },
      { category: 'tax', amount_cents: 99999, state: 'cancelled', confidence: 'low' },
    ])

    expect(totals.byCategory.venue).toEqual({
      estimated_cents: 100000,
      committed_cents: 200000,
      paid_cents: 0,
    })
    expect(totals.byCategory.vendor.estimated_cents).toBe(30000)
    expect(totals.byCategory.staff.committed_cents).toBe(40000)
    expect(totals.byCategory.marketing).toEqual({
      estimated_cents: 0,
      committed_cents: 50000,
      paid_cents: 50000,
    })
    expect(totals.overall).toEqual({
      estimated_cents: 130000,
      committed_cents: 290000,
      paid_cents: 50000,
    })
  })

  it('infers cost confidence from active commitment states', () => {
    expect(inferCostConfidence([])).toBe('estimated')
    expect(inferCostConfidence([
      { category: 'venue', amount_cents: 100000, state: 'quoted', confidence: 'medium' },
    ])).toBe('estimated')
    expect(inferCostConfidence([
      { category: 'venue', amount_cents: 100000, state: 'accepted', confidence: 'high' },
      { category: 'vendor', amount_cents: 50000, state: 'paid', confidence: 'high' },
    ])).toBe('confirmed')
    expect(inferCostConfidence([
      { category: 'venue', amount_cents: 100000, state: 'accepted', confidence: 'high' },
      { category: 'vendor', amount_cents: 50000, state: 'estimated', confidence: 'low' },
    ])).toBe('mixed')
  })

  it('updates the existing party/category row instead of inserting duplicates', async () => {
    const db = new MemoryCostCommitmentDb([baseCommitment])

    const result = await upsertCommitment(db, {
      event_id: baseCommitment.event_id,
      org_id: baseCommitment.org_id,
      category: 'vendor',
      party_id: baseCommitment.party_id,
      party_name: 'DJ Analog',
      amount_cents: 195000,
      state: 'accepted',
      confidence: 'high',
      source: 'outreach_reply',
    })

    expect(result.id).toBe(baseCommitment.id)
    expect(result.amount_cents).toBe(195000)
    expect(result.source).toBe('outreach_reply')
    expect(db.rows).toHaveLength(1)
  })

  it('has org-scoped RLS policies so cross-org reads are denied by default', () => {
    expect(migration).toContain('ALTER TABLE public.event_cost_commitments ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('public.can_manage_event_cost_commitment_org(org_id)')
    expect(migration).toContain('FOR SELECT')
    expect(migration).toContain('FOR INSERT')
    expect(migration).toContain('FOR UPDATE')
    expect(migration).not.toContain('USING (true)')
  })
})

class MemoryCostCommitmentDb {
  rows: Commitment[]

  constructor(rows: Commitment[]) {
    this.rows = rows.map((row) => ({ ...row }))
  }

  from(table: string) {
    if (table !== 'event_cost_commitments') throw new Error(`Unexpected table ${table}`)
    return new MemoryQuery(this.rows)
  }
}

class MemoryQuery {
  private filters: Array<{ column: string; value: unknown }> = []
  private pendingInsert: Partial<Commitment> | null = null
  private pendingUpdate: Partial<Commitment> | null = null

  constructor(private rows: Commitment[]) {}

  select() {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value })
    return this
  }

  limit() {
    return this
  }

  insert(value: Partial<Commitment>) {
    this.pendingInsert = value
    return this
  }

  update(value: Partial<Commitment>) {
    this.pendingUpdate = value
    return this
  }

  async maybeSingle() {
    return { data: this.matchingRows()[0] ?? null, error: null }
  }

  async single() {
    if (this.pendingInsert) {
      const row = {
        ...baseCommitment,
        ...this.pendingInsert,
        id: this.pendingInsert.id ?? '55555555-5555-4555-8555-555555555555',
        created_at: this.pendingInsert.created_at ?? new Date().toISOString(),
        updated_at: this.pendingInsert.updated_at ?? new Date().toISOString(),
        plan_id: this.pendingInsert.plan_id ?? null,
        party_id: this.pendingInsert.party_id ?? null,
        party_name: this.pendingInsert.party_name ?? null,
        description: this.pendingInsert.description ?? null,
        evidence_url: this.pendingInsert.evidence_url ?? null,
        committed_at: this.pendingInsert.committed_at ?? null,
        paid_at: this.pendingInsert.paid_at ?? null,
      } as Commitment
      this.rows.push(row)
      return { data: row, error: null }
    }

    if (this.pendingUpdate) {
      const row = this.matchingRows()[0]
      if (!row) return { data: null, error: { message: 'Not found' } }
      Object.assign(row, this.pendingUpdate)
      return { data: row, error: null }
    }

    return { data: this.matchingRows()[0] ?? null, error: null }
  }

  private matchingRows() {
    return this.rows.filter((row) =>
      this.filters.every((filter) => (row as unknown as Record<string, unknown>)[filter.column] === filter.value)
    )
  }
}
