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
  VenueAmenityType,
  VenuePhoto,
  VenueRequirement,
  VenueRule,
  VenueRuleType,
  VenueRuleAudience,
  Vendor,
  VendorStripeAccount,
  VendorStripeAccountStatus,
  VendorPaymentStatus,
  VendorTransaction,
  VendorTransactionPaymentType,
  VendorTransactionStatus,
  VendorInvoice,
  VendorInvoiceLineItem,
  VendorInvoiceStatus,
  VendorOffering,
  VendorPackage,
  Event,
  VenueBooking,
  VendorBooking,
  VendorAvailability,
  VendorAvailabilityStatus,
  VenueBookingWithEvent,
  VendorBookingWithEvent,
  AvailabilityBlock,
  Message,
  MessageThread,
  SavedVendor,
  SavedVenue,
  EventTeamMember,
  EventTask,
  EventTemplate,
  Review,
  Notification,
  Database,
  Json,
} from './database'

// Export helper utilities
export * from './helpers'
export * from './planner'

// Legacy type aliases for backward compatibility
export type UserRole = import('./enums').UserType
