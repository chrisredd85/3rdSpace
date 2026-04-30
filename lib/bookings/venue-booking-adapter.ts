import type { Database } from '@/lib/types/database-generated'
import type { BookingStatus, VenueBooking } from '@/lib/types'
import { normalizeVenue } from '@/lib/venues/venue-adapter'

type VenueBookingRow = Database['public']['Tables']['venue_bookings']['Row']
type EventRow = Database['public']['Tables']['events']['Row']
type BuilderProfileRow = Database['public']['Tables']['builder_profiles']['Row']
type VenueRow = Database['public']['Tables']['venues']['Row']

export type VenueBookingJoinRow = VenueBookingRow & {
  events?: (EventRow & {
    builder_profiles?: BuilderProfileRow | null
  }) | null
  venues?: VenueRow | null
  auto_approval?: {
    eligible: boolean
    reasons: string[]
  }
}

export const VENUE_BOOKING_WITH_DETAILS_SELECT = `
  *,
  events (
    id,
    event_name,
    event_date,
    start_time,
    end_time,
    expected_attendance,
    expected_attendance_min,
    expected_attendance_max,
    budget,
    total_budget,
    event_description,
    description,
    builder_id,
    builder_profiles!events_builder_id_fkey (
      id,
      user_id,
      name,
      phone,
      photo_url
    )
  ),
  venues (
    id,
    owner_id,
    venue_name,
    address,
    city,
    state,
    hourly_rate,
    minimum_hours,
    standing_capacity,
    seated_capacity,
    ticket_sales_share_enabled,
    ticket_sales_share_percent,
    bar_revenue_share_enabled,
    bar_revenue_share_percent,
    bar_revenue_percentage,
    per_head_kickback,
    per_head_kickback_amount,
    is_published,
    bulk_approval_enabled,
    auto_approve_threshold,
    auto_approve_conditions
  )
`

/**
 * Converts a venue_bookings row into the app-facing VenueBooking DTO.
 *
 * The canonical DB table stores booking_date/start_time/end_time and
 * special_requests. Older UI surfaces still read requested_* and notes.
 */
export function normalizeVenueBooking(row: VenueBookingJoinRow): VenueBooking & {
  events?: Record<string, unknown> | null
  venues?: Record<string, unknown> | null
  auto_approval?: VenueBookingJoinRow['auto_approval']
} {
  const status = (row.status || 'pending') as BookingStatus
  const approvalSource =
    row.approval_source === 'manual' || row.approval_source === 'bulk' || row.approval_source === 'auto'
      ? row.approval_source
      : null
  const rejectionReason = row.rejection_reason ?? row.decline_reason ?? null

  return {
    id: row.id,
    event_id: row.event_id,
    venue_id: row.venue_id,
    status,
    approval_source: approvalSource,
    requested_date: row.booking_date,
    requested_start_time: row.start_time,
    requested_end_time: row.end_time,
    confirmed_date: status === 'confirmed' ? row.booking_date : null,
    confirmed_start_time: status === 'confirmed' ? row.start_time : null,
    confirmed_end_time: status === 'confirmed' ? row.end_time : null,
    deposit_amount: null,
    deposit_paid: row.payment_status === 'succeeded',
    quoted_price: row.quoted_price,
    final_price: row.final_price,
    approved_at: row.approved_at,
    rejection_reason: rejectionReason,
    notes: row.special_requests ?? rejectionReason,
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
    events: normalizeBookingEvent(row.events),
    venues: row.venues ? (normalizeVenue(row.venues) as unknown as Record<string, unknown>) : null,
    auto_approval: row.auto_approval,
  }
}

export function normalizeVenueBookings(rows: VenueBookingJoinRow[] | null | undefined) {
  return (rows || []).map(normalizeVenueBooking)
}

/**
 * Converts app-facing booking update fields into venue_bookings columns.
 */
export function toVenueBookingUpdate(updates: {
  status?: BookingStatus
  confirmed_date?: string | null
  confirmed_start_time?: string | null
  confirmed_end_time?: string | null
  final_price?: number | null
  quoted_price?: number | null
  notes?: string | null
}) {
  const row: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (updates.status !== undefined) row.status = updates.status
  if (updates.confirmed_date !== undefined && updates.confirmed_date !== null) {
    row.booking_date = updates.confirmed_date
  }
  if (updates.confirmed_start_time !== undefined) row.start_time = updates.confirmed_start_time
  if (updates.confirmed_end_time !== undefined) row.end_time = updates.confirmed_end_time
  if (updates.final_price !== undefined) row.final_price = updates.final_price
  if (updates.quoted_price !== undefined) row.quoted_price = updates.quoted_price
  if (updates.notes !== undefined) row.special_requests = updates.notes

  if (updates.status === 'confirmed') {
    row.approved_at = new Date().toISOString()
    row.approval_source = row.approval_source ?? 'manual'
    row.rejection_reason = null
  }

  if (updates.status === 'declined' && updates.notes) {
    row.rejection_reason = updates.notes
    row.decline_reason = updates.notes
  }

  return row
}

function normalizeBookingEvent(event: VenueBookingJoinRow['events']) {
  if (!event) return null

  const builderProfile = event.builder_profiles ?? null
  const expectedAttendees =
    event.expected_attendance ?? event.expected_attendance_min ?? event.expected_attendance_max ?? null

  return {
    ...event,
    title: event.event_name,
    description: event.event_description ?? event.description ?? null,
    expected_attendees: expectedAttendees,
    budget: event.budget ?? event.total_budget ?? null,
    profiles: builderProfile
      ? {
          id: builderProfile.user_id,
          profile_id: builderProfile.id,
          name: builderProfile.name,
          email: null,
          avatar_url: builderProfile.photo_url,
          phone: builderProfile.phone,
        }
      : null,
  }
}
