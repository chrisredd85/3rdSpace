import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  generateInvoiceFromBooking,
  getAuthenticatedVendorProfile,
  normalizeLineItems,
} from '@/lib/invoices/vendor-invoices'

export const runtime = 'nodejs'

const lineItemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.coerce.number().positive(),
  unit_price: z.coerce.number().min(0),
  total: z.coerce.number().min(0).optional(),
})

const generateInvoiceSchema = z.object({
  bookingId: z.string().uuid(),
  lineItems: z.array(lineItemSchema).optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  depositDueDate: z.string().optional(),
  finalDueDate: z.string().optional(),
})

/**
 * Lists vendor invoices for the authenticated vendor.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const vendorId = searchParams.get('vendorId')
    const supabase = createClient()
    const auth = await getAuthenticatedVendorProfile(supabase, vendorId)

    if (auth.error || !auth.vendor) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createServiceRoleClient()
    const { data: invoices, error } = await (admin as any)
      .from('vendor_invoices')
      .select('*')
      .eq('vendor_id', auth.vendor.id)
      .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)

    return NextResponse.json({
      invoices: invoices || [],
      count: invoices?.length || 0,
    })
  } catch (error) {
    console.error('[vendor.invoices] Failed to list invoices', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list invoices' },
      { status: 500 }
    )
  }
}

/**
 * Generates a draft invoice for a confirmed vendor booking.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = generateInvoiceSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid invoice request', details: parsedBody.error.flatten() }, { status: 400 })
    }

    const supabase = createClient()
    const admin = createServiceRoleClient()
    const { data: booking, error: bookingError } = await (admin as any)
      .from('vendor_bookings')
      .select('id, vendor_id, status')
      .eq('id', parsedBody.data.bookingId)
      .maybeSingle()

    if (bookingError) throw new Error(bookingError.message)
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

    const auth = await getAuthenticatedVendorProfile(supabase, booking.vendor_id)
    if (auth.error || !auth.vendor) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (booking.status !== 'confirmed') {
      return NextResponse.json({ error: 'Invoices can be generated after the vendor booking is confirmed.' }, { status: 400 })
    }

    const invoice = await generateInvoiceFromBooking({
      admin: admin as any,
      bookingId: parsedBody.data.bookingId,
      lineItems: parsedBody.data.lineItems ? normalizeLineItems(parsedBody.data.lineItems) : undefined,
      taxRate: parsedBody.data.taxRate,
      depositDueDate: parsedBody.data.depositDueDate,
      finalDueDate: parsedBody.data.finalDueDate,
      request,
    })

    return NextResponse.json({ invoice }, { status: 201 })
  } catch (error) {
    console.error('[vendor.invoices] Failed to generate invoice', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate invoice' },
      { status: 500 }
    )
  }
}
