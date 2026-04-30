import type { VendorBooking } from '@/lib/types'

export type VendorBookingDashboardStatus = 'all' | 'pending' | 'confirmed' | 'completed' | 'declined' | 'cancelled'

export interface VendorBookingDashboardItem extends VendorBooking {
  events?: {
    id?: string
    title?: string | null
    event_name?: string | null
    description?: string | null
    status?: string | null
    event_date?: string | null
    start_time?: string | null
    end_time?: string | null
    expected_attendees?: number | null
    expected_attendance_min?: number | null
    expected_attendance_max?: number | null
    budget?: number | null
    builder_id?: string | null
    profiles?: {
      id?: string
      name?: string | null
      email?: string | null
      avatar_url?: string | null
    } | null
    venues?: {
      id?: string
      name?: string | null
      address?: string | null
      city?: string | null
      state?: string | null
    } | null
  } | null
  vendor_profiles?: {
    id?: string
    name?: string | null
    service_type?: string | null
  } | null
  vendor_offerings?: {
    id?: string
    offering_name?: string | null
    description?: string | null
    service_category?: string | null
    duration_hours?: number | null
    base_price?: number | null
    equipment_included?: string[] | null
  } | null
  vendor_packages?: {
    id?: string
    package_name?: string | null
    description?: string | null
    base_price?: number | null
    duration_hours?: number | null
    includes?: string[] | null
  } | null
}

/**
 * Formats currency for vendor booking dashboards.
 *
 * @param amount - Amount to format.
 * @returns Currency string or TBD.
 */
export function formatBookingMoney(amount?: number | null) {
  if (amount == null) return 'TBD'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(amount))
}

/**
 * Finds the best date for a vendor booking.
 *
 * @param booking - Vendor booking row.
 * @returns Date string or null.
 */
export function getVendorBookingDate(booking: VendorBookingDashboardItem) {
  return booking.confirmed_date || booking.requested_date || booking.booking_date || booking.events?.event_date || null
}

/**
 * Gets the display title for a vendor booking.
 *
 * @param booking - Vendor booking row.
 * @returns Event title fallback.
 */
export function getVendorBookingTitle(booking: VendorBookingDashboardItem) {
  return booking.events?.title || booking.events?.event_name || 'Event Booking Request'
}

/**
 * Gets the service/package name attached to a booking.
 *
 * @param booking - Vendor booking row.
 * @returns Service label.
 */
export function getVendorBookingServiceName(booking: VendorBookingDashboardItem) {
  return booking.vendor_offerings?.offering_name || booking.vendor_packages?.package_name || booking.vendor_profiles?.service_type || 'Service'
}

/**
 * Formats a date for compact dashboard display.
 *
 * @param value - Date string.
 * @returns Formatted date or TBD.
 */
export function formatBookingDate(value?: string | null) {
  if (!value) return 'TBD'
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Formats a time string from Postgres.
 *
 * @param value - Time string.
 * @returns Formatted time.
 */
export function formatBookingTime(value?: string | null) {
  if (!value) return null
  return new Date(`2000-01-01T${value}`).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Builds a dashboard-safe CSV value.
 *
 * @param value - Cell value.
 * @returns Escaped CSV cell.
 */
export function toCsvCell(value: unknown) {
  const text = value == null ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}
