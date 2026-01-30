import { z } from "zod"
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
  password: z.string().min(6, "Password must be at least 6 characters"),
})

// Venue Owner signup schema
export const venueSignupSchema = z.object({
  venue_name: z.string().min(2, "Venue name must be at least 2 characters"),
  contact_name: z.string().min(2, "Contact name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(10, "Phone number must be at least 10 digits"),
  venue_type: z.enum([
    "loft_warehouse",
    "gallery",
    "restaurant",
    "rooftop",
    "conference_center",
    "other",
  ]),
  capacity: z.number().min(1, "Capacity must be at least 1"),
  password: z.string().min(6, "Password must be at least 6 characters"),
})

// Vendor signup schema
export const vendorSignupSchema = z.object({
  business_name: z.string().min(2, "Business name must be at least 2 characters"),
  your_name: z.string().min(2, "Your name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(10, "Phone number must be at least 10 digits"),
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
  service_area: z.string().min(2, "Service area must be specified"),
  password: z.string().min(6, "Password must be at least 6 characters"),
})

export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>
export type BuilderSignupInput = z.infer<typeof builderSignupSchema>
export type VenueSignupInput = z.infer<typeof venueSignupSchema>
export type VendorSignupInput = z.infer<typeof vendorSignupSchema>
