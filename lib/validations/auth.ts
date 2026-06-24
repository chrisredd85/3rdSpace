import { z } from "zod"
import { BUILDER_EVENT_TYPE_OPTIONS, TICKET_PLATFORM_OPTIONS, VENUE_AMENITIES } from "@/lib/constants/account-setup"
import { isUserType } from "@/lib/types"

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
})

export const signupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().min(2, "Name must be at least 2 characters"),
  user_type: z.enum(["community_builder", "venue_owner", "vendor"]),
})

// Community Builder signup schema
export const builderSignupSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  organization_name: z.string().min(2, "Organization name is required"),
  event_types: z.array(z.enum(BUILDER_EVENT_TYPE_OPTIONS)).min(1, "Select at least one event type"),
  ticket_platforms: z.array(z.enum(TICKET_PLATFORM_OPTIONS.map((platform) => platform.id) as [string, ...string[]])).default([]),
  password: z.string().min(6, "Password must be at least 6 characters"),
})

// Venue Owner signup schema
export const venueSignupSchema = z.object({
  venue_name: z.string().min(2, "Venue name must be at least 2 characters"),
  contact_name: z.string().min(2, "Contact name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  address: z.string().min(5, "Address must be at least 5 characters"),
  city: z.string().min(2, "City is required"),
  state: z.string().min(2, "State is required").max(2, "Use a 2-letter state code"),
  zip_code: z.string().min(5, "ZIP code is required"),
  venue_type: z.enum([
    "loft_warehouse",
    "gallery",
    "restaurant",
    "rooftop",
    "conference_center",
    "other",
  ]),
  capacity: z.number().min(1, "Capacity must be at least 1"),
  house_rules: z.string().min(10, "Add a few house rules or requirements"),
  amenities: z.array(z.enum(VENUE_AMENITIES.map((amenity) => amenity.id) as [string, ...string[]])).min(1, "Select at least one amenity"),
  password: z.string().min(6, "Password must be at least 6 characters"),
})

// Vendor signup schema
export const vendorSignupSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  service_type: z.enum([
    "dj",
    "catering",
    "bartending",
    "photography",
    "videography",
    "av_tech",
    "event_planning",
    "florist",
    "other",
  ]),
  bank_account_holder_name: z.string().min(2, "Bank account holder name is required"),
  bank_name: z.string().min(2, "Bank name is required"),
  availability_notes: z.string().min(10, "Tell builders when you are generally available"),
  password: z.string().min(6, "Password must be at least 6 characters"),
})

export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>
export type BuilderSignupInput = z.infer<typeof builderSignupSchema>
export type VenueSignupInput = z.infer<typeof venueSignupSchema>
export type VendorSignupInput = z.infer<typeof vendorSignupSchema>
