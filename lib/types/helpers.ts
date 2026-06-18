/**
 * Type helper utilities for common type operations
 */

import type {
  UserType,
  VenueType,
  ServiceType,
  BookingStatus,
  EventStatus,
  PricingModel,
} from './enums'

/**
 * Get display name for UserType
 */
export function getUserTypeDisplayName(userType: UserType): string {
  const displayNames: Record<UserType, string> = {
    community_builder: 'Community Builder',
    venue_owner: 'Venue Owner',
    vendor: 'Vendor',
  }
  return displayNames[userType] || userType
}

/**
 * Get display name for VenueType
 */
export function getVenueTypeDisplayName(venueType: VenueType): string {
  const displayNames: Record<VenueType, string> = {
    loft_warehouse: 'Loft/Warehouse',
    gallery: 'Gallery',
    restaurant: 'Restaurant',
    rooftop: 'Rooftop',
    conference_center: 'Conference Center',
    other: 'Other',
  }
  return displayNames[venueType] || venueType
}

/**
 * Get display name for ServiceType
 */
export function getServiceTypeDisplayName(serviceType: ServiceType): string {
  const displayNames: Record<ServiceType, string> = {
    dj: 'DJ',
    catering: 'Catering',
    bartending: 'Bartending',
    photography: 'Photography',
    videography: 'Videography',
    av_tech: 'AV/Tech',
    event_planning: 'Event Planning',
    florist: 'Florist',
    other: 'Other',
  }
  return displayNames[serviceType] || serviceType
}

/**
 * Get display name for BookingStatus
 */
export function getBookingStatusDisplayName(
  status: BookingStatus
): string {
  const displayNames: Record<BookingStatus, string> = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    declined: 'Declined',
    cancelled: 'Cancelled',
    completed: 'Completed',
  }
  return displayNames[status] || status
}

/**
 * Get display name for EventStatus
 */
export function getEventStatusDisplayName(status: EventStatus): string {
  const displayNames: Record<EventStatus, string> = {
    planning: 'Planning',
    in_progress: 'In Progress',
    confirmed: 'Confirmed',
    completed: 'Completed',
    cancelled: 'Cancelled',
  }
  return displayNames[status] || status
}

/**
 * Get display name for PricingModel
 */
export function getPricingModelDisplayName(
  model: PricingModel
): string {
  const displayNames: Record<PricingModel, string> = {
    hourly: 'Hourly',
    consumption_share: 'Consumption Model',
    hybrid: 'Hybrid',
    flat_rate: 'Flat Rate',
    per_person: 'Per Person',
  }
  return displayNames[model] || model
}

/**
 * Check if booking status is active (not cancelled or declined)
 */
export function isActiveBookingStatus(status: BookingStatus): boolean {
  return status === 'pending' || status === 'confirmed'
}

/**
 * Check if event status is active (not completed or cancelled)
 */
export function isActiveEventStatus(status: EventStatus): boolean {
  return (
    status === 'planning' ||
    status === 'in_progress' ||
    status === 'confirmed'
  )
}

/**
 * Get color class for booking status (for UI)
 */
export function getBookingStatusColor(status: BookingStatus): string {
  const colors: Record<BookingStatus, string> = {
    pending: 'text-yellow-500',
    confirmed: 'text-forest-500',
    declined: 'text-gray-500',
    cancelled: 'text-red-500',
    completed: 'text-blue-500',
  }
  return colors[status] || 'text-gray-500'
}

/**
 * Get color class for event status (for UI)
 */
export function getEventStatusColor(status: EventStatus): string {
  const colors: Record<EventStatus, string> = {
    planning: 'text-blue-500',
    in_progress: 'text-yellow-500',
    confirmed: 'text-forest-500',
    completed: 'text-gray-500',
    cancelled: 'text-red-500',
  }
  return colors[status] || 'text-gray-500'
}
