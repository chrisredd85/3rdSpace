import {
  attachPendingApprovalPlanContext,
  loadOwnedPlannerPlansForApprovalQueue,
  loadPendingApprovalsForPlan,
} from '@/lib/planner/pendingApprovals'
import type { Plan } from '@/lib/types'

type TableRows = Record<string, Array<Record<string, unknown>>>

class Query {
  private filters: Array<(row: Record<string, unknown>) => boolean> = []
  private limitCount: number | null = null
  private orderColumn: string | null = null
  private ascending = true

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  select() {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]))
    return this
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderColumn = column
    this.ascending = options?.ascending ?? true
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  then<TResult1 = { data: Record<string, unknown>[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Record<string, unknown>[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve({ data: this.resultRows(), error: null }).then(onfulfilled, onrejected)
  }

  private resultRows() {
    let rows = this.rows.filter((row) => this.filters.every((filter) => filter(row)))
    if (this.orderColumn) {
      rows = [...rows].sort((a, b) => {
        const left = String(a[this.orderColumn!] ?? '')
        const right = String(b[this.orderColumn!] ?? '')
        return this.ascending ? left.localeCompare(right) : right.localeCompare(left)
      })
    }
    return this.limitCount == null ? rows : rows.slice(0, this.limitCount)
  }
}

function createDb(rows: TableRows) {
  return {
    from(table: string) {
      return new Query(rows[table] ?? [])
    },
  }
}

const plan = {
  id: 'plan-1',
  user_id: 'user-1',
  title: 'Oakland happy hour',
  event_type: 'networking_mixer',
  status: 'ready',
  guest_count: 40,
  budget_cap_cents: 500000,
  neighborhood: 'Downtown Oakland',
  date_window_start: '2026-07-10',
  date_window_end: '2026-07-10',
  ticketed: true,
  ticketing_model: 'ticketed',
  food_responsibility: null,
  venue_terms: null,
  agent_action: null,
  profit_goal_cents: null,
  notes: null,
  metadata: {},
  created_at: '2026-06-24T00:00:00.000Z',
  updated_at: '2026-06-24T00:00:00.000Z',
} satisfies Plan

describe('pending approvals planner helpers', () => {
  it('loads active plans and pending approvals with the same filters used by desktop and mobile', async () => {
    const db = createDb({
      plans: [
        { ...plan, id: 'archived-plan', status: 'archived', updated_at: '2026-06-25T00:00:00.000Z' },
        { ...plan, updated_at: '2026-06-26T00:00:00.000Z' },
        { ...plan, id: 'other-user-plan', user_id: 'other-user', updated_at: '2026-06-27T00:00:00.000Z' },
      ],
      approvals: [
        {
          id: 'approval-later',
          plan_id: plan.id,
          action_label: 'Approve venue hold',
          provider: 'Venue',
          status: 'pending',
          created_at: '2026-06-24T00:02:00.000Z',
          updated_at: '2026-06-24T00:02:00.000Z',
        },
        {
          id: 'approval-earlier',
          plan_id: plan.id,
          action_label: 'Approve outreach',
          provider: 'Gmail',
          status: 'pending',
          created_at: '2026-06-24T00:01:00.000Z',
          updated_at: '2026-06-24T00:01:00.000Z',
        },
        {
          id: 'approval-approved',
          plan_id: plan.id,
          action_label: 'Already approved',
          provider: 'Venue',
          status: 'approved',
          created_at: '2026-06-24T00:00:00.000Z',
          updated_at: '2026-06-24T00:00:00.000Z',
        },
        {
          id: 'approval-expired',
          plan_id: plan.id,
          agent_action_id: 'action-expired',
          action_label: 'Expired hold',
          provider: 'Venue',
          status: 'expired',
          created_at: '2026-06-24T00:03:00.000Z',
          updated_at: '2026-06-24T00:03:00.000Z',
        },
        {
          id: 'approval-reapproval',
          plan_id: plan.id,
          agent_action_id: 'action-reapproval',
          action_label: 'Changed quote',
          provider: 'Venue',
          status: 're_approval_required',
          created_at: '2026-06-24T00:04:00.000Z',
          updated_at: '2026-06-24T00:04:00.000Z',
        },
        {
          id: 'approval-failed',
          plan_id: plan.id,
          agent_action_id: 'action-failed',
          action_label: 'Failed Gmail send',
          provider: 'Gmail',
          status: 'authorized',
          created_at: '2026-06-24T00:05:00.000Z',
          updated_at: '2026-06-24T00:05:00.000Z',
        },
      ],
      agent_actions: [
        { id: 'action-expired', status: 'pending', result_metadata: null, last_retry_result: null },
        { id: 'action-reapproval', status: 'pending', result_metadata: null, last_retry_result: null },
        { id: 'action-failed', status: 'failed', result_metadata: { error: 'provider failed' }, last_retry_result: null },
      ],
    })

    const plans = await loadOwnedPlannerPlansForApprovalQueue(db, 'user-1')
    const approvals = await loadPendingApprovalsForPlan(db, plan.id)
    const withPlan = attachPendingApprovalPlanContext(approvals, plans as Plan[])

    expect(plans.map((row) => row.id)).toEqual(['plan-1', 'archived-plan'])
    expect(approvals.map((approval) => approval.id)).toEqual([
      'approval-earlier',
      'approval-later',
      'approval-expired',
      'approval-reapproval',
      'approval-failed',
    ])
    expect(approvals.map((approval) => [approval.id, approval.ui_status, approval.available_actions])).toEqual([
      ['approval-earlier', 'pending', ['edit', 'authorize', 'cancel']],
      ['approval-later', 'pending', ['edit', 'authorize', 'cancel']],
      ['approval-expired', 'expired', ['request_reapproval']],
      ['approval-reapproval', 'reapproval_required', ['request_reapproval']],
      ['approval-failed', 'failed', ['retry']],
    ])
    expect(withPlan[0]?.plan?.title).toBe('Oakland happy hour')
  })
})
