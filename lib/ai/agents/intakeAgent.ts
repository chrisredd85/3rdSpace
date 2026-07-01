import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { eventPlanSchema, AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'
import { buildAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'
import {
  vendorStackItemSchema,
  commercialModelSchema,
  matchingFieldSchema,
  archetypeMatchingFieldsSchema,
} from '@/lib/planner/archetypes/types'
import { normalizeVendorNeedStatus } from '@/lib/planner/vendorNeedStatus'

const intakeMessageSchema = z.object({
  role: z.string().trim().min(1),
  content: z.string().trim().min(1),
})

const intakeTicketPlatformSchema = z.enum(['eventbrite', 'luma', 'posh', 'partiful'])
const intakeBuilderHistorySchema = z.object({
  sample_size: z.number().int().nonnegative(),
  avg: z.number().nonnegative(),
  p75: z.number().nonnegative(),
  confidence: z.enum(['low', 'medium', 'high']),
  last_event_at: z.string().trim().min(1).nullable(),
})
const archetypeIntakeQuestionSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  source: z.enum(['matching_field', 'vendor_stack', 'required_amenity', 'commercial_model', 'operational_timing']),
  required: z.boolean(),
  priority: z.number().int().nonnegative(),
  field: z.string().trim().min(1).optional(),
  answer_keywords: z.array(z.string().trim().min(1)).default([]),
})

const archetypeQuestionPrioritySchema = z.object({
  critical_missing: z.array(matchingFieldSchema),
  high_signal_missing: z.array(matchingFieldSchema),
  archetype_vendor_stack: z.array(vendorStackItemSchema),
})

const archetypeAlternativeSchema = z.object({
  key: z.string().trim().min(1),
  display_name: z.string().trim().min(1),
  why: z.string().trim().min(1),
})

const archetypeResolutionSchema = z.object({
  key: z.string().trim().min(1),
  display_name: z.string().trim().min(1),
  match_strength: z.enum(['exact', 'fuzzy', 'inferred']),
  matched_alias: z.string().trim().min(1).nullable().optional(),
  alternative_archetypes: z.array(archetypeAlternativeSchema).default([]),
})

const mutationContractSchema = z.object({
  locked_archetype: z.object({
    key: z.string().trim().min(1),
    display_name: z.string().trim().min(1),
  }).nullable(),
  current_event_type: z.string().trim().min(1).nullable(),
  allowed_fields: z.array(z.string().trim().min(1)),
  suggest_only_fields: z.array(z.string().trim().min(1)),
  confirmation_required_fields: z.array(z.string().trim().min(1)),
  rules: z.array(z.string().trim().min(1)),
})

function coerceNullableString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const text = value
      .map(coerceNullableString)
      .filter((item): item is string => Boolean(item))
      .join(', ')
    return text || null
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const direct = coerceNullableString(record.summary ?? record.text ?? record.value ?? record.label ?? record.name)
    if (direct) return direct
    const text = Object.values(record)
      .map(coerceNullableString)
      .filter((item): item is string => Boolean(item))
      .join(', ')
    return text || null
  }
  return null
}

function coerceNullableInt(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null
  if (typeof value === 'string') {
    const normalized = value.replace(/[$,\s]/g, '').toLowerCase()
    const kMatch = normalized.match(/^(\d+(?:\.\d+)?)k$/)
    const numberValue = kMatch ? Number.parseFloat(kMatch[1]) * 1000 : Number.parseFloat(normalized)
    return Number.isFinite(numberValue) ? Math.max(0, Math.round(numberValue)) : null
  }
  return null
}

function coerceNullableMoneyCents(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return normalizeMajorMoneyToCents(value)
  if (typeof value === 'string') {
    const normalized = value.replace(/[$,\s]/g, '').toLowerCase()
    const kMatch = normalized.match(/^(\d+(?:\.\d+)?)k$/)
    const mMatch = normalized.match(/^(\d+(?:\.\d+)?)m$/)
    const numberValue = kMatch
      ? Number.parseFloat(kMatch[1]) * 1000
      : mMatch
        ? Number.parseFloat(mMatch[1]) * 1_000_000
        : Number.parseFloat(normalized)
    return normalizeMajorMoneyToCents(numberValue)
  }
  return null
}

function coerceNullableTicketPriceCents(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return normalizeTicketPriceToCents(value)
  if (typeof value === 'string') {
    const normalized = value.replace(/[$,\s]/g, '').toLowerCase()
    const kMatch = normalized.match(/^(\d+(?:\.\d+)?)k$/)
    const mMatch = normalized.match(/^(\d+(?:\.\d+)?)m$/)
    const numberValue = kMatch
      ? Number.parseFloat(kMatch[1]) * 1000
      : mMatch
        ? Number.parseFloat(mMatch[1]) * 1_000_000
        : Number.parseFloat(normalized)
    return normalizeTicketPriceToCents(numberValue)
  }
  return null
}

function normalizeMajorMoneyToCents(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.max(0, Math.round(value < 10000 ? value * 100 : value))
}

function normalizeTicketPriceToCents(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.max(0, Math.round(value < 1000 ? value * 100 : value))
}

function coerceNullableBoolean(value: unknown): boolean | null {
  if (value == null) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (/^(true|yes|y|ticketed|paid)$/i.test(value.trim())) return true
    if (/^(false|no|n|free|rsvp|invite|invite-only|unknown)$/i.test(value.trim())) return false
  }
  return null
}

function coerceStringArray(value: unknown): string[] {
  if (value == null) return []
  if (typeof value === 'string') return value.trim().length > 0 ? [value.trim()] : []
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => coerceStringArray(item))
      .map((item) => item.trim())
      .filter(Boolean)
  }
  const text = coerceNullableString(value)
  return text ? [text] : []
}

const nullableStringSchema = z.preprocess(coerceNullableString, z.string().trim().min(1).nullable())
const nullableIntSchema = z.preprocess(coerceNullableInt, z.number().int().nonnegative().nullable())
const nullableMoneyCentsSchema = z.preprocess(coerceNullableMoneyCents, z.number().int().nonnegative().nullable())
const nullableTicketPriceCentsSchema = z.preprocess(coerceNullableTicketPriceCents, z.number().int().nonnegative().nullable())
const nullableBooleanSchema = z.preprocess(coerceNullableBoolean, z.boolean().nullable())
const stringArraySchema = z.preprocess(coerceStringArray, z.array(z.string().trim().min(1)))
const vendorNeedStatusSchema = z.preprocess(
  (value) => normalizeVendorNeedStatus(value) ?? 'unknown',
  z.enum(['none', 'optional', 'required', 'unknown'])
)

const supplyIntentCategorySchema = z.enum([
  'activity_facility',
  'social_venue',
  'instructor_vendor',
  'watch_party',
  'special_supply',
])

const supplyIntentSchema = z.object({
  category: supplyIntentCategorySchema,
  activity_type: nullableStringSchema,
  label: z.string().trim().min(1),
  requirements: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1).default(0.7),
  source: z.enum(['intake', 'clarification', 'reply_parsing', 'manual']).default('intake'),
})

const supplyClarificationSchema = z.object({
  status: z.enum(['pending', 'resolved']),
  activity_type: z.string().trim().min(1),
  question: z.string().trim().min(1),
  options: z.array(z.object({
    category: supplyIntentCategorySchema,
    label: z.string().trim().min(1),
    description: z.string().trim().min(1),
  })).default([]),
  created_at: z.string().trim().min(1).default(() => new Date().toISOString()),
  resolved_at: z.string().trim().min(1).optional(),
})

const planRevisionSchema = z.object({
  type: z.enum([
    'negative_preference',
    'positive_preference',
    'vendor_stack_addition',
    'vendor_stack_removal',
    'date_change',
    'guest_count_change',
    'budget_change',
    'venue_swap',
    'scope_change',
  ]),
  field: z.string().trim().min(1),
  value: z.unknown(),
  source_message_excerpt: z.string().trim().min(1),
})

export const intakeExtractedFieldsSchema = z.object({
  event_type: z.string().trim().min(1).nullable(),
  guest_count: nullableIntSchema,
  neighborhood: nullableStringSchema,
  date_window_start: nullableStringSchema,
  date_window_end: nullableStringSchema,
  budget_cap_cents: nullableMoneyCentsSchema,
  ticketed: nullableBooleanSchema,
  ticket_price_target: nullableTicketPriceCentsSchema,
  food_responsibility: nullableStringSchema,
  profit_goal_cents: nullableMoneyCentsSchema,
})

/**
 * BYO ("bring your own") vendor — when the organizer is providing a vendor
 * themselves (their own DJ, a friend's photographer, etc.). Captured into
 * plan.metadata.byo_vendors so the economics pipeline can fold the cost into
 * the total and so the recommender can skip suggesting catalog options for
 * service types the organizer has already covered.
 *
 * service_type uses the canonical vendor stack vocabulary (dj, photographer,
 * catering, bartending, av_production, etc.). Lowercase underscore form.
 */
export const byoVendorSchema = z.object({
  service_type: z.string().trim().min(1).transform((s) => s.toLowerCase().replace(/[\s-]+/g, '_')),
  name: nullableStringSchema,
  cost_cents: nullableMoneyCentsSchema,
})
export type ByoVendor = z.infer<typeof byoVendorSchema>

export const intakeAgentInputSchema = z.object({
  user_message: z.string().trim().min(1),
  existing_event_plan: eventPlanSchema.nullish(),
  current_plan: z.record(z.unknown()).nullish(),
  messages: z.array(intakeMessageSchema).default([]),
  connected_platforms: z.array(intakeTicketPlatformSchema).default([]),
  builder_history: intakeBuilderHistorySchema.nullish(),
  can_match_now: z.boolean().optional().default(false),
  resolved_archetype: z.object({
    key: z.string().trim().min(1),
    display_name: z.string().trim().min(1),
    match_strength: z.enum(['exact', 'fuzzy', 'inferred']).optional(),
    matched_alias: z.string().trim().min(1).nullable().optional(),
    alternative_archetypes: z.array(archetypeAlternativeSchema).optional().default([]),
    capacity_range: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
    vendor_stack: z.array(vendorStackItemSchema),
    preferred_commercial_models: z.array(commercialModelSchema),
    preferred_venue_types: z.array(z.string().trim().min(1)).optional().default([]),
    required_amenities: z.array(z.string().trim().min(1)).optional().default([]),
    bonus_amenities: z.array(z.string().trim().min(1)).optional().default([]),
    needs_whole_venue: z.boolean().optional(),
    catering_rule: z.enum(['kitchen_required', 'outside_ok', 'either', 'na']).optional(),
    red_flags: z.array(z.string().trim().min(1)).optional().default([]),
    matching_fields: archetypeMatchingFieldsSchema.optional(),
    default_fills: z.record(z.string(), z.unknown()).optional().default({}),
    intake_questions: z.array(archetypeIntakeQuestionSchema).optional().default([]),
  }).nullable().optional(),
  archetype_resolution: archetypeResolutionSchema.nullish(),
  archetype_question_priority: archetypeQuestionPrioritySchema.nullish(),
  mutation_contract: mutationContractSchema.nullish(),
  organizer_profile: z.record(z.unknown()).nullish(),
})

export const intakeAgentOutputSchema = z.object({
  reflection: z.string().trim().min(1),
  extracted_fields: intakeExtractedFieldsSchema,
  updated_event_plan: eventPlanSchema,
  neighborhood: nullableStringSchema,
  food_drink_needs: nullableStringSchema,
  music_av_needs: nullableStringSchema,
  vibe_audience: nullableStringSchema,
  hard_constraints: stringArraySchema,
  missing_questions: z.preprocess((value) => coerceStringArray(value).slice(0, 1), z.array(z.string().trim().min(1)).max(1)),
  confidence_score: z.number().min(0).max(1),
  next_best_question: nullableStringSchema,
  assumptions_made: stringArraySchema,
  byo_vendors: z.preprocess((v) => Array.isArray(v) ? v : [], z.array(byoVendorSchema)).default([]),
  vendor_need_status: vendorNeedStatusSchema.default('unknown'),
  supply_intents: z.preprocess((v) => Array.isArray(v) ? v : [], z.array(supplyIntentSchema)).default([]),
  supply_clarification_needed: supplyClarificationSchema.nullable().optional(),
  plan_revision: planRevisionSchema.nullable().optional(),
})

export type IntakeAgentInput = z.infer<typeof intakeAgentInputSchema>
export type IntakeAgentOutput = z.infer<typeof intakeAgentOutputSchema>
export type IntakeAgentResult = AgentResult<IntakeAgentOutput>

export const intakeAgentDefinition = {
  agentName: 'intake',
  model: 'gpt-4o',
} as const

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

const INTAKE_OUTPUT_CONTRACT = {
  reflection: 'One short natural acknowledgement reflecting what the user said.',
  next_best_question: 'one conversational question string, or null when ready',
  missing_questions: ['same single question as next_best_question, or [] when ready'],
  extracted_fields: {
    event_type: null,
    guest_count: null,
    neighborhood: null,
    date_window_start: null,
    date_window_end: null,
    budget_cap_cents: null,
    ticketed: null,
    ticket_price_target: null,
    food_responsibility: null,
    profit_goal_cents: null,
  },
  updated_event_plan: {
    event_name: null,
    expected_attendance: null,
    city: null,
    venue_type: null,
    budget: null,
    event_date: null,
    monetization_model: null,
    headcount_min: null,
    headcount_max: null,
    ticket_price_target: null,
    profit_goal: null,
  },
  neighborhood: null,
  food_drink_needs: null,
  music_av_needs: null,
  vibe_audience: null,
  hard_constraints: [],
  confidence_score: 0.75,
  assumptions_made: ['string'],
  byo_vendors: [{ service_type: 'dj', name: 'optional vendor name or null', cost_cents: 50000 }],
  vendor_need_status: 'unknown',
  supply_intents: [{
    category: 'activity_facility',
    activity_type: 'tennis',
    label: 'Tennis facilities',
    requirements: {},
    confidence: 0.85,
    source: 'intake',
  }],
  supply_clarification_needed: null,
  plan_revision: null,
}

const INTAKE_SYSTEM_PROMPT = [
  'You are the 3rdPlace Intake Agent. Your voice is a sharp event operator, not a form wizard.',
  'Turn a vague event idea into a structured event draft while sounding natural and useful.',
  'Return JSON only. Do not include markdown, prose outside JSON, or raw text.',
  'The user-facing response is built from reflection plus next_best_question. Make those fields conversational and varied.',
  'Set reflection to one short clause that reflects back what the user said, using the user\'s own event words when possible. Vary the opening naturally. Do not start every positive response with "Got it"; use it sparingly. The reflection MUST use the actual neighborhood, guest count, date, and event type from current_plan or extracted_fields — never copy literal values from the examples below. The examples illustrate STRUCTURE only; substitute every concrete value with what the user actually provided. Structure examples (do not copy the words "Mission", "Dogpatch", "founders game night", "watch party", "pop-up market", "90", "next two weeks", or "next month" unless those are the user\'s actual values): "Perfect — [event_type] in [neighborhood], [date_phrase].", "Clear — [event_type] in [neighborhood] for [guest_count] [audience_word] [date_phrase].", "I\'m tracking — [event_type] in [neighborhood] [date_phrase]."',
  'Then ask exactly ONE clarifying question for the highest-priority missing field.',
  'First collect the core planning fields: event type, guest count, date/date window, and neighborhood or city area. Budget and ticketing are useful but only block matching when the archetype marks them as critical; if the user does not know their budget, continue and note that 3rdPlace will estimate from comparable events.',
  'The input includes connected_platforms, the builder ticketing platforms that are actually connected and usable for sales history.',
  'The input may include organizer_profile with organization_name, organization_type, website, social_handle, bio, event_archetype_keys, event_type_labels, preferred_amenities, preferred_ticket_platforms, and self_reported_typical_attendance collected during creator signup. Use it only as soft context for ambiguous "usual event" phrasing, trust context, ranking defaults, and cold-start attendance assumptions; never override explicit user input with profile preferences.',
  'The input may include resolved_archetype. If resolved_archetype is present, treat the event type as understood and do not ask the user to clarify event type.',
  'Exact archetype matches are locked for intake. If resolved_archetype.match_strength or archetype_resolution.match_strength is "exact", do NOT ask whether to change, confirm, or keep the event type. Move directly to the next missing intake field.',
  'The input may include archetype_resolution. If archetype_resolution.match_strength is "fuzzy" or "inferred", the first reflection must say you are treating this as archetype_resolution.display_name and mention up to two alternative_archetypes the user might have meant. Example: "I\'m treating this as a private dinner so we focus on intimate spots with private rooms. If it should feel more like a community meetup or a workshop, let me know." Then ask the next single question.',
  'If a later user message explicitly says "actually more like..." one of archetype_resolution.alternative_archetypes, treat that as an explicit reclassification request and set extracted_fields.event_type to that alternative display name.',
  'The input may include archetype_question_priority with critical_missing, high_signal_missing, and archetype_vendor_stack. Use it as the main question selector.',
  'The input includes can_match_now. When can_match_now is true, do not ask another intake question; pivot to matching by setting next_best_question to null and missing_questions to [].',
  'The input may include mutation_contract. Treat mutation_contract.locked_archetype as authoritative. You may update only mutation_contract.allowed_fields. You may suggest changes to mutation_contract.suggest_only_fields, but do not apply them.',
  'If a later message contains words like artist, VIP, green room, DJ, tickets, bar, sponsor, venue, guest list, sound check, load-in, or breakdown, treat them as operational requirements inside the locked archetype unless the user explicitly asks to change event type.',
  'If you think the event may need reclassification, set extracted_fields.event_type to null and ask a confirmation question in next_best_question instead of changing event_type.',
  'If resolved_archetype is null or missing and current_plan does not already have event_type, ask exactly one clarifying question: "Is this more of a mixer, a workshop, a dinner, or something else?" Exception: if organizer_profile has a clear event_type_labels default and the user says "usual", "same kind", or "one of my regular events", you may treat that profile event type as an assumption and say so in assumptions_made.',
  'Use resolved_archetype as the source of truth for archetype-specific intake. Its matching_fields, default_fills, vendor_stack, required_amenities, preferred_commercial_models, red_flags, and intake_questions describe what must be clarified for this type of event.',
  'When asking the next question, pull from this priority order: first the first archetype_question_priority.critical_missing field, asked in natural language using the archetype tone; then, when critical_missing is empty, the highest-impact archetype_question_priority.high_signal_missing field tied to ranking.',
  'Prefer ranking questions over venue-side operations: av_intensity before prep time, food_responsibility before load-in, music_format before door policy.',
  'If high_signal_missing still has two or more fields, you may ask one more high-signal question before transitioning to recommendations. After that, pivot.',
  'If can_match_now is true, or critical_missing is empty and the user already answered at least one high_signal field, pivot to matching: set next_best_question to null and missing_questions to [].',
  'Use archetype_question_priority.archetype_vendor_stack to phrase questions naturally. Example: "For a product launch you will usually want a photographer plus AV. Have you decided on AV intensity, or want me to factor in a typical setup?"',
  'Special supply exception workflow — if the user describes a yacht party, boat charter, warehouse party, mansion or private-estate event, outdoor park event, rooftop buyout, or similar nonstandard supply, treat normal venue matching as insufficient. Ask one specialized quote-intake question about location, hard capacity, timing, duration, food/bar, sound, weather/refund policy, security/check-in, or an existing provider link. Do not imply candidates are bookable inventory; they require verified quotes and organizer approval before any outreach, booking, or payment.',
  'Activity supply intent workflow — if the user describes an activity-based event such as tennis, pickleball, bowling, basketball, golf, Pilates, yoga, dance, cooking, or art, decide what supply the host needs before sourcing. Use supply_intents when clear: activity_facility for courts/lanes/studios/courses/ranges/places to play; social_venue for a nearby bar/restaurant/gathering place around the activity; instructor_vendor for coach/instructor/class/vendor needs; watch_party for a venue to watch a match/game. If the user only says "tennis event", "bowling event", "golf event", "Pilates event", or similar and it is ambiguous, set supply_clarification_needed with a single plain question asking whether they need a place to play, a nearby social spot, an instructor, or a place to watch. Do not pivot to Places discovery until that ambiguity is resolved.',
  'Never ask about a field that is not in resolved_archetype.matching_fields.critical or resolved_archetype.matching_fields.high_signal.',
  'Never ask about prep time, load-in, breakdown, sound-check windows, setup duration, or doors unless the user volunteers it. Those are venue-side logistics, not matching signals.',
  'After the core planning fields are present, ask the first unanswered required matching-field question from resolved_archetype.intake_questions before saying the plan is ready.',
  'For party, listening, club, showcase, screening, and music-forward archetypes, ask about DJ/music/AV/sound when the archetype indicates that need. Do not skip it just because headcount and date are known.',
  'For game outing or external checkout archetypes, ask about group tickets, external checkout path, seat budget, or section before recommendations.',
  'Do not expose internal config names unless helpful in plain language.',
  'If current_plan.neighborhood or extracted_fields.neighborhood is present, assume the city from that neighborhood when reasonable. For SF neighborhoods such as SOMA, Mission, Hayes Valley, Dogpatch, Marina, FiDi, NOPA, and Castro, assume San Francisco and do not ask which city.',
  'If connected_platforms is empty and the user explicitly mentions selling tickets, paid tickets, a ticket price, a ticketing platform, or a paid event, ask exactly: "Which ticketing platform are you using? Eventbrite, Luma, Posh, or Partiful?"',
  'Do not ask for a ticketing platform for free, RSVP-only, invite-only, non-ticketed, or unknown-ticketing events. If ticketing_model is missing and the user did not imply paid tickets, ask whether it is ticketed, RSVP-only, free, or invite-only instead.',
  'If connected_platforms has more than one platform and this event is ticketed or platform-specific, either ask which connected platform to use for this event or default to the first platform in connected_platforms as the most recently used.',
  'Do not assume historical ticket data is available when connected_platforms is empty.',
  'The input may include builder_history summarizing past ticketed attendance for this archetype. If builder_history.confidence is "medium" or "high" and the user\'s stated guest count is more than 30% below builder_history.p75, add a single follow-up note in reflection, not a question: "Quick note — your last few events sold more like 180 tickets, so I\'m pulling venues that can handle either size." Do not block intake on this and do not ask the user to revise their number.',
  'Skip any field already present in current_plan, existing_event_plan, or prior messages.',
  'Phrase the question conversationally, never as a label. Good: "How many people are you planning for?" Bad: "What is your GUEST_COUNT?"',
  'NEVER ask multiple questions in one message. NEVER list bullet options unless the user explicitly asks for examples.',
  'NEVER repeat a question the user already answered.',
  'When event type, guest count, area, date, and all required resolved_archetype.intake_questions are answered, set next_best_question to null and missing_questions to []. Make reflection a one-sentence readiness signal that uses the ACTUAL values from current_plan/extracted_fields — never copy the example verbatim. Template: "Locked in — pulling {neighborhood} venues that fit {guest_count} guests for this {event_type}." Substitute the real neighborhood, guest count, and event type. If budget is known, you may mention it. If budget is unknown, say you are using market estimates instead of blocking intake. Do not include placeholder names or example numbers (no literal "Mission", "50", or "$5k") unless those are the actual values in current_plan.',
  'Extract fields from the latest user_message and merge with current_plan and existing_event_plan.',
  'Never wipe a previously-set field unless the user explicitly contradicts it.',
  'Never invent confirmed facts. Put guesses in assumptions_made.',
  'Do not send outreach, create bookings, authorize payments, or execute any action.',
  'Extract event_name, city, neighborhood, event_date, expected_attendance, budget, monetization_model, ticket_price_target, profit_goal, headcount_min, headcount_max, venue_type, food/drink needs, music/AV needs, vibe/audience, and hard constraints when present.',
  'BYO (bring-your-own) vendors — when the user says they "already have", "bring", "use my own", or otherwise indicate a vendor they are providing outside the platform (e.g. "I already have a DJ", "my friend is shooting photos", "venue includes a bartender", "we are bringing our own caterer"), capture them in byo_vendors. Each entry must have: service_type (one of dj, photographer, videographer, catering, bartending, av_production, security, decor, check_in, instructor, music_coordinator, staffing — lowercase underscore form), name (the vendor name if the user said it, else null), cost_cents (integer cents if the user said a price, else null). When the user states a cost like "$500", "500 bucks", "$1.5k", "$1,500", convert to integer cents.',
  'BYO updates — if the user updates an existing BYO entry ("actually the DJ is $700 not $500", "the photographer is named Jane"), keep the same service_type entry and update name or cost_cents instead of adding a duplicate. Merge with current_plan.metadata.byo_vendors when present.',
  'BYO removal — if the user says they no longer have a vendor ("nevermind on the DJ, I will use the platform", "drop my photographer"), remove that entry from byo_vendors. Returning an empty array on a turn means "no BYO vendors known yet"; do NOT use empty array to remove a previously-captured BYO vendor — only omit the specific entry if the user explicitly removed it.',
  'When a BYO vendor exists for a service type, do NOT also ask the user whether they need that service from the catalog. Skip the corresponding archetype question.',
  'Set vendor_need_status as a durable plan-level vendor sourcing state: "none" when the user says no vendors are needed, the venue handles all vendor-like work, no outside vendors, or the organizer already has everything covered; "required" when 3rdPlace should source or compare vendors; "optional" when vendors are nice-to-have but not required; "unknown" only when the plan lacks enough information. If vendor_need_status is "none", do not ask catalog vendor questions.',
  'PLAN REVISION DETECTION: If the organizer message expresses a CHANGE to an already-set plan, return plan_revision. Do not treat first-time intake as a revision. Revisions include negative preference ("no tacos", "no alcohol", "exclude X"), positive preference ("Black-owned vendors", "must deliver", "near Oakland"), vendor_stack_addition ("I need flowers", "add lighting", "we need security"), vendor_stack_removal ("skip photographer"), date_change, guest_count_change, budget_change, venue_swap, and scope_change ("make it smaller", "make it more premium").',
  'For plan_revision, set type, field, value, and source_message_excerpt. Examples: "no tacos" => {type:"negative_preference", field:"excluded_cuisines", value:["tacos"], source_message_excerpt:"no tacos"}; "I need flowers" => {type:"vendor_stack_addition", field:"service_type", value:"florist", source_message_excerpt:"I need flowers"}; "move it to Berkeley" => {type:"venue_swap", field:"neighborhood", value:"Berkeley", source_message_excerpt:"move it to Berkeley"}.',
  'Vendor city widening: if the agent asked whether to widen vendor sourcing to adjacent cities and the organizer says yes, include plan_revision {type:"positive_preference", field:"vendor_out_of_city_approved", value:{approved:true, adjacent_cities:[cities mentioned or suggested]}, source_message_excerpt}. If the organizer declines, do not set the approval flag; keep city-only sourcing.',
  'Specific out-of-city vendor request: if the organizer names a vendor outside the event city ("I want Belladonna Florists in SF for my Oakland event"), include plan_revision {type:"vendor_stack_addition", field:"specific_vendor", value:{service_type, vendor_name, vendor_city}, source_message_excerpt}. This is an explicit organizer exception to the normal same-city vendor boundary.',
  'If the user changes vendor preference, cuisine, date, guest count, area, venue, budget, or terms after the field was already present in current_plan, include plan_revision even when you also update extracted_fields.',
  'Also populate extracted_fields using planner DB field names: event_type, guest_count, neighborhood, date_window_start, date_window_end, budget_cap_cents, ticketed, ticket_price_target, food_responsibility, profit_goal_cents.',
  'All monetary extracted_fields values must be integer cents.',
  'Use monetization_model values like ticketed, free, or sponsored when the user provides enough evidence.',
  'Use null for unknown EventPlan fields. Every EventPlan key must be present.',
  `Output JSON must match this contract: ${JSON.stringify(INTAKE_OUTPUT_CONTRACT)}.`,
].join('\n')

export async function runIntakeAgent(
  payload: unknown,
  client: ChatCompletionClient = openai.chat.completions
): Promise<IntakeAgentResult> {
  const startedAt = Date.now()
  const input = intakeAgentInputSchema.parse(payload)

  assertOpenAIConfigured()

  const messages: AgentMessagePayload = [
    {
      role: 'system',
      content: INTAKE_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: JSON.stringify(input),
    },
  ]

  const completion = await client.create({
    model: intakeAgentDefinition.model,
    response_format: { type: 'json_object' },
    messages,
  })

  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, intakeAgentDefinition.model, messages, content)
  if (!content) {
    throw new AgentRunExecutionError('intake returned an empty model response', metadata)
  }

  let output: IntakeAgentOutput
  try {
    output = intakeAgentOutputSchema.parse(parseJsonObject(content))
  } catch (error) {
    throw new AgentRunExecutionError(getErrorMessage(error), metadata, error)
  }

  output = suppressExactArchetypeClarification(input, output)

  return {
    agent_name: intakeAgentDefinition.agentName,
    status: 'succeeded',
    ...metadata,
    duration_ms: Date.now() - startedAt,
    output,
  }
}

function suppressExactArchetypeClarification(
  input: IntakeAgentInput,
  output: IntakeAgentOutput
): IntakeAgentOutput {
  if (!hasExactArchetypeMatch(input)) return output
  if (!isEventTypeClarification(output.next_best_question)) return output

  const fallbackQuestion = findNextArchetypeQuestion(input, output)

  return {
    ...output,
    next_best_question: fallbackQuestion,
    missing_questions: fallbackQuestion ? [fallbackQuestion] : [],
  }
}

function hasExactArchetypeMatch(input: IntakeAgentInput) {
  return input.resolved_archetype?.match_strength === 'exact' || input.archetype_resolution?.match_strength === 'exact'
}

function isEventTypeClarification(question: string | null) {
  if (!question) return false
  return /(?:should|do you want|would you like).{0,80}(?:change|switch|keep|confirm).{0,80}(?:event type|archetype|this as|founder\/operator dinner|founder dinner|operator dinner)/i.test(question)
    || /(?:change|switch|keep|confirm).{0,80}(?:event type|archetype|founder\/operator dinner|founder dinner|operator dinner)/i.test(question)
}

function findNextArchetypeQuestion(input: IntakeAgentInput, output: IntakeAgentOutput) {
  const questions = [...(input.resolved_archetype?.intake_questions ?? [])]
    .sort((first, second) => first.priority - second.priority)

  for (const question of questions) {
    if (!isQuestionFieldAnswered(question.field, input, output)) return question.prompt
  }

  return null
}

function isQuestionFieldAnswered(
  field: string | undefined,
  input: IntakeAgentInput,
  output: IntakeAgentOutput
) {
  if (!field) return false
  const normalizedField = normalizeQuestionField(field)
  const outputFields = output.extracted_fields as Record<string, unknown>
  if (hasUsableValue(outputFields[normalizedField])) return true

  const currentPlan = input.current_plan
  if (currentPlan && hasUsableValue(currentPlan[normalizedField])) return true

  const eventPlanField = toEventPlanField(normalizedField)
  const existingEventPlan = input.existing_event_plan as Record<string, unknown> | null | undefined
  if (eventPlanField && existingEventPlan && hasUsableValue(existingEventPlan[eventPlanField])) return true

  return false
}

function normalizeQuestionField(field: string) {
  if (field === 'expected_attendance') return 'guest_count'
  if (field === 'event_date') return 'date_window_start'
  if (field === 'budget') return 'budget_cap_cents'
  if (field === 'monetization_model') return 'ticketed'
  return field
}

function toEventPlanField(field: string) {
  if (field === 'guest_count') return 'expected_attendance'
  if (field === 'date_window_start') return 'event_date'
  if (field === 'budget_cap_cents') return 'budget'
  if (field === 'ticketed') return 'monetization_model'
  return field
}

function hasUsableValue(value: unknown) {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to parse intake model JSON'
}

function parseJsonObject(content: string): unknown {
  try {
    const value = JSON.parse(content) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Model response was not a JSON object')
    }
    return value
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse intake model JSON: ${error.message}`)
    }
    throw new Error('Failed to parse intake model JSON')
  }
}

/*
Example API request:

await fetch('/api/ai/agents/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agent_name: 'intake',
    payload: {
      user_message: 'I want to host a 60 person founder dinner in SF',
      existing_event_plan: null,
      organizer_profile: { organization_name: '3rdPlace Labs' }
    }
  })
})
*/
