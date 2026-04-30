import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedBuilderForBooking, getVendorBookingForPayment } from '@/lib/payments/vendor-payments'

export const runtime = 'nodejs'

/**
 * Returns vendor payment history for a booking.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const parsedBookingId = z.string().uuid().safeParse(searchParams.get('bookingId'))

    if (!parsedBookingId.success) {
      return NextResponse.json({ error: 'Invalid booking id' }, { status: 400 })
    }

    const supabase = createClient()
    const admin = createServiceRoleClient()
    const booking = await getVendorBookingForPayment(admin as any, parsedBookingId.data)

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    const auth = await getAuthenticatedBuilderForBooking(supabase, booking)
    let authorized = auth.authorized

    if (!authorized) {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const { data: vendor } = await supabase
          .from('vendor_profiles')
          .select('id')
          .eq('id', booking.vendor_id)
          .eq('user_id', user.id)
          .maybeSingle()
        authorized = Boolean(vendor)
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: 'Not authorized for this booking' }, { status: 403 })
    }

    const { data: transactions, error } = await (admin as any)
      .from('vendor_transactions')
      .select('*')
      .eq('booking_id', parsedBookingId.data)
      .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)

    return NextResponse.json({
      transactions: transactions || [],
      count: transactions?.length || 0,
    })
  } catch (error) {
    console.error('[payments.history] Failed to load payment history', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load payment history' },
      { status: 500 }
    )
  }
}
