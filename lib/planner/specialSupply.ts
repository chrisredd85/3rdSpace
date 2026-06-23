import type {
  EventComplexity,
  Plan,
  SpecialSupplyExecutionMode,
  SpecialSupplyKind,
} from '@/lib/types/planner'

export const EVENT_COMPLEXITY_METADATA_KEY = 'event_complexity'
export const SPECIAL_SUPPLY_METADATA_KEY = 'special_supply'
export const SPECIAL_SUPPLY_COMPLEXITY = 'special_supply_required' satisfies EventComplexity

export type SpecialSupplyPack = {
  id: string
  kind: SpecialSupplyKind
  label: string
  leadLabel: string
  candidateStatusLabel: string
  searchTerms: string[]
  intakeQuestions: string[]
  quoteComparisonFields: string[]
  outreachQuoteFields: string[]
  executionModes: SpecialSupplyExecutionMode[]
}

export type SpecialSupplyMetadata = {
  kind: SpecialSupplyKind
  label: string
  intake_pack_id: string
  lead_label: string
  candidate_status_label: string
  quote_required: true
  verification_status: 'unverified_quote_required'
  search_terms: string[]
  intake_questions: string[]
  quote_comparison_fields: string[]
  outreach_quote_fields: string[]
  execution_modes: SpecialSupplyExecutionMode[]
}

export type SpecialSupplyDetection = {
  event_complexity: typeof SPECIAL_SUPPLY_COMPLEXITY
  kind: SpecialSupplyKind
  pack: SpecialSupplyPack
}

export const SPECIAL_SUPPLY_PACKS: Record<SpecialSupplyKind, SpecialSupplyPack> = {
  yacht_charter: {
    id: 'special_supply_yacht_charter',
    kind: 'yacht_charter',
    label: 'Yacht charter',
    leadLabel: 'Charter operator',
    candidateStatusLabel: 'Unverified charter lead - quote required',
    searchTerms: ['yacht charter', 'private boat charter', 'event charter', 'marina event venue'],
    intakeQuestions: [
      'Which city, marina, or boarding location should I scout from?',
      'What is the hard guest cap the charter needs to support?',
      'What date, time window, and duration on water are you targeting?',
      'What food, bar, DJ or sound, security, and check-in expectations need to be included in the quote?',
      'Do you already have a charter link or operator you want compared?',
    ],
    quoteComparisonFields: [
      'all-in charter price',
      'capacity',
      'included crew',
      'deposit',
      'cancellation and weather terms',
      'bar and alcohol rules',
      'food rules',
      'DJ and sound rules',
      'boarding location',
      'insurance and security requirements',
      'hold deadline',
      'expected profit at ticket prices',
    ],
    outreachQuoteFields: [
      'capacity',
      'total charter price',
      'deposit',
      'refund and weather terms',
      'alcohol rules',
      'food rules',
      'security requirements',
      'included crew',
      'boarding location',
      'hold deadline',
    ],
    executionModes: ['concierge_queue', 'external_checkout', 'controlled_payment'],
  },
  warehouse_party: {
    id: 'special_supply_warehouse_party',
    kind: 'warehouse_party',
    label: 'Warehouse party',
    leadLabel: 'Warehouse or production space',
    candidateStatusLabel: 'Unverified warehouse lead - quote required',
    searchTerms: ['warehouse event space', 'industrial event venue', 'loft event space'],
    intakeQuestions: [
      'Which city or neighborhood should the warehouse search start in?',
      'What is the hard guest cap and expected door flow?',
      'What date, time window, load-in, and breakdown window do you need?',
      'What sound, lighting, bar, security, and permit requirements need to be quoted?',
      'Do you already have a space link or operator you want compared?',
    ],
    quoteComparisonFields: [
      'all-in rental price',
      'capacity',
      'included staff',
      'deposit',
      'cancellation terms',
      'sound and noise rules',
      'bar and alcohol rules',
      'permit requirements',
      'security requirements',
      'load-in and breakdown windows',
      'hold deadline',
      'expected profit at ticket prices',
    ],
    outreachQuoteFields: [
      'capacity',
      'all-in rental price',
      'deposit',
      'load-in and breakdown rules',
      'noise restrictions',
      'alcohol rules',
      'permit requirements',
      'security requirements',
      'hold deadline',
    ],
    executionModes: ['concierge_queue', 'external_checkout', 'controlled_payment'],
  },
  private_estate: {
    id: 'special_supply_private_estate',
    kind: 'private_estate',
    label: 'Private estate',
    leadLabel: 'Private estate or mansion host',
    candidateStatusLabel: 'Unverified private-estate lead - quote required',
    searchTerms: ['private estate event venue', 'mansion event venue', 'private home events'],
    intakeQuestions: [
      'Which city or neighborhood should the estate search start in?',
      'What guest count, arrival pattern, and privacy level do you need?',
      'What date, time window, and quiet-hour constraints should I quote against?',
      'What catering, bar, valet, security, restroom, and cleanup needs should be included?',
      'Do you already have an estate link or host you want compared?',
    ],
    quoteComparisonFields: [
      'all-in rental price',
      'capacity',
      'included staff',
      'deposit',
      'cancellation terms',
      'food and bar rules',
      'parking or valet requirements',
      'restroom requirements',
      'security requirements',
      'quiet-hour rules',
      'hold deadline',
      'expected profit at ticket prices',
    ],
    outreachQuoteFields: [
      'capacity',
      'all-in rental price',
      'deposit',
      'food and bar rules',
      'parking or valet requirements',
      'security requirements',
      'quiet-hour rules',
      'cleanup requirements',
      'hold deadline',
    ],
    executionModes: ['concierge_queue', 'external_checkout', 'controlled_payment'],
  },
  outdoor_park: {
    id: 'special_supply_outdoor_park',
    kind: 'outdoor_park',
    label: 'Outdoor or park event',
    leadLabel: 'Outdoor site or permit lead',
    candidateStatusLabel: 'Unverified outdoor lead - permit/quote required',
    searchTerms: ['outdoor event venue', 'park event permit', 'garden event venue'],
    intakeQuestions: [
      'Which city, park, or outdoor area should I scout?',
      'What guest count and footprint do you need?',
      'What date, time window, and weather fallback should quotes assume?',
      'What permit, food, restroom, power, sound, security, and cleanup needs should be included?',
      'Do you already have a park, permit link, or site contact you want compared?',
    ],
    quoteComparisonFields: [
      'site or permit cost',
      'capacity',
      'included staff',
      'deposit',
      'weather terms',
      'permit requirements',
      'food and alcohol rules',
      'power and sound rules',
      'restroom requirements',
      'security requirements',
      'hold deadline',
      'expected profit at ticket prices',
    ],
    outreachQuoteFields: [
      'capacity',
      'site or permit cost',
      'permit requirements',
      'deposit',
      'weather terms',
      'food and alcohol rules',
      'power and sound rules',
      'restroom requirements',
      'security requirements',
      'hold deadline',
    ],
    executionModes: ['concierge_queue', 'external_checkout', 'controlled_payment'],
  },
  rooftop_buyout: {
    id: 'special_supply_rooftop_buyout',
    kind: 'rooftop_buyout',
    label: 'Rooftop buyout',
    leadLabel: 'Rooftop venue',
    candidateStatusLabel: 'Unverified rooftop lead - quote required',
    searchTerms: ['rooftop event venue', 'rooftop buyout', 'rooftop bar private event'],
    intakeQuestions: [
      'Which city or neighborhood should the rooftop search start in?',
      'What guest count and indoor fallback do you need?',
      'What date, time window, and weather policy should I quote against?',
      'What food, bar minimum, sound, security, and elevator/access needs should be included?',
      'Do you already have a rooftop link or operator you want compared?',
    ],
    quoteComparisonFields: [
      'all-in price or minimum',
      'capacity',
      'included staff',
      'deposit',
      'weather terms',
      'bar minimum or food rules',
      'sound rules',
      'security requirements',
      'access constraints',
      'hold deadline',
      'expected profit at ticket prices',
    ],
    outreachQuoteFields: [
      'capacity',
      'all-in price or minimum',
      'deposit',
      'weather terms',
      'bar minimum or food rules',
      'sound rules',
      'security requirements',
      'access constraints',
      'hold deadline',
    ],
    executionModes: ['concierge_queue', 'external_checkout', 'controlled_payment'],
  },
  nonstandard: {
    id: 'special_supply_nonstandard',
    kind: 'nonstandard',
    label: 'Special supply event',
    leadLabel: 'Special supply lead',
    candidateStatusLabel: 'Unverified special-supply lead - quote required',
    searchTerms: ['special event venue', 'private event space', 'event operator'],
    intakeQuestions: [
      'What kind of nonstandard location or supply do you need?',
      'Which city or area should I scout?',
      'What guest count, date, and time window should quotes assume?',
      'What operating needs, restrictions, and backup plans should be included?',
      'Do you already have a link or provider you want compared?',
    ],
    quoteComparisonFields: [
      'all-in price',
      'capacity',
      'included staff',
      'deposit',
      'cancellation terms',
      'operating restrictions',
      'insurance or permit requirements',
      'security requirements',
      'hold deadline',
      'expected profit at ticket prices',
    ],
    outreachQuoteFields: [
      'capacity',
      'all-in price',
      'deposit',
      'cancellation terms',
      'operating restrictions',
      'insurance or permit requirements',
      'security requirements',
      'hold deadline',
    ],
    executionModes: ['concierge_queue', 'external_checkout', 'controlled_payment'],
  },
}

const SPECIAL_SUPPLY_PATTERNS: Array<{ kind: SpecialSupplyKind; patterns: RegExp[] }> = [
  {
    kind: 'yacht_charter',
    patterns: [
      /\b(yacht|boat|charter|catamaran|cruise|marina|boarding\s+location|on\s+the\s+water)\b/i,
    ],
  },
  {
    kind: 'warehouse_party',
    patterns: [
      /\b(warehouse|industrial\s+(space|party|venue)|loft\s+warehouse|underground\s+party)\b/i,
    ],
  },
  {
    kind: 'private_estate',
    patterns: [
      /\b(mansion|private\s+estate|estate\s+dinner|private\s+home|villa)\b/i,
    ],
  },
  {
    kind: 'outdoor_park',
    patterns: [
      /\b(outdoor\s+park|park\s+event|public\s+park|garden\s+event|outdoor\s+festival|picnic\s+permit)\b/i,
    ],
  },
  {
    kind: 'rooftop_buyout',
    patterns: [
      /\b(rooftop\s+buyout|rooftop\s+(party|event|dinner|bar|venue)|roof\s+deck)\b/i,
    ],
  },
]

export function detectSpecialSupplyFromText(text: string): SpecialSupplyDetection | null {
  for (const entry of SPECIAL_SUPPLY_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      return {
        event_complexity: SPECIAL_SUPPLY_COMPLEXITY,
        kind: entry.kind,
        pack: SPECIAL_SUPPLY_PACKS[entry.kind],
      }
    }
  }

  if (/\b(nonstandard|special\s+supply|unusual\s+venue|quote\s+required)\b/i.test(text)) {
    return {
      event_complexity: SPECIAL_SUPPLY_COMPLEXITY,
      kind: 'nonstandard',
      pack: SPECIAL_SUPPLY_PACKS.nonstandard,
    }
  }

  return null
}

export function buildSpecialSupplyMetadata(pack: SpecialSupplyPack): SpecialSupplyMetadata {
  return {
    kind: pack.kind,
    label: pack.label,
    intake_pack_id: pack.id,
    lead_label: pack.leadLabel,
    candidate_status_label: pack.candidateStatusLabel,
    quote_required: true,
    verification_status: 'unverified_quote_required',
    search_terms: pack.searchTerms,
    intake_questions: pack.intakeQuestions,
    quote_comparison_fields: pack.quoteComparisonFields,
    outreach_quote_fields: pack.outreachQuoteFields,
    execution_modes: pack.executionModes,
  }
}

export function mergeSpecialSupplyMetadata(
  metadata: unknown,
  userMessage: string
): Record<string, unknown> | null {
  const detection = detectSpecialSupplyFromText(userMessage)
  if (!detection) return null

  const current = readRecord(metadata) ?? {}
  const specialSupply = buildSpecialSupplyMetadata(detection.pack)
  const eventRequirements = {
    ...(readRecord(current.event_requirements) ?? {}),
    special_supply_kind: detection.kind,
    verified_quote_required: true,
    candidate_status_label: detection.pack.candidateStatusLabel,
  }
  const matchingSignals = {
    ...(readRecord(current.matching_signals) ?? {}),
    special_supply_kind: detection.kind,
    verified_quote_required: true,
  }

  return {
    ...current,
    [EVENT_COMPLEXITY_METADATA_KEY]: SPECIAL_SUPPLY_COMPLEXITY,
    [SPECIAL_SUPPLY_METADATA_KEY]: specialSupply,
    event_requirements: eventRequirements,
    matching_signals: matchingSignals,
  }
}

export function readEventComplexityFromMetadata(metadata: unknown): EventComplexity {
  const record = readRecord(metadata)
  return record?.[EVENT_COMPLEXITY_METADATA_KEY] === SPECIAL_SUPPLY_COMPLEXITY
    ? SPECIAL_SUPPLY_COMPLEXITY
    : 'standard'
}

export function readSpecialSupplyMetadata(metadata: unknown): SpecialSupplyMetadata | null {
  const record = readRecord(metadata)
  const specialSupply = readRecord(record?.[SPECIAL_SUPPLY_METADATA_KEY])
  if (!specialSupply) return null
  const kind = readSpecialSupplyKind(specialSupply.kind)
  if (!kind) return null
  const pack = SPECIAL_SUPPLY_PACKS[kind]

  return {
    ...buildSpecialSupplyMetadata(pack),
    ...specialSupply,
    kind,
    quote_required: true,
    verification_status: 'unverified_quote_required',
    search_terms: readStringArray(specialSupply.search_terms) ?? pack.searchTerms,
    intake_questions: readStringArray(specialSupply.intake_questions) ?? pack.intakeQuestions,
    quote_comparison_fields: readStringArray(specialSupply.quote_comparison_fields) ?? pack.quoteComparisonFields,
    outreach_quote_fields: readStringArray(specialSupply.outreach_quote_fields) ?? pack.outreachQuoteFields,
    execution_modes: readExecutionModes(specialSupply.execution_modes) ?? pack.executionModes,
  }
}

export function readPlanSpecialSupply(plan: Pick<Plan, 'metadata'>): SpecialSupplyMetadata | null {
  return readSpecialSupplyMetadata(plan.metadata)
}

export function isSpecialSupplyPlan(plan: Pick<Plan, 'metadata'>): boolean {
  return readEventComplexityFromMetadata(plan.metadata) === SPECIAL_SUPPLY_COMPLEXITY && Boolean(readPlanSpecialSupply(plan))
}

export function buildSpecialSupplySearchQuery(plan: Pick<Plan, 'metadata' | 'neighborhood' | 'event_type'>): string | null {
  const specialSupply = readPlanSpecialSupply(plan)
  if (!specialSupply) return null
  const location = plan.neighborhood?.trim() || 'Bay Area'
  const firstSearchTerm = specialSupply.search_terms[0] ?? specialSupply.label
  return `${firstSearchTerm} in ${location}`
}

export function pickSpecialSupplyIntakeQuestion(plan: Pick<Plan, 'metadata' | 'guest_count' | 'neighborhood' | 'date_window_start' | 'date_window_end' | 'food_responsibility'>, conversationText: string): string | null {
  const specialSupply = readPlanSpecialSupply(plan)
  if (!specialSupply) return null

  if (!plan.neighborhood) return specialSupply.intake_questions[0] ?? null
  if (!plan.guest_count) return specialSupply.intake_questions[1] ?? null
  if (!plan.date_window_start && !plan.date_window_end) return specialSupply.intake_questions[2] ?? null

  const normalizedConversation = conversationText.toLowerCase()
  if (
    !plan.food_responsibility &&
    !/\b(food|bar|drink|alcohol|dj|sound|security|check[-\s]?in|permit|crew|weather|refund|deposit)\b/.test(normalizedConversation)
  ) {
    return specialSupply.intake_questions[3] ?? null
  }

  if (!/\b(link|operator|provider|already\s+have|compare)\b/.test(normalizedConversation)) {
    return specialSupply.intake_questions[4] ?? null
  }

  return null
}

export function buildSpecialSupplyTransitionPhrase(plan: Pick<Plan, 'metadata' | 'guest_count' | 'neighborhood' | 'event_type'>): string | null {
  const specialSupply = readPlanSpecialSupply(plan)
  if (!specialSupply) return null

  const location = plan.neighborhood?.trim() || 'your target area'
  const guestText = typeof plan.guest_count === 'number' && plan.guest_count > 0
    ? ` for ${plan.guest_count.toLocaleString()} guests`
    : ''
  return `I have enough to scout ${location} ${specialSupply.lead_label.toLowerCase()} leads${guestText}. I’ll label them as unverified until a provider confirms quote terms, then compare only real quotes for approval.`
}

function readSpecialSupplyKind(value: unknown): SpecialSupplyKind | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return normalized in SPECIAL_SUPPLY_PACKS ? normalized as SpecialSupplyKind : null
}

function readExecutionModes(value: unknown): SpecialSupplyExecutionMode[] | null {
  const modes = readStringArray(value)
  if (!modes) return null
  const valid = modes.filter((mode): mode is SpecialSupplyExecutionMode =>
    mode === 'concierge_queue' || mode === 'external_checkout' || mode === 'controlled_payment'
  )
  return valid.length > 0 ? valid : null
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return strings.length > 0 ? strings : null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
