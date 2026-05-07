export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  buildInvoiceEmailHtml,
  generateInvoiceFromBooking,
  getInvoiceContext,
  renderAndStoreInvoicePdf,
  sendInvoiceEmail,
} from '@/lib/invoices/vendor-invoices'

export const runtime = 'nodejs'

const generateInvoiceSchema = z.object({
  bookingId: z.string().uuid(),
  regenerate: z.boolean().optional(),
})

/**
 * Verifies that the signed-in user is either the booking's builder or vendor.
 *
 * @param admin - Supabase service-role client.
 * @param bookingId - Vendor booking id.
 * @param userId - Authenticated user id.
 * @returns Authorization result and booking metadata.
 */
async function authorizeInvoiceAccess(admin: any, bookingId: string, userId: string) {
  const { data: booking, error } = await admin
    .from('vendor_bookings')
    .select('id, vendor_id, event_id, events!inner(builder_id)')
    .eq('id', bookingId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!booking) return { authorized: false, status: 404, error: 'Booking not found', booking: null }

  const [vendorResult, builderResult] = await Promise.all([
    admin
      .from('vendor_profiles')
      .select('id')
      .eq('id', booking.vendor_id)
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .from('builder_profiles')
      .select('id')
      .eq('id', booking.events?.builder_id)
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  if (vendorResult.error) throw new Error(vendorResult.error.message)
  if (builderResult.error) throw new Error(builderResult.error.message)

  const authorized = Boolean(vendorResult.data || builderResult.data)
  return {
    authorized,
    status: authorized ? 200 : 403,
    error: authorized ? null : 'Not authorized',
    booking,
  }
}

/**
 * Sends an invoice-ready email to the builder when email delivery is configured.
 *
 * @param admin - Supabase service-role client.
 * @param invoiceId - Generated invoice id.
 * @param pdfUrl - Public URL for the stored PDF.
 * @param pdf - PDF bytes for attachment.
 */
async function emailInvoiceToBuilder(admin: any, invoiceId: string, pdfUrl: string, pdf: Buffer) {
  const context = await getInvoiceContext(admin, invoiceId)
  if (!context?.builderEmail) {
    return { sent: false, reason: 'Builder email is unavailable' }
  }

  return sendInvoiceEmail({
    to: context.builderEmail,
    subject: `${context.invoice.invoice_number} from ${context.vendor.name || '3rdPlace vendor'}`,
    html: buildInvoiceEmailHtml(context, pdfUrl),
    attachment: {
      filename: `${context.invoice.invoice_number}.pdf`,
      content: pdf,
      type: 'application/pdf',
    },
  })
}

/**
 * Generates, stores, and emails a professional PDF invoice for a vendor booking.
 *
 * @route POST /api/invoices/generate
 * @auth Required - booking builder or vendor.
 *
 * @param request - JSON body containing bookingId and optional regenerate flag.
 * @returns Invoice details with PDF URL.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = generateInvoiceSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid invoice generation payload', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const supabase = createClient()
    const admin = createServiceRoleClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const auth = await authorizeInvoiceAccess(admin as any, parsedBody.data.bookingId, user.id)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { data: existingInvoices, error: existingError } = await (admin as any)
      .from('vendor_invoices')
      .select('*')
      .eq('booking_id', parsedBody.data.bookingId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (existingError) throw new Error(existingError.message)

    let invoice = existingInvoices?.[0] || null
    let pdfResult:
      | Awaited<ReturnType<typeof renderAndStoreInvoicePdf>>
      | null = null

    if (!invoice || parsedBody.data.regenerate) {
      invoice = await generateInvoiceFromBooking({
        admin: admin as any,
        bookingId: parsedBody.data.bookingId,
        request,
      })
    }

    if (!invoice.pdf_url || parsedBody.data.regenerate) {
      try {
        pdfResult = await renderAndStoreInvoicePdf(admin as any, invoice.id)
        invoice = pdfResult.invoice
      } catch (pdfError) {
        console.error('[invoices.generate] PDF generation/storage failed', pdfError)
        return NextResponse.json(
          { error: pdfError instanceof Error ? pdfError.message : 'Failed to generate invoice PDF' },
          { status: 500 }
        )
      }
    }

    if (pdfResult) {
      try {
        const emailResult = await emailInvoiceToBuilder(
          admin as any,
          invoice.id,
          pdfResult.pdfUrl,
          pdfResult.pdf
        )

        if (!emailResult.sent) {
          console.warn('[invoices.generate] Invoice email skipped', emailResult.reason)
        }
      } catch (emailError) {
        console.error('[invoices.generate] Invoice email failed', emailError)
      }
    }

    return NextResponse.json({ invoice })
  } catch (error) {
    console.error('[invoices.generate] Failed to generate invoice', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate invoice' },
      { status: 500 }
    )
  }
}
