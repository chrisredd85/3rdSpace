import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import { assertCalculationBasisAllowed } from '@/lib/finance/community-host-incentive/compliance'
import { assertIntegerCents } from '@/lib/planner/execution/approvalState'

export const DEFAULT_CHI_TRUEUP_MAX_MOVEMENT_PCT = 0.2
export const DEFAULT_CHI_TRUEUP_ALERT_THRESHOLD_PCT = 0.05

type SettlementRunRow = {
  attendance_count: number | null
  attendee_count: number | null
  verified_attendees: number | null
  total_cents: number | null
  organizer_payout_cents: number | null
}

type CurrentRateHistoryRow = {
  id: string
  per_attendee_cents: number
}

type ChiManualReviewRow = {
  id: string
  organizer_id: string
  venue_id: string
  archetype: string
  venue_type: string
  proposed_rate_cents: number
  derived_from_event_count: number
  reviewed_at: string | null
}

type ChiTrueupMovementRow = {
  movement_pct: number | null
}

type SupabaseErrorLike = {
  code?: string
  message?: string
}

export class CHIRateTrueupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CHIRateTrueupError'
  }
}

export type ChiTrueupMovementBucket = '<1%' | '1-5%' | '5-20%' | '>20%' | 'no-current-rate'

export type ChiRateTrueupResult = {
  newRateCents: number
  supersededHistoryId: string | null
  applied: boolean
  queued_for_review: boolean
  manualReviewId: string | null
  movementPct: number | null
}

type ChiRateTrueupInput = {
  organizerId: string
  venueId?: string | null
  archetype: string
  venueType: string
  settlementRunId?: string | null
  bypassCap?: boolean
}

function assertRateInputAllowed(input: { archetype: string; venueType: string }): void {
  assertCalculationBasisAllowed(input.archetype.trim().toLowerCase())
  assertCalculationBasisAllowed(input.venueType.trim().toLowerCase())
}

function readPercentEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getChiTrueupConfig() {
  return {
    maxMovementPct: readPercentEnv('CHI_TRUEUP_MAX_MOVEMENT_PCT', DEFAULT_CHI_TRUEUP_MAX_MOVEMENT_PCT),
    alertThresholdPct: readPercentEnv('CHI_TRUEUP_ALERT_THRESHOLD_PCT', DEFAULT_CHI_TRUEUP_ALERT_THRESHOLD_PCT),
  }
}

function movementBucket(movementPct: number | null): ChiTrueupMovementBucket {
  if (movementPct == null) return 'no-current-rate'
  if (movementPct < 0.01) return '<1%'
  if (movementPct < 0.05) return '1-5%'
  if (movementPct <= 0.2) return '5-20%'
  return '>20%'
}

function calculateMovementPct(currentRateCents: number | null, proposedRateCents: number): number | null {
  if (currentRateCents == null || currentRateCents <= 0) return null
  return Math.abs(proposedRateCents - currentRateCents) / currentRateCents
}

function recordSignificantMovement(input: {
  organizerId: string
  venueId?: string | null
  archetype: string
  venueType: string
  settlementRunId?: string | null
  movementPct: number
  currentRateCents: number
  proposedRateCents: number
}) {
  const bucket = movementBucket(input.movementPct)
  const data = {
    organizer_id: input.organizerId,
    venue_id: input.venueId ?? null,
    archetype: input.archetype,
    venue_type: input.venueType,
    settlement_run_id: input.settlementRunId ?? null,
    movement_pct: input.movementPct,
    current_rate_cents: input.currentRateCents,
    proposed_rate_cents: input.proposedRateCents,
    chi_trueup_movement_bucket: bucket,
  }

  console.warn('[CHI trueup] significant movement', data)
  Sentry.addBreadcrumb({
    category: 'finance.chi_trueup',
    level: 'warning',
    message: 'significant_movement',
    data,
  })
}

function isMissingSettlementRunsTable(error: SupabaseErrorLike | null): boolean {
  if (!error) return false
  return error.code === '42P01' || /settlement_runs|relation .* does not exist|table .* does not exist/i.test(error.message ?? '')
}

function readAttendanceCount(row: SettlementRunRow): number | null {
  const value = row.attendance_count ?? row.attendee_count ?? row.verified_attendees
  if (value == null || value <= 0) return null
  if (!Number.isSafeInteger(value)) {
    throw new CHIRateTrueupError('Settlement attendance count must be a safe integer')
  }
  return value
}

function readSettlementAmountCents(row: SettlementRunRow): number | null {
  const value = row.total_cents ?? row.organizer_payout_cents
  if (value == null) return null
  return assertIntegerCents(value, 'settlementAmountCents')
}

/**
 * Forward-only true-up: after a settlement run completes, recompute the group's
 * measured rate from all completed events at organizer, archetype, and venue type.
 *
 * This function does not modify any settled event. It inserts a new rate-history
 * row for future events and supersedes the prior current row with an optimistic
 * lock. Until epsilon.2 creates settlement_runs, missing-table responses are the
 * expected no-op path.
 */
export async function updateChiRateFromSettlement(
  db: SupabaseClient,
  input: ChiRateTrueupInput,
): Promise<ChiRateTrueupResult> {
  assertRateInputAllowed(input)

  const settlementQuery = db
    .from('settlement_runs')
    .select('attendance_count, attendee_count, verified_attendees, total_cents, organizer_payout_cents')
    .eq('organizer_id', input.organizerId)
    .eq('archetype', input.archetype)
    .eq('venue_type', input.venueType)
    .in('status', ['completed', 'settled'])

  const { data: settlementRuns, error: settlementError } = await settlementQuery as {
    data: SettlementRunRow[] | null
    error: SupabaseErrorLike | null
  }

  if (isMissingSettlementRunsTable(settlementError)) {
    return {
      newRateCents: 0,
      supersededHistoryId: null,
      applied: false,
      queued_for_review: false,
      manualReviewId: null,
      movementPct: null,
    }
  }

  if (settlementError) {
    throw new Error(settlementError.message ?? 'Failed to load CHI settlement runs')
  }

  let totalCents = 0
  let totalAttendance = 0

  for (const row of settlementRuns ?? []) {
    const attendanceCount = readAttendanceCount(row)
    const amountCents = readSettlementAmountCents(row)
    if (attendanceCount == null || amountCents == null) continue
    totalAttendance += attendanceCount
    totalCents += amountCents
  }

  if (totalAttendance === 0) {
    return {
      newRateCents: 0,
      supersededHistoryId: null,
      applied: false,
      queued_for_review: false,
      manualReviewId: null,
      movementPct: null,
    }
  }

  const newRateCents = assertIntegerCents(
    Math.round(totalCents / totalAttendance),
    'newRateCents',
  )

  const currentQuery = db
    .from('chi_rate_history')
    .select('id, per_attendee_cents')
    .eq('organizer_id', input.organizerId)
    .eq('archetype', input.archetype)
    .eq('venue_type', input.venueType)
    .is('superseded_at', null)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: currentRate, error: currentError } = await currentQuery as {
    data: CurrentRateHistoryRow | null
    error: SupabaseErrorLike | null
  }

  if (currentError) {
    throw new Error(currentError.message ?? 'Failed to load current CHI rate history')
  }

  const currentRateCents = currentRate
    ? assertIntegerCents(currentRate.per_attendee_cents, 'currentRateCents')
    : null
  const movementPct = calculateMovementPct(currentRateCents, newRateCents)
  const { maxMovementPct, alertThresholdPct } = getChiTrueupConfig()

  if (movementPct !== null && movementPct >= alertThresholdPct) {
    recordSignificantMovement({
      organizerId: input.organizerId,
      venueId: input.venueId,
      archetype: input.archetype,
      venueType: input.venueType,
      settlementRunId: input.settlementRunId,
      movementPct,
      currentRateCents: currentRateCents ?? 0,
      proposedRateCents: newRateCents,
    })
  }

  if (!input.bypassCap && movementPct !== null && movementPct > maxMovementPct) {
    const manualReviewId = await queueManualReview(db, {
      organizerId: input.organizerId,
      venueId: input.venueId,
      archetype: input.archetype,
      venueType: input.venueType,
      settlementRunId: input.settlementRunId,
      currentRateCents: currentRateCents ?? 0,
      proposedRateCents: newRateCents,
      movementPct,
      derivedFromEventCount: (settlementRuns ?? []).length,
    })

    Sentry.captureMessage('CHI trueup cap exceeded', {
      level: 'warning',
      tags: {
        area: 'chi_trueup',
        chi_trueup_movement_bucket: movementBucket(movementPct),
      },
      extra: {
        organizer_id: input.organizerId,
        venue_id: input.venueId ?? null,
        archetype: input.archetype,
        venue_type: input.venueType,
        settlement_run_id: input.settlementRunId ?? null,
        movement_pct: movementPct,
        current_rate_cents: currentRateCents,
        proposed_rate_cents: newRateCents,
        manual_review_id: manualReviewId,
      },
    })

    return {
      newRateCents,
      supersededHistoryId: null,
      applied: false,
      queued_for_review: true,
      manualReviewId,
      movementPct,
    }
  }

  const supersededHistoryId = await writeChiRateHistory(db, {
    organizerId: input.organizerId,
    archetype: input.archetype,
    venueType: input.venueType,
    currentRate,
    newRateCents,
    derivedFromEventCount: (settlementRuns ?? []).length,
    movementPct,
  })

  return {
    newRateCents,
    supersededHistoryId,
    applied: true,
    queued_for_review: false,
    manualReviewId: null,
    movementPct,
  }
}

async function writeChiRateHistory(
  db: SupabaseClient,
  input: {
    organizerId: string
    archetype: string
    venueType: string
    currentRate: CurrentRateHistoryRow | null
    newRateCents: number
    derivedFromEventCount: number
    movementPct: number | null
  },
): Promise<string | null> {
  const now = new Date().toISOString()
  let supersededHistoryId: string | null = null

  if (input.currentRate) {
    const updateQuery = db
      .from('chi_rate_history')
      .update({ superseded_at: now })
      .eq('id', input.currentRate.id)
      .is('superseded_at', null)
      .select('id')
      .maybeSingle()

    const { data: supersededRate, error: updateError } = await updateQuery as {
      data: CurrentRateHistoryRow | null
      error: SupabaseErrorLike | null
    }

    if (updateError) {
      throw new Error(updateError.message ?? 'Failed to supersede current CHI rate history')
    }

    if (!supersededRate) {
      throw new CHIRateTrueupError('Current CHI rate history was updated by another request')
    }

    supersededHistoryId = supersededRate.id
  }

  const insertQuery = db
    .from('chi_rate_history')
    .insert({
      organizer_id: input.organizerId,
      archetype: input.archetype,
      venue_type: input.venueType,
      per_attendee_cents: input.newRateCents,
      derived_from_event_count: input.derivedFromEventCount,
      effective_from: now,
      movement_pct: input.movementPct,
      movement_bucket: movementBucket(input.movementPct),
    })
    .select('id')
    .single()

  const { error: insertError } = await insertQuery as {
    data: { id: string } | null
    error: SupabaseErrorLike | null
  }

  if (insertError) {
    throw new Error(insertError.message ?? 'Failed to insert CHI rate history')
  }

  return supersededHistoryId
}

async function queueManualReview(
  db: SupabaseClient,
  input: {
    organizerId: string
    venueId?: string | null
    archetype: string
    venueType: string
    settlementRunId?: string | null
    currentRateCents: number
    proposedRateCents: number
    movementPct: number
    derivedFromEventCount: number
  },
): Promise<string> {
  if (!input.venueId) {
    throw new CHIRateTrueupError('Venue id is required to queue CHI true-up manual review')
  }

  const insertQuery = db
    .from('chi_trueup_manual_review')
    .insert({
      organizer_id: input.organizerId,
      venue_id: input.venueId,
      archetype: input.archetype,
      venue_type: input.venueType,
      current_rate_cents: input.currentRateCents,
      proposed_rate_cents: input.proposedRateCents,
      movement_pct: input.movementPct,
      movement_bucket: movementBucket(input.movementPct),
      derived_from_event_count: input.derivedFromEventCount,
      triggering_settlement_run_id: input.settlementRunId ?? null,
      reason: 'movement_cap_exceeded',
    })
    .select('id')
    .single()

  const { data, error } = await insertQuery as {
    data: { id: string } | null
    error: SupabaseErrorLike | null
  }

  if (error) {
    throw new Error(error.message ?? 'Failed to queue CHI true-up manual review')
  }

  if (!data?.id) {
    throw new Error('CHI true-up manual review insert did not return an id')
  }

  return data.id
}

export async function reviewChiTrueupManualReview(
  db: SupabaseClient,
  input: {
    reviewId: string
    reviewerUserId: string
    decision: 'approve' | 'reject' | 'adjust'
    adjustedRateCents?: number | null
    reviewNotes?: string | null
  },
): Promise<{ applied: boolean; appliedRateCents: number | null; supersededHistoryId: string | null }> {
  const { data: review, error: reviewError } = await db
    .from('chi_trueup_manual_review')
    .select('id, organizer_id, venue_id, archetype, venue_type, proposed_rate_cents, derived_from_event_count, reviewed_at')
    .eq('id', input.reviewId)
    .is('reviewed_at', null)
    .maybeSingle() as {
      data: ChiManualReviewRow | null
      error: SupabaseErrorLike | null
    }

  if (reviewError) {
    throw new Error(reviewError.message ?? 'Failed to load CHI true-up manual review')
  }

  if (!review) {
    throw new CHIRateTrueupError('CHI true-up manual review was already reviewed or does not exist')
  }

  let appliedRateCents: number | null = null
  let supersededHistoryId: string | null = null

  if (input.decision === 'approve' || input.decision === 'adjust') {
    if (input.decision === 'adjust') {
      if (input.adjustedRateCents == null) {
        throw new CHIRateTrueupError('Adjusted rate is required when adjusting a CHI true-up review')
      }
      appliedRateCents = assertIntegerCents(input.adjustedRateCents, 'adjustedRateCents')
    } else {
      appliedRateCents = assertIntegerCents(review.proposed_rate_cents, 'proposedRateCents')
    }

    const { data: currentRate, error: currentError } = await db
      .from('chi_rate_history')
      .select('id, per_attendee_cents')
      .eq('organizer_id', review.organizer_id)
      .eq('archetype', review.archetype)
      .eq('venue_type', review.venue_type)
      .is('superseded_at', null)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle() as {
        data: CurrentRateHistoryRow | null
        error: SupabaseErrorLike | null
      }

    if (currentError) {
      throw new Error(currentError.message ?? 'Failed to load current CHI rate history')
    }

    const movementPct = calculateMovementPct(currentRate?.per_attendee_cents ?? null, appliedRateCents)
    supersededHistoryId = await writeChiRateHistory(db, {
      organizerId: review.organizer_id,
      archetype: review.archetype,
      venueType: review.venue_type,
      currentRate,
      newRateCents: appliedRateCents,
      derivedFromEventCount: review.derived_from_event_count,
      movementPct,
    })
  }

  const { error: updateError } = await db
    .from('chi_trueup_manual_review')
    .update({
      reviewed_at: new Date().toISOString(),
      reviewed_by: input.reviewerUserId,
      applied: input.decision !== 'reject',
      applied_rate_cents: appliedRateCents,
      review_notes: input.reviewNotes ?? null,
    })
    .eq('id', review.id)
    .is('reviewed_at', null)

  if (updateError) {
    throw new Error(updateError.message ?? 'Failed to mark CHI true-up manual review reviewed')
  }

  return {
    applied: input.decision !== 'reject',
    appliedRateCents,
    supersededHistoryId,
  }
}

export async function logChiTrueupDailySummary(db: SupabaseClient, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  const [rateHistoryResult, manualReviewResult] = await Promise.all([
    db
      .from('chi_rate_history')
      .select('movement_pct')
      .gte('created_at', since),
    db
      .from('chi_trueup_manual_review')
      .select('movement_pct')
      .gte('created_at', since),
  ]) as Array<{
    data: ChiTrueupMovementRow[] | null
    error: SupabaseErrorLike | null
  }>

  if (rateHistoryResult.error) {
    throw new Error(rateHistoryResult.error.message ?? 'Failed to load CHI true-up rate history summary')
  }
  if (manualReviewResult.error) {
    throw new Error(manualReviewResult.error.message ?? 'Failed to load CHI true-up manual review summary')
  }

  const appliedMovements = (rateHistoryResult.data ?? [])
    .map((row) => row.movement_pct)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const queuedMovements = (manualReviewResult.data ?? [])
    .map((row) => row.movement_pct)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const movements = [...appliedMovements, ...queuedMovements]
  const total = (rateHistoryResult.data ?? []).length + (manualReviewResult.data ?? []).length
  const meanMovementPct = movements.length
    ? movements.reduce((sum, value) => sum + value, 0) / movements.length
    : 0
  const maxMovementPct = movements.length ? Math.max(...movements) : 0

  const summary = {
    trueup_runs_last_24h: total,
    applied_last_24h: (rateHistoryResult.data ?? []).length,
    queued_for_review_last_24h: (manualReviewResult.data ?? []).length,
    mean_movement_pct: meanMovementPct,
    max_movement_pct: maxMovementPct,
  }

  console.info('[CHI trueup] daily summary', summary)
  Sentry.addBreadcrumb({
    category: 'finance.chi_trueup',
    level: maxMovementPct > DEFAULT_CHI_TRUEUP_ALERT_THRESHOLD_PCT ? 'warning' : 'info',
    message: 'daily_summary',
    data: summary,
  })

  return summary
}
