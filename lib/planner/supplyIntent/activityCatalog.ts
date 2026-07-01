import type { GooglePlacesIncludedType } from '@/lib/server/google-places-client'
import type { Json, Plan } from '@/lib/types'

export const SUPPLY_INTENTS_METADATA_KEY = 'supply_intents'
export const SUPPLY_CLARIFICATION_METADATA_KEY = 'supply_clarification'

export type SupplyIntentCategory =
  | 'activity_facility'
  | 'social_venue'
  | 'instructor_vendor'
  | 'watch_party'
  | 'special_supply'

export type SupplyIntentSource = 'intake' | 'clarification' | 'reply_parsing' | 'manual'

export type SupplyClarificationStatus = 'pending' | 'resolved'

export type PlanSupplyIntent = {
  category: SupplyIntentCategory
  activity_type: string | null
  label: string
  requirements: Record<string, unknown>
  confidence: number
  source: SupplyIntentSource
}

export type SupplyClarification = {
  status: SupplyClarificationStatus
  activity_type: string
  question: string
  options: Array<{
    category: SupplyIntentCategory
    label: string
    description: string
  }>
  created_at: string
  resolved_at?: string
}

export type SupplyActivityConfig = {
  activity_type: string
  label: string
  aliases: readonly RegExp[]
  facility_types: readonly GooglePlacesIncludedType[]
  facility_queries: readonly string[]
  instructor_queries?: readonly string[]
  social_queries?: readonly string[]
  watch_queries?: readonly string[]
}

export type SupplyIntentPlacesSearch = {
  category: SupplyIntentCategory
  activity_type: string | null
  label: string
  textQuery: string
  includedType: GooglePlacesIncludedType | null
}

export const ACTIVITY_CATALOG: readonly SupplyActivityConfig[] = [
  {
    activity_type: 'tennis',
    label: 'Tennis',
    aliases: [/\btennis\b/i],
    facility_types: ['tennis_court', 'sports_club', 'sports_complex', 'sports_activity_location'],
    facility_queries: ['tennis court', 'tennis club', 'racket club', 'country club tennis'],
    instructor_queries: ['tennis coach', 'tennis instructor'],
    social_queries: ['sports bar near tennis', 'restaurant near tennis club'],
    watch_queries: ['sports bar tennis match'],
  },
  {
    activity_type: 'pickleball',
    label: 'Pickleball',
    aliases: [/\bpickle\s?ball\b/i],
    facility_types: ['tennis_court', 'sports_complex', 'sports_activity_location'],
    facility_queries: ['pickleball court', 'pickleball club', 'indoor pickleball'],
    instructor_queries: ['pickleball coach', 'pickleball instructor'],
    social_queries: ['bar near pickleball', 'restaurant near pickleball'],
  },
  {
    activity_type: 'bowling',
    label: 'Bowling',
    aliases: [/\bbowling\b/i, /\bbowling alley\b/i],
    facility_types: ['bowling_alley'],
    facility_queries: ['bowling alley', 'bowling center'],
    social_queries: ['bar near bowling alley', 'restaurant near bowling alley'],
  },
  {
    activity_type: 'basketball',
    label: 'Basketball',
    aliases: [/\bbasketball\b/i, /\bhoops\b/i],
    facility_types: ['sports_complex', 'gym', 'athletic_field', 'sports_activity_location'],
    facility_queries: ['basketball court', 'basketball gym', 'basketball recreation center'],
    instructor_queries: ['basketball coach', 'basketball trainer'],
    social_queries: ['sports bar near basketball court', 'restaurant near basketball gym'],
    watch_queries: ['sports bar basketball game'],
  },
  {
    activity_type: 'golf',
    label: 'Golf',
    aliases: [/\bgolf\b/i, /\bdriving range\b/i],
    facility_types: ['golf_course', 'indoor_golf_course', 'sports_activity_location', 'sports_complex'],
    facility_queries: ['golf course', 'driving range', 'indoor golf', 'golf simulator'],
    instructor_queries: ['golf instructor', 'golf lesson'],
    social_queries: ['bar near golf course', 'restaurant near golf course'],
  },
  {
    activity_type: 'pilates',
    label: 'Pilates',
    aliases: [/\bpilates\b/i, /\breformer\b/i],
    facility_types: ['fitness_center', 'gym', 'sports_activity_location'],
    facility_queries: ['pilates studio', 'reformer pilates studio'],
    instructor_queries: ['pilates instructor', 'pilates coach'],
    social_queries: ['cafe near pilates studio', 'restaurant near pilates studio'],
  },
  {
    activity_type: 'yoga',
    label: 'Yoga',
    aliases: [/\byoga\b/i],
    facility_types: ['fitness_center', 'gym', 'sports_activity_location'],
    facility_queries: ['yoga studio', 'yoga center'],
    instructor_queries: ['yoga instructor', 'yoga teacher'],
    social_queries: ['cafe near yoga studio', 'restaurant near yoga studio'],
  },
  {
    activity_type: 'dance',
    label: 'Dance',
    aliases: [/\bdance\b/i, /\bdancing\b/i],
    facility_types: ['fitness_center', 'sports_activity_location'],
    facility_queries: ['dance studio', 'dance class studio'],
    instructor_queries: ['dance instructor', 'dance teacher'],
    social_queries: ['bar near dance studio', 'restaurant near dance studio'],
  },
  {
    activity_type: 'cooking',
    label: 'Cooking',
    aliases: [/\bcooking\b/i, /\bculinary\b/i, /\bcooking class\b/i],
    facility_types: ['event_venue', 'cultural_center'],
    facility_queries: ['cooking class', 'culinary school', 'chef studio', 'commercial kitchen event'],
    instructor_queries: ['private chef cooking class', 'culinary instructor'],
    social_queries: ['restaurant private dining', 'wine bar cooking class'],
  },
  {
    activity_type: 'art',
    label: 'Art',
    aliases: [/\bpaint(?:ing)?\b/i, /\bart class\b/i, /\bceramic(?:s)?\b/i],
    facility_types: ['art_gallery', 'cultural_center', 'museum'],
    facility_queries: ['art studio', 'painting class', 'ceramics studio'],
    instructor_queries: ['art instructor', 'painting instructor'],
    social_queries: ['wine bar art class', 'restaurant near art studio'],
  },
] as const

const FACILITY_WORDS = /\b(court|courts|lane|lanes|studio|course|range|gym|facility|reserve|reserved|book|play|playing|private session|clinic|tournament|class)\b/i
const SOCIAL_WORDS = /\b(after|before|drinks|happy hour|bar|restaurant|nearby|near|social|hang(?:\s|-)?out|pre[-\s]?game|post[-\s]?game)\b/i
const WATCH_WORDS = /\b(watch|viewing|screening|game on|match on|finals|playoffs|tournament on tv)\b/i
const INSTRUCTOR_WORDS = /\b(instructor|coach|teacher|trainer|guided|led by|lesson|lessons|class)\b/i

export function mergeSupplyIntentMetadata(
  metadata: unknown,
  input: {
    userMessage: string
    agentIntents?: unknown
    agentClarification?: unknown
    source?: SupplyIntentSource
  }
): Record<string, unknown> | null {
  const base = { ...(readRecord(metadata) ?? {}) }
  const existingIntents = readSupplyIntentsFromMetadata(base)
  const detected = detectSupplyIntentFromText(input.userMessage, {
    existingClarification: readSupplyClarificationFromMetadata(base),
    source: input.source ?? 'intake',
  })
  const agentIntents = normalizeSupplyIntents(input.agentIntents, input.source ?? 'intake')
  const agentClarification = normalizeSupplyClarification(input.agentClarification)
  const nextIntents = mergeSupplyIntents(existingIntents, [...detected.intents, ...agentIntents])
  const clarification = agentClarification ?? detected.clarification
  let changed = false

  if (nextIntents.length > 0 && JSON.stringify(nextIntents) !== JSON.stringify(existingIntents)) {
    base[SUPPLY_INTENTS_METADATA_KEY] = nextIntents
    changed = true
  }

  const existingClarification = readSupplyClarificationFromMetadata(base)
  if (clarification && JSON.stringify(clarification) !== JSON.stringify(existingClarification)) {
    base[SUPPLY_CLARIFICATION_METADATA_KEY] = clarification
    changed = true
  }

  if (!clarification && existingClarification?.status === 'pending' && detected.resolvedClarification) {
    base[SUPPLY_CLARIFICATION_METADATA_KEY] = detected.resolvedClarification
    changed = true
  }

  return changed ? base : null
}

export function readPlanSupplyIntents(planOrMetadata: Pick<Plan, 'metadata'> | unknown): PlanSupplyIntent[] {
  const metadata = isPlanLike(planOrMetadata) ? planOrMetadata.metadata : planOrMetadata
  return readSupplyIntentsFromMetadata(metadata)
}

export function pickSupplyIntentClarificationQuestion(plan: Pick<Plan, 'metadata'>): string | null {
  const clarification = readSupplyClarificationFromMetadata(plan.metadata)
  return clarification?.status === 'pending' ? clarification.question : null
}

export function buildSupplyIntentPlacesSearches(plan: Pick<Plan, 'metadata' | 'neighborhood' | 'event_type'>): SupplyIntentPlacesSearch[] {
  const intents = readPlanSupplyIntents(plan).filter((intent) => intent.category !== 'special_supply')
  if (intents.length === 0) return []

  const area = plan.neighborhood?.trim() || 'Bay Area'
  const searches: SupplyIntentPlacesSearch[] = []

  for (const intent of intents) {
    const activity = intent.activity_type ? findActivityConfig(intent.activity_type) : null
    if (!activity) continue

    if (intent.category === 'activity_facility') {
      searches.push(...activity.facility_types.map((includedType, index) => ({
        category: intent.category,
        activity_type: activity.activity_type,
        label: `${activity.label} facilities`,
        textQuery: `${activity.facility_queries[index] ?? activity.facility_queries[0]} in ${area}`,
        includedType,
      })))
    } else if (intent.category === 'instructor_vendor') {
      for (const query of activity.instructor_queries ?? [`${activity.label} instructor`]) {
        searches.push({
          category: intent.category,
          activity_type: activity.activity_type,
          label: `${activity.label} instructors`,
          textQuery: `${query} in ${area}`,
          includedType: null,
        })
      }
    } else if (intent.category === 'watch_party') {
      for (const query of activity.watch_queries ?? [`sports bar ${activity.label}`]) {
        searches.push({
          category: intent.category,
          activity_type: activity.activity_type,
          label: `${activity.label} watch venues`,
          textQuery: `${query} in ${area}`,
          includedType: 'bar',
        })
      }
    } else if (intent.category === 'social_venue') {
      for (const query of activity.social_queries ?? [`bar near ${activity.label}`, `restaurant near ${activity.label}`]) {
        searches.push({
          category: intent.category,
          activity_type: activity.activity_type,
          label: `${activity.label} social venues`,
          textQuery: `${query} in ${area}`,
          includedType: query.includes('restaurant') ? 'restaurant' : 'bar',
        })
      }
    }
  }

  return dedupeSupplySearches(searches).slice(0, 8)
}

export async function syncPlanSupplyIntentRows(
  db: { from: (table: string) => any },
  planId: string,
  metadata: unknown
): Promise<void> {
  const intents = readPlanSupplyIntents(metadata)
  try {
    await db.from('plan_supply_intents').delete().eq('plan_id', planId)
    if (intents.length === 0) return
    const rows = intents.map((intent) => ({
      plan_id: planId,
      category: intent.category,
      activity_type: intent.activity_type,
      label: intent.label,
      requirements: intent.requirements as Json,
      confidence: intent.confidence,
      source: intent.source,
    }))
    const { error } = await db.from('plan_supply_intents').insert(rows)
    if (error) {
      console.warn('[planner.supply-intent] sync_insert_failed', { plan_id: planId, error: error.message })
    }
  } catch (error) {
    console.warn('[planner.supply-intent] sync_failed', {
      plan_id: planId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function detectSupplyIntentFromText(
  message: string,
  options: {
    existingClarification?: SupplyClarification | null
    source?: SupplyIntentSource
  } = {}
): {
  intents: PlanSupplyIntent[]
  clarification: SupplyClarification | null
  resolvedClarification: SupplyClarification | null
} {
  const text = normalizeText(message)
  const source = options.source ?? 'intake'
  const existingClarification = options.existingClarification?.status === 'pending'
    ? options.existingClarification
    : null

  if (existingClarification) {
    const resolvedCategory = resolveClarificationCategory(text)
    if (resolvedCategory) {
      const activity = findActivityConfig(existingClarification.activity_type)
      return {
        intents: activity ? [toIntent(activity, resolvedCategory, 0.9, source, { resolved_from_clarification: true })] : [],
        clarification: null,
        resolvedClarification: {
          ...existingClarification,
          status: 'resolved',
          resolved_at: new Date().toISOString(),
        },
      }
    }
  }

  const activity = findActivityInText(message)
  if (!activity) return { intents: [], clarification: null, resolvedClarification: null }

  const category = inferCategory(text)
  if (category) {
    return {
      intents: [toIntent(activity, category, 0.86, source)],
      clarification: null,
      resolvedClarification: null,
    }
  }

  return {
    intents: [],
    clarification: buildClarification(activity),
    resolvedClarification: null,
  }
}

export function normalizeSupplyIntents(value: unknown, source: SupplyIntentSource = 'intake'): PlanSupplyIntent[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): PlanSupplyIntent[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const category = normalizeCategory(record.category)
    if (!category) return []
    const activityType = readString(record.activity_type)
    const activity = activityType ? findActivityConfig(activityType) : null
    const label = readString(record.label) ?? activity?.label ?? category.replace(/_/g, ' ')
    return [{
      category,
      activity_type: activity?.activity_type ?? activityType,
      label,
      requirements: readRecord(record.requirements) ?? {},
      confidence: clampConfidence(readNumber(record.confidence) ?? 0.7),
      source: normalizeSource(record.source) ?? source,
    }]
  })
}

function normalizeSupplyClarification(value: unknown): SupplyClarification | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const status = record.status === 'resolved' ? 'resolved' : record.status === 'pending' ? 'pending' : null
  const activityType = readString(record.activity_type)
  const question = readString(record.question)
  if (!status || !activityType || !question) return null
  return {
    status,
    activity_type: activityType,
    question,
    options: Array.isArray(record.options) ? record.options.flatMap((option): SupplyClarification['options'] => {
      if (!option || typeof option !== 'object' || Array.isArray(option)) return []
      const optionRecord = option as Record<string, unknown>
      const category = normalizeCategory(optionRecord.category)
      const label = readString(optionRecord.label)
      const description = readString(optionRecord.description)
      return category && label && description ? [{ category, label, description }] : []
    }) : buildClarification(findActivityConfig(activityType) ?? ACTIVITY_CATALOG[0]).options,
    created_at: readString(record.created_at) ?? new Date().toISOString(),
    resolved_at: readString(record.resolved_at) ?? undefined,
  }
}

function buildClarification(activity: SupplyActivityConfig): SupplyClarification {
  return {
    status: 'pending',
    activity_type: activity.activity_type,
    question: `For ${activity.label.toLowerCase()}, do you need a place to play, a nearby social spot, an instructor, or a place to watch?`,
    options: [
      {
        category: 'activity_facility',
        label: 'Place to play',
        description: `Find ${activity.label.toLowerCase()} facilities first.`,
      },
      {
        category: 'social_venue',
        label: 'Nearby social spot',
        description: 'Find a bar, restaurant, or gathering place near the activity.',
      },
      {
        category: 'instructor_vendor',
        label: 'Instructor or coach',
        description: `Find a ${activity.label.toLowerCase()} instructor/vendor.`,
      },
      {
        category: 'watch_party',
        label: 'Watch party',
        description: `Find a venue showing the ${activity.label.toLowerCase()} match or event.`,
      },
    ],
    created_at: new Date().toISOString(),
  }
}

function inferCategory(text: string): SupplyIntentCategory | null {
  if (WATCH_WORDS.test(text)) return 'watch_party'
  if (INSTRUCTOR_WORDS.test(text)) return 'instructor_vendor'
  if (FACILITY_WORDS.test(text)) return 'activity_facility'
  if (SOCIAL_WORDS.test(text)) return 'social_venue'
  return null
}

function resolveClarificationCategory(text: string): SupplyIntentCategory | null {
  if (/\b(play|court|courts|lane|lanes|facility|book|reserve|range|course|studio|gym)\b/i.test(text)) return 'activity_facility'
  if (/\b(social|bar|restaurant|drinks|nearby|after|before)\b/i.test(text)) return 'social_venue'
  if (/\b(coach|instructor|lesson|class|trainer)\b/i.test(text)) return 'instructor_vendor'
  if (/\b(watch|viewing|screening)\b/i.test(text)) return 'watch_party'
  return null
}

function toIntent(
  activity: SupplyActivityConfig,
  category: SupplyIntentCategory,
  confidence: number,
  source: SupplyIntentSource,
  requirements: Record<string, unknown> = {}
): PlanSupplyIntent {
  return {
    category,
    activity_type: activity.activity_type,
    label: category === 'activity_facility'
      ? `${activity.label} facilities`
      : category === 'social_venue'
        ? `${activity.label} social venue`
        : category === 'instructor_vendor'
          ? `${activity.label} instructor`
          : category === 'watch_party'
            ? `${activity.label} watch party`
            : activity.label,
    requirements,
    confidence: clampConfidence(confidence),
    source,
  }
}

function findActivityInText(text: string): SupplyActivityConfig | null {
  return ACTIVITY_CATALOG.find((activity) => activity.aliases.some((pattern) => pattern.test(text))) ?? null
}

function findActivityConfig(activityType: string): SupplyActivityConfig | null {
  const normalized = normalizeText(activityType).replace(/\s+/g, '_')
  return ACTIVITY_CATALOG.find((activity) => activity.activity_type === normalized) ?? null
}

function readSupplyIntentsFromMetadata(metadata: unknown): PlanSupplyIntent[] {
  const record = readRecord(metadata)
  return normalizeSupplyIntents(record?.[SUPPLY_INTENTS_METADATA_KEY])
}

function readSupplyClarificationFromMetadata(metadata: unknown): SupplyClarification | null {
  const record = readRecord(metadata)
  return normalizeSupplyClarification(record?.[SUPPLY_CLARIFICATION_METADATA_KEY])
}

function mergeSupplyIntents(existing: PlanSupplyIntent[], incoming: PlanSupplyIntent[]): PlanSupplyIntent[] {
  const byKey = new Map<string, PlanSupplyIntent>()
  for (const intent of existing) byKey.set(intentKey(intent), intent)
  for (const intent of incoming) byKey.set(intentKey(intent), intent)
  return [...byKey.values()]
}

function intentKey(intent: PlanSupplyIntent) {
  return `${intent.category}:${intent.activity_type ?? ''}`
}

function dedupeSupplySearches(searches: SupplyIntentPlacesSearch[]): SupplyIntentPlacesSearch[] {
  const seen = new Set<string>()
  return searches.filter((search) => {
    const key = `${search.includedType ?? 'text'}:${normalizeText(search.textQuery)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeCategory(value: unknown): SupplyIntentCategory | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (
    normalized === 'activity_facility' ||
    normalized === 'social_venue' ||
    normalized === 'instructor_vendor' ||
    normalized === 'watch_party' ||
    normalized === 'special_supply'
  ) return normalized
  return null
}

function normalizeSource(value: unknown): SupplyIntentSource | null {
  if (value === 'intake' || value === 'clarification' || value === 'reply_parsing' || value === 'manual') return value
  return null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.7
  return Math.max(0, Math.min(1, Number(value.toFixed(3))))
}

function normalizeText(value: string) {
  return value.toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

function isPlanLike(value: unknown): value is Pick<Plan, 'metadata'> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'metadata' in value)
}
