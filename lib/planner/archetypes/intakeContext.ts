import {
  getArchetypeByKey,
  resolveArchetypeContext,
  type ResolvedArchetypeContext,
} from '@/lib/planner/archetypes/resolveArchetype'
import {
  buildArchetypeIntakeQuestionBrief,
  type ArchetypeIntakeQuestion,
} from '@/lib/planner/archetypes/intakeQuestions'
import type { EventArchetypeConfig } from '@/lib/planner/archetypes/types'

export type ResolvedArchetypeIntakeContext = ResolvedArchetypeContext & Pick<
  EventArchetypeConfig,
  | 'preferred_venue_types'
  | 'required_amenities'
  | 'bonus_amenities'
  | 'needs_whole_venue'
  | 'catering_rule'
  | 'red_flags'
  | 'matching_fields'
  | 'default_fills'
> & {
  intake_questions: ArchetypeIntakeQuestion[]
}

export function resolveArchetypeIntakeContext(rawText: string): ResolvedArchetypeIntakeContext | null {
  const resolved = resolveArchetypeContext(rawText)
  if (!resolved) return null

  const archetype = getArchetypeByKey(resolved.key)
  if (!archetype) return null

  return {
    ...resolved,
    preferred_venue_types: archetype.preferred_venue_types,
    required_amenities: archetype.required_amenities,
    bonus_amenities: archetype.bonus_amenities,
    needs_whole_venue: archetype.needs_whole_venue,
    catering_rule: archetype.catering_rule,
    red_flags: archetype.red_flags,
    matching_fields: archetype.matching_fields,
    default_fills: archetype.default_fills,
    intake_questions: buildArchetypeIntakeQuestionBrief(archetype),
  }
}
