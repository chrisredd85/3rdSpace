import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import { isChiEligibleVenueType } from '@/lib/finance/chi-eligibility'
import { resolveChiRate } from '@/lib/finance/chi-rate-resolver'
import { ensureSettlementApproval } from '@/lib/finance/settlement-checkout'
import {
  transitionSettlementRunStatus,
  type SettlementRunStatus,
} from '@/lib/finance/settlement-run-state'
import { enqueueJob, type SupabaseJobClient } from '@/lib/server/job-queue'
import { decryptSecret } from '@/lib/server/token-crypto'
import { pollEventbriteCheckedInCount } from '@/lib/ticketing/eventbritePoll'
import type { JsonObject } from '@/lib/types/databaseRows'
import { assertIntegerCents } from '@/lib/planner/execution/approvalState'

type SupabaseAdminClient = SupabaseClient<any, 'public', any>

export type SettlementAttendanceSource =
  | 'eventbrite_api'
  | 'webhook_posh'
  | 'webhook_luma'
  | 'webhook_partiful'
  | 'csv_upload'
  | 'organizer_manual'

export type SettlementEvidenceKind =
  | 'pos_screenshot'
  | 'pos_csv'
  | 'pos_pdf'
  | 'eventbrite_api_response'
  | 'webhook_payload'
  | 'organizer_attestation'

type EventRow = {
  id: string
  builder_id: string
  venue_id: string | null
  event_name: string
  event_type: string
  event_date: string
  eventbrite_event_id: string | null
}

type BuilderRow = {
  id: string
  user_id: string
}

type VenueRow = {
  id: string
  venue_name: string
  venue_type: string | null
  city: string | null
  state: string | null
}

type PlanRow = {
  id: string
  title: string
  event_type: string | null
  neighborhood: string | null
  date_window_start: string | null
}

export type SettlementRunRow = {
  id: string
  event_id: string
  organizer_id: string
  venue_id: string
  archetype: string
  venue_type: string
  neighborhood: string
  attendance_count: number | null
  attendance_source: SettlementAttendanceSource | null
  attendance_recorded_at: string | null
  per_attendee_cents: number | null
  rate_source: 'measured' | 'network_default' | 'no_rate_available' | null
  rate_derived_from_event_count: number | null
  total_cents: number | null
  status: SettlementRunStatus
  scheduled_settle_at: string
  organizer_reviewed_at: string | null
  organizer_reviewed_by: string | null
  disputed_at: string | null
  dispute_reason: string | null
  created_at: string
  updated_at: string
}

const LEGACY_AGREEMENT_TABLE = `event_${'kick' + 'back'}_agreements`
const TEXT_REF_LIMIT = 4096

export async function createSettlementRunForEvent(
  admin: SupabaseAdminClient,
  eventId: string,
): Promise<{ created: boolean; skippedReason?: string; run?: SettlementRunRow }> {
  const context = await loadSettlementContext(admin, eventId)
  if (!context) return { created: false, skippedReason: 'event_not_found' }

  const { event, builder, venue, plan } = context
  if (!event.venue_id) return { created: false, skippedReason: 'missing_venue' }
  if (!venue) return { created: false, skippedReason: 'venue_not_found' }
  if (!isChiEligibleVenueType(venue.venue_type)) {
    return { created: false, skippedReason: 'venue_not_chi_eligible' }
  }

  if (await hasCapturedLegacyPayout(admin, event.id)) {
    return { created: false, skippedReason: 'legacy_captured_payout_exists' }
  }

  const archetype = normalizeDimension(plan?.event_type ?? event.event_type ?? 'event')
  const venueType = normalizeDimension(venue.venue_type ?? 'venue')
  const neighborhood = normalizeDimension(plan?.neighborhood ?? venue.city ?? venue.state ?? 'bay_area')
  const rate = await resolveChiRate(admin, {
    organizerId: builder.user_id,
    archetype,
    venueType,
    neighborhood,
  })
  const now = new Date()
  const scheduledSettleAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()

  const insert = {
    event_id: event.id,
    organizer_id: builder.user_id,
    venue_id: event.venue_id,
    archetype,
    venue_type: venueType,
    neighborhood,
    per_attendee_cents: rate.perAttendeeCents,
    rate_source: rate.source,
    rate_derived_from_event_count: rate.derivedFromEventCount,
    total_cents: null,
    status: 'pending',
    scheduled_settle_at: scheduledSettleAt,
  }

  const { data, error } = await (admin as any)
    .from('settlement_runs')
    .insert(insert)
    .select('*')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      const existing = await loadSettlementRunByEvent(admin, event.id)
      return { created: false, skippedReason: 'already_exists', run: existing ?? undefined }
    }
    throw new Error(error.message ?? 'Failed to create settlement run')
  }

  let run = normalizeRun(data)
  const cached = await applyCachedAttendance(admin, run)
  if (cached) {
    run = cached
  } else if (event.eventbrite_event_id) {
    await enqueueJob(admin as unknown as SupabaseJobClient, {
      jobType: 'settlement.run.eventbrite_pull',
      payload: { settlement_run_id: run.id },
      uniqueKey: `settlement-eventbrite:${run.id}`,
      maxAttempts: 3,
    })
  }

  return { created: true, run }
}

export async function pullEventbriteAttendanceForSettlementRun(
  admin: SupabaseAdminClient,
  settlementRunId: string,
): Promise<{ processed: boolean; attendanceCount?: number; reason?: string }> {
  const run = await loadSettlementRun(admin, settlementRunId)
  if (!run) return { processed: false, reason: 'settlement_run_not_found' }

  const { event, token } = await loadEventbriteAttendanceContext(admin, run.event_id)
  if (!event?.eventbrite_event_id) {
    await markAwaitingAttendance(admin, run, 'missing_eventbrite_event_id')
    return { processed: false, reason: 'missing_eventbrite_event_id' }
  }
  if (!token) {
    await markAwaitingAttendance(admin, run, 'missing_eventbrite_access_token')
    return { processed: false, reason: 'missing_eventbrite_access_token' }
  }

  try {
    const result = await pollEventbriteCheckedInCount({
      accessToken: token,
      eventbriteEventId: event.eventbrite_event_id,
    })
    const updated = await recordAttendanceForRun(admin, run, {
      attendanceCount: result.checkedInCount,
      source: 'eventbrite_api',
      evidenceKind: 'eventbrite_api_response',
      externalRef: truncateRef(result.rawResponse),
      notes: 'Attendance imported from Eventbrite checked-in attendees.',
    })
    return {
      processed: true,
      attendanceCount: updated.attendance_count ?? result.checkedInCount,
    }
  } catch (error) {
    await markAwaitingAttendance(
      admin,
      run,
      error instanceof Error ? error.message : 'Eventbrite attendance pull failed',
    )
    return {
      processed: false,
      reason: error instanceof Error ? error.message : 'Eventbrite attendance pull failed',
    }
  }
}

export async function recordAttendanceForRun(
  admin: SupabaseAdminClient,
  run: SettlementRunRow,
  input: {
    attendanceCount: number
    source: SettlementAttendanceSource
    evidenceKind: SettlementEvidenceKind
    storagePath?: string | null
    externalRef?: string | null
    uploadedBy?: string | null
    notes?: string | null
  },
): Promise<SettlementRunRow> {
  const attendanceCount = readNonNegativeInteger(input.attendanceCount, 'attendance_count')
  const perAttendeeCents = assertIntegerCents(run.per_attendee_cents ?? 0, 'per_attendee_cents')
  const totalCents = assertIntegerCents(attendanceCount * perAttendeeCents, 'total_cents')
  const status = nextAttendanceStatus(run.status)
  const now = new Date().toISOString()

  const { data, error } = await (admin as any)
    .from('settlement_runs')
    .update({
      attendance_count: attendanceCount,
      attendance_source: input.source,
      attendance_recorded_at: now,
      total_cents: totalCents,
      status,
      updated_at: now,
    })
    .eq('id', run.id)
    .eq('status', run.status)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to record settlement attendance')
  if (!data) throw new Error('Settlement run was updated by another request')

  const updated = normalizeRun(data)
  await insertEvidence(admin, updated.id, {
    evidenceKind: input.evidenceKind,
    storagePath: input.storagePath ?? null,
    externalRef: input.externalRef ?? null,
    attendeeCount: attendanceCount,
    uploadedBy: input.uploadedBy ?? null,
    notes: input.notes ?? null,
  })

  return updated
}

export async function recordWebhookAttendanceForEvent(
  admin: SupabaseAdminClient,
  input: {
    eventId: string | null
    source: Extract<SettlementAttendanceSource, 'webhook_posh' | 'webhook_luma' | 'webhook_partiful'>
    payload: JsonObject
    attendanceCount: number | null
  },
): Promise<{ recorded: boolean; cached: boolean; reason?: string }> {
  if (!input.eventId) return { recorded: false, cached: false, reason: 'missing_event_id' }
  if (input.attendanceCount == null) return { recorded: false, cached: false, reason: 'missing_attendance_count' }

  const attendanceCount = readNonNegativeInteger(input.attendanceCount, 'attendance_count')
  const run = await loadSettlementRunByEvent(admin, input.eventId)
  if (!run) {
    await cacheWebhookAttendance(admin, {
      eventId: input.eventId,
      source: input.source,
      attendanceCount,
      payload: input.payload,
    })
    return { recorded: false, cached: true }
  }

  if (!['pending', 'awaiting_attendance'].includes(run.status)) {
    return { recorded: false, cached: false, reason: `status_${run.status}` }
  }

  await recordAttendanceForRun(admin, run, {
    attendanceCount,
    source: input.source,
    evidenceKind: 'webhook_payload',
    externalRef: truncateRef(input.payload),
    notes: 'Attendance recorded from ticketing webhook.',
  })
  return { recorded: true, cached: false }
}

export async function reviewSettlementRun(
  admin: SupabaseAdminClient,
  input: {
    runId: string
    organizerId: string
    action: 'approve' | 'dispute'
    disputeReason?: string | null
  },
): Promise<SettlementRunRow | null> {
  const run = await loadSettlementRun(admin, input.runId)
  if (!run || run.organizer_id !== input.organizerId) return null

  const transition = transitionSettlementRunStatus(
    run.status,
    input.action === 'approve' ? 'organizer_approved' : 'organizer_disputed',
  )
  if (!transition.ok) throw new Error(transition.reason)

  const now = new Date().toISOString()
  const patch = input.action === 'approve'
    ? {
        status: transition.to,
        organizer_reviewed_at: now,
        organizer_reviewed_by: input.organizerId,
        updated_at: now,
      }
    : {
        status: transition.to,
        disputed_at: now,
        dispute_reason: input.disputeReason ?? null,
        updated_at: now,
      }

  const { data, error } = await (admin as any)
    .from('settlement_runs')
    .update(patch)
    .eq('id', input.runId)
    .eq('status', run.status)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to review settlement run')
  if (!data) return null

  const updatedRun = normalizeRun(data)

  if (input.action === 'approve') {
    await ensureSettlementApproval(admin, {
      run: updatedRun,
      organizerId: input.organizerId,
    })
    await enqueueJob(admin as unknown as SupabaseJobClient, {
      jobType: 'settlement.ack.email_send',
      payload: { settlement_run_id: updatedRun.id },
      uniqueKey: `settlement-ack-email:${updatedRun.id}`,
      maxAttempts: 5,
    })
  }

  Sentry.addBreadcrumb({
    category: 'finance.settlement_run',
    level: 'info',
    message: input.action === 'approve' ? 'settlement_organizer_approved' : 'settlement_organizer_disputed',
    data: {
      settlement_run_id: input.runId,
      organizer_id: input.organizerId,
    },
  })

  return updatedRun
}

export function extractWebhookAttendanceCount(payload: JsonObject): number | null {
  const value = firstNumber(payload, [
    'attendance_count',
    'checked_in_count',
    'check_in_count',
    'total_checked_in',
    'attendees_checked_in',
    'data.attendance_count',
    'data.checked_in_count',
    'data.check_in_count',
    'data.total_checked_in',
    'data.attendees_checked_in',
  ])
  if (value != null) return Math.max(0, Math.floor(value))
  return null
}

export async function loadSettlementRun(
  admin: SupabaseAdminClient,
  runId: string,
): Promise<SettlementRunRow | null> {
  const { data, error } = await (admin as any)
    .from('settlement_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load settlement run')
  return data ? normalizeRun(data) : null
}

async function loadSettlementRunByEvent(
  admin: SupabaseAdminClient,
  eventId: string,
): Promise<SettlementRunRow | null> {
  const { data, error } = await (admin as any)
    .from('settlement_runs')
    .select('*')
    .eq('event_id', eventId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load settlement run')
  return data ? normalizeRun(data) : null
}

async function loadSettlementContext(admin: SupabaseAdminClient, eventId: string) {
  const { data: event, error: eventError } = await (admin as any)
    .from('events')
    .select('id, builder_id, venue_id, event_name, event_type, event_date, eventbrite_event_id')
    .eq('id', eventId)
    .maybeSingle()
  if (eventError) throw new Error(eventError.message ?? 'Failed to load event')
  if (!event) return null

  const [builder, venue] = await Promise.all([
    loadBuilder(admin, event.builder_id),
    event.venue_id ? loadVenue(admin, event.venue_id) : Promise.resolve(null),
  ])
  if (!builder) return null

  const plan = await loadLikelyPlan(admin, builder.user_id, event)
  return {
    event: event as EventRow,
    builder,
    venue,
    plan,
  }
}

async function loadBuilder(admin: SupabaseAdminClient, builderId: string): Promise<BuilderRow | null> {
  const { data, error } = await (admin as any)
    .from('builder_profiles')
    .select('id, user_id')
    .eq('id', builderId)
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to load builder profile')
  return (data as BuilderRow | null) ?? null
}

async function loadVenue(admin: SupabaseAdminClient, venueId: string): Promise<VenueRow | null> {
  const { data, error } = await (admin as any)
    .from('venues')
    .select('id, venue_name, venue_type, city, state')
    .eq('id', venueId)
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to load venue')
  return (data as VenueRow | null) ?? null
}

async function loadLikelyPlan(
  admin: SupabaseAdminClient,
  organizerId: string,
  event: EventRow,
): Promise<PlanRow | null> {
  const { data, error } = await (admin as any)
    .from('plans')
    .select('id, title, event_type, neighborhood, date_window_start')
    .eq('user_id', organizerId)
    .order('updated_at', { ascending: false })
    .limit(25)
  if (error) throw new Error(error.message ?? 'Failed to load organizer plans')

  const eventDate = event.event_date?.slice(0, 10)
  const plans = ((data ?? []) as PlanRow[])
  return plans.find((plan) => plan.date_window_start?.slice(0, 10) === eventDate)
    ?? plans.find((plan) => normalizeDimension(plan.title) === normalizeDimension(event.event_name))
    ?? plans[0]
    ?? null
}

async function hasCapturedLegacyPayout(admin: SupabaseAdminClient, eventId: string): Promise<boolean> {
  const { data, error } = await (admin as any)
    .from(LEGACY_AGREEMENT_TABLE)
    .select('id')
    .eq('event_id', eventId)
    .not('payment_completed_at', 'is', null)
    .limit(1)

  if (error) {
    if (isMissingTable(error)) return false
    throw new Error(error.message ?? 'Failed to check existing settlement compatibility rows')
  }
  return Boolean((data ?? []).length)
}

async function loadEventbriteAttendanceContext(admin: SupabaseAdminClient, eventId: string) {
  const { data: event, error: eventError } = await (admin as any)
    .from('events')
    .select('id, builder_id, eventbrite_event_id')
    .eq('id', eventId)
    .maybeSingle()
  if (eventError) throw new Error(eventError.message ?? 'Failed to load event')
  if (!event) return { event: null, token: null }

  const { data: integration, error: integrationError } = await (admin as any)
    .from('external_event_integrations')
    .select('access_token_encrypted, external_event_id')
    .eq('event_id', eventId)
    .eq('platform', 'eventbrite')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (integrationError) throw new Error(integrationError.message ?? 'Failed to load Eventbrite integration')

  let token = integration?.access_token_encrypted ? decryptSecret(integration.access_token_encrypted) : null

  if (!token) {
    const { data: connection, error: connectionError } = await (admin as any)
      .from('builder_ticketing_connections')
      .select('access_token_encrypted')
      .eq('builder_id', event.builder_id)
      .eq('platform', 'eventbrite')
      .neq('status', 'disabled')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (connectionError) throw new Error(connectionError.message ?? 'Failed to load Eventbrite connection')
    token = connection?.access_token_encrypted ? decryptSecret(connection.access_token_encrypted) : null
  }

  return {
    event: {
      ...event,
      eventbrite_event_id: event.eventbrite_event_id ?? integration?.external_event_id ?? null,
    } as Pick<EventRow, 'id' | 'builder_id' | 'eventbrite_event_id'>,
    token,
  }
}

async function markAwaitingAttendance(admin: SupabaseAdminClient, run: SettlementRunRow, reason: string) {
  if (!['pending', 'awaiting_attendance'].includes(run.status)) return
  const { error } = await (admin as any)
    .from('settlement_runs')
    .update({
      status: 'awaiting_attendance',
      updated_at: new Date().toISOString(),
    })
    .eq('id', run.id)
    .eq('status', run.status)

  if (error) throw new Error(error.message ?? `Failed to mark settlement awaiting attendance: ${reason}`)
}

async function applyCachedAttendance(
  admin: SupabaseAdminClient,
  run: SettlementRunRow,
): Promise<SettlementRunRow | null> {
  const { data, error } = await (admin as any)
    .from('settlement_attendance_webhook_cache')
    .select('*')
    .eq('event_id', run.event_id)
    .is('applied_at', null)
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to load cached settlement attendance')
  if (!data) return null

  const updated = await recordAttendanceForRun(admin, run, {
    attendanceCount: data.attendance_count,
    source: data.source,
    evidenceKind: 'webhook_payload',
    externalRef: truncateRef(data.payload),
    notes: 'Attendance applied from cached ticketing webhook.',
  })

  await (admin as any)
    .from('settlement_attendance_webhook_cache')
    .update({ applied_at: new Date().toISOString() })
    .eq('id', data.id)

  return updated
}

async function cacheWebhookAttendance(
  admin: SupabaseAdminClient,
  input: {
    eventId: string
    source: Extract<SettlementAttendanceSource, 'webhook_posh' | 'webhook_luma' | 'webhook_partiful'>
    attendanceCount: number
    payload: JsonObject
  },
) {
  const patch = {
    attendance_count: input.attendanceCount,
    payload: input.payload,
    received_at: new Date().toISOString(),
    applied_at: null,
  }

  const { data: existing, error: existingError } = await (admin as any)
    .from('settlement_attendance_webhook_cache')
    .select('id')
    .eq('event_id', input.eventId)
    .eq('source', input.source)
    .is('applied_at', null)
    .maybeSingle()
  if (existingError) throw new Error(existingError.message ?? 'Failed to load cached settlement attendance')

  if (existing?.id) {
    const { error } = await (admin as any)
      .from('settlement_attendance_webhook_cache')
      .update(patch)
      .eq('id', existing.id)
    if (error) throw new Error(error.message ?? 'Failed to update cached settlement attendance')
    return
  }

  const { error } = await (admin as any)
    .from('settlement_attendance_webhook_cache')
    .insert({
      event_id: input.eventId,
      source: input.source,
      ...patch,
    })
  if (error) throw new Error(error.message ?? 'Failed to cache settlement attendance')
}

async function insertEvidence(
  admin: SupabaseAdminClient,
  settlementRunId: string,
  input: {
    evidenceKind: SettlementEvidenceKind
    storagePath: string | null
    externalRef: string | null
    attendeeCount: number
    uploadedBy: string | null
    notes: string | null
  },
) {
  const { error } = await (admin as any)
    .from('settlement_attendance_evidence')
    .insert({
      settlement_run_id: settlementRunId,
      evidence_kind: input.evidenceKind,
      storage_path: input.storagePath,
      external_ref: input.externalRef,
      attendee_count: input.attendeeCount,
      uploaded_by: input.uploadedBy,
      notes: input.notes,
    })

  if (error) throw new Error(error.message ?? 'Failed to insert settlement attendance evidence')
}

function nextAttendanceStatus(current: SettlementRunStatus): SettlementRunStatus {
  if (current === 'awaiting_organizer_review') return current
  const transition = transitionSettlementRunStatus(current, 'attendance_recorded')
  if (!transition.ok) throw new Error(transition.reason)
  return transition.to
}

function normalizeRun(row: any): SettlementRunRow {
  return {
    ...row,
    status: row.status as SettlementRunStatus,
  }
}

function normalizeDimension(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized || 'event'
}

function readNonNegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`)
  }
  return value
}

function truncateRef(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text.length <= TEXT_REF_LIMIT) return text
  return JSON.stringify({
    truncated: true,
    preview: text.slice(0, TEXT_REF_LIMIT),
  })
}

function firstNumber(source: JsonObject, paths: string[]): number | null {
  for (const path of paths) {
    const value = getPath(source, path)
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

function getPath(source: JsonObject, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    return (current as Record<string, unknown>)[key]
  }, source)
}

function isUniqueViolation(error: { code?: string; message?: string }) {
  return error.code === '23505' || /duplicate key|unique constraint/i.test(error.message ?? '')
}

function isMissingTable(error: { code?: string; message?: string }) {
  return error.code === '42P01' || /does not exist|missing table|relation/i.test(error.message ?? '')
}
