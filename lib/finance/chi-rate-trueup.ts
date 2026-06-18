import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { assertCalculationBasisAllowed } from '@/lib/finance/community-host-incentive/compliance'
import { assertIntegerCents } from '@/lib/planner/execution/approvalState'

type SettlementRunRow = {
  attendance_count: number | null
  attendee_count: number | null
  verified_attendees: number | null
  total_cents: number | null
  organizer_payout_cents: number | null
}

type CurrentRateHistoryRow = {
  id: string
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

function assertRateInputAllowed(input: { archetype: string; venueType: string }): void {
  assertCalculationBasisAllowed(input.archetype.trim().toLowerCase())
  assertCalculationBasisAllowed(input.venueType.trim().toLowerCase())
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
  input: {
    organizerId: string
    archetype: string
    venueType: string
  },
): Promise<{ newRateCents: number; supersededHistoryId: string | null }> {
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
    return { newRateCents: 0, supersededHistoryId: null }
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
    return { newRateCents: 0, supersededHistoryId: null }
  }

  const newRateCents = assertIntegerCents(
    Math.round(totalCents / totalAttendance),
    'newRateCents',
  )

  const currentQuery = db
    .from('chi_rate_history')
    .select('id')
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

  const now = new Date().toISOString()
  let supersededHistoryId: string | null = null

  if (currentRate) {
    const updateQuery = db
      .from('chi_rate_history')
      .update({ superseded_at: now })
      .eq('id', currentRate.id)
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
      per_attendee_cents: newRateCents,
      derived_from_event_count: (settlementRuns ?? []).length,
      effective_from: now,
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

  return { newRateCents, supersededHistoryId }
}
