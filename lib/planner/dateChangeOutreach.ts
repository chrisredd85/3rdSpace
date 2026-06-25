import 'server-only'

import {
  createOrReuseGmailOutreachApproval,
  GmailConnectionRequiredError,
  type GmailOutreachTarget,
} from '@/lib/outreach/gmailApprovalFlow'
import { PLAN_MESSAGE_SELECT_COLUMNS, PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import type { Json, Plan, PlanMessage } from '@/lib/types'

export type PlannerDb = { from: (table: string) => any }

export type DateChangeOutreachTarget = {
  kind?: 'venue' | 'vendor'
  name: string
  email: string
}

export type DateChangeOutreachInput = {
  userId: string
  planId: string
  dateWindowStart: string
  dateWindowEnd?: string | null
  note?: string | null
  targets?: DateChangeOutreachTarget[]
  ensureProductAccess?: (plan: Plan) => Promise<Plan>
}

export class DateChangeNoTargetsError extends Error {
  constructor() {
    super('Add a partner email, or send outreach first so 3rdPlace knows who should receive the date-change request.')
    this.name = 'DateChangeNoTargetsError'
  }
}

export class DateChangePlanNotFoundError extends Error {
  constructor() {
    super('Plan not found')
    this.name = 'DateChangePlanNotFoundError'
  }
}

export async function createDateChangeOutreachApproval(
  db: PlannerDb,
  input: DateChangeOutreachInput
) {
  const plan = await loadOwnedPlan(db, input.planId, input.userId)
  if (!plan) throw new DateChangePlanNotFoundError()

  await ensureGmailConnected(db, input.userId)

  const targets = await resolveDateChangeTargets(db, input)
  if (targets.length === 0) throw new DateChangeNoTargetsError()

  const accessPlan = input.ensureProductAccess
    ? await input.ensureProductAccess(plan)
    : plan
  const dateWindowStart = normalizeIsoDate(input.dateWindowStart)
  if (!dateWindowStart) throw new Error('Choose a valid proposed date.')
  const dateWindowEnd = normalizeIsoDate(input.dateWindowEnd) ?? dateWindowStart
  const previousDateLabel = formatDateWindow(accessPlan.date_window_start, accessPlan.date_window_end)
  const proposedDateLabel = formatDateWindow(dateWindowStart, dateWindowEnd)
  const requestedAt = new Date().toISOString()
  const note = input.note?.trim() || null
  const previousMetadata = readRecord(accessPlan.metadata) ?? {}
  const baseDateChangeRequest = {
    status: 'pending_outreach_approval',
    requested_at: requestedAt,
    previous_date_window_start: accessPlan.date_window_start,
    previous_date_window_end: accessPlan.date_window_end,
    proposed_date_window_start: dateWindowStart,
    proposed_date_window_end: dateWindowEnd,
    previous_date_label: previousDateLabel,
    proposed_date_label: proposedDateLabel,
    note,
    target_count: targets.length,
    target_names: targets.map((target) => target.name),
  }

  const { data: updatedPlan, error: updateError } = await db
    .from('plans')
    .update({
      date_window_start: dateWindowStart,
      date_window_end: dateWindowEnd,
      metadata: {
        ...previousMetadata,
        date_change_request: baseDateChangeRequest,
      } as Json,
    })
    .eq('id', plan.id)
    .eq('user_id', input.userId)
    .select(PLAN_SELECT_COLUMNS)
    .single()

  if (updateError || !updatedPlan) {
    throw new Error(updateError?.message ?? 'Failed to update event brief with proposed date change')
  }

  let approvalResult: Awaited<ReturnType<typeof createOrReuseGmailOutreachApproval>>
  try {
    approvalResult = await createOrReuseGmailOutreachApproval(db, {
      userId: input.userId,
      planId: plan.id,
      reuseExisting: false,
      targets,
      subject: buildDateChangeSubject(accessPlan),
      bodyText: buildDateChangeBody({
        plan: accessPlan,
        previousDateLabel,
        proposedDateLabel,
        note,
      }),
    })
  } catch (error) {
    await rollbackPlanDateChange(db, accessPlan, previousMetadata, input.userId)
    throw error
  }

  const { data: finalPlan, error: finalUpdateError } = await db
    .from('plans')
    .update({
      metadata: {
        ...readRecord((updatedPlan as Plan).metadata),
        date_change_request: {
          ...baseDateChangeRequest,
          approval_id: approvalResult.approval.id,
          approval_message_id: approvalResult.approvalMessageId,
          approval_redirect_url: approvalResult.redirectUrl,
        },
      } as Json,
    })
    .eq('id', plan.id)
    .eq('user_id', input.userId)
    .select(PLAN_SELECT_COLUMNS)
    .single()

  if (finalUpdateError || !finalPlan) {
    throw new Error(finalUpdateError?.message ?? 'Failed to finalize date-change event brief')
  }

  const statusMessage = await insertDateChangeStatusMessage(db, {
    planId: plan.id,
    proposedDateLabel,
    targetCount: targets.length,
    approvalId: approvalResult.approval.id,
    approvalMessageId: approvalResult.approvalMessageId,
  })

  return {
    plan: finalPlan as Plan,
    approval: approvalResult.approval,
    approvalMessageId: approvalResult.approvalMessageId,
    redirectUrl: approvalResult.redirectUrl,
    targetCount: targets.length,
    statusMessage,
  }
}

async function loadOwnedPlan(db: PlannerDb, planId: string, userId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as Plan | null) ?? null
}

async function ensureGmailConnected(db: PlannerDb, userId: string) {
  const { data, error } = await db
    .from('creator_email_accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('provider', 'gmail')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new GmailConnectionRequiredError()
}

async function resolveDateChangeTargets(
  db: PlannerDb,
  input: DateChangeOutreachInput
): Promise<GmailOutreachTarget[]> {
  const manualTargets = normalizeTargets(input.targets ?? [])
  if (manualTargets.length > 0) return manualTargets

  const { data, error } = await db
    .from('outreach_threads')
    .select('target_name, target_type, target_email, updated_at')
    .eq('plan_id', input.planId)
    .eq('user_id', input.userId)
    .order('updated_at', { ascending: false })
    .limit(12)

  if (error) throw new Error(error.message)

  return normalizeTargets((Array.isArray(data) ? data : []).flatMap((row) => {
    const record = readRecord(row)
    const name = readString(record?.target_name)
    const email = readString(record?.target_email)
    if (!name || !email) return []
    return [{
      name,
      email,
      kind: readString(record?.target_type) === 'vendor' ? 'vendor' as const : 'venue' as const,
    }]
  }))
}

function normalizeTargets(targets: DateChangeOutreachTarget[]): GmailOutreachTarget[] {
  const seen = new Set<string>()
  return targets.flatMap((target) => {
    const name = target.name.trim()
    const email = target.email.trim().toLowerCase()
    if (!name || !isValidEmail(email)) return []
    if (seen.has(email)) return []
    seen.add(email)
    return [{
      name,
      email,
      kind: target.kind === 'vendor' ? 'vendor' as const : 'venue' as const,
    }]
  }).slice(0, 6)
}

function buildDateChangeSubject(plan: Plan) {
  return `Date check for ${plan.title}`
}

function buildDateChangeBody(input: {
  plan: Plan
  previousDateLabel: string
  proposedDateLabel: string
  note: string | null
}) {
  const noteLine = input.note ? `\nOrganizer note: ${input.note}\n` : ''
  return [
    'Hi {{place_name}},',
    '',
    `We are reviewing a possible date change for ${input.plan.title}.`,
    '',
    `Current date/window: ${input.previousDateLabel}`,
    `Proposed date/window: ${input.proposedDateLabel}`,
    noteLine.trim(),
    'Can you confirm whether the proposed date works, and whether pricing, minimums, deposit timing, staffing, or any other terms would change?',
    '',
    'No booking or payment changes are made from this email. The organizer will review replies in 3rdPlace before approving next steps.',
    '',
    'Thanks,',
    '{{sender_email}}',
  ].filter(Boolean).join('\n')
}

async function insertDateChangeStatusMessage(
  db: PlannerDb,
  input: {
    planId: string
    proposedDateLabel: string
    targetCount: number
    approvalId: string
    approvalMessageId: string
  }
): Promise<PlanMessage | null> {
  const { data, error } = await db
    .from('plan_messages')
    .insert({
      plan_id: input.planId,
      role: 'agent',
      content: `Event brief updated with a proposed date change to ${input.proposedDateLabel}. Review the Gmail approval before partner emails send.`,
      message_type: 'status_update',
      metadata: {
        kind: 'date_change_request',
        status: 'pending_outreach_approval',
        target_count: input.targetCount,
        approval_id: input.approvalId,
        approval_message_id: input.approvalMessageId,
      } as Json,
    })
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    console.error('[date-change] status message insert failed', error)
    return null
  }

  return data as PlanMessage
}

async function rollbackPlanDateChange(
  db: PlannerDb,
  originalPlan: Plan,
  originalMetadata: Record<string, unknown>,
  userId: string
) {
  const { error } = await db
    .from('plans')
    .update({
      date_window_start: originalPlan.date_window_start,
      date_window_end: originalPlan.date_window_end,
      metadata: originalMetadata as Json,
    })
    .eq('id', originalPlan.id)
    .eq('user_id', userId)

  if (error) {
    console.error('[date-change] rollback failed', {
      plan_id: originalPlan.id,
      error,
    })
  }
}

function normalizeIsoDate(value: string | null | undefined): string | null {
  if (!value) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function formatDateWindow(start: string | null | undefined, end: string | null | undefined) {
  if (!start && !end) return 'Not set'
  const startLabel = formatDate(start ?? end)
  const endLabel = end && end !== start ? formatDate(end) : null
  return endLabel ? `${startLabel} - ${endLabel}` : startLabel
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not set'
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
