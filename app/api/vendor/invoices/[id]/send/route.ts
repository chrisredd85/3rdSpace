import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  buildInvoiceEmailHtml,
  getAuthenticatedVendorProfile,
  getInvoiceContext,
  renderInvoicePdf,
  sendInvoiceEmail,
} from '@/lib/invoices/vendor-invoices'
import { getAppBaseUrl } from '@/lib/stripe/connect'

export const runtime = 'nodejs'

const sendInvoiceSchema = z.object({
  email: z.string().email().optional(),
})

/**
 * Sends an invoice email to the client.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsedId = z.string().uuid().safeParse(params.id)
    if (!parsedId.success) {
      return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const parsedBody = sendInvoiceSchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid email payload', details: parsedBody.error.flatten() }, { status: 400 })
    }

    const supabase = createClient()
    const admin = createServiceRoleClient()
    const context = await getInvoiceContext(admin as any, parsedId.data)

    if (!context) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const auth = await getAuthenticatedVendorProfile(supabase, context.invoice.vendor_id)
    if (auth.error || !auth.vendor) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const to = parsedBody.data.email || context.builderEmail
    if (!to) {
      return NextResponse.json({ error: 'Client email is unavailable' }, { status: 400 })
    }

    const baseUrl = getAppBaseUrl(request)
    const invoiceUrl = `${baseUrl}/api/vendor/invoices/${context.invoice.id}/pdf`
    const result = await sendInvoiceEmail({
      to,
      subject: `${context.invoice.invoice_number} from ${context.vendor.name || '3rdSpace vendor'}`,
      html: buildInvoiceEmailHtml(context, invoiceUrl),
      attachment: {
        filename: `${context.invoice.invoice_number}.pdf`,
        content: renderInvoicePdf(context),
        type: 'application/pdf',
      },
    })

    if (!result.sent) {
      return NextResponse.json({ sent: false, error: result.reason }, { status: 501 })
    }

    const sentAt = new Date().toISOString()
    const { data: invoice, error: updateError } = await (admin as any)
      .from('vendor_invoices')
      .update({
        status: context.invoice.final_paid ? 'paid' : 'sent',
        sent_at: sentAt,
        updated_at: sentAt,
      })
      .eq('id', context.invoice.id)
      .select('*')
      .single()

    if (updateError) throw new Error(updateError.message)

    return NextResponse.json({ sent: true, invoice })
  } catch (error) {
    console.error('[vendor.invoices.send] Failed to send invoice', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send invoice' },
      { status: 500 }
    )
  }
}
