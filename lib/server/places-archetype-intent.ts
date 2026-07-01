import 'server-only'

import type { GooglePlacesIncludedType } from '@/lib/server/google-places-client'

export type PlacesIntentClusterLabel = 'food_drink' | 'event_space' | 'hospitality' | 'mixed'

export interface PlacesIntent {
  primary_types: readonly GooglePlacesIncludedType[]
  cluster_label: PlacesIntentClusterLabel
  venue_style: string | null
  subspace_keywords: readonly string[]
}

type PlacesIntentHints = {
  venue_style?: string | null
  vibe?: string[] | null
  subspace_keywords?: string[] | null
}

const DEFAULT_INTENT: PlacesIntent = {
  primary_types: ['event_venue', 'restaurant', 'bar'],
  cluster_label: 'mixed',
  venue_style: null,
  subspace_keywords: [],
}

const MAX_TYPES_PER_SEARCH = 4

/**
 * Canonical archetype-to-Places traversal table.
 *
 * These keys mirror lib/planner/archetypes/data.ts:
 * - networking_mixer -> bar, brewery, cocktail_bar, restaurant
 * - founder_operator_dinner -> restaurant, fine_dining_restaurant, hotel, cocktail_bar
 * - brand_product_launch -> event_venue, art_gallery, museum, performing_arts_theater
 * - pop_up_activation -> event_venue, art_gallery, museum, cultural_center
 * - workshop_class -> event_venue, community_center, cafe, coffee_shop
 * - panel_fireside -> event_venue, performing_arts_theater, community_center, hotel
 * - demo_day_pitch_night -> event_venue, convention_center, hotel, banquet_hall
 * - hackathon -> event_venue, community_center, hotel, coffee_shop
 * - community_meetup -> bar, cafe, coffee_shop, community_center
 * - fundraiser_gala -> banquet_hall, museum, hotel, event_venue
 * - private_dinner_celebration -> restaurant, fine_dining_restaurant, cocktail_bar, lounge_bar
 * - day_party_brunch_party -> restaurant, cocktail_bar, lounge_bar, bar
 * - nightlife_club_night -> night_club, cocktail_bar, lounge_bar, bar
 * - listening_party_showcase -> performing_arts_theater, night_club, event_venue, cultural_center
 * - watch_party_screening -> bar, restaurant, event_venue, community_center
 * - fitness_wellness_run_club -> fitness_center, gym, sports_activity_location, cafe
 * - game_sports_outing -> sports_complex, sports_activity_location, athletic_field, bar
 * - holiday_reception -> banquet_hall, event_venue, restaurant, hotel
 * - retreat_offsite -> hotel, resort_hotel, event_venue, convention_center
 */
const ARCHETYPE_INTENTS: Record<string, Omit<PlacesIntent, 'venue_style' | 'subspace_keywords'>> = {
  networking_mixer: {
    primary_types: ['bar', 'brewery', 'cocktail_bar', 'restaurant'],
    cluster_label: 'food_drink',
  },
  founder_operator_dinner: {
    primary_types: ['restaurant', 'fine_dining_restaurant', 'hotel', 'cocktail_bar'],
    cluster_label: 'food_drink',
  },
  founder_dinner: {
    primary_types: ['restaurant', 'fine_dining_restaurant', 'hotel', 'cocktail_bar'],
    cluster_label: 'food_drink',
  },
  brand_product_launch: {
    primary_types: ['event_venue', 'art_gallery', 'museum', 'performing_arts_theater'],
    cluster_label: 'mixed',
  },
  pop_up_activation: {
    primary_types: ['event_venue', 'art_gallery', 'museum', 'cultural_center'],
    cluster_label: 'mixed',
  },
  workshop_class: {
    primary_types: ['event_venue', 'community_center', 'cafe', 'coffee_shop'],
    cluster_label: 'event_space',
  },
  workshop: {
    primary_types: ['event_venue', 'community_center', 'cafe', 'coffee_shop'],
    cluster_label: 'event_space',
  },
  panel_fireside: {
    primary_types: ['event_venue', 'performing_arts_theater', 'community_center', 'hotel'],
    cluster_label: 'event_space',
  },
  demo_day_pitch_night: {
    primary_types: ['event_venue', 'convention_center', 'hotel', 'banquet_hall'],
    cluster_label: 'event_space',
  },
  conference: {
    primary_types: ['convention_center', 'hotel', 'event_venue', 'banquet_hall'],
    cluster_label: 'event_space',
  },
  hackathon: {
    primary_types: ['event_venue', 'community_center', 'hotel', 'coffee_shop'],
    cluster_label: 'event_space',
  },
  community_meetup: {
    primary_types: ['bar', 'cafe', 'coffee_shop', 'community_center'],
    cluster_label: 'mixed',
  },
  fundraiser_gala: {
    primary_types: ['banquet_hall', 'museum', 'hotel', 'event_venue'],
    cluster_label: 'event_space',
  },
  wedding: {
    primary_types: ['wedding_venue', 'banquet_hall', 'hotel', 'resort_hotel'],
    cluster_label: 'event_space',
  },
  private_dinner_celebration: {
    primary_types: ['restaurant', 'fine_dining_restaurant', 'cocktail_bar', 'lounge_bar'],
    cluster_label: 'food_drink',
  },
  day_party_brunch_party: {
    primary_types: ['restaurant', 'cocktail_bar', 'lounge_bar', 'bar'],
    cluster_label: 'food_drink',
  },
  nightlife_club_night: {
    primary_types: ['night_club', 'cocktail_bar', 'lounge_bar', 'bar'],
    cluster_label: 'food_drink',
  },
  listening_party_showcase: {
    primary_types: ['performing_arts_theater', 'night_club', 'event_venue', 'cultural_center'],
    cluster_label: 'event_space',
  },
  ticketed_show: {
    primary_types: ['performing_arts_theater', 'night_club', 'event_venue', 'cultural_center'],
    cluster_label: 'event_space',
  },
  watch_party_screening: {
    primary_types: ['bar', 'restaurant', 'event_venue', 'community_center'],
    cluster_label: 'mixed',
  },
  fitness_wellness_run_club: {
    primary_types: ['fitness_center', 'gym', 'sports_activity_location', 'cafe'],
    cluster_label: 'event_space',
  },
  game_sports_outing: {
    primary_types: ['sports_complex', 'sports_activity_location', 'athletic_field', 'bar'],
    cluster_label: 'mixed',
  },
  holiday_reception: {
    primary_types: ['banquet_hall', 'event_venue', 'hotel', 'winery'],
    cluster_label: 'event_space',
  },
  holiday_party: {
    primary_types: ['banquet_hall', 'event_venue', 'hotel', 'winery'],
    cluster_label: 'event_space',
  },
  retreat_offsite: {
    primary_types: ['hotel', 'resort_hotel', 'event_venue', 'convention_center'],
    cluster_label: 'hospitality',
  },
  book_club: {
    primary_types: ['cafe', 'coffee_shop', 'community_center', 'museum'],
    cluster_label: 'food_drink',
  },
}

export function resolvePlacesIntent(archetype: string | null | undefined, hints: PlacesIntentHints = {}): PlacesIntent {
  const normalizedArchetype = normalizeIntentText(archetype)
  const normalizedArchetypeKey = normalizedArchetype.replace(/\s+/g, '_')
  const base = ARCHETYPE_INTENTS[normalizedArchetypeKey] ?? inferIntentFromText(normalizedArchetype) ?? DEFAULT_INTENT
  const venueStyle = normalizeIntentText(hints.venue_style)
  const subspaceKeywords = normalizeStringList(hints.subspace_keywords)
  const vibeKeywords = normalizeStringList(hints.vibe)
  const mergedKeywords = uniqueStrings([...subspaceKeywords, ...vibeKeywords])
  let clusterLabel = base.cluster_label
  let types = [...base.primary_types]

  if (venueStyle === 'hotel') {
    types = mergeTypes(['hotel', 'lodging', 'resort_hotel'], types)
    clusterLabel = 'hospitality'
  } else if (venueStyle === 'rooftop') {
    types = mergeTypes(['cocktail_bar', 'restaurant', 'event_venue'], types)
    clusterLabel = 'hospitality'
  } else if (venueStyle === 'ballroom') {
    types = mergeTypes(['banquet_hall', 'hotel', 'event_venue', 'convention_center'], types)
    clusterLabel = 'hospitality'
  } else if (venueStyle === 'private dining') {
    types = mergeTypes(['restaurant', 'fine_dining_restaurant', 'cocktail_bar'], types)
    clusterLabel = 'food_drink'
  } else if (venueStyle === 'gallery') {
    types = mergeTypes(['art_gallery', 'museum', 'event_venue', 'cultural_center'], types)
    clusterLabel = 'event_space'
  }

  if (mergedKeywords.some((keyword) => /\brooftop|ballroom|hotel|resort|lodging\b/.test(keyword))) {
    clusterLabel = 'hospitality'
  } else if (mergedKeywords.some((keyword) => /\bgallery|museum|theater|theatre|performance|showcase\b/.test(keyword))) {
    clusterLabel = 'event_space'
  }

  return {
    primary_types: capPlacesIntentTypes(types),
    cluster_label: clusterLabel,
    venue_style: venueStyle || null,
    subspace_keywords: mergedKeywords,
  }
}

export function capPlacesIntentTypes(types: readonly GooglePlacesIncludedType[]): readonly GooglePlacesIncludedType[] {
  return uniqueTypes(types).slice(0, MAX_TYPES_PER_SEARCH)
}

function inferIntentFromText(text: string): Omit<PlacesIntent, 'venue_style' | 'subspace_keywords'> | null {
  if (!text) return null
  if (/\b(conference|summit)\b/.test(text)) return ARCHETYPE_INTENTS.conference
  if (/\b(wedding)\b/.test(text)) return ARCHETYPE_INTENTS.wedding
  if (/\b(holiday|reception)\b/.test(text)) return ARCHETYPE_INTENTS.holiday_party
  if (/\b(book|reading)\b/.test(text)) return ARCHETYPE_INTENTS.book_club
  if (/\b(show|showcase|concert|performance)\b/.test(text)) return ARCHETYPE_INTENTS.ticketed_show
  if (/\b(tennis|pickleball|basketball|bowling|golf|sports outing|game outing)\b/.test(text)) return ARCHETYPE_INTENTS.game_sports_outing
  if (/\b(pilates|yoga|fitness|wellness|run club|workout)\b/.test(text)) return ARCHETYPE_INTENTS.fitness_wellness_run_club
  if (/\b(dinner|supper|private dining)\b/.test(text)) return ARCHETYPE_INTENTS.founder_dinner
  if (/\b(mixer|happy hour|networking|meetup)\b/.test(text)) return ARCHETYPE_INTENTS.networking_mixer
  if (/\b(workshop|class)\b/.test(text)) return ARCHETYPE_INTENTS.workshop
  if (/\b(offsite|retreat)\b/.test(text)) return ARCHETYPE_INTENTS.retreat_offsite
  return null
}

function mergeTypes(
  preferredTypes: readonly GooglePlacesIncludedType[],
  fallbackTypes: readonly GooglePlacesIncludedType[]
): GooglePlacesIncludedType[] {
  return uniqueTypes([...preferredTypes, ...fallbackTypes])
}

function uniqueTypes(types: readonly GooglePlacesIncludedType[]): GooglePlacesIncludedType[] {
  return [...new Set(types)]
}

function normalizeStringList(value?: readonly string[] | null): string[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeIntentText).filter(Boolean)
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function normalizeIntentText(value?: string | null) {
  return (value ?? '').toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}
