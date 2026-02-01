import type { User as SupabaseUser } from '@supabase/supabase-js'
import type {
  UserType,
  VenueType,
  ServiceType,
  BookingStatus,
  EventStatus,
  PricingModel,
} from './enums'

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/**
 * User type extending Supabase auth user
 */
export interface User extends Omit<SupabaseUser, 'user_metadata'> {
  user_metadata: SupabaseUser['user_metadata'] & {
    name?: string
    user_type?: UserType
  }
}

/**
 * Profile table row
 */
export interface Profile {
  id: string
  email: string
  name: string | null
  user_type: UserType
  avatar_url: string | null
  bio: string | null
  phone: string | null
  website: string | null
  created_at: string
  updated_at: string
}

/**
 * Venue table row
 */
export interface Venue {
  id: string
  owner_id: string
  name: string
  description: string | null
  venue_type: VenueType
  address: string
  city: string
  state: string
  zip_code: string
  country: string
  latitude: number | null
  longitude: number | null
  capacity: number
  min_capacity: number | null
  max_capacity: number | null
  square_footage: number | null
  hourly_rate: number | null
  daily_rate: number | null
  pricing_model: PricingModel
  is_active: boolean
  is_verified: boolean
  created_at: string
  updated_at: string
}

/**
 * Venue amenity table row
 */
export interface VenueAmenity {
  id: string
  venue_id: string
  amenity_name: string
  description: string | null
  created_at: string
}

/**
 * Venue photo table row
 */
export interface VenuePhoto {
  id: string
  venue_id: string
  photo_url: string
  caption: string | null
  is_primary: boolean
  display_order: number
  created_at: string
}

/**
 * Venue requirement table row
 */
export interface VenueRequirement {
  id: string
  venue_id: string
  requirement_type: string
  requirement_description: string
  is_mandatory: boolean
  created_at: string
}

/**
 * Vendor table row
 */
export interface Vendor {
  id: string
  owner_id: string
  name: string
  description: string | null
  service_type: ServiceType
  business_name: string | null
  tax_id: string | null
  address: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  country: string | null
  phone: string | null
  email: string | null
  website: string | null
  pricing_model: PricingModel
  is_active: boolean
  is_verified: boolean
  created_at: string
  updated_at: string
}

/**
 * Vendor offering table row
 */
export interface VendorOffering {
  id: string
  vendor_id: string
  offering_name: string
  description: string | null
  base_price: number
  pricing_model: PricingModel
  min_quantity: number | null
  max_quantity: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/**
 * Vendor package table row
 */
export interface VendorPackage {
  id: string
  vendor_id: string
  package_name: string
  description: string | null
  base_price: number
  includes: string[] | null
  min_guests: number | null
  max_guests: number | null
  duration_hours: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/**
 * Event table row
 */
export interface Event {
  id: string
  builder_id: string
  title: string
  description: string | null
  event_type: string | null
  event_date: string
  start_time: string | null
  end_time: string | null
  expected_attendees: number | null
  status: EventStatus
  venue_id: string | null
  budget: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

/**
 * Venue booking table row
 */
export interface VenueBooking {
  id: string
  event_id: string
  venue_id: string
  status: BookingStatus
  requested_date: string
  requested_start_time: string | null
  requested_end_time: string | null
  confirmed_date: string | null
  confirmed_start_time: string | null
  confirmed_end_time: string | null
  quoted_price: number | null
  final_price: number | null
  deposit_amount: number | null
  deposit_paid: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

/**
 * Vendor booking table row
 */
export interface VendorBooking {
  id: string
  event_id: string
  vendor_id: string
  vendor_offering_id: string | null
  vendor_package_id: string | null
  status: BookingStatus
  requested_date: string
  requested_start_time: string | null
  requested_end_time: string | null
  confirmed_date: string | null
  confirmed_start_time: string | null
  confirmed_end_time: string | null
  quoted_price: number | null
  final_price: number | null
  quantity: number | null
  deposit_amount: number | null
  deposit_paid: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

/**
 * Availability block table row
 */
export interface AvailabilityBlock {
  id: string
  venue_id: string | null
  vendor_id: string | null
  start_date: string
  end_date: string
  start_time: string | null
  end_time: string | null
  is_available: boolean
  reason: string | null
  created_at: string
  updated_at: string
}

/**
 * Message table row
 */
export interface Message {
  id: string
  thread_id: string
  sender_id: string
  content: string
  is_read: boolean
  read_at: string | null
  created_at: string
}

/**
 * Message thread table row
 */
export interface MessageThread {
  id: string
  participant_1_id: string
  participant_2_id: string
  event_id: string | null
  venue_booking_id: string | null
  vendor_booking_id: string | null
  last_message_at: string | null
  created_at: string
  updated_at: string
}

/**
 * Saved vendor table row
 */
export interface SavedVendor {
  id: string
  user_id: string
  vendor_id: string
  notes: string | null
  created_at: string
}

/**
 * Saved venue table row
 */
export interface SavedVenue {
  id: string
  user_id: string
  venue_id: string
  notes: string | null
  created_at: string
}

/**
 * Event template table row
 */
export interface EventTemplate {
  id: string
  builder_id: string
  name: string
  description: string | null
  event_type: string | null
  expected_attendees: number | null
  budget: number | null
  venue_requirements: Json | null
  vendor_requirements: Json | null
  notes: string | null
  created_at: string
  updated_at: string
}

/**
 * Review table row
 */
export interface Review {
  id: string
  reviewer_id: string
  reviewee_id: string
  reviewee_type: 'venue' | 'vendor' | 'builder'
  event_id: string | null
  venue_booking_id: string | null
  vendor_booking_id: string | null
  rating: number
  title: string | null
  comment: string | null
  is_verified: boolean
  is_public: boolean
  created_at: string
  updated_at: string
}

/**
 * Notification table row
 */
export interface Notification {
  id: string
  user_id: string
  type: string
  title: string
  message: string
  link: string | null
  is_read: boolean
  read_at: string | null
  metadata: Json | null
  created_at: string
}

/**
 * VenueBooking with optional joined events (for list/detail views)
 */
export type VenueBookingWithEvent = VenueBooking & { events?: Event | null }

/**
 * VendorBooking with optional joined events and vendor-specific fields
 */
export type VendorBookingWithEvent = VendorBooking & {
  events?: Event | null
  setup_time?: string | null
  duration?: number | null
}

/**
 * Database type definition for Supabase
 */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Omit<Profile, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<Profile, 'id' | 'created_at'>> & {
          updated_at?: string
        }
        Relationships: []
      }
      venues: {
        Row: Venue
        Insert: Omit<Venue, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<Venue, 'id' | 'created_at'>> & {
          updated_at?: string
        }
        Relationships: []
      }
      venue_amenities: {
        Row: VenueAmenity
        Insert: Omit<VenueAmenity, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<VenueAmenity, 'id' | 'created_at'>>
        Relationships: []
      }
      venue_photos: {
        Row: VenuePhoto
        Insert: Omit<VenuePhoto, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<VenuePhoto, 'id' | 'created_at'>>
        Relationships: []
      }
      venue_requirements: {
        Row: VenueRequirement
        Insert: Omit<VenueRequirement, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<VenueRequirement, 'id' | 'created_at'>>
        Relationships: []
      }
      vendors: {
        Row: Vendor
        Insert: Omit<Vendor, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<Vendor, 'id' | 'created_at'>> & {
          updated_at?: string
        }
        Relationships: []
      }
      vendor_offerings: {
        Row: VendorOffering
        Insert: Omit<VendorOffering, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<VendorOffering, 'id' | 'created_at'>> & {
          updated_at?: string
        }
        Relationships: []
      }
      vendor_packages: {
        Row: VendorPackage
        Insert: Omit<VendorPackage, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<VendorPackage, 'id' | 'created_at'>> & {
          updated_at?: string
        }
        Relationships: []
      }
      events: {
        Row: Event
        Insert: Omit<Event, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<Event, 'id' | 'created_at'>> & {
          updated_at?: string
        }
        Relationships: []
      }
      venue_bookings: {
        Row: VenueBooking
        Insert: Omit<VenueBooking, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<VenueBooking, 'id' | 'created_at'>> & {
          updated_at?: string
        }
        Relationships: []
      }
      vendor_bookings: {
        Row: VendorBooking
        Insert: Omit<VendorBooking, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<VendorBooking, 'id' | 'created_at'>> & {
          updated_at?: string
        }
        Relationships: []
      }
      availability_blocks: {
        Row: AvailabilityBlock
        Insert: Omit<
          AvailabilityBlock,
          'id' | 'created_at' | 'updated_at'
        > & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<AvailabilityBlock, 'id' | 'created_at'>> & {
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: Message
        Insert: Omit<Message, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<Message, 'id' | 'created_at'>>
        Relationships: []
      }
      message_threads: {
        Row: MessageThread
        Insert: Omit<MessageThread, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<MessageThread, 'id' | 'created_at'>> & {
          updated_at?: string
        }
        Relationships: []
      }
      saved_vendors: {
        Row: SavedVendor
        Insert: Omit<SavedVendor, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<SavedVendor, 'id' | 'created_at'>>
        Relationships: []
      }
      saved_venues: {
        Row: SavedVenue
        Insert: Omit<SavedVenue, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<SavedVenue, 'id' | 'created_at'>>
        Relationships: []
      }
      event_templates: {
        Row: EventTemplate
        Insert: Omit<EventTemplate, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<EventTemplate, 'id' | 'created_at'>> & {
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: Review
        Insert: Omit<Review, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<Review, 'id' | 'created_at'>> & {
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: Notification
        Insert: Omit<Notification, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<Notification, 'id' | 'created_at'>>
        Relationships: []
      }
    }
    Views: Record<string, { Row: Record<string, unknown>; Relationships?: unknown[] }>
    Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }>
    Enums: {
      user_type: UserType
      venue_type: VenueType
      service_type: ServiceType
      booking_status: BookingStatus
      event_status: EventStatus
      pricing_model: PricingModel
    }
  }
}
