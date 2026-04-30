/**
 * User type enum
 */
export type UserType = 'community_builder' | 'venue_owner' | 'vendor'

/**
 * Venue type enum
 */
export type VenueType =
  | 'loft_warehouse'
  | 'gallery'
  | 'restaurant'
  | 'rooftop'
  | 'conference_center'
  | 'other'

/**
 * Service type enum for vendors
 */
export type ServiceType =
  | 'dj'
  | 'catering'
  | 'bartending'
  | 'photography'
  | 'videography'
  | 'av_tech'
  | 'event_planning'
  | 'florist'
  | 'other'

/**
 * Booking status enum
 */
export type BookingStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'completed'

/**
 * Event status enum
 */
export type EventStatus =
  | 'planning'
  | 'in_progress'
  | 'confirmed'
  | 'completed'
  | 'cancelled'

/**
 * Pricing model enum
 */
export type PricingModel =
  | 'hourly'
  | 'revenue_share'
  | 'hybrid'
  | 'flat_rate'
  | 'per_person'

/**
 * Type guard for UserType
 */
export function isUserType(value: string): value is UserType {
  return ['community_builder', 'venue_owner', 'vendor'].includes(value)
}

/**
 * Type guard for VenueType
 */
export function isVenueType(value: string): value is VenueType {
  return [
    'loft_warehouse',
    'gallery',
    'restaurant',
    'rooftop',
    'conference_center',
    'other',
  ].includes(value)
}

/**
 * Type guard for ServiceType
 */
export function isServiceType(value: string): value is ServiceType {
  return [
    'dj',
    'catering',
    'bartending',
    'photography',
    'videography',
    'av_tech',
    'event_planning',
    'florist',
    'other',
  ].includes(value)
}

/**
 * Type guard for BookingStatus
 */
export function isBookingStatus(value: string): value is BookingStatus {
  return ['pending', 'confirmed', 'declined', 'cancelled', 'completed'].includes(value)
}

/**
 * Type guard for EventStatus
 */
export function isEventStatus(value: string): value is EventStatus {
  return [
    'planning',
    'in_progress',
    'confirmed',
    'completed',
    'cancelled',
  ].includes(value)
}

/**
 * Type guard for PricingModel
 */
export function isPricingModel(value: string): value is PricingModel {
  return [
    'hourly',
    'revenue_share',
    'hybrid',
    'flat_rate',
    'per_person',
  ].includes(value)
}
