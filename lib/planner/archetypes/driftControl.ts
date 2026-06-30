import { ARCHETYPES } from '@/lib/planner/archetypes/data'
import { getArchetypeByKey, resolveArchetypeContext, resolveArchetypeKey } from '@/lib/planner/archetypes/resolveArchetype'
import type { EventArchetypeConfig } from '@/lib/planner/archetypes/types'

export const ARCHETYPE_LOCK_METADATA_KEY = 'event_archetype_lock'
export const EVENT_REQUIREMENTS_METADATA_KEY = 'event_requirements'
export const PENDING_PLAN_CHANGE_METADATA_KEY = 'pending_plan_change'

export type ArchetypeLockSource =
  | 'initial_intake'
  | 'draft_migration'
  | 'explicit_user_reclassification'
  | 'agent_suggestion_confirmed'

export interface EventArchetypeLock {
  key: string
  display_name: string
  locked_at: string
  source: ArchetypeLockSource
}

export interface EventRequirementSignals {
  music_av: string[]
  guest_list: string[]
  vip: string[]
  food_drink: string[]
  venue_terms: string[]
  sponsor: string[]
  timing: string[]
}

export interface ArchetypeMutationContract extends Record<string, unknown> {
  locked_archetype: Pick<EventArchetypeLock, 'key' | 'display_name'> | null
  current_event_type: string | null
  allowed_fields: string[]
  suggest_only_fields: string[]
  confirmation_required_fields: string[]
  rules: string[]
}

export interface EventTypeMutationDecision {
  eventType: string | null
  lock: EventArchetypeLock | null
  shouldApply: boolean
  blockedCandidate: string | null
  requiresConfirmation: boolean
  confirmationPrompt: string | null
}

interface DecideEventTypeMutationInput {
  currentEventType: string | null
  currentMetadata: unknown
  proposedEventType: string | null
  userMessage: string
  now?: string
  source?: ArchetypeLockSource
}

const OPERATIONAL_SIGNAL_PATTERNS: Array<{
  bucket: keyof EventRequirementSignals
  label: string
  pattern: RegExp
}> = [
  { bucket: 'music_av', label: 'DJ', pattern: /\bdj\b/i },
  { bucket: 'music_av', label: 'Playback control', pattern: /\b(playback|house speakers?|premium sound|sound check|soundcheck|audio|speakers?|av|a\/v)\b/i },
  { bucket: 'guest_list', label: 'Guest-list control', pattern: /\bguest[-\s]?list|guest list control|door list|check[-\s]?in|ticket scan\b/i },
  { bucket: 'vip', label: 'Artist/VIP area', pattern: /\b(artist vip|vip|green room|green-room|artist area|holding area)\b/i },
  { bucket: 'food_drink', label: 'Food/drinks', pattern: /\b(food|drinks?|bar|venue handles drinks|cash bar|hosted bar|minimum spend|bar minimum|catering|snacks?|light bites?)\b/i },
  { bucket: 'venue_terms', label: 'Venue terms', pattern: /\b(venue terms|minimum spend|bar minimum|deposit|rental|chi|consumption share|door incentive|ticket incentive)\b/i },
  { bucket: 'sponsor', label: 'Sponsor needs', pattern: /\b(sponsor|sponsors|sponsored|brand partner)\b/i },
  { bucket: 'timing', label: 'Load-in/breakdown', pattern: /\b(load[-\s]?in|breakdown|tear[-\s]?down|setup|sound check|soundcheck|doors)\b/i },
]

const EXPLICIT_RECLASSIFICATION_PATTERNS = [
  /\b(?:actually|now|instead)\s+(?:make|change|switch|turn|reclassify|classify|call|treat)\s+(?:this|it|the event)?\s*(?:as|to|into)?\s+(?:a|an)?\b/i,
  /\b(?:make|change|switch|turn|reclassify|classify|call|treat)\s+(?:this|it|the event)\s+(?:as|to|into)\s+(?:a|an)?\b/i,
  /\bthis\s+is\s+(?:really\s+)?(?:more\s+of\s+)?(?:a|an)\b/i,
  /\bit\s+is\s+(?:really\s+)?(?:more\s+of\s+)?(?:a|an)\b/i,
]

const HIGH_IMPACT_FIELDS = [
  'event_type',
  'date_window_start',
  'date_window_end',
  'guest_count',
  'budget_cap_cents',
  'ticketed',
  'ticketing_model',
  'venue_terms',
  'metadata.ticket_price_target_cents',
  'venue',
  'vendor',
  'pricing',
]

export function readEventArchetypeLock(metadata: unknown): EventArchetypeLock | null {
  const record = readRecord(metadata)
  const rawLock = readRecord(record?.[ARCHETYPE_LOCK_METADATA_KEY])
  const key = readString(rawLock?.key)
  const displayName = readString(rawLock?.display_name)
  const lockedAt = readString(rawLock?.locked_at)
  const source = readString(rawLock?.source)

  if (!key || !displayName) return null

  return {
    key,
    display_name: displayName,
    locked_at: lockedAt ?? new Date(0).toISOString(),
    source: isArchetypeLockSource(source) ? source : 'initial_intake',
  }
}

export function createEventArchetypeLock(
  eventTypeOrText: string | null | undefined,
  source: ArchetypeLockSource = 'initial_intake',
  now = new Date().toISOString()
): EventArchetypeLock | null {
  const archetype = resolveArchetypeFromText(eventTypeOrText)
  if (!archetype) return null

  return {
    key: archetype.key,
    display_name: archetype.display_name,
    locked_at: now,
    source,
  }
}

export function decideEventTypeMutation(input: DecideEventTypeMutationInput): EventTypeMutationDecision {
  const currentLock = readEventArchetypeLock(input.currentMetadata)
  const proposed = normalizeProposedEventType(input.proposedEventType, input.userMessage)
  const existing = currentLock?.display_name ?? humanizeEventType(input.currentEventType)
  const explicitChange = isExplicitReclassificationRequest(input.userMessage)

  if (!existing && proposed) {
    const lock = createEventArchetypeLock(`${proposed} ${input.userMessage}`, input.source ?? 'initial_intake', input.now)
    return {
      eventType: lock?.display_name ?? proposed,
      lock,
      shouldApply: true,
      blockedCandidate: null,
      requiresConfirmation: false,
      confirmationPrompt: null,
    }
  }

  if (!proposed || !existing || labelsEqual(existing, proposed)) {
    return {
      eventType: existing,
      lock: currentLock ?? createEventArchetypeLock(existing, 'initial_intake', input.now),
      shouldApply: false,
      blockedCandidate: null,
      requiresConfirmation: false,
      confirmationPrompt: null,
    }
  }

  if (explicitChange) {
    const lock = createEventArchetypeLock(`${proposed} ${input.userMessage}`, input.source ?? 'explicit_user_reclassification', input.now)
    return {
      eventType: lock?.display_name ?? humanizeEventType(proposed),
      lock,
      shouldApply: true,
      blockedCandidate: null,
      requiresConfirmation: false,
      confirmationPrompt: null,
    }
  }

  if (labelsShareArchetypeFamily(existing, proposed)) {
    return {
      eventType: existing,
      lock: currentLock ?? createEventArchetypeLock(existing, 'initial_intake', input.now),
      shouldApply: false,
      blockedCandidate: null,
      requiresConfirmation: false,
      confirmationPrompt: null,
    }
  }

  const candidateLabel = humanizeEventType(proposed) ?? proposed

  return {
    eventType: existing,
    lock: currentLock ?? createEventArchetypeLock(existing, 'initial_intake', input.now),
    shouldApply: false,
    blockedCandidate: candidateLabel,
    requiresConfirmation: true,
    confirmationPrompt: `I noticed this may be closer to ${articleFor(candidateLabel)} ${candidateLabel.toLowerCase()}. Should I change the event type, or keep this as ${existing.toLowerCase()}?`,
  }
}

export function buildMutationContract(metadata: unknown, currentEventType: string | null): ArchetypeMutationContract {
  const lock = readEventArchetypeLock(metadata) ?? createEventArchetypeLock(currentEventType)

  return {
    locked_archetype: lock ? { key: lock.key, display_name: lock.display_name } : null,
    current_event_type: lock?.display_name ?? humanizeEventType(currentEventType),
    allowed_fields: [
      'guest_count',
      'neighborhood',
      'date_window_start',
      'date_window_end',
      'budget_cap_cents',
      'ticketed',
      'ticketing_model',
      'food_responsibility',
      'profit_goal_cents',
      'metadata.intended_platform',
      `metadata.${EVENT_REQUIREMENTS_METADATA_KEY}`,
    ],
    suggest_only_fields: ['event_type', `metadata.${ARCHETYPE_LOCK_METADATA_KEY}`, 'venue', 'vendor', 'terms', 'pricing'],
    confirmation_required_fields: HIGH_IMPACT_FIELDS,
    rules: [
      'Treat DJ, artist, VIP, green room, guest list, sponsors, tickets, bar, sound, load-in, and breakdown as operational requirements unless the user explicitly asks to change event type.',
      'Do not overwrite locked_archetype or event_type. Suggest a reclassification question instead.',
      'High-impact changes to event type, date, headcount, venue, budget, terms, pricing, or vendor require user confirmation when already set.',
      'The agent proposes; the user approves; the system executes.',
    ],
  }
}

export function extractEventRequirementSignals(message: string): EventRequirementSignals {
  const signals: EventRequirementSignals = {
    music_av: [],
    guest_list: [],
    vip: [],
    food_drink: [],
    venue_terms: [],
    sponsor: [],
    timing: [],
  }

  for (const signal of OPERATIONAL_SIGNAL_PATTERNS) {
    if (!signal.pattern.test(message)) continue
    signals[signal.bucket].push(signal.label)
  }

  return dedupeRequirementSignals(signals)
}

export function mergeEventRequirementSignals(metadata: unknown, message: string): Record<string, unknown> {
  const existingMetadata = readRecord(metadata) ?? {}
  const existingSignals = normalizeRequirementSignals(existingMetadata[EVENT_REQUIREMENTS_METADATA_KEY])
  const incomingSignals = extractEventRequirementSignals(message)
  const merged = dedupeRequirementSignals({
    music_av: [...existingSignals.music_av, ...incomingSignals.music_av],
    guest_list: [...existingSignals.guest_list, ...incomingSignals.guest_list],
    vip: [...existingSignals.vip, ...incomingSignals.vip],
    food_drink: [...existingSignals.food_drink, ...incomingSignals.food_drink],
    venue_terms: [...existingSignals.venue_terms, ...incomingSignals.venue_terms],
    sponsor: [...existingSignals.sponsor, ...incomingSignals.sponsor],
    timing: [...existingSignals.timing, ...incomingSignals.timing],
  })

  return {
    ...existingMetadata,
    [EVENT_REQUIREMENTS_METADATA_KEY]: merged,
  }
}

export function hasEventRequirementSignals(message: string): boolean {
  const signals = extractEventRequirementSignals(message)
  return Object.values(signals).some((values) => values.length > 0)
}

export function isExplicitReclassificationRequest(message: string): boolean {
  return EXPLICIT_RECLASSIFICATION_PATTERNS.some((pattern) => pattern.test(message))
}

export function humanizeEventType(value: string | null | undefined): string | null {
  if (!value) return null
  const archetype = resolveArchetypeFromText(value)
  if (archetype) return archetype.display_name

  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function allArchetypeKeys(): string[] {
  return ARCHETYPES.map((archetype) => archetype.key)
}

function resolveArchetypeFromText(value: string | null | undefined): EventArchetypeConfig | null {
  if (!value) return null
  const key = resolveArchetypeKey(value) ?? resolveArchetypeContext(value)?.key ?? null
  return getArchetypeByKey(key)
}

function normalizeProposedEventType(proposedEventType: string | null, userMessage: string): string | null {
  const resolved = resolveArchetypeContext(`${proposedEventType ?? ''} ${userMessage}`)
  if (resolved) return resolved.display_name
  return humanizeEventType(proposedEventType)
}

function labelsEqual(first: string, second: string): boolean {
  return normalizeLabel(first) === normalizeLabel(second)
}

function labelsShareArchetypeFamily(first: string, second: string): boolean {
  const normalizedFirst = normalizeLabel(first)
  const normalizedSecond = normalizeLabel(second)

  const families = [
    ['dinner', 'supper'],
    ['mixer', 'networking'],
    ['launch', 'product'],
    ['workshop', 'class'],
    ['panel', 'fireside'],
    ['demo', 'pitch'],
    ['meetup', 'community'],
    ['fundraiser', 'gala'],
    ['brunch', 'day party'],
    ['nightlife', 'club'],
    ['listening', 'showcase'],
    ['watch party', 'screening'],
    ['fitness', 'wellness', 'run club'],
    ['game', 'sports', 'outing'],
    ['holiday', 'reception'],
    ['retreat', 'offsite'],
  ]

  return families.some((family) => {
    const firstMatches = family.some((token) => normalizedFirst.includes(token))
    const secondMatches = family.some((token) => normalizedSecond.includes(token))
    return firstMatches && secondMatches
  })
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[_/,-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function articleFor(value: string): 'a' | 'an' {
  return /^[aeiou]/i.test(value.trim()) ? 'an' : 'a'
}

function normalizeRequirementSignals(value: unknown): EventRequirementSignals {
  const record = readRecord(value)
  return dedupeRequirementSignals({
    music_av: readStringArray(record?.music_av),
    guest_list: readStringArray(record?.guest_list),
    vip: readStringArray(record?.vip),
    food_drink: readStringArray(record?.food_drink),
    venue_terms: readStringArray(record?.venue_terms),
    sponsor: readStringArray(record?.sponsor),
    timing: readStringArray(record?.timing),
  })
}

function dedupeRequirementSignals(signals: EventRequirementSignals): EventRequirementSignals {
  return {
    music_av: unique(signals.music_av),
    guest_list: unique(signals.guest_list),
    vip: unique(signals.vip),
    food_drink: unique(signals.food_drink),
    venue_terms: unique(signals.venue_terms),
    sponsor: unique(signals.sponsor),
    timing: unique(signals.timing),
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function isArchetypeLockSource(value: string | null): value is ArchetypeLockSource {
  return value === 'initial_intake' ||
    value === 'draft_migration' ||
    value === 'explicit_user_reclassification' ||
    value === 'agent_suggestion_confirmed'
}
