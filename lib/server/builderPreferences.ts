import { ARCHETYPES, getArchetypeByKey, resolveArchetypeMatch } from '@/lib/planner/archetypes'
import type { TicketPlatform } from '@/lib/constants/account-setup'

type SupabaseLikeClient = { from: (table: string) => any }

export type BuilderOrganizerPreferences = {
  builder_id: string
  event_archetype_keys: string[]
  event_type_labels: string[]
  preferred_amenities: string[]
  preferred_ticket_platforms: TicketPlatform[]
}

const LEGACY_EVENT_TYPE_MAP: Record<string, string> = {
  concerts: 'listening_party_showcase',
  networking: 'networking_mixer',
  'pop ups': 'pop_up_activation',
  popups: 'pop_up_activation',
  'brand activations': 'brand_product_launch',
  workshops: 'workshop_class',
  'community gatherings': 'community_meetup',
  'private events': 'private_dinner_celebration',
  fundraisers: 'fundraiser_gala',
}

const AMENITY_PREFERENCE_CONCEPTS: Record<string, string[]> = {
  'private semi private room': ['private room', 'semi-private room'],
  'full bar': ['full bar'],
  'av microphones': ['av', 'microphones'],
  'stage speaker area': ['stage', 'speaker area'],
  'screen projector': ['screen', 'projector'],
  'work tables': ['work tables'],
  'outdoor patio': ['outdoor space', 'patio'],
  'kitchen catering allowed': ['kitchen', 'catering allowed'],
  'check in area': ['check-in area'],
  'load in access': ['load-in access'],
}

const ticketPlatformSet = new Set<TicketPlatform>(['eventbrite', 'luma', 'posh', 'partiful'])

export function normalizeBuilderEventTypes(values: string[] | null | undefined): string[] {
  const keys = (values ?? [])
    .map((value) => {
      const normalized = normalizePreferenceText(value)
      if (!normalized) return null
      const mapped = LEGACY_EVENT_TYPE_MAP[normalized]
      if (mapped) return mapped
      const match = resolveArchetypeMatch(value)
      return match?.key ?? null
    })
    .filter((value): value is string => Boolean(value))

  return unique(keys)
}

export function normalizeBuilderAmenityPreferences(values: string[] | null | undefined): string[] {
  const concepts = (values ?? []).flatMap((value) => {
    const normalized = normalizePreferenceText(value)
    if (!normalized) return []
    return AMENITY_PREFERENCE_CONCEPTS[normalized] ?? [value.trim()]
  })

  return unique(concepts)
}

export async function loadBuilderOrganizerPreferences(
  db: SupabaseLikeClient,
  userId: string
): Promise<BuilderOrganizerPreferences | null> {
  const { data, error } = await db
    .from('builder_profiles')
    .select('id, event_types, priorities, preferred_ticket_platforms')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.warn('[builder.preferences] Failed to load builder profile preferences', error)
    return null
  }

  const row = data as {
    id?: unknown
    event_types?: unknown
    priorities?: unknown
    preferred_ticket_platforms?: unknown
  } | null

  if (!row || typeof row.id !== 'string') return null

  const eventArchetypeKeys = normalizeBuilderEventTypes(readStringArray(row.event_types))
  const preferredAmenities = normalizeBuilderAmenityPreferences(readStringArray(row.priorities))
  const preferredTicketPlatforms = readStringArray(row.preferred_ticket_platforms)
    .filter((platform): platform is TicketPlatform => ticketPlatformSet.has(platform as TicketPlatform))

  return {
    builder_id: row.id,
    event_archetype_keys: eventArchetypeKeys,
    event_type_labels: eventArchetypeKeys
      .map((key) => getArchetypeByKey(key)?.display_name)
      .filter((label): label is string => Boolean(label)),
    preferred_amenities: preferredAmenities,
    preferred_ticket_platforms: preferredTicketPlatforms,
  }
}

export function buildOrganizerPreferencePayload(preferences: BuilderOrganizerPreferences | null) {
  if (!preferences) return null
  return {
    builder_id: preferences.builder_id,
    event_archetype_keys: preferences.event_archetype_keys,
    event_type_labels: preferences.event_type_labels,
    preferred_amenities: preferences.preferred_amenities,
    preferred_ticket_platforms: preferences.preferred_ticket_platforms,
  }
}

export function firstKnownBuilderArchetype(preferences: BuilderOrganizerPreferences | null): string | null {
  return preferences?.event_archetype_keys.find((key) => ARCHETYPES.some((archetype) => archetype.key === key)) ?? null
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => readStringArray(item))
      .filter(Boolean)
  }
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try {
      return readStringArray(JSON.parse(trimmed) as unknown)
    } catch {
      return [trimmed]
    }
  }
  return trimmed
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizePreferenceText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/-]+/g, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}
