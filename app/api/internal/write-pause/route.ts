export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getCronOrAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { WRITE_PAUSE_CONTROL_KEY, type WritePauseState } from '@/lib/write-pause'

const CONTROL_SELECT = 'control_key,state,enabled,reason,enabled_at,updated_at,changed_by,revision'
const DEFAULT_DRAIN_SECONDS = 30
const MAX_DRAIN_SECONDS = 600

const controlRequestSchema = z.object({
  state: z.enum(['open', 'paused', 'draining']),
  expected_revision: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(500),
})

type ControlRow = {
  control_key: string
  state: WritePauseState
  enabled: boolean
  reason: string | null
  enabled_at: string | null
  updated_at: string
  changed_by: string
  revision: number
}

type ControlRpcResult = {
  applied: boolean
  opened?: boolean
  code: string
  remaining?: number | null
  control: ControlRow
}

export async function GET(request: NextRequest) {
  const context = await getCronOrAdminContext(request)
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  try {
    const row = await loadControlRow()
    return NextResponse.json(toControlStatus(row))
  } catch (error) {
    console.error('[write-pause.control] status_failed', error)
    return NextResponse.json(
      { error: 'Write-pause status is unavailable' },
      { status: 503 },
    )
  }
}

export async function POST(request: NextRequest) {
  const context = await getCronOrAdminContext(request)
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const parsed = controlRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid write-pause request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const admin = createServiceRoleClient() as any
  const changedBy = context.user.email ?? context.user.id
  const rpcName = parsed.data.state === 'open'
    ? 'complete_write_pause_drain'
    : 'transition_release_runtime_control'
  const rpcArgs = parsed.data.state === 'open'
    ? {
        p_expected_revision: parsed.data.expected_revision,
        p_reason: parsed.data.reason,
        p_changed_by: changedBy,
      }
    : {
        p_expected_revision: parsed.data.expected_revision,
        p_target_state: parsed.data.state,
        p_reason: parsed.data.reason,
        p_changed_by: changedBy,
      }
  const { data, error } = await admin.rpc(rpcName, rpcArgs)

  if (error) {
    console.error('[write-pause.control] update_failed', {
      error: error.message,
      requested_state: parsed.data.state,
      expected_revision: parsed.data.expected_revision,
    })
    return NextResponse.json({ error: 'Failed to update write pause' }, { status: 500 })
  }

  const result = normalizeControlRpcResult(data)
  if (!result) {
    console.error('[write-pause.control] malformed_rpc_result', {
      requested_state: parsed.data.state,
      expected_revision: parsed.data.expected_revision,
    })
    return NextResponse.json({ error: 'Write-pause transition result is invalid' }, { status: 500 })
  }

  if (!result.applied && result.code !== 'queue_not_empty') {
    const current = await loadControlRow().catch(() => null)
    return NextResponse.json(
      {
        error: result.code === 'revision_conflict'
          ? 'Write-pause state changed concurrently; reload status and retry'
          : 'Write-pause transition is not allowed from the current state',
        code: result.code === 'revision_conflict'
          ? 'write_pause_revision_conflict'
          : 'write_pause_invalid_transition',
        current: current ? toControlStatus(current) : toControlStatus(result.control),
      },
      { status: 409 },
    )
  }

  const status = toControlStatus(result.control)
  console.info('[write-pause.control] state_changed', {
    state: status.state,
    revision: status.revision,
    changed_by: changedBy,
    transition_code: result.code,
  })
  return NextResponse.json({
    ...status,
    transition_code: result.code,
    ...(parsed.data.state === 'open'
      ? {
          opened: Boolean(result.opened),
          remaining: result.remaining ?? null,
        }
      : {}),
  })
}

async function loadControlRow(): Promise<ControlRow> {
  const admin = createServiceRoleClient() as any
  const { data, error } = await admin
    .from('release_runtime_controls')
    .select(CONTROL_SELECT)
    .eq('control_key', WRITE_PAUSE_CONTROL_KEY)
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'write_pause control row is missing')
  }

  return data as unknown as ControlRow
}

function toControlStatus(row: ControlRow, nowMs: number = Date.now()) {
  const drainSeconds = getDrainSeconds()
  const enabledAtMs = row.enabled_at ? Date.parse(row.enabled_at) : Number.NaN
  const drainElapsed = row.state === 'paused'
    && Number.isFinite(enabledAtMs)
    && nowMs - enabledAtMs >= drainSeconds * 1000

  return {
    ok: true,
    control: WRITE_PAUSE_CONTROL_KEY,
    state: row.state,
    paused: row.state !== 'open',
    draining: row.state === 'draining',
    blocking: row.state !== 'open',
    safe_to_migrate: drainElapsed,
    drain_seconds: drainSeconds,
    reason: row.reason,
    enabled_at: row.enabled_at,
    updated_at: row.updated_at,
    changed_by: row.changed_by,
    revision: row.revision,
  }
}

function normalizeControlRpcResult(data: unknown): ControlRpcResult | null {
  const value = Array.isArray(data) ? data[0] : data
  if (!value || typeof value !== 'object') return null

  const result = value as Partial<ControlRpcResult>
  const control = result.control as Partial<ControlRow> | undefined
  if (
    typeof result.applied !== 'boolean'
    || typeof result.code !== 'string'
    || !control
    || control.control_key !== WRITE_PAUSE_CONTROL_KEY
    || (control.state !== 'open' && control.state !== 'paused' && control.state !== 'draining')
    || typeof control.enabled !== 'boolean'
    || typeof control.updated_at !== 'string'
    || typeof control.changed_by !== 'string'
    || !Number.isSafeInteger(Number(control.revision))
  ) {
    return null
  }

  return {
    applied: result.applied,
    opened: result.opened,
    code: result.code,
    remaining: result.remaining == null ? result.remaining : Number(result.remaining),
    control: {
      control_key: control.control_key,
      state: control.state,
      enabled: control.enabled,
      reason: typeof control.reason === 'string' ? control.reason : null,
      enabled_at: typeof control.enabled_at === 'string' ? control.enabled_at : null,
      updated_at: control.updated_at,
      changed_by: control.changed_by,
      revision: Number(control.revision),
    },
  }
}

function getDrainSeconds(): number {
  const configured = Number(process.env.WRITE_PAUSE_DRAIN_SECONDS ?? DEFAULT_DRAIN_SECONDS)
  if (!Number.isSafeInteger(configured) || configured < 0) return DEFAULT_DRAIN_SECONDS
  return Math.min(configured, MAX_DRAIN_SECONDS)
}
