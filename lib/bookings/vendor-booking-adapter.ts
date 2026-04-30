import type { Database, Json } from '@/lib/types/database-generated'
import type { BookingStatus, VendorBooking } from '@/lib/types'

type VendorBookingRow = Database['public']['Tables']['vendor_bookings']['Row']
type EventRow = Database['public']['Tables']['events']['Row']
type BuilderProfileRow = Database['public']['Tables']['builder_profiles']['Row']
type VenueRow = Database['public']['Tables']['venues']['Row']
type VendorOfferingRow = Database['public']['Tables']['vendor_offerings']['Row']
type VendorPackageRow = Database['public']['Tables']['vendor_packages']['Row']
type VendorProfileRow = Database['public']['Tables']['vendor_profiles']['Row']
type UserRow = Database['public']['Tables']['users']['Row']

export type VendorBookingJoinRow = VendorBookingRow & {
  events?: (EventRow & {
    builder_profiles?: BuilderProfileRow | null
    venues?: Pick<VenueRow, 'id' | 'venue_name' | 'address' | 'city' | 'state'> | null
  }) | null
  vendor_offerings?: VendorOfferingRow | null
  vendor_packages?: VendorPackageRow | null
  vendor_profiles?: Pick<VendorProfileRow, 'id' | 'name' | 'service_type' | 'user_id'> | null
  users?: Pick<UserRow, 'id' | 'email' | 'company_name'> | null
}

export const VENDOR_BOOKING_WITH_DETAILS_SELECT = `
  *,
  users!vendor_bookings_organizer_id_fkey (
    id,
    email,
    company_name
  ),
  events (
    id,
    event_name,
    event_description,
    description,
    status,
    event_date,
    start_time,
    end_time,
    expected_attendance,
    expected_attendance_min,
    expected_attendance_max,
    budget,
    total_budget,
    builder_id,
    venue_id,
    builder_profiles!events_builder_id_fkey (
      id,
      user_id,
      name,
      phone,
      photo_url
    ),
    venues (
      id,
      venue_name,
      address,
      city,
      state
    )
  ),
  vendor_offerings (
    id,
    offering_name,
    description,
    service_category,
    duration_hours,
    base_price,
    equipment_included
  ),
  vendor_packages (
    id,
    package_name,
    description,
    price,
    duration_hours,
    inclusions
  ),
  vendor_profiles (
    id,
    name,
    service_type,
    user_id
  )
`

export function normalizeVendorBooking(row: VendorBookingJoinRow): VendorBooking & {
  events?: Record<string, unknown> | null
  vendor_profiles?: Record<string, unknown> | null
  vendor_offerings?: Record<string, unknown> | null
  vendor_packages?: Record<string, unknown> | null
} {
  const status = normalizeBookingStatus(row.status)

  return {
    ...row,
    status,
    booking_date: row.booking_date,
    requested_date: row.requested_date || row.booking_date,
    requested_start_time: row.requested_start_time || row.start_time,
    requested_end_time: row.requested_end_time || row.end_time,
    confirmed_date: row.confirmed_date,
    confirmed_start_time: row.confirmed_start_time,
    confirmed_end_time: row.confirmed_end_time,
    payment_status: normalizePaymentStatus(row.payment_status),
    deposit_paid: row.deposit_paid ?? false,
    quantity: row.quantity ?? null,
    notes: row.notes ?? row.decline_reason ?? null,
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
    events: normalizeVendorBookingEvent(row),
    vendor_profiles: row.vendor_profiles
      ? {
          id: row.vendor_profiles.id,
          name: row.vendor_profiles.name,
          service_type: row.vendor_profiles.service_type,
          user_id: row.vendor_profiles.user_id,
        }
      : null,
    vendor_offerings: row.vendor_offerings,
    vendor_packages: row.vendor_packages
      ? {
          ...row.vendor_packages,
          base_price: row.vendor_packages.price,
          includes: jsonToStringList(row.vendor_packages.inclusions),
        }
      : null,
  }
}

export function normalizeVendorBookings(rows: VendorBookingJoinRow[] | null | undefined) {
  return (rows || []).map(normalizeVendorBooking)
}

export function getVendorBookingCalendarDate(booking: Pick<VendorBooking, 'confirmed_date' | 'requested_date' | 'booking_date'> & {
  events?: { event_date?: string | null } | null
}) {
  return booking.confirmed_date || booking.requested_date || booking.booking_date || booking.events?.event_date || null
}

export function isCompletedVendorBooking(booking: Pick<VendorBooking, 'status' | 'confirmed_date' | 'requested_date' | 'booking_date'> & {
  events?: { event_date?: string | null; status?: string | null } | null
}, today: string) {
  if (booking.status !== 'confirmed') return false
  if (booking.events?.status === 'completed') return true
  const bookingDate = getVendorBookingCalendarDate(booking)
  return Boolean(bookingDate && bookingDate < today)
}

function normalizeVendorBookingEvent(row: VendorBookingJoinRow) {
  const event = row.events
  if (!event) return null

  const builderProfile = event.builder_profiles
  const organizer = row.users
  const expectedAttendees =
    event.expected_attendance ?? event.expected_attendance_min ?? event.expected_attendance_max ?? null

  return {
    ...event,
    title: event.event_name,
    description: event.event_description ?? event.description ?? null,
    expected_attendees: expectedAttendees,
    budget: event.budget ?? event.total_budget ?? null,
    profiles: {
      id: builderProfile?.user_id || organizer?.id || row.organizer_id,
      profile_id: builderProfile?.id || null,
      name: builderProfile?.name || organizer?.company_name || organizer?.email || null,
      email: organizer?.email || null,
      avatar_url: builderProfile?.photo_url || null,
      phone: builderProfile?.phone || null,
    },
    venues: event.venues
      ? {
          id: event.venues.id,
          name: event.venues.venue_name,
          address: event.venues.address,
          city: event.venues.city,
          state: event.venues.state,
        }
      : null,
  }
}

function normalizeBookingStatus(value: string | null): BookingStatus {
  if (
    value === 'pending' ||
    value === 'confirmed' ||
    value === 'declined' ||
    value === 'cancelled' ||
    value === 'completed'
  ) {
    return value
  }
  return 'pending'
}

function normalizePaymentStatus(value: string | null) {
  if (
    value === 'pending' ||
    value === 'processing' ||
    value === 'succeeded' ||
    value === 'fully_paid' ||
    value === 'failed' ||
    value === 'refunded'
  ) {
    return value
  }
  return null
}

function jsonToStringList(value: Json | null) {
  if (!Array.isArray(value)) return null
  return value.map((item) => String(item))
}
