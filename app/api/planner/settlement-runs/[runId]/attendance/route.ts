export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import {
  loadSettlementRun,
  recordAttendanceForRun,
} from '@/lib/finance/settlement-runs'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const attendanceSchema = z.object({
  attendance_count: z.number().int().nonnegative().optional(),
  source: z.enum(['organizer_manual', 'csv_upload']),
  evidence_kind: z.enum(['organizer_attestation', 'pos_csv', 'pos_pdf', 'pos_screenshot']),
  evidence_storage_path: z.string().trim().min(1).optional(),
  csv_text: z.string().optional(),
  notes: z.string().trim().max(1000).optional(),
})

export async function PATCH(
  request: NextRequest,
  context: { params: { runId: string } },
) {
  try {
    const supabase = createClient()
    const admin = createServiceRoleClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = attendanceSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 422 })
    }

    const run = await loadSettlementRun(admin, context.params.runId)
    if (!run || run.organizer_id !== user.id) {
      return NextResponse.json({ error: 'Settlement run not found' }, { status: 404 })
    }

    if (!['awaiting_attendance', 'awaiting_organizer_review', 'pending'].includes(run.status)) {
      return NextResponse.json(
        { error: 'Attendance can only be updated before venue acknowledgment.', code: 'settlement_state_conflict' },
        { status: 409 },
      )
    }

    const attendanceCount = parsed.data.source === 'csv_upload' && parsed.data.csv_text
      ? countCsvRows(parsed.data.csv_text)
      : parsed.data.attendance_count

    if (attendanceCount == null) {
      return NextResponse.json({ error: 'attendance_count or csv_text is required' }, { status: 422 })
    }

    const updated = await recordAttendanceForRun(admin, run, {
      attendanceCount,
      source: parsed.data.source,
      evidenceKind: parsed.data.evidence_kind,
      storagePath: parsed.data.evidence_storage_path ?? null,
      uploadedBy: user.id,
      notes: parsed.data.notes ?? null,
    })

    return NextResponse.json({ settlement_run: updated })
  } catch (error) {
    if (error instanceof Error && /updated by another request/i.test(error.message)) {
      return NextResponse.json(
        { error: 'Settlement run was updated by another request. Refresh and try again.', code: 'settlement_stale' },
        { status: 409 },
      )
    }

    console.error('[settlement-runs.attendance] Failed to update attendance', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update attendance' },
      { status: 500 },
    )
  }
}

function countCsvRows(csvText: string) {
  const rows = csvText
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)

  if (rows.length === 0) return 0
  const [firstRow, ...rest] = rows
  const firstCells = firstRow.split(',').map((cell) => cell.trim().toLowerCase())
  const hasHeader = firstCells.some((cell) => ['email', 'name', 'attendee', 'ticket'].some((token) => cell.includes(token)))
  return hasHeader ? rest.length : rows.length
}
