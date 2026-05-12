import { z } from 'zod'

export type CommercialModel =
  | 'flat_rental'
  | 'minimum_spend'
  | 'bar_rev_share'
  | 'per_head'
  | 'prix_fixe'
  | 'sponsor_share'
  | 'ticket_share'
  | 'ticket_split'
  | 'door_split'
  | 'package'
  | 'external_checkout'
  | 'free_space'
  | 'concierge_queue'
  | 'sponsor_covered'
  | 'guests_pay_venue'
  | 'ticket_revenue'

export type VenueType =
  | 'bar'
  | 'lounge'
  | 'rooftop'
  | 'coworking_event_space'
  | 'restaurant'
  | 'private_dining_room'
  | 'gallery'
  | 'showroom'
  | 'event_space'
  | 'retail'
  | 'cafe'
  | 'market_hall'
  | 'studio'
  | 'classroom'
  | 'theater'
  | 'auditorium'
  | 'startup_venue'
  | 'expo_space'
  | 'campus'
  | 'event_hall'
  | 'community_space'
  | 'ballroom'
  | 'restaurant_buyout'
  | 'club'
  | 'warehouse'
  | 'sports_bar'
  | 'hotel'
  | 'conference_center'
  | 'winery'
  | 'private_estate'
  | 'loft_warehouse'
  | 'outdoor_park'

export type ServiceType =
  | 'photographer'
  | 'videographer'
  | 'dj'
  | 'catering'
  | 'bartending'
  | 'av_production'
  | 'check_in'
  | 'security'
  | 'decor'
  | 'staffing'
  | 'instructor'
  | 'transport'
  | 'cake_pastry'
  | 'photo_booth'
  | 'florist'
  | 'lighting'
  | 'permits'
  | 'pos_systems'
  | 'music_coordinator'

export type MatchingField =
  | 'event_type'
  | 'neighborhood'
  | 'guest_count'
  | 'date_window'
  | 'budget_cap_cents'
  | 'ticketed'
  | 'food_responsibility'
  | 'setup_format'
  | 'private_or_shared'
  | 'indoor_outdoor'
  | 'duration_days'
  | 'duration_minutes'
  | 'av_intensity'
  | 'stage_required'
  | 'demo_stations_needed'
  | 'screens_count'
  | 'mics_count'
  | 'music_format'
  | 'lighting_intensity'
  | 'photo_video_priority'
  | 'decor_intensity'
  | 'catering_style'
  | 'bar_required'
  | 'security_needs'
  | 'check_in_needs'
  | 'sponsor_status'
  | 'preferred_commercial_model'

export interface ArchetypeMatchingFields {
  critical: MatchingField[]
  high_signal: MatchingField[]
}

/**
 * A machine-readable condition that gates a `conditional` vendor.
 * Evaluated against the plan at recommendation time.
 *
 * Examples:
 *   { field: 'guest_count', op: 'gte', value: 100 }
 *   { field: 'indoor_outdoor', op: 'eq', value: 'outdoor' }
 *   { field: 'catering_style', op: 'neq', value: 'venue_handles' }
 */
export interface VendorTrigger {
  field:
    | 'guest_count'
    | 'indoor_outdoor'
    | 'catering_style'
    | 'is_ticketed'
    | 'has_bar'
    | 'duration_hours'
    | 'venue_type'
    | 'setup_format'
    | 'music_format'
  op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'in'
  value: string | number | boolean | string[]
}

export interface VendorStackItem {
  service_type: ServiceType
  /**
   * - required: Always needed. Block or warn if missing.
   * - recommended: Strong default. Include unless budget prevents it.
   * - optional: Surface only when budget headroom allows.
   * - conditional: Evaluate `trigger` against the plan. If trigger passes, treat as recommended.
   */
  necessity: 'required' | 'recommended' | 'optional' | 'conditional'
  notes?: string
  /** Only used when necessity === 'conditional'. Defines when this vendor should activate. */
  trigger?: VendorTrigger
}

export interface EventArchetypeConfig {
  key: string
  display_name: string
  aliases: string[]
  adjacent_archetypes: string[]
  description: string
  preferred_venue_types: VenueType[]
  capacity_range: [number, number]
  capacity_ratio_min: number
  capacity_ratio_max: number
  required_amenities: string[]
  bonus_amenities: string[]
  needs_whole_venue: boolean
  catering_rule: 'kitchen_required' | 'outside_ok' | 'either' | 'na'
  vendor_stack: VendorStackItem[]
  preferred_vendor_styles?: string[]
  required_insurance?: ServiceType[]
  matching_fields: ArchetypeMatchingFields
  default_fills: Partial<Record<MatchingField, unknown>>
  preferred_commercial_models: CommercialModel[]
  typical_ticket_price_range_cents: [number, number] | null
  typical_minimum_spend_cents: [number, number] | null
  red_flags: string[]
}

export const commercialModelSchema = z.enum([
  'flat_rental',
  'minimum_spend',
  'bar_rev_share',
  'per_head',
  'prix_fixe',
  'sponsor_share',
  'ticket_share',
  'ticket_split',
  'door_split',
  'package',
  'external_checkout',
  'free_space',
  'concierge_queue',
  'sponsor_covered',
  'guests_pay_venue',
  'ticket_revenue',
])

export const venueTypeSchema = z.enum([
  'bar',
  'lounge',
  'rooftop',
  'coworking_event_space',
  'restaurant',
  'private_dining_room',
  'gallery',
  'showroom',
  'event_space',
  'retail',
  'cafe',
  'market_hall',
  'studio',
  'classroom',
  'theater',
  'auditorium',
  'startup_venue',
  'expo_space',
  'campus',
  'event_hall',
  'community_space',
  'ballroom',
  'restaurant_buyout',
  'club',
  'warehouse',
  'sports_bar',
  'hotel',
  'conference_center',
  'winery',
  'private_estate',
  'loft_warehouse',
  'outdoor_park',
])

export const serviceTypeSchema = z.enum([
  'photographer',
  'videographer',
  'dj',
  'catering',
  'bartending',
  'av_production',
  'check_in',
  'security',
  'decor',
  'staffing',
  'instructor',
  'transport',
  'cake_pastry',
  'photo_booth',
  'florist',
  'lighting',
  'permits',
  'pos_systems',
  'music_coordinator',
])

export const matchingFieldSchema = z.enum([
  'event_type',
  'neighborhood',
  'guest_count',
  'date_window',
  'budget_cap_cents',
  'ticketed',
  'food_responsibility',
  'setup_format',
  'private_or_shared',
  'indoor_outdoor',
  'duration_days',
  'duration_minutes',
  'av_intensity',
  'stage_required',
  'demo_stations_needed',
  'screens_count',
  'mics_count',
  'music_format',
  'lighting_intensity',
  'photo_video_priority',
  'decor_intensity',
  'catering_style',
  'bar_required',
  'security_needs',
  'check_in_needs',
  'sponsor_status',
  'preferred_commercial_model',
])

export const archetypeMatchingFieldsSchema = z.object({
  critical: z.array(matchingFieldSchema),
  high_signal: z.array(matchingFieldSchema),
})

export const vendorTriggerSchema = z.object({
  field: z.enum([
    'guest_count',
    'indoor_outdoor',
    'catering_style',
    'is_ticketed',
    'has_bar',
    'duration_hours',
    'venue_type',
    'setup_format',
    'music_format',
  ]),
  op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'in']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
})

export const vendorStackItemSchema = z.object({
  service_type: serviceTypeSchema,
  necessity: z.enum(['required', 'recommended', 'optional', 'conditional']),
  notes: z.string().trim().min(1).optional(),
  trigger: vendorTriggerSchema.optional(),
})

export const eventArchetypeConfigSchema = z.object({
  key: z.string().trim().min(1),
  display_name: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)),
  adjacent_archetypes: z.array(z.string().trim().min(1)).default([]),
  description: z.string().trim().min(1),
  preferred_venue_types: z.array(venueTypeSchema).min(1),
  capacity_range: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  capacity_ratio_min: z.number().positive(),
  capacity_ratio_max: z.number().positive(),
  required_amenities: z.array(z.string().trim().min(1)),
  bonus_amenities: z.array(z.string().trim().min(1)),
  needs_whole_venue: z.boolean(),
  catering_rule: z.enum(['kitchen_required', 'outside_ok', 'either', 'na']),
  vendor_stack: z.array(vendorStackItemSchema),
  preferred_vendor_styles: z.array(z.string().trim().min(1)).optional().default([]),
  required_insurance: z.array(serviceTypeSchema).optional().default([]),
  matching_fields: archetypeMatchingFieldsSchema,
  default_fills: z.record(z.string(), z.unknown()).default({}),
  preferred_commercial_models: z.array(commercialModelSchema).min(1),
  typical_ticket_price_range_cents: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).nullable(),
  typical_minimum_spend_cents: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).nullable(),
  red_flags: z.array(z.string().trim().min(1)),
})
