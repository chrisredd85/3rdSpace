import type { Json, Plan } from '@/lib/types'
import { getPlanCanonicalEventId } from '@/lib/planner/eventIdentity'

export type PlannerVenueSelectionDb = { from: (table: string) => any }

export type VenueTermType = 'flat_rental' | 'minimum_spend' | 'per_head_chi' | 'bar_chi' | 'no_charge' | 'tbd'

export interface SelectedPlanVenueLine {
  id: string
  venue_id: string
  reference_id: string
  type: 'venue'
  external_name: string
  venue_type: string | null
  city: string | null
  state: string | null
  standing_capacity: number | null
  seated_capacity: number | null
  price_cents: number | null
  term_type: VenueTermType
  amount_cents: number | null
  source_event_id: string | null
  rate_source: string
  claim_status: string | null
  is_claimed: boolean | null
  invited_at: string | null
  [key: string]: Json | undefined
}

export async function attachVenueToActivePlan(
  db: PlannerVenueSelectionDb,
  input: {
    planId: string
    organizerUserId: string
    venueId: string
    termType?: VenueTermType | null
    amountCents?: number | null
  }
): Promise<{ ok: true; plan: Plan; selectedVenue: SelectedPlanVenueLine } | { ok: false; error: string }> {
  const { data: plan, error: planError } = await db
    .from('plans')
    .select('*')
    .eq('id', input.planId)
    .eq('user_id', input.organizerUserId)
    .maybeSingle()

  if (planError || !plan) {
    return { ok: false, error: 'Plan not found.' }
  }

  const { data: venue, error: venueError } = await db
    .from('venues')
    .select('id, venue_name, venue_type, city, state, standing_capacity, seated_capacity, claim_status, is_claimed, invited_at')
    .eq('id', input.venueId)
    .maybeSingle()

  if (venueError || !venue) {
    return { ok: false, error: 'Venue not found.' }
  }

  const sourceEventId = getPlanSourceEventId(plan as Plan)
  const selectedVenue = buildSelectedVenueLine({
    venue: venue as Record<string, unknown>,
    termType: input.termType ?? 'tbd',
    amountCents: input.amountCents ?? null,
    sourceEventId,
  })
  const nextMetadata = mergeSelectedVenueIntoMetadata((plan as Plan).metadata, selectedVenue)

  const { data: updatedPlan, error: updateError } = await db
    .from('plans')
    .update({ metadata: nextMetadata as Json })
    .eq('id', input.planId)
    .eq('user_id', input.organizerUserId)
    .select('*')
    .single()

  if (updateError || !updatedPlan) {
    return { ok: false, error: 'Could not attach venue to plan.' }
  }

  return { ok: true, plan: updatedPlan as Plan, selectedVenue }
}

export function buildSelectedVenueLine(input: {
  venue: Record<string, unknown>
  termType: VenueTermType
  amountCents: number | null
  sourceEventId: string | null
}): SelectedPlanVenueLine {
  const venueId = readString(input.venue.id) ?? ''
  return {
    id: venueId,
    venue_id: venueId,
    reference_id: venueId,
    type: 'venue',
    external_name: readString(input.venue.venue_name) ?? readString(input.venue.name) ?? 'Venue',
    venue_type: readString(input.venue.venue_type),
    city: readString(input.venue.city),
    state: readString(input.venue.state),
    standing_capacity: readNumber(input.venue.standing_capacity),
    seated_capacity: readNumber(input.venue.seated_capacity),
    price_cents: estimateVenuePriceCents(input.amountCents, input.termType),
    term_type: input.termType,
    amount_cents: input.amountCents,
    source_event_id: input.sourceEventId,
    rate_source: 'organizer_entered',
    claim_status: readString(input.venue.claim_status),
    is_claimed: readBoolean(input.venue.is_claimed),
    invited_at: readString(input.venue.invited_at),
  }
}

export function mergeSelectedVenueIntoMetadata(metadataValue: unknown, selectedVenue: Record<string, unknown>) {
  const metadata = readRecord(metadataValue) ?? {}
  const shoppingList = readRecord(metadata.shopping_list) ?? {}

  return {
    ...metadata,
    shopping_list: {
      ...shoppingList,
      selected_venue: selectedVenue,
      updated_at: new Date().toISOString(),
    },
  }
}

export function getPlanSourceEventId(plan: Plan) {
  return getPlanCanonicalEventId(plan)
}

function estimateVenuePriceCents(amountCents: number | null, termType: VenueTermType) {
  if (typeof amountCents !== 'number') return null
  if (termType === 'per_head_chi' || termType === 'bar_chi') return -Math.abs(amountCents)
  if (termType === 'no_charge') return 0
  return amountCents
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}
