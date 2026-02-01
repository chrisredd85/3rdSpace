/**
 * Main types export file
 * Re-exports all types from database and enums
 */

// Export all enum types and type guards
export * from './enums'

// Export all database types
export type {
  User,
  Profile,
  Venue,
  VenueAmenity,
  VenuePhoto,
  VenueRequirement,
  Vendor,
  VendorOffering,
  VendorPackage,
  Event,
  VenueBooking,
  VendorBooking,
  VenueBookingWithEvent,
  VendorBookingWithEvent,
  AvailabilityBlock,
  Message,
  MessageThread,
  SavedVendor,
  SavedVenue,
  EventTemplate,
  Review,
  Notification,
  Database,
  Json,
} from './database'

// Export helper utilities
export * from './helpers'

// Legacy type aliases for backward compatibility
export type UserRole = import('./enums').UserType
