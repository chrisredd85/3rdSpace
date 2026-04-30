import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const vendorIdSchema = z.string().uuid()
const reviewSchema = z
  .object({
    vendorBookingId: z.string().uuid().optional(),
    bookingId: z.string().uuid().optional(),
    rating: z.coerce.number().int().min(1).max(5),
    reviewText: z.string().trim().min(1).max(2000),
  })
  .refine((body) => body.vendorBookingId || body.bookingId, {
    message: 'vendorBookingId is required',
    path: ['vendorBookingId'],
  })

type VendorBookingReviewRow = {
  id: string
  vendor_id: string
  organizer_id?: string | null
  status?: string | null
  booking_date?: string | null
  requested_date?: string | null
  confirmed_date?: string | null
  event_id?: string | null
}

type EventReviewRow = {
  id: string
  status?: string | null
  event_date?: string | null
  builder_id?: string | null
}

type VendorReviewRow = {
  id: string
  vendor_id: string | null
  builder_id: string | null
  vendor_booking_id: string | null
  reviewer_id: string
  rating: number
  review_text: string | null
  vendor_response: string | null
  response_date: string | null
  response_text: string | null
  responded_at: string | null
  created_at: string
}

/**
 * Resolves the event date used for post-event review eligibility.
 *
 * @param booking - Vendor booking row.
 * @param event - Event row linked to the booking.
 * @returns ISO date string or null.
 */
function getReviewableDate(booking: VendorBookingReviewRow, event: EventReviewRow | null) {
  return booking.confirmed_date || booking.requested_date || booking.booking_date || event?.event_date || null
}

/**
 * Determines whether a vendor booking is eligible for builder review.
 *
 * A builder can review only confirmed vendor bookings after the linked event is
 * completed or after the booking/event date has passed.
 *
 * @param booking - Vendor booking row.
 * @param event - Event row linked to the booking.
 * @returns True when a review can be submitted.
 */
function canReviewBooking(booking: VendorBookingReviewRow, event: EventReviewRow | null) {
  if (booking.status !== 'confirmed') return false
  if (event?.status === 'completed') return true

  const reviewableDate = getReviewableDate(booking, event)
  if (!reviewableDate) return false

  const today = new Date().toISOString().slice(0, 10)
  return reviewableDate < today
}

/**
 * Gets public reviews and rating summary for a vendor profile.
 *
 * @route GET /api/vendor/reviews?vendorId={id}
 * @auth Public
 *
 * @param request - Reviews list request.
 * @returns Published reviews, average rating, and review count.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const parsedVendorId = vendorIdSchema.safeParse(searchParams.get('vendorId'))

    if (!parsedVendorId.success) {
      return NextResponse.json({ error: 'Invalid vendor id' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: reviews, error } = await supabase
      .from('reviews')
      .select(
        `
        id,
        vendor_id,
        builder_id,
        vendor_booking_id,
        reviewer_id,
        rating,
        review_text,
        vendor_response,
        response_date,
        response_text,
        responded_at,
        created_at
      `
      )
      .eq('vendor_id', parsedVendorId.data)
      .eq('status', 'published')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[vendor.reviews] Review lookup failed', error)
      return NextResponse.json({ error: 'Failed to load reviews' }, { status: 500 })
    }

    const rows = (reviews || []) as VendorReviewRow[]
    const builderIds = Array.from(new Set(rows.map((review) => review.builder_id).filter(Boolean))) as string[]
    const reviewerProfiles = new Map<string, { name: string | null; photo_url: string | null }>()

    if (builderIds.length > 0) {
      const { data: builders, error: builderError } = await supabase
        .from('builder_profiles')
        .select('user_id, name, photo_url')
        .in('user_id', builderIds)

      if (builderError) {
        console.error('[vendor.reviews] Builder profile lookup failed', builderError)
      } else {
        for (const builder of builders || []) {
          const row = builder as { user_id: string; name: string | null; photo_url: string | null }
          reviewerProfiles.set(row.user_id, { name: row.name, photo_url: row.photo_url })
        }
      }
    }

    const publicReviews = rows.map((review) => {
      const profile = review.builder_id ? reviewerProfiles.get(review.builder_id) : null
      return {
        id: review.id,
        vendor_id: review.vendor_id,
        booking_id: review.vendor_booking_id,
        rating: review.rating,
        review_text: review.review_text,
        reviewer_name: profile?.name || '3rdSpace builder',
        reviewer_photo_url: profile?.photo_url || null,
        vendor_response: review.vendor_response || review.response_text,
        response_date: review.response_date || review.responded_at,
        created_at: review.created_at,
      }
    })

    const averageRating =
      publicReviews.length > 0
        ? publicReviews.reduce((sum, review) => sum + review.rating, 0) / publicReviews.length
        : 0

    return NextResponse.json({
      reviews: publicReviews,
      average_rating: Number(averageRating.toFixed(2)),
      review_count: publicReviews.length,
    })
  } catch (error) {
    console.error('[vendor.reviews] Unexpected GET error', error)
    return NextResponse.json({ error: 'Failed to load reviews' }, { status: 500 })
  }
}

/**
 * Submits a post-event review for a completed vendor booking.
 *
 * Builders can submit one review per vendor booking after the booking is
 * confirmed and the event has completed or the booking date has passed.
 *
 * @route POST /api/vendor/reviews
 * @auth Required - booking organizer only.
 *
 * @param request - Review submission request.
 * @returns Newly created review.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsedBody = reviewSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: parsedBody.error.errors[0]?.message || 'Invalid review payload' },
        { status: 400 }
      )
    }

    const vendorBookingId = (parsedBody.data.vendorBookingId || parsedBody.data.bookingId) as string
    const { data: booking, error: bookingError } = await supabase
      .from('vendor_bookings')
      .select('id, vendor_id, organizer_id, status, booking_date, requested_date, confirmed_date, event_id')
      .eq('id', vendorBookingId)
      .maybeSingle()

    if (bookingError) {
      console.error('[vendor.reviews] Booking lookup failed', bookingError)
      return NextResponse.json({ error: 'Failed to verify booking' }, { status: 500 })
    }

    if (!booking) {
      return NextResponse.json({ error: 'Vendor booking not found' }, { status: 404 })
    }

    const bookingRow = booking as VendorBookingReviewRow
    const { data: event } = bookingRow.event_id
      ? await supabase
          .from('events')
          .select('id, status, event_date, builder_id')
          .eq('id', bookingRow.event_id)
          .maybeSingle()
      : { data: null }
    const eventRow = (event || null) as EventReviewRow | null

    let isOrganizer = bookingRow.organizer_id === user.id
    if (!isOrganizer && eventRow?.builder_id) {
      const { data: builderProfile } = await supabase
        .from('builder_profiles')
        .select('id')
        .eq('id', eventRow.builder_id)
        .eq('user_id', user.id)
        .maybeSingle()
      isOrganizer = Boolean(builderProfile)
    }

    if (!isOrganizer) {
      return NextResponse.json({ error: 'Not authorized to review this booking' }, { status: 403 })
    }

    if (!canReviewBooking(bookingRow, eventRow)) {
      return NextResponse.json(
        { error: 'Reviews can only be submitted after a confirmed event is complete' },
        { status: 400 }
      )
    }

    const { data: vendor, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select('id, user_id')
      .eq('id', bookingRow.vendor_id)
      .maybeSingle()

    if (vendorError || !vendor) {
      console.error('[vendor.reviews] Vendor lookup failed', vendorError)
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    const { data: existingReview, error: existingError } = await supabase
      .from('reviews')
      .select('id')
      .eq('vendor_booking_id', vendorBookingId)
      .eq('reviewer_id', user.id)
      .maybeSingle()

    if (existingError) {
      console.error('[vendor.reviews] Existing review lookup failed', existingError)
      return NextResponse.json({ error: 'Failed to verify review uniqueness' }, { status: 500 })
    }

    if (existingReview) {
      return NextResponse.json({ error: 'This booking already has your review' }, { status: 409 })
    }

    const { data: review, error: insertError } = await supabase
      .from('reviews')
      .insert({
        vendor_booking_id: vendorBookingId,
        vendor_id: bookingRow.vendor_id,
        builder_id: user.id,
        reviewer_id: user.id,
        reviewee_id: (vendor as { user_id: string }).user_id,
        rating: parsedBody.data.rating,
        review_text: parsedBody.data.reviewText,
        event_type: 'vendor',
        status: 'published',
      } as never)
      .select(
        `
        id,
        vendor_id,
        builder_id,
        vendor_booking_id,
        reviewer_id,
        rating,
        review_text,
        vendor_response,
        response_date,
        created_at
      `
      )
      .single()

    if (insertError) {
      console.error('[vendor.reviews] Review insert failed', insertError)
      const status = insertError.code === '23505' ? 409 : 500
      const message = insertError.code === '23505' ? 'This booking already has your review' : 'Failed to submit review'
      return NextResponse.json({ error: message }, { status })
    }

    return NextResponse.json({ review }, { status: 201 })
  } catch (error) {
    console.error('[vendor.reviews] Unexpected POST error', error)
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 })
  }
}
