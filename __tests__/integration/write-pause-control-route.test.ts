/**
 * @jest-environment node
 */

jest.mock('server-only', () => ({}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data), {
      ...init,
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json', ...init?.headers },
    }),
  },
}))

jest.mock('@/lib/server/admin-auth', () => ({
  getCronOrAdminContext: jest.fn().mockResolvedValue({
    authorized: true,
    user: { id: 'worker', email: 'worker@internal' },
  }),
}))

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))

import { POST } from '@/app/api/internal/write-pause/route'
import { createServiceRoleClient } from '@/lib/supabase/server'

type ControlRow = {
  control_key: string
  state: 'open' | 'paused' | 'draining'
  enabled: boolean
  reason: string | null
  enabled_at: string | null
  updated_at: string
  changed_by: string
  revision: number
}

class ControlDb {
  queueRemaining = 0
  beforeFinalize: (() => void) | null = null
  row: ControlRow = {
    control_key: 'write_pause',
    state: 'open',
    enabled: false,
    reason: null,
    enabled_at: null,
    updated_at: '2026-07-10T20:00:00.000Z',
    changed_by: 'migration',
    revision: 0,
  }

  from() {
    return {
      select: () => new SelectQuery(this),
    }
  }

  async rpc(fn: string, args: Record<string, unknown>) {
    const expectedRevision = Number(args.p_expected_revision)
    if (expectedRevision !== this.row.revision) {
      return {
        data: {
          applied: false,
          opened: false,
          code: 'revision_conflict',
          remaining: null,
          control: { ...this.row },
        },
        error: null,
      }
    }

    if (fn === 'complete_write_pause_drain') {
      this.beforeFinalize?.()
      this.beforeFinalize = null
      if (this.row.state !== 'draining') {
        return {
          data: { applied: false, opened: false, code: 'invalid_transition', control: { ...this.row } },
          error: null,
        }
      }
      if (this.queueRemaining > 0) {
        return {
          data: {
            applied: false,
            opened: false,
            code: 'queue_not_empty',
            remaining: this.queueRemaining,
            control: { ...this.row },
          },
          error: null,
        }
      }
      this.updateState('open', String(args.p_reason), String(args.p_changed_by))
      return {
        data: {
          applied: true,
          opened: true,
          code: 'drain_complete',
          remaining: 0,
          control: { ...this.row },
        },
        error: null,
      }
    }

    if (fn !== 'transition_release_runtime_control') {
      return { data: null, error: { message: `unexpected RPC ${fn}` } }
    }

    const target = args.p_target_state as 'paused' | 'draining'
    if (target === 'draining' && this.row.state !== 'paused') {
      return {
        data: { applied: false, code: 'invalid_transition', control: { ...this.row } },
        error: null,
      }
    }
    this.updateState(target, String(args.p_reason), String(args.p_changed_by))
    return {
      data: { applied: true, code: 'state_changed', control: { ...this.row } },
      error: null,
    }
  }

  private updateState(state: ControlRow['state'], reason: string, changedBy: string) {
    const now = '2026-07-10T20:00:01.000Z'
    const wasOpen = this.row.state === 'open'
    this.row = {
      ...this.row,
      state,
      enabled: state !== 'open',
      enabled_at: state === 'open' ? null : wasOpen ? now : this.row.enabled_at,
      reason,
      changed_by: changedBy,
      updated_at: now,
      revision: this.row.revision + 1,
    }
  }
}

class SelectQuery {
  constructor(private db: ControlDb) {}
  eq() { return this }
  async single() { return { data: { ...this.db.row }, error: null } }
}

function transitionRequest(
  state: ControlRow['state'],
  expectedRevision = 0,
) {
  return new Request('https://www.3rdplace.io/api/internal/write-pause', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      state,
      reason: state === 'open' ? 'Window complete' : 'Release window',
      expected_revision: expectedRevision,
    }),
  }) as never
}

describe('write-pause atomic control route', () => {
  it('allows only one concurrent flag flip for a given revision', async () => {
    const db = new ControlDb()
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)

    const responses = await Promise.all([
      POST(transitionRequest('paused')),
      POST(transitionRequest('paused')),
    ])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    expect(db.row.revision).toBe(1)
    const conflict = responses.find((response) => response.status === 409)
    await expect(conflict?.json()).resolves.toMatchObject({
      code: 'write_pause_revision_conflict',
      current: { revision: 1 },
    })
  })

  it('keeps draining when a delivery queues at the zero/open boundary', async () => {
    const db = new ControlDb()
    db.row = {
      ...db.row,
      state: 'draining',
      enabled: true,
      enabled_at: '2026-07-10T20:00:00.000Z',
      revision: 4,
    }
    db.beforeFinalize = () => {
      db.queueRemaining = 1
    }
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)

    const raced = await POST(transitionRequest('open', 4))
    expect(raced.status).toBe(200)
    await expect(raced.json()).resolves.toMatchObject({
      state: 'draining',
      opened: false,
      remaining: 1,
      transition_code: 'queue_not_empty',
      revision: 4,
    })

    db.queueRemaining = 0
    const completed = await POST(transitionRequest('open', 4))
    expect(completed.status).toBe(200)
    await expect(completed.json()).resolves.toMatchObject({
      state: 'open',
      opened: true,
      remaining: 0,
      transition_code: 'drain_complete',
      revision: 5,
    })
  })
})
