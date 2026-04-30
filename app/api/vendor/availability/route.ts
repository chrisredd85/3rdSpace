import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { VendorAvailability, VendorAvailabilityStatus } from '@/lib/types'

const availabilityStatusSchema = z.enum(['available', 'booked', 'blocked', 'tentative'])

const saveAvailabilitySchema = z.object({
  vendorId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: availabilityStatusSchema,
  notes: z.string().max(500).optional().nullable(),
})

type VendorBookingCalendarRow = {
  id: string
  vendor_id: string
  status: string | null
  booking_date?: string | null
  requested_date?: string | null
  confirmed_date?: string | null
  event_id?: string | null
  events?: { id?: string; event_name?: string; title?: string; event_date?: string } | null
}

/**
 * Returns YYYY-MM-DD for a Date using UTC date parts.
 *
 * @param date - Date to format.
 * @returns ISO date string.
 */
function formatDate(date: Date) {
  return date.toISOString().split('T')[0]
}

/**
 * Parses a YYYY-MM month into start/end dates.
 *
 * @param month - Month string in YYYY-MM format.
 * @returns Month range and numeric parts.
 */
function parseMonth(month: string | null, yearParam: string | null, monthParam: string | null) {
  if (month) {
    const parsed = /^(\d{4})-(\d{2})$/.exec(month)
    if (!parsed) return null
    const year = Number(parsed[1])
    const monthNumber = Number(parsed[2])
    if (monthNumber < 1 || monthNumber > 12) return null
    return {
      year,
      month: monthNumber,
      start: new Date(Date.UTC(year, monthNumber - 1, 1)),
      end: new Date(Date.UTC(year, monthNumber, 0)),
    }
  }

  const year = Number(yearParam || new Date().getFullYear())
  const monthNumber = Number(monthParam || new Date().getMonth() + 1)
  if (!year || monthNumber < 1 || monthNumber > 12) return null
  return {
    year,
    month: monthNumber,
    start: new Date(Date.UTC(year, monthNumber - 1, 1)),
    end: new Date(Date.UTC(year, monthNumber, 0)),
  }
}

/**
 * Lists every date between start and end, inclusive.
 *
 * @param startDate - Start date string.
 * @param endDate - End date string.
 * @returns Date strings in YYYY-MM-DD format.
 */
function expandDateRange(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  const dates: string[] = []

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return dates

  const current = new Date(start)
  while (current <= end) {
    dates.push(formatDate(current))
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return dates
}

/**
 * Resolves a booking's calendar date from confirmed/requested/legacy fields.
 *
 * @param booking - Vendor booking row.
 * @returns Booking date string or null.
 */
function getBookingDate(booking: VendorBookingCalendarRow) {
  if (booking.status === 'confirmed') {
    return booking.confirmed_date || booking.requested_date || booking.booking_date || null
  }
  return booking.requested_date || booking.booking_date || booking.confirmed_date || null
}

/**
 * Loads an owned vendor id for authenticated vendor writes.
 *
 * @param supabase - Request-scoped Supabase client.
 * @param vendorId - Optional vendor id to verify.
 * @returns Vendor id or a JSON response.
 */
async function requireOwnedVendor(supabase: ReturnType<typeof createClient>, vendorId?: string) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  let query = supabase
    .from('vendor_profiles')
    .select('id')
    .eq('user_id', user.id)

  if (vendorId) query = query.eq('id', vendorId)

  const { data: vendor, error } = await query.limit(1).maybeSingle()

  if (error) {
    console.error('[vendor.availability] Vendor lookup failed', error)
    return { ok: false as const, response: NextResponse.json({ error: 'Failed to verify vendor' }, { status: 500 }) }
  }

  if (!vendor) {
    return { ok: false as const, response: NextResponse.json({ error: 'Vendor profile not found' }, { status: 403 }) }
  }

  return { ok: true as const, vendorId: (vendor as { id: string }).id }
}

/**
 * Checks if a manual availability status can be saved for the date.
 *
 * @param supabase - Supabase client.
 * @param vendorId - Vendor id.
 * @param date - Date to check.
 * @param status - New status.
 * @returns Error message when blocked by a booking, otherwise null.
 */
async function validateManualStatus(
  supabase: ReturnType<typeof createClient>,
  vendorId: string,
  date: string,
  status: VendorAvailabilityStatus
) {
  if (!['blocked', 'tentative', 'available'].includes(status)) {
    return 'Manual availability can only be set to available, tentative, or blocked'
  }

  const { data: bookings } = await supabase
    .from('vendor_bookings')
    .select('id, status, booking_date, requested_date, confirmed_date')
    .eq('vendor_id', vendorId)
    .in('status', ['pending', 'confirmed'])

  const conflicts = ((bookings as VendorBookingCalendarRow[] | null) || [])
    .filter((booking) => getBookingDate(booking) === date)

  if (conflicts.length > 0 && status !== 'available') {
    return `Date already has a ${conflicts[0].status} booking`
  }

  if (conflicts.length > 0 && status === 'available') {
    return 'Cannot mark a booked or tentative date as available'
  }

  return null
}

/**
 * Gets vendor availability for a month.
 *
 * @route GET /api/vendor/availability?vendorId={id}&month={YYYY-MM}
 * @auth Public when vendorId is provided; authenticated vendor may omit vendorId.
 *
 * @param request - Availability query request.
 * @returns Availability rows, derived day statuses, and booking dates.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    const { searchParams } = request.nextUrl
    const vendorIdParam = searchParams.get('vendorId')
    const rawMonth = searchParams.get('month')
    const month = parseMonth(
      rawMonth && /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : null,
      searchParams.get('year'),
      searchParams.get('monthNumber') || searchParams.get('monthIndex') || rawMonth
    )

    if (!month) {
      return NextResponse.json({ error: 'Invalid month. Use month=YYYY-MM or year/month params.' }, { status: 400 })
    }

    let vendorId = vendorIdParam || ''
    if (vendorId) {
      const parsedVendorId = z.string().uuid().safeParse(vendorId)
      if (!parsedVendorId.success) return NextResponse.json({ error: 'Invalid vendor id' }, { status: 400 })
      vendorId = parsedVendorId.data
    } else {
      const ownership = await requireOwnedVendor(supabase)
      if (!ownership.ok) return ownership.response
      vendorId = ownership.vendorId
    }

    const startDate = formatDate(month.start)
    const endDate = formatDate(month.end)

    const { data: availability, error: availabilityError } = await supabase
      .from('vendor_availability')
      .select('*')
      .eq('vendor_id', vendorId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })

    if (availabilityError) {
      console.error('[vendor.availability] Failed to load availability', availabilityError)
      return NextResponse.json({ error: 'Failed to load availability' }, { status: 500 })
    }

    const { data: bookings, error: bookingsError } = await supabase
      .from('vendor_bookings')
      .select(`
        id,
        vendor_id,
        event_id,
        status,
        booking_date,
        requested_date,
        confirmed_date,
        events (
          id,
          event_name,
          event_date
        )
      `)
      .eq('vendor_id', vendorId)
      .in('status', ['pending', 'confirmed'])

    if (bookingsError) {
      console.error('[vendor.availability] Failed to load bookings', bookingsError)
      return NextResponse.json({ error: 'Failed to load bookings' }, { status: 500 })
    }

    const days = expandDateRange(startDate, endDate).map((date) => {
      const row = ((availability as VendorAvailability[] | null) || []).find((item) => item.date === date)
      const booking = ((bookings as VendorBookingCalendarRow[] | null) || []).find((item) => getBookingDate(item) === date)
      const status = row?.status || (booking?.status === 'confirmed' ? 'booked' : booking?.status === 'pending' ? 'tentative' : 'available')

      return {
        date,
        status,
        availability: row || null,
        booking: booking || null,
        notes: row?.notes || null,
      }
    })

    return NextResponse.json({
      vendorId,
      month: { year: month.year, month: month.month, value: `${month.year}-${String(month.month).padStart(2, '0')}` },
      availability: availability || [],
      bookings: bookings || [],
      days,
      bookedDates: days.filter((day) => day.status === 'booked').map((day) => day.date),
      blockedDates: days.filter((day) => day.status === 'blocked').map((day) => day.date),
      tentativeDates: days.filter((day) => day.status === 'tentative').map((day) => day.date),
      availableDates: days.filter((day) => day.status === 'available').map((day) => day.date),
    })
  } catch (error) {
    console.error('[vendor.availability] Unexpected GET error', error)
    return NextResponse.json({ error: 'Failed to load availability' }, { status: 500 })
  }
}

/**
 * Marks one or more vendor dates as available, tentative, or blocked.
 *
 * @route POST /api/vendor/availability
 * @auth Required - vendor owner only.
 *
 * @param request - Availability status payload.
 * @returns Saved availability rows.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const parsedBody = saveAvailabilitySchema.safeParse(await request.json())

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid availability payload', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const body = parsedBody.data
    const ownership = await requireOwnedVendor(supabase, body.vendorId)
    if (!ownership.ok) return ownership.response

    const dates = body.dates?.length
      ? body.dates
      : body.date
      ? [body.date]
      : body.startDate && body.endDate
      ? expandDateRange(body.startDate, body.endDate)
      : []

    if (dates.length === 0) {
      return NextResponse.json({ error: 'At least one date is required' }, { status: 400 })
    }

    for (const date of dates) {
      const validationError = await validateManualStatus(supabase, ownership.vendorId, date, body.status)
      if (validationError) return NextResponse.json({ error: validationError, date }, { status: 409 })
    }

    const { data, error } = await (supabase as any)
      .rpc('save_vendor_manual_availability', {
        p_vendor_id: ownership.vendorId,
        p_dates: dates,
        p_status: body.status,
        p_notes: body.notes || null,
      })

    if (error) {
      console.error('[vendor.availability] Failed to save availability', error)
      return NextResponse.json({ error: 'Failed to save availability' }, { status: 500 })
    }

    if ((data || []).length !== dates.length) {
      return NextResponse.json(
        { error: 'Cannot update one or more dates because a booking now holds them' },
        { status: 409 }
      )
    }

    return NextResponse.json({ availability: data || [] })
  } catch (error) {
    console.error('[vendor.availability] Unexpected POST error', error)
    return NextResponse.json({ error: 'Failed to save availability' }, { status: 500 })
  }
}
