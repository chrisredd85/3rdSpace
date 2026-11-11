/** @jest-environment node */
import { createClient } from '@supabase/supabase-js'
import { mutateAdminTask } from '@/lib/server/admin-tasks'
import { cancelConciergeHandoff, type ConciergeExecutionDb, type ConciergeExecutionInput } from '@/lib/server/concierge-execution'
import { venueBoundaryFetch } from '@/lib/supabase/venueBoundaryFetch'
import type { AgentAction, Approval, Database, Plan } from '@/lib/types'
import receipts from '@/lib/supabase/__tests__/fixtures/concierge-receipts-160.json'

jest.mock('server-only', () => ({}))

type Receipt = typeof receipts[number]
const ACTOR_ID = 'c2160000-0000-4000-8000-000000000002'
const json = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200, headers: { 'content-type': 'application/json' },
})

// Real SDK -> real boundary -> captured disposable-PG receipt. No network or DB.
function harness(receipt: Receipt) {
  const observed: { status: number; body: unknown }[] = []
  const requests: { method: string; url: URL; body: unknown }[] = []
  const fetcher: typeof fetch = jest.fn(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = init?.method ?? 'GET'
    requests.push({ method, url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null })
    if (method === 'GET' && url.pathname === '/rest/v1/admin_tasks') {
      return json({ ...receipt.result, status: receipt.scenario.endsWith('_repeat') ? receipt.result.status : 'open' })
    }
    if (method === 'POST' && url.pathname === `/rest/v1/rpc/${receipt.rpc}`) return json(receipt.result)
    throw new Error(`Unexpected local request: ${method} ${url.pathname}`)
  })
  const boundary = venueBoundaryFetch(fetcher)
  const observingFetch: typeof fetch = async (input, init) => {
    const response = await boundary(input, init)
    observed.push({ status: response.status, body: await response.clone().json() })
    return response
  }
  const client = createClient<Database>('https://example.supabase.co', 'fake-local-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: observingFetch },
  })
  return { client, requests, observed }
}

describe('captured concierge receipts through the SDK, boundary, and real consumers', () => {
  it.each(receipts.filter(receipt => receipt.scenario !== 'host_cancel'))('$scenario preserves the committed task without recovery or another mutation', async receipt => {
    const { client, requests, observed } = harness(receipt)
    const original = JSON.stringify(receipt)
    const row = await mutateAdminTask(client, {
      taskId: receipt.result.id, adminUserId: ACTOR_ID, adminUserEmail: 'operator@example.com',
      action: receipt.rpc === 'complete_admin_task_execution' ? 'complete' : 'cancel',
      note: 'Operator confirmed the requested outcome.',
      outcomePayload: receipt.rpc === 'complete_admin_task_execution' ? { outcome: 'completed' } : undefined,
    })
    expect(row).toMatchObject({
      id: receipt.result.id, planId: receipt.result.plan_id, status: receipt.result.status,
      metadata: receipt.result.metadata, notes: receipt.result.notes, outcomePayload: receipt.result.outcome_payload,
      approvalId: receipt.result.approval_id, agentActionId: receipt.result.agent_action_id,
    })
    expect(requests.map(request => request.method)).toEqual(['GET', 'POST'])
    expect(requests[1].body).toMatchObject({ p_task_id: receipt.result.id })
    expect(observed.map(response => response.status)).toEqual([200, 200])
    expect(observed[1].body).toEqual(receipt.result)
    expect(JSON.stringify(receipt)).toBe(original)
  })

  it('host_cancel preserves the receipt and signed evidence through the real host wrapper, once', async () => {
    const receipt = receipts.find(value => value.scenario === 'host_cancel')!
    const { client, requests, observed } = harness(receipt)
    const db: ConciergeExecutionDb = {
      from: () => { throw new Error('Cancellation must not perform a vendor lookup') },
      rpc: async (name, args) => {
        expect(name).toBe('cancel_approved_admin_task')
        // The consumer interface accepts dynamic RPC names; the SDK uses generated arguments.
        return await client.rpc('cancel_approved_admin_task', args as Database['public']['Functions']['cancel_approved_admin_task']['Args'])
      },
    }
    const input = hostInput(db, receipt)
    const signedBefore = JSON.stringify({ action: input.action, approval: input.approval })
    const result = await cancelConciergeHandoff(input, 'Host requested cancellation.')
    expect(result).toEqual({ cancelled: true, metadata: {
      execution_mode: 'concierge_admin_queue', handoff_status: 'cancelled',
      admin_task_id: receipt.result.id, event_id: receipt.result.event_id, outbound_message_sent: false,
    } })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'POST', body: {
      p_plan_id: input.plan.id, p_action_id: input.action.id, p_approval_id: input.approval.id, p_actor_id: ACTOR_ID,
    } })
    expect(observed).toEqual([{ status: 200, body: receipt.result }])
    expect(JSON.stringify({ action: input.action, approval: input.approval })).toBe(signedBefore)
  })
})

function hostInput(db: ConciergeExecutionDb, receipt: Receipt): ConciergeExecutionInput {
  const task = receipt.result
  const at = '2026-11-10T00:00:00Z'
  const plan = {
    id: task.plan_id, user_id: ACTOR_ID, title: 'Approved host event', event_type: 'dinner', status: 'approved',
    guest_count: 80, budget_cap_cents: 800_000, neighborhood: null, date_window_start: '2026-12-01',
    date_window_end: '2026-12-01', ticketed: false, profit_goal_cents: null, notes: null, created_at: at, updated_at: at,
  } satisfies Plan
  const action = {
    id: task.agent_action_id, plan_id: task.plan_id, action_type: 'concierge_queue', description: 'Approved operator request',
    provider: 'Independent Supplier', target_type: 'vendor', target_id: task.metadata.vendor_data.identity.id,
    payload_json: {}, amount_cents: 12_000, currency: 'usd', status: 'executing', approval_id: task.approval_id,
    executed_at: null, result_metadata: {}, created_at: at, updated_at: at,
  } satisfies AgentAction
  const approval = {
    id: task.approval_id, plan_id: task.plan_id, agent_action_id: task.agent_action_id, action_label: 'Approve operator task',
    provider: action.provider, event_date: '2026-12-01', price_cents: 12_000, fees_cents: 0, refund_terms: null,
    cancellation_terms: 'Host-authorized cancellation only', package_details: null, delivery_email: null, payment_method_id: null,
    status: 'authorized', requested_amount_cents: 12_000, authorized_amount_cents: 12_000, authorized_by: ACTOR_ID,
    authorized_at: at, approved_by: null, approved_at: null, expires_at: null, snapshot_hash: 'fixture-signed-snapshot-hash',
    created_at: at, updated_at: at,
  } satisfies Approval
  return { db, plan, action, approval, actorId: ACTOR_ID }
}
