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
    approvals: [
      {
        id: 'approval-1',
        agent_action_id: 'action-1',
        settlement_run_id: initialRun.id,
        approval_type: 'chi_settlement',
        status: 'authorized',
        authorized_amount_cents: initialRun.total_cents ?? 0,
        created_at: '2026-06-17T00:00:00.000Z',
      },
    ] as Array<Record<string, unknown>>,
    jobs: [] as Array<Record<string, unknown>>,
    actions: [] as Array<Record<string, unknown>>,
    audit: [] as Array<Record<string, unknown>>,
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
        rowLimit: null as number | null,
        select() {
          return this
        },
        update(patch: Record<string, unknown>) {
          this.mode = 'update'
          this.patch = patch
          return this
        },
        insert(values: Record<string, unknown>) {
          this.mode = 'insert'
          this.patch = values
          return this
        },
        eq(column: string, value: unknown) {
          this.filters.push([column, value])
          return this
        },
        in(column: string, values: readonly unknown[]) {
          this.filters.push([column, values])
          return this
        },
        order() {
          return this
        },
        limit(count: number) {
          this.rowLimit = count
          return this
        },
        single() {
          return this.maybeSingle()
        },
        maybeSingle() {
          const result = this.execute()
          const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data
          return Promise.resolve({ data, error: result.error })
        },
        then(onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => unknown) | null, onrejected?: ((reason: unknown) => unknown) | null) {
          return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
        },
        execute() {
          if (this.mode === 'insert') {
            const row = {
              id: `${table}-${Date.now()}-${Math.random()}`,
              created_at: '2026-06-17T00:00:00.000Z',
              updated_at: '2026-06-17T00:00:00.000Z',
              ...(this.patch as Record<string, unknown>),
            }

            if (table === 'settlement_attendance_evidence') {
              state.evidence.push(row)
              return { data: [row], error: null }
            }
            if (table === 'app_jobs') {
              state.jobs.push({ status: 'pending', attempts: 0, ...row })
              return { data: [{ status: 'pending', attempts: 0, ...row }], error: null }
            }
            if (table === 'agent_actions') {
              state.actions.push(row)
              return { data: [row], error: null }
            }
            if (table === 'approvals') {
              state.approvals.push(row)
              return { data: [row], error: null }
            }
            if (table === 'settlement_audit_log') {
              state.audit.push(row)
              return { data: [row], error: null }
            }

            return { data: null, error: { message: `Unexpected insert into ${table}` } }
          }

          if (this.mode === 'select') {
            if (table === 'approvals') {
              let rows = state.approvals.filter((row) => this.filters.every(([column, value]) => {
                if (Array.isArray(value)) return value.includes(row[column])
                return row[column] === value
              }))
              if (this.rowLimit != null) rows = rows.slice(0, this.rowLimit)
              return { data: rows, error: null }
            }
            if (table === 'app_jobs') {
              let rows = state.jobs.filter((row) => this.filters.every(([column, value]) => {
                if (Array.isArray(value)) return value.includes(row[column])
                return row[column] === value
              }))
              if (this.rowLimit != null) rows = rows.slice(0, this.rowLimit)
              return { data: rows, error: null }
            }
            if (table !== 'settlement_runs') return { data: null, error: null }
            const idFilter = this.filters.find(([column]) => column === 'id')
            if (idFilter && idFilter[1] !== state.run.id) return { data: null, error: null }
            return { data: [{ ...state.run }], error: null }
          }

          const statusFilter = this.filters.find(([column]) => column === 'status')
          if (options.staleUpdates || (statusFilter && statusFilter[1] !== state.run.status)) {
            return { data: [], error: null }
          }

          if (table === 'settlement_runs') {
            state.run = { ...state.run, ...(this.patch as Record<string, unknown>) } as SettlementRunRow
            return { data: [{ ...state.run }], error: null }
          }

          if (table === 'agent_actions') {
            return { data: [], error: null }
          }

          return { data: null, error: { message: `Unexpected update to ${table}` } }
        },
      }
      return query
    },
  }
}
