import { getAdminTaskQueueData, mutateAdminTask, type AdminTasksDb } from '@/lib/server/admin-tasks'
import type { Database } from '@/lib/types/database-generated'

type AdminTaskRow = Database['public']['Tables']['admin_tasks']['Row']
type PlanRow = Database['public']['Tables']['plans']['Row']
type UserRow = Database['public']['Tables']['users']['Row']

const baseTask = {
  id: '11111111-1111-4111-8111-111111111111',
  plan_id: '22222222-2222-4222-8222-222222222222',
  assigned_to: null,
  task_type: 'catalog_gap',
  description: 'Source venue options for a plan.',
  status: 'pending',
  priority: 'low',
  metadata: { type: 'catalog_gap' },
  due_at: null,
  completed_at: null,
  notes: null,
  created_at: '2026-06-08T00:00:00.000Z',
  updated_at: '2026-06-08T00:00:00.000Z',
} satisfies AdminTaskRow

const basePlan = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Founder dinner',
  user_id: '33333333-3333-4333-8333-333333333333',
  guest_count: 80,
  neighborhood: 'Mission',
  date_window_start: '2026-07-01T00:00:00.000Z',
  date_window_end: null,
  event_type: 'dinner',
  status: 'ready',
} as PlanRow

const assignedUser = {
  id: '44444444-4444-4444-8444-444444444444',
  email: 'ops@example.com',
  company_name: '3rdPlace',
  role: 'admin',
  user_type: 'admin',
} as UserRow

describe('admin task service', () => {
  it('surfaces catalog_gap and concierge_booking admin_tasks with plan and assignee context', async () => {
    const tasks = [
      baseTask,
      {
        ...baseTask,
        id: '55555555-5555-4555-8555-555555555555',
        assigned_to: assignedUser.id,
        task_type: 'concierge_booking',
        description: 'Route opportunity targets through admin fallback.',
        status: 'open',
        priority: 'high',
        metadata: { opportunity_id: 'opportunity-1' },
      },
    ] satisfies AdminTaskRow[]
    const admin = makeListClient(tasks, [basePlan], [assignedUser])

    const data = await getAdminTaskQueueData(admin)

    expect(data.rows).toHaveLength(2)
    expect(data.rows.map((row) => row.taskType)).toEqual(['catalog_gap', 'concierge_booking'])
    expect(data.rows[0].plan?.title).toBe('Founder dinner')
    expect(data.rows[1].assignee?.email).toBe('ops@example.com')
  })

  it('updates task status and records an admin audit row', async () => {
    const before = { ...baseTask, status: 'open', priority: 'normal' } satisfies AdminTaskRow
    const after = { ...before, status: 'in_progress', updated_at: '2026-06-08T00:01:00.000Z' } satisfies AdminTaskRow
    const admin = makeMutationClient(before, after)

    const task = await mutateAdminTask(admin.client, {
      taskId: before.id,
      adminUserId: '66666666-6666-4666-8666-666666666666',
      adminUserEmail: 'admin@example.com',
      action: 'start',
    })

    expect(task.status).toBe('in_progress')
    expect(admin.updateMock).toHaveBeenCalledWith({ status: 'in_progress' })
    expect(admin.auditInsertMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'admin_tasks.start',
      entity_type: 'admin_task',
      entity_id: before.id,
      admin_user_id: '66666666-6666-4666-8666-666666666666',
      before_state: expect.objectContaining({ status: 'open' }),
      after_state: expect.objectContaining({ status: 'in_progress' }),
    }))
  })

  it('completes execution-linked tasks through the atomic database command', async () => {
    const before = { ...baseTask, status: 'in_progress', priority: 'normal' } satisfies AdminTaskRow
    const after = {
      ...before,
      status: 'complete',
      completed_at: '2026-06-08T00:02:00.000Z',
    } satisfies AdminTaskRow
    const admin = makeExecutionMutationClient(before, after)

    const task = await mutateAdminTask(admin.client, {
      taskId: before.id,
      adminUserId: '66666666-6666-4666-8666-666666666666',
      adminUserEmail: 'admin@example.com',
      action: 'complete',
      note: 'Provider reference is in the internal task.',
      hostMessage: 'The venue confirmed the requested hold.',
      outcomePayload: {
        outcome: 'hold_confirmed',
        hold_reference: 'hold-ref-1',
      },
    })

    expect(task.status).toBe('complete')
    expect(admin.rpcMock).toHaveBeenCalledWith('complete_admin_task_execution', {
      p_task_id: before.id,
      p_admin_user_id: '66666666-6666-4666-8666-666666666666',
      p_outcome_payload: {
        outcome: 'hold_confirmed',
        hold_reference: 'hold-ref-1',
      },
      p_host_message: 'The venue confirmed the requested hold.',
      p_internal_note: 'Provider reference is in the internal task.',
    })
  })

  it('passes a repeated completion to the idempotent database command', async () => {
    const complete = {
      ...baseTask,
      status: 'complete',
      priority: 'normal',
      completed_at: '2026-06-08T00:02:00.000Z',
    } satisfies AdminTaskRow
    const admin = makeExecutionMutationClient(complete, complete)

    await expect(mutateAdminTask(admin.client, {
      taskId: complete.id,
      adminUserId: '66666666-6666-4666-8666-666666666666',
      adminUserEmail: 'admin@example.com',
      action: 'complete',
      outcomePayload: { outcome: 'hold_confirmed' },
    })).resolves.toMatchObject({ status: 'complete' })

    expect(admin.rpcMock).toHaveBeenCalledWith(
      'complete_admin_task_execution',
      expect.objectContaining({ p_task_id: complete.id })
    )
  })

  it('cancels queued post-authorization work through the atomic database command', async () => {
    const before = { ...baseTask, status: 'open', priority: 'normal' } satisfies AdminTaskRow
    const after = { ...before, status: 'cancelled' } satisfies AdminTaskRow
    const admin = makeExecutionMutationClient(before, after)

    await expect(mutateAdminTask(admin.client, {
      taskId: before.id,
      adminUserId: '66666666-6666-4666-8666-666666666666',
      adminUserEmail: 'admin@example.com',
      action: 'cancel',
      note: 'Host withdrew authorization.',
    })).resolves.toMatchObject({ status: 'cancelled' })

    expect(admin.rpcMock).toHaveBeenCalledWith('cancel_admin_task_execution', {
      p_task_id: before.id,
      p_actor_id: '66666666-6666-4666-8666-666666666666',
      p_reason: 'Host withdrew authorization.',
      p_host_message: null,
    })
  })

  it('surfaces a concierge deadlock as a retryable conflict', async () => {
    const before = { ...baseTask, status: 'in_progress', priority: 'normal' } satisfies AdminTaskRow
    const admin = makeExecutionMutationClient(before, before)
    admin.rpcMock.mockResolvedValue({ data: null, error: { code: '40P01', message: 'deadlock detected' } })

    await expect(mutateAdminTask(admin.client, {
      taskId: before.id,
      adminUserId: '66666666-6666-4666-8666-666666666666',
      adminUserEmail: 'admin@example.com',
      action: 'complete',
      outcomePayload: { outcome: 'hold_confirmed' },
    })).rejects.toMatchObject({ status: 409, message: 'deadlock detected' })
  })
})

function makeListClient(tasks: AdminTaskRow[], plans: PlanRow[], users: UserRow[]): AdminTasksDb {
  const from = jest.fn((table: string) => {
    if (table === 'admin_tasks') {
      return {
        select: jest.fn(() => ({
          order: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue({ data: tasks, error: null }),
          })),
        })),
      }
    }

    if (table === 'plans') {
      return {
        select: jest.fn(() => ({
          in: jest.fn().mockResolvedValue({ data: plans, error: null }),
        })),
      }
    }

    return {
      select: jest.fn(() => ({
        in: jest.fn().mockResolvedValue({ data: users, error: null }),
      })),
    }
  })

  return { from } as unknown as AdminTasksDb
}

function makeMutationClient(before: AdminTaskRow, after: AdminTaskRow) {
  const auditInsertMock = jest.fn().mockResolvedValue({ error: null })
  const updateMock = jest.fn(() => ({
    eq: jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn().mockResolvedValue({ data: after, error: null }),
      })),
    })),
  }))
  const adminTasksTable = {
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn().mockResolvedValue({ data: before, error: null }),
      })),
    })),
    update: updateMock,
  }

  const from = jest.fn((table: string) => {
    if (table === 'admin_tasks') return adminTasksTable
    return { insert: auditInsertMock }
  })

  return {
    client: { from } as unknown as AdminTasksDb,
    updateMock,
    auditInsertMock,
  }
}

function makeExecutionMutationClient(before: AdminTaskRow, after: AdminTaskRow) {
  const adminTasksTable = {
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn().mockResolvedValue({ data: before, error: null }),
      })),
    })),
  }
  const from = jest.fn(() => adminTasksTable)
  const rpcMock = jest.fn().mockResolvedValue({ data: after, error: null })

  return {
    client: { from, rpc: rpcMock } as unknown as AdminTasksDb,
    rpcMock,
  }
}
