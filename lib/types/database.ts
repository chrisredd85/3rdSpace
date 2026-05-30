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

export type DepositType = 'fixed' | 'percentage'

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
  owner_id: string | null
  name: string
  description: string | null
  venue_type: VenueType
  neighborhood?: string | null
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
  hourly_rate_cents?: number | null
  hourly_rate: number | null
  daily_rate_cents?: number | null
  daily_rate: number | null
  price_per_night_cents?: number | null
  pricing_model: PricingModel
  ticket_sales_share_enabled?: boolean | null
  ticket_sales_share_percent?: number | null
  bar_revenue_share_enabled?: boolean | null
  bar_revenue_share_percent?: number | null
  per_head_kickback_amount?: number | null
  per_head_kickback_cents?: number | null
  bulk_approval_enabled?: boolean | null
  auto_approve_threshold?: number | null
  auto_approve_conditions?: Json | null
  unique_features?: string | null
  unique_features_tags?: string[] | null
  contact_email: string | null
  is_claimed: boolean
  claimed_user_id: string | null
  is_admin_seeded: boolean
  requires_deposit?: boolean | null
  deposit_amount_cents?: number | null
  deposit_amount?: number | null
  deposit_type?: DepositType | null
  deposit_percentage?: number | null
  deposit_refundable?: boolean | null
  deposit_terms?: string | null
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
  amenity_type_id?: string | null
  custom_amenity_name?: string | null
  created_at: string
}

/**
 * Venue amenity master-list table row
 */
export interface VenueAmenityType {
  id: string
  name: string
  category: string
  icon: string
  description: string | null
  display_order: number
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

export type VenueRuleType = 'general' | 'insurance' | 'safety' | 'conduct'
export type VenueRuleAudience = 'all' | 'vendors' | 'organizations' | 'builders'

/**
 * Venue house rule table row
 */
export interface VenueRule {
  id: string
  venue_id: string
  title: string
  description: string
  rule_type: VenueRuleType
  applies_to: VenueRuleAudience
  is_mandatory: boolean
  display_order: number
  created_at: string
  updated_at: string
}

/**
 * Vendor table row
 */
export interface Vendor {
  id: string
  owner_id: string | null
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
  hourly_rate?: number | null
  base_rate?: number | null
  per_person_rate?: number | null
  per_head_kickback?: number | null
  contact_email: string | null
  is_claimed: boolean
  claimed_user_id: string | null
  is_admin_seeded: boolean
  requires_deposit?: boolean | null
  deposit_amount?: number | null
  deposit_type?: DepositType | null
  deposit_percentage?: number | null
  deposit_refundable?: boolean | null
  deposit_terms?: string | null
  service_area?: string | null
  regions_served?: string | null
  availability_notes?: string | null
  lead_time_days?: number | null
  cancellation_terms?: string | null
  emergency_available?: boolean | null
  emergency_rate_uplift?: number | null
  is_active: boolean
  is_verified: boolean
  created_at: string
  updated_at: string
}

export type VendorStripeAccountStatus = 'pending' | 'active' | 'restricted'

/**
 * Vendor Stripe Connect account table row
 */
export interface VendorStripeAccount {
  id: string
  vendor_id: string
  stripe_account_id: string | null
  account_status: VendorStripeAccountStatus
  charges_enabled: boolean
  payouts_enabled: boolean
  requirements_due: Json
  created_at: string
  updated_at: string
}

export type VendorPaymentStatus = 'pending' | 'processing' | 'succeeded' | 'fully_paid' | 'failed' | 'refunded'
export type VendorTransactionPaymentType = 'deposit' | 'final_payment' | 'refund'
export type VendorTransactionStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'refunded'
export type VenuePaymentMethodType = 'card' | 'us_bank_account'
export type VenuePaymentTransactionStatus =
  | 'pending_builder_payment'
  | 'checkout_created'
  | 'paid'
  | 'refund_requested'
  | 'refund_approved'
  | 'refunded_partial'
  | 'refunded_full'
  | 'cancelled'
  | 'failed'

/**
 * Vendor payment transaction table row
 */
export interface VendorTransaction {
  id: string
  booking_id: string
  vendor_id: string
  builder_id: string
  stripe_payment_intent_id: string | null
  stripe_charge_id: string | null
  stripe_transfer_id: string | null
  amount: number
  platform_fee: number
  stripe_fee: number
  vendor_payout: number
  payment_type: VendorTransactionPaymentType
  status: VendorTransactionStatus
  paid_at: string | null
  created_at: string
}

/**
 * Venue rental payment transaction table row
 */
export interface VenuePaymentTransaction {
  id: string
  plan_id: string
  venue_booking_id: string | null
  builder_id: string
  venue_id: string
  venue_owner_id: string
  amount_cents: number
  processing_fee_cents: number
  application_fee_cents: number
  venue_payout_cents: number
  currency: string
  status: VenuePaymentTransactionStatus
  payment_method_type: VenuePaymentMethodType | null
  stripe_checkout_session_id: string | null
  stripe_payment_intent_id: string | null
  stripe_charge_id: string | null
  stripe_transfer_id: string | null
  stripe_refund_id: string | null
  stripe_transfer_reversal_id: string | null
  refund_amount_cents: number | null
  refund_reason: string | null
  refund_requested_by: string | null
  refund_requested_at: string | null
  refund_approved_by: string | null
  refund_approved_at: string | null
  paid_at: string | null
  transfer_completed_at: string | null
  failed_at: string | null
  failure_reason: string | null
  created_at: string
  updated_at: string
}

export type VendorInvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'

export interface VendorInvoiceLineItem {
  description: string
  quantity: number
  unit_price: number
  total: number
}

/**
 * Vendor invoice table row
 */
export interface VendorInvoice {
  id: string
  booking_id: string
  vendor_id: string
  event_id: string
  builder_id: string
  invoice_number: string
  line_items: VendorInvoiceLineItem[] | Json
  subtotal: number
  tax_rate: number
  tax_amount: number
  total: number
  deposit_amount: number
  deposit_due_date: string | null
  deposit_paid: boolean
  deposit_paid_at: string | null
  final_amount: number
  final_due_date: string | null
  final_paid: boolean
  final_paid_at: string | null
  status: VendorInvoiceStatus
  pdf_url: string | null
  sent_at: string | null
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
  is_included?: boolean | null
  base_price: number
  pricing_model: PricingModel
  min_quantity: number | null
  max_quantity: number | null
  duration_hours: number | null
  portfolio_images: string[]
  add_ons: Json
  service_category: string
  max_capacity: number | null
  equipment_included: string[]
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
  approved_at?: string | null
  rejection_reason?: string | null
  approval_source?: 'manual' | 'bulk' | 'auto' | null
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
  organizer_id?: string | null
  vendor_offering_id: string | null
  vendor_package_id: string | null
  status: BookingStatus
  booking_date?: string | null
  start_time?: string | null
  end_time?: string | null
  setup_time?: string | null
  guest_count?: number | null
  requested_date: string
  requested_start_time: string | null
  requested_end_time: string | null
  confirmed_date: string | null
  confirmed_start_time: string | null
  confirmed_end_time: string | null
  quoted_price: number | null
  final_price: number | null
  subtotal?: number | null
  platform_fee_percentage?: number | null
  platform_fee_amount?: number | null
  total_amount?: number | null
  payment_status?: VendorPaymentStatus | null
  paid_at?: string | null
  responded_at?: string | null
  decline_reason?: string | null
  quantity: number | null
  deposit_amount: number | null
  deposit_paid: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export type VendorAvailabilityStatus = 'available' | 'booked' | 'blocked' | 'tentative'

/**
 * Vendor per-day availability table row
 */
export interface VendorAvailability {
  id: string
  vendor_id: string
  date: string
  status: VendorAvailabilityStatus
  booking_id: string | null
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
  notes?: string | null
  created_at: string
  updated_at: string
}

/**
 * Message table row
 */
export interface Message {
  id: string
  thread_id: string
  booking_id?: string | null
  venue_booking_id?: string | null
  vendor_booking_id?: string | null
  sender_id: string
  receiver_id?: string | null
  content: string
  read?: boolean | null
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
  booking_id?: string | null
  booking_type?: 'venue_booking' | 'vendor_booking' | 'general' | string | null
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
 * Event team member table row
 */
export interface EventTeamMember {
  id: string
  event_id: string
  email: string
  role: 'organizer' | 'coordinator' | 'vendor_contact'
  status: 'invited' | 'accepted' | 'declined'
  invited_at: string
  created_at: string
}

/**
 * Event task table row
 */
export interface EventTask {
  id: string
  event_id: string
  text: string
  completed: boolean
  due_date: string | null
  priority: 'low' | 'medium' | 'high'
  created_at: string
  updated_at: string
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
  booking_id: string | null
  vendor_booking_id: string | null
  vendor_id?: string | null
  builder_id?: string | null
  reviewer_id: string
  reviewee_id: string
  rating: number
  review_text: string | null
  event_type: string | null
  response_text: string | null
  responded_at: string | null
  vendor_response?: string | null
  response_date?: string | null
  status: 'pending' | 'published' | 'hidden' | string | null
  created_at: string
  updated_at: string
  reviewee_type?: 'venue' | 'vendor' | 'builder'
  event_id?: string | null
  venue_booking_id?: string | null
  title?: string | null
  comment?: string | null
  is_verified?: boolean
  is_public?: boolean
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
 * Venue booking approval audit table row
 */
export interface VenueBookingApprovalAudit {
  id: string
  venue_id: string
  booking_id: string
  actor_id: string | null
  action: 'bulk_approve' | 'bulk_reject'
  previous_status: string | null
  new_status: string
  message: string | null
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
      venue_amenity_types: {
        Row: VenueAmenityType
        Insert: Omit<VenueAmenityType, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<VenueAmenityType, 'id' | 'created_at'>>
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
      venue_rules: {
        Row: VenueRule
        Insert: Omit<VenueRule, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<VenueRule, 'id' | 'created_at'>> & {
          updated_at?: string
        }
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
      vendor_stripe_accounts: {
        Row: VendorStripeAccount
        Insert: Omit<VendorStripeAccount, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<VendorStripeAccount, 'id' | 'created_at'>> & {
          updated_at?: string
        }
        Relationships: []
      }
      vendor_transactions: {
        Row: VendorTransaction
        Insert: Omit<VendorTransaction, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<VendorTransaction, 'id' | 'created_at'>>
        Relationships: []
      }
      venue_payment_transactions: {
        Row: VenuePaymentTransaction
        Insert: {
          id?: string
          plan_id: string
          venue_booking_id?: string | null
          builder_id: string
          venue_id: string
          venue_owner_id: string
          amount_cents: number
          processing_fee_cents?: number
          application_fee_cents?: number
          venue_payout_cents: number
          currency?: string
          status?: VenuePaymentTransactionStatus
          payment_method_type?: VenuePaymentMethodType | null
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_charge_id?: string | null
          stripe_transfer_id?: string | null
          stripe_refund_id?: string | null
          stripe_transfer_reversal_id?: string | null
          refund_amount_cents?: number | null
          refund_reason?: string | null
          refund_requested_by?: string | null
          refund_requested_at?: string | null
          refund_approved_by?: string | null
          refund_approved_at?: string | null
          paid_at?: string | null
          transfer_completed_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<VenuePaymentTransaction>
        Relationships: []
      }
      vendor_invoices: {
        Row: VendorInvoice
        Insert: Omit<VendorInvoice, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<VendorInvoice, 'id' | 'created_at'>> & {
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
      venue_booking_approval_audit: {
        Row: VenueBookingApprovalAudit
        Insert: Omit<VenueBookingApprovalAudit, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<Omit<VenueBookingApprovalAudit, 'id' | 'created_at'>>
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
      vendor_availability: {
        Row: VendorAvailability
        Insert: Omit<VendorAvailability, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<VendorAvailability, 'id' | 'created_at'>> & {
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
      event_team_members: {
        Row: EventTeamMember
        Insert: Omit<EventTeamMember, 'id' | 'status' | 'invited_at' | 'created_at'> & {
          id?: string
          status?: EventTeamMember['status']
          invited_at?: string
          created_at?: string
        }
        Update: Partial<Omit<EventTeamMember, 'id' | 'event_id' | 'created_at'>>
        Relationships: []
      }
      event_tasks: {
        Row: EventTask
        Insert: Omit<EventTask, 'id' | 'completed' | 'created_at' | 'updated_at'> & {
          id?: string
          completed?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<EventTask, 'id' | 'event_id' | 'created_at'>>
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
        Insert: Partial<Omit<Review, 'id' | 'created_at' | 'updated_at'>> & {
          id?: string
          reviewer_id: string
          reviewee_id: string
          rating: number
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
