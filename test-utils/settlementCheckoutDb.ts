type Row = Record<string, any>

export const SETTLEMENT_RUN_ID = '11111111-1111-4111-8111-111111111111'
export const EVENT_ID = '22222222-2222-4222-8222-222222222222'
export const ORGANIZER_ID = '33333333-3333-4333-8333-333333333333'
export const VENUE_ID = '44444444-4444-4444-8444-444444444444'
export const PLAN_ID = '55555555-5555-4555-8555-555555555555'
export const APPROVAL_ID = '66666666-6666-4666-8666-666666666666'

let sequence = 0

export class SettlementMemoryDb {
  rows: Record<string, Row[]> = {
    venue_settlement_tokens: [],
    settlement_runs: [
      {
        id: SETTLEMENT_RUN_ID,
        event_id: EVENT_ID,
        organizer_id: ORGANIZER_ID,
        venue_id: VENUE_ID,
        archetype: 'happy_hour',
        venue_type: 'bar',
        neighborhood: 'mission',
        total_cents: 12000,
        status: 'awaiting_venue_ack',
        created_at: '2026-06-18T00:00:00Z',
        updated_at: '2026-06-18T00:00:00Z',
      },
    ],
    venues: [
      {
        id: VENUE_ID,
        venue_name: 'Moongate Lounge',
        contact_email: 'venue@example.com',
        owner_id: '77777777-7777-4777-8777-777777777777',
        city: 'San Francisco',
        state: 'CA',
      },
    ],
    events: [
      {
        id: EVENT_ID,
        event_name: 'Bay Area Happy Hour',
        event_date: '2026-07-01T19:00:00Z',
        builder_id: 'builder-profile',
      },
    ],
    users: [
      { id: ORGANIZER_ID, email: 'organizer@example.com' },
      { id: '77777777-7777-4777-8777-777777777777', email: 'owner@example.com' },
    ],
    plans: [
      {
        id: PLAN_ID,
        title: 'Bay Area Happy Hour',
        event_type: 'happy_hour',
        date_window_start: '2026-07-01',
        updated_at: '2026-06-18T00:00:00Z',
      },
    ],
    approvals: [
      {
        id: APPROVAL_ID,
        agent_action_id: 'action-1',
        settlement_run_id: SETTLEMENT_RUN_ID,
        approval_type: 'chi_settlement',
        status: 'authorized',
        authorized_amount_cents: 12000,
        created_at: '2026-06-18T00:00:00Z',
      },
    ],
    builder_stripe_accounts: [
      {
        user_id: ORGANIZER_ID,
        stripe_account_id: 'acct_builder',
        account_status: 'active',
        charges_enabled: true,
        payouts_enabled: true,
      },
    ],
    settlement_charges: [],
    agent_actions: [],
  }

  conflictOnSettlementChargeInsert = false

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new SettlementQuery(this, table)
  }
}

class SettlementQuery implements PromiseLike<{ data: any; error: null | { code?: string; message: string } }> {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'select' | 'insert' | 'update' = 'select'
  private payload: Row | null = null
  private rowLimit: number | null = null
  private sortColumn: string | null = null
  private sortAscending = true

  constructor(private db: SettlementMemoryDb, private table: string) {}

  select() {
    return this
  }

  insert(payload: Row) {
    this.operation = 'insert'
    this.payload = payload
    return this
  }

  update(payload: Row) {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  is(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  gt(column: string, value: unknown) {
    this.filters.push((row) => String(row[column]) > String(value))
    return this
  }

  in(column: string, values: readonly unknown[]) {
    this.filters.push((row) => values.includes(row[column]))
    return this
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.sortColumn = column
    this.sortAscending = options?.ascending ?? true
    return this
  }

  limit(count: number) {
    this.rowLimit = count
    return this
  }

  single() {
    return Promise.resolve(this.execute()).then((result) => ({
      data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
      error: result.error,
    }))
  }

  maybeSingle() {
    return this.single()
  }

  then<TResult1 = { data: any; error: null | { code?: string; message: string } }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: null | { code?: string; message: string } }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private execute() {
    if (this.operation === 'insert') {
      if (
        this.table === 'settlement_charges' &&
        (this.db.conflictOnSettlementChargeInsert ||
          this.db.rows.settlement_charges.some((row) =>
            row.settlement_run_id === this.payload?.settlement_run_id &&
            ['checkout_created', 'paid'].includes(row.status)
          ))
      ) {
        return {
          data: null,
          error: { code: '23505', message: 'duplicate key value violates unique constraint' },
        }
      }

      const row = {
        id: this.payload?.id ?? `${this.table}-${++sequence}`,
        created_at: this.payload?.created_at ?? '2026-06-18T00:00:00Z',
        updated_at: this.payload?.updated_at ?? '2026-06-18T00:00:00Z',
        ...this.payload,
      }
      this.db.rows[this.table].push(row)
      return { data: [row], error: null }
    }

    let rows = this.db.rows[this.table].filter((row) => this.filters.every((filter) => filter(row)))
    if (this.sortColumn) {
      rows = [...rows].sort((a, b) => {
        const left = String(a[this.sortColumn!] ?? '')
        const right = String(b[this.sortColumn!] ?? '')
        return this.sortAscending ? left.localeCompare(right) : right.localeCompare(left)
      })
    }
    if (this.rowLimit != null) rows = rows.slice(0, this.rowLimit)

    if (this.operation === 'update') {
      const updated = rows.map((row) => {
        Object.assign(row, this.payload)
        return row
      })
      return { data: updated, error: null }
    }

    return { data: rows, error: null }
  }
}
