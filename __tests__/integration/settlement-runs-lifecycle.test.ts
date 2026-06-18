import {
  recordAttendanceForRun,
  reviewSettlementRun,
  type SettlementRunRow,
} from '@/lib/finance/settlement-runs'

const baseRun: SettlementRunRow = {
  id: 'run-1',
  event_id: 'event-1',
  organizer_id: 'user-1',
  venue_id: 'venue-1',
  archetype: 'founder_dinner',
  venue_type: 'bar',
  neighborhood: 'mission',
  attendance_count: null,
  attendance_source: null,
  attendance_recorded_at: null,
  per_attendee_cents: 500,
  rate_source: 'network_default',
  rate_derived_from_event_count: 8,
  total_cents: null,
  status: 'awaiting_attendance',
  scheduled_settle_at: '2026-06-18T00:00:00.000Z',
  organizer_reviewed_at: null,
  organizer_reviewed_by: null,
  disputed_at: null,
  dispute_reason: null,
  created_at: '2026-06-17T00:00:00.000Z',
  updated_at: '2026-06-17T00:00:00.000Z',
}

describe('settlement run lifecycle service', () => {
  it('records organizer attendance, recomputes total cents, and inserts evidence', async () => {
    const db = createSettlementDb({ ...baseRun })

    const updated = await recordAttendanceForRun(db as never, baseRun, {
      attendanceCount: 42,
      source: 'organizer_manual',
      evidenceKind: 'organizer_attestation',
      uploadedBy: 'user-1',
      notes: 'Confirmed after check-in reconciliation.',
    })

    expect(updated.status).toBe('awaiting_organizer_review')
    expect(updated.attendance_count).toBe(42)
    expect(updated.total_cents).toBe(21000)
    expect(db.evidence).toHaveLength(1)
    expect(db.evidence[0]).toMatchObject({
      settlement_run_id: 'run-1',
      evidence_kind: 'organizer_attestation',
      attendee_count: 42,
    })
  })

  it('approves organizer-reviewed runs with an optimistic lock', async () => {
    const db = createSettlementDb({
      ...baseRun,
      status: 'awaiting_organizer_review',
      attendance_count: 42,
      total_cents: 21000,
    })

    const updated = await reviewSettlementRun(db as never, {
      runId: 'run-1',
      organizerId: 'user-1',
      action: 'approve',
    })

    expect(updated?.status).toBe('awaiting_venue_ack')
    expect(updated?.organizer_reviewed_by).toBe('user-1')
  })

  it('records disputes without moving money', async () => {
    const db = createSettlementDb({
      ...baseRun,
      status: 'awaiting_organizer_review',
      attendance_count: 30,
      total_cents: 15000,
    })

    const updated = await reviewSettlementRun(db as never, {
      runId: 'run-1',
      organizerId: 'user-1',
      action: 'dispute',
      disputeReason: 'Attendance source does not match door count.',
    })

    expect(updated?.status).toBe('disputed')
    expect(updated?.dispute_reason).toBe('Attendance source does not match door count.')
  })

  it('returns null when the optimistic lock loses a concurrent review race', async () => {
    const db = createSettlementDb({
      ...baseRun,
      status: 'awaiting_organizer_review',
      attendance_count: 42,
      total_cents: 21000,
    }, { staleUpdates: true })

    const updated = await reviewSettlementRun(db as never, {
      runId: 'run-1',
      organizerId: 'user-1',
      action: 'approve',
    })

    expect(updated).toBeNull()
  })
})

function createSettlementDb(initialRun: SettlementRunRow, options: { staleUpdates?: boolean } = {}) {
  const state = {
    run: { ...initialRun },
    evidence: [] as Array<Record<string, unknown>>,
  }

  return {
    get evidence() {
      return state.evidence
    },
    from(table: string) {
      const query: Record<string, unknown> = {
        table,
        mode: 'select',
        patch: null,
        filters: [] as Array<[string, unknown]>,
        select() {
          return this
        },
        update(patch: Record<string, unknown>) {
          this.mode = 'update'
          this.patch = patch
          return this
        },
        insert(values: Record<string, unknown>) {
          if (table !== 'settlement_attendance_evidence') {
            return Promise.resolve({ error: { message: `Unexpected insert into ${table}` } })
          }
          state.evidence.push(values)
          return Promise.resolve({ error: null })
        },
        eq(column: string, value: unknown) {
          this.filters.push([column, value])
          return this
        },
        maybeSingle() {
          if (table !== 'settlement_runs') return Promise.resolve({ data: null, error: null })
          if (this.mode === 'select') {
            const idFilter = this.filters.find(([column]) => column === 'id')
            if (idFilter && idFilter[1] !== state.run.id) return Promise.resolve({ data: null, error: null })
            return Promise.resolve({ data: { ...state.run }, error: null })
          }

          const statusFilter = this.filters.find(([column]) => column === 'status')
          if (options.staleUpdates || (statusFilter && statusFilter[1] !== state.run.status)) {
            return Promise.resolve({ data: null, error: null })
          }

          state.run = { ...state.run, ...(this.patch as Record<string, unknown>) } as SettlementRunRow
          return Promise.resolve({ data: { ...state.run }, error: null })
        },
      }
      return query
    },
  }
}
