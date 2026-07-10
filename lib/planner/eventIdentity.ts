import { resolveArchetypeKey } from '@/lib/planner/archetypes'
import type { Plan } from '@/lib/types'

/**
 * Canonical event taxonomy for planner-materialized events.
 *
 * The events constraint is widened by Prompt 7 to preserve every planner
 * archetype verbatim. Keeping this mapping explicit makes taxonomy drift a
 * compile/test failure instead of silently collapsing a format to `other`.
 */
export const CANONICAL_EVENT_TYPE_BY_ARCHETYPE = {
  networking_mixer: 'networking_mixer',
  founder_operator_dinner: 'founder_operator_dinner',
  brand_product_launch: 'brand_product_launch',
  pop_up_activation: 'pop_up_activation',
  workshop_class: 'workshop_class',
  panel_fireside: 'panel_fireside',
  demo_day_pitch_night: 'demo_day_pitch_night',
  hackathon: 'hackathon',
  community_meetup: 'community_meetup',
  fundraiser_gala: 'fundraiser_gala',
  private_dinner_celebration: 'private_dinner_celebration',
  day_party_brunch_party: 'day_party_brunch_party',
  nightlife_club_night: 'nightlife_club_night',
  listening_party_showcase: 'listening_party_showcase',
  watch_party_screening: 'watch_party_screening',
  fitness_wellness_run_club: 'fitness_wellness_run_club',
  game_sports_outing: 'game_sports_outing',
  holiday_reception: 'holiday_reception',
  retreat_offsite: 'retreat_offsite',
} as const

export type PlannerArchetypeKey = keyof typeof CANONICAL_EVENT_TYPE_BY_ARCHETYPE
export type CanonicalPlannerEventType = (typeof CANONICAL_EVENT_TYPE_BY_ARCHETYPE)[PlannerArchetypeKey]

export interface CanonicalEventTaxonomy {
  archetypeKey: PlannerArchetypeKey
  eventType: CanonicalPlannerEventType
}

export function isPlannerArchetypeKey(value: string): value is PlannerArchetypeKey {
  return Object.prototype.hasOwnProperty.call(CANONICAL_EVENT_TYPE_BY_ARCHETYPE, value)
}

/** Resolves existing planner copy/aliases without ever choosing a fallback. */
export function resolveCanonicalEventTaxonomy(eventType: string | null | undefined): CanonicalEventTaxonomy | null {
  if (!eventType) return null
  const archetypeKey = resolveArchetypeKey(eventType)
  if (!archetypeKey || !isPlannerArchetypeKey(archetypeKey)) return null

  return {
    archetypeKey,
    eventType: CANONICAL_EVENT_TYPE_BY_ARCHETYPE[archetypeKey],
  }
}

/**
 * Returns the event linked to a plan by the canonical FK, with the old metadata
 * projection retained only for pre-Prompt-7 rows.
 *
 * This is lineage, not authority: callers must never treat an event ID as
 * proof that a booking, outbound message, or payment was approved.
 */
export function getPlanCanonicalEventId(
  plan: Pick<Plan, 'materialized_event_id' | 'metadata'>
): string | null {
  const materializedEventId = readNonEmptyString(plan.materialized_event_id)
  if (materializedEventId) return materializedEventId

  const metadata = readRecord(plan.metadata)
  return readNonEmptyString(metadata?.event_id)
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
