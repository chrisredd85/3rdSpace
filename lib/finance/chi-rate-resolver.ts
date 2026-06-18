import 'server-only'

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

import { assertCalculationBasisAllowed } from '@/lib/finance/community-host-incentive/compliance'
import { assertIntegerCents } from '@/lib/planner/execution/approvalState'

export interface ChiRateResolutionInput {
  organizerId: string
  archetype: string
  venueType: string
  neighborhood: string
}

export type ChiRateSource = 'measured' | 'network_default' | 'no_rate_available'

export interface ChiRateResolution {
  perAttendeeCents: number
  source: ChiRateSource
  derivedFromEventCount: number
  notes: string
}

type MeasuredRateRow = {
  per_attendee_cents: number
  derived_from_event_count: number
}

type NetworkDefaultRateRow = {
  per_attendee_cents: number
  sample_size: number
}

function assertRateInputAllowed(input: ChiRateResolutionInput): void {
  for (const value of [input.archetype, input.venueType, input.neighborhood]) {
    assertCalculationBasisAllowed(value.trim().toLowerCase())
  }
}

function recordRateBreadcrumb(source: ChiRateSource, input: ChiRateResolutionInput, extra?: Record<string, unknown>): void {
  Sentry.addBreadcrumb({
    category: 'finance.chi_rate',
    level: source === 'no_rate_available' ? 'warning' : 'info',
    message: 'chi_rate_resolved',
    data: {
      source,
      organizer_id: input.organizerId,
      archetype: input.archetype,
      venue_type: input.venueType,
      neighborhood: input.neighborhood,
      ...extra,
    },
  })
}

/**
 * Resolves the CHI per-attendee rate for a given organizer+archetype+venue type
 * at a venue in the given neighborhood.
 *
 * Resolution order:
 * 1. Group measured rate from chi_rate_history. Requires at least two events.
 * 2. Network default from chi_network_defaults.
 * 3. No rate available. The caller must treat this as a settlement block.
 */
export async function resolveChiRate(
  db: SupabaseClient,
  input: ChiRateResolutionInput,
): Promise<ChiRateResolution> {
  assertRateInputAllowed(input)

  const measuredQuery = db
    .from('chi_rate_history')
    .select('per_attendee_cents, derived_from_event_count')
    .eq('organizer_id', input.organizerId)
    .eq('archetype', input.archetype)
    .eq('venue_type', input.venueType)
    .is('superseded_at', null)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: measuredRate, error: measuredError } = await measuredQuery as {
    data: MeasuredRateRow | null
    error: { message?: string } | null
  }

  if (measuredError) {
    throw new Error(measuredError.message ?? 'Failed to resolve CHI measured rate')
  }

  if (measuredRate && measuredRate.derived_from_event_count >= 2) {
    const perAttendeeCents = assertIntegerCents(measuredRate.per_attendee_cents, 'perAttendeeCents')
    recordRateBreadcrumb('measured', input, {
      derived_from_event_count: measuredRate.derived_from_event_count,
    })

    return {
      perAttendeeCents,
      source: 'measured',
      derivedFromEventCount: measuredRate.derived_from_event_count,
      notes: 'Using measured group CHI rate from prior settled events.',
    }
  }

  const networkQuery = db
    .from('chi_network_defaults')
    .select('per_attendee_cents, sample_size')
    .eq('archetype', input.archetype)
    .eq('venue_type', input.venueType)
    .eq('neighborhood', input.neighborhood)
    .maybeSingle()

  const { data: networkRate, error: networkError } = await networkQuery as {
    data: NetworkDefaultRateRow | null
    error: { message?: string } | null
  }

  if (networkError) {
    throw new Error(networkError.message ?? 'Failed to resolve CHI network default rate')
  }

  if (networkRate) {
    const perAttendeeCents = assertIntegerCents(networkRate.per_attendee_cents, 'perAttendeeCents')
    recordRateBreadcrumb('network_default', input, {
      measured_event_count: measuredRate?.derived_from_event_count ?? 0,
      sample_size: networkRate.sample_size,
    })

    return {
      perAttendeeCents,
      source: 'network_default',
      derivedFromEventCount: networkRate.sample_size,
      notes: measuredRate
        ? 'Measured group rate has fewer than two events; using network default.'
        : 'No measured group rate yet; using network default.',
    }
  }

  recordRateBreadcrumb('no_rate_available', input, {
    measured_event_count: measuredRate?.derived_from_event_count ?? 0,
  })

  return {
    perAttendeeCents: 0,
    source: 'no_rate_available',
    derivedFromEventCount: 0,
    notes: 'No CHI rate is available. Caller must block settlement until a rate is approved.',
  }
}
