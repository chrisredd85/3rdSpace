jest.mock('server-only', () => ({}))

import { recordPlannerPaymentAuthenticationState } from '@/lib/planner/paymentAuthenticationState'
import type { AgentAction } from '@/lib/types'

type Row = Record<string, any>

class MemoryDb {
  actions: Row[] = []
  audits: Row[] = []

  from(table: string) {
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery {
  private operation: 'select' | 'update' | 'insert' = 'select'
  private payload: Row | null = null
  private filters: Array<(row: Row) => boolean> = []

  constructor(private db: MemoryDb, private table: string) {}

  select() {
    return this
  }

  update(payload: Row) {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  insert(payload: Row) {
    this.operation = 'insert'
    this.payload = payload
    return this.execute()
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  async maybeSingle() {
    const result = await this.execute()
    return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error }
  }

  private async execute() {
    const rows = this.table === 'agent_actions' ? this.db.actions : this.db.audits
    if (this.operation === 'insert' && this.payload) {
      rows.push({ id: `${this.table}-${rows.length + 1}`, ...this.payload })
      return { data: this.payload, error: null }
    }
    const matches = rows.filter((row) => this.filters.every((filter) => filter(row)))
    if (this.operation === 'update' && this.payload) {
      matches.forEach((row) => Object.assign(row, this.payload))
    }
    return { data: matches, error: null }
  }
}

function paymentAction(): AgentAction {
  return {
    id: '550e8400-e29b-41d4-a716-446655440401',
    plan_id: '550e8400-e29b-41d4-a716-446655440402',
    action_type: 'payment',
    description: 'Authorize deposit',
    provider: 'Test venue',
    target_type: 'venue',
    target_id: '550e8400-e29b-41d4-a716-446655440403',
    payload_json: {},
    amount_cents: 25_000,
    currency: 'usd',
    status: 'approved',
    approval_id: '550e8400-e29b-41d4-a716-446655440404',
    executed_at: null,
    result_metadata: {
      payment_authentication: {
        status: 'awaiting_authentication',
      },
    },
    created_at: '2026-07-11T00:00:00.000Z',
    updated_at: '2026-07-11T00:00:00.000Z',
  }
}

describe('recordPlannerPaymentAuthenticationState', () => {
  it('clears an abandoned SCA attempt to retry_allowed without failing the approved action', async () => {
    const db = new MemoryDb()
    const action = paymentAction()
    db.actions.push({ ...action })

    await recordPlannerPaymentAuthenticationState({
      db,
      action,
      actorId: '550e8400-e29b-41d4-a716-446655440405',
      state: 'retry_allowed',
      paymentIntentId: '550e8400-e29b-41d4-a716-446655440406',
      outcome: 'abandoned',
    })

    expect(db.actions[0].status).toBe('approved')
    expect(db.actions[0].result_metadata).toEqual(expect.objectContaining({
      payment_authentication: expect.objectContaining({
        status: 'retry_allowed',
        outcome: 'abandoned',
        payment_intent_id: '550e8400-e29b-41d4-a716-446655440406',
      }),
    }))
    expect(db.audits).toEqual([
      expect.objectContaining({
        from_status: 'approved',
        to_status: 'approved',
        reason: 'payment.authentication.retry_allowed',
        actor_role: 'user',
      }),
    ])
  })
})
