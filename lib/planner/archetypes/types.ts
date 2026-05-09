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

export interface VendorStackItem {
  service_type: ServiceType
  necessity: 'required' | 'recommended' | 'optional'
  notes?: string
}

export interface EventArchetypeConfig {
  key: string
  display_name: string
  aliases: string[]
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
])

export const vendorStackItemSchema = z.object({
  service_type: serviceTypeSchema,
  necessity: z.enum(['required', 'recommended', 'optional']),
  notes: z.string().trim().min(1).optional(),
})

export const eventArchetypeConfigSchema = z.object({
  key: z.string().trim().min(1),
  display_name: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)),
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
  preferred_commercial_models: z.array(commercialModelSchema).min(1),
  typical_ticket_price_range_cents: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).nullable(),
  typical_minimum_spend_cents: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).nullable(),
  red_flags: z.array(z.string().trim().min(1)),
})
